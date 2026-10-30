import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../common/database/prisma.service';
import { CreativeService } from '../../creative/creative.service';
import { StrategistService } from '../../strategist/strategist.service';
import { slotCost } from '../pilot-estimate';
import type { PilotStep, StepResult } from '../pilot-runner.service';
import { optionsOf, stepsOf, type PilotRunRow, type Slot } from '../pilot.types';

type JobCost = { id: string; actual_cost: Prisma.Decimal | number | null; estimated_cost: Prisma.Decimal | number | null };

/**
 * Créditos já gastos pelas peças do piloto: custo real do job, ou o estimado; peça ainda gerando sem custo no job (o vídeo nasce assim)
 * conta o custo máximo dela, para o teto não deixar passar outra peça contando 0. Derivado, nunca guardado.
 */
export function spentCredits(slots: Slot[], jobs: JobCost[], variations = 3): number {
  const byId = new Map(jobs.map((j) => [j.id, j]));
  let total = 0;
  for (const s of slots) {
    if (!s.job_id) continue;
    const j = byId.get(s.job_id);
    const cost = j ? (j.actual_cost ?? j.estimated_cost) : null;
    if (cost != null) total += Number(cost);
    else if (s.status === 'waiting') total += slotCost(s.kind, variations);
  }
  return Math.round(total * 100) / 100;
}

type PilotJob = { id: string; status: string; creative_id: string | null; error_message: string | null; options: unknown };
const pilotMark = (j: PilotJob) => (j.options as { pilot?: { run_id?: string; slot?: number } } | null)?.pilot;

const br = (n: number) => String(Math.round(n * 100) / 100).replace('.', ',');

/**
 * Artes e vídeo do anúncio, UMA peça por rodada: imagem pelo caminho dirigido de sempre (variações + crítico + 1 refação); vídeo
 * assíncrono (o `creative-poll-5min` termina e a vaga sai de `waiting`). Antes de cada peça, gasto + custo máximo dela ≤ teto.
 * Proveniência em `creatives.extras.pilot`, gravada só com a peça pronta (o poller do vídeo grava `extras` e não pode apagá-la).
 */
@Injectable()
export class CreativesStep implements PilotStep {
  constructor(
    private readonly prisma: PrismaService,
    private readonly strategist: StrategistService,
    private readonly creative: CreativeService,
  ) {}

  async run(run: PilotRunRow): Promise<StepResult> {
    const o = optionsOf(run);
    const ws = run.workspace_id;
    const saved = stepsOf(run).creatives?.slots;
    if (!saved?.length) return { kind: 'again', state: { slots: await this.buildSlots(run) } };
    const slots: Slot[] = structuredClone(saved);

    // (a) vídeos que estavam gerando
    for (const s of slots.filter((x) => x.status === 'waiting' && x.job_id)) {
      const job = await this.prisma.creative_generation_jobs.findFirst({ where: { id: s.job_id!, workspace_id: ws }, select: { status: true, creative_id: true, error_message: true } });
      if (job?.status === 'ready' && job.creative_id) {
        Object.assign(s, { status: 'done', creative_id: job.creative_id });
        await this.mark(run, s);
      } else if (!job || job.status === 'failed') {
        Object.assign(s, { status: 'failed', error: job?.error_message ?? 'O vídeo não ficou pronto.' });
      }
    }

    // (b) no máximo uma peça nova — antes, adota a que uma rodada descartada já gerou para esta vaga (marcada no job)
    const next = slots.find((x) => x.status === 'pending');
    const adopted = next ? await this.adopt(run, next, slots) : false;
    if (next && !adopted) {
      const jobIds = slots.map((x) => x.job_id).filter(Boolean) as string[];
      const jobs = jobIds.length
        ? await this.prisma.creative_generation_jobs.findMany({ where: { id: { in: jobIds }, workspace_id: ws }, select: { id: true, actual_cost: true, estimated_cost: true } })
        : [];
      const max = Number(run.max_credits ?? o.max_credits);
      if (spentCredits(slots, jobs, o.variations) + slotCost(next.kind, o.variations) > max) {
        const done = slots.filter((x) => x.status === 'done').length;
        return { kind: 'blocked', code: 'COST_CAP', message: `Chegamos ao teto de ${br(max)} créditos com ${done} de ${slots.length} artes prontas.`, stopRun: true, state: { slots } };
      }
      const camp = await this.prisma.campaigns.findFirst({ where: { id: run.campaign_id, workspace_id: ws }, select: { name: true, brand_id: true } });
      const video = next.kind === 'video';
      const out = await this.creative.generateAsSystem(
        {
          workspaceId: ws, campaignId: run.campaign_id, brandId: camp?.brand_id ?? null, title: `${camp?.name ?? 'Campanha'} · ${next.angle}`,
          type: video ? 'reels' : 'static_image', aspectRatio: video ? '9:16' : '4:5', angle: next.angle, variations: o.variations, provider: 'auto', useBrandImage: true,
        },
        run.approved_by ?? run.created_by,
        { runId: run.id, slot: next.slot },
      );
      next.job_id = out.jobId;
      if (out.status === 'ready' && out.creativeId) {
        Object.assign(next, { status: 'done', creative_id: out.creativeId, score: out.variations.find((v) => v.winner)?.score?.total ?? null });
        await this.mark(run, next);
      } else if (out.status === 'generating') {
        Object.assign(next, { status: 'waiting', creative_id: out.creativeId ?? null });
      } else if (out.error?.startsWith('Créditos de IA esgotados')) {
        // A geração devolve a falha (não lança): sem crédito, as próximas peças falhariam todas — para e diz o motivo.
        Object.assign(next, { status: 'failed', error: out.error });
        return { kind: 'blocked', code: 'AI_NO_CREDITS', message: out.error, stopRun: true, state: { slots } };
      } else {
        Object.assign(next, { status: 'failed', error: out.error ?? 'A arte não ficou pronta.' });
      }
    }

    if (slots.some((x) => x.status === 'pending')) return { kind: 'again', state: { slots } };
    if (slots.some((x) => x.status === 'waiting')) return { kind: 'wait', minutes: 5, state: { slots } };
    const done = slots.filter((x) => x.status === 'done').length;
    if (!done) return { kind: 'blocked', code: 'NO_CREATIVE_MADE', message: 'Nenhuma arte ficou pronta.', stopRun: true, state: { slots } };
    return { kind: 'done', note: `${done} de ${slots.length} prontas`, state: { slots } };
  }

  /** Peça desta vaga já pedida por uma rodada que não gravou: liga o job à vaga e segue o estado dele. `true` = adotou (é a ação da rodada). */
  private async adopt(run: PilotRunRow, slot: Slot, slots: Slot[]): Promise<boolean> {
    const known = new Set(slots.map((s) => s.job_id).filter(Boolean));
    const jobs: PilotJob[] = await this.prisma.creative_generation_jobs.findMany({
      where: { workspace_id: run.workspace_id, campaign_id: run.campaign_id, ...(run.approved_at ? { created_at: { gte: run.approved_at } } : {}) },
      select: { id: true, status: true, creative_id: true, error_message: true, options: true },
    });
    const job = jobs.find((j) => !known.has(j.id) && pilotMark(j)?.run_id === run.id && pilotMark(j)?.slot === slot.slot);
    if (!job) return false;
    slot.job_id = job.id;
    if (job.status === 'ready' && job.creative_id) {
      Object.assign(slot, { status: 'done', creative_id: job.creative_id });
      await this.mark(run, slot);
    } else if (job.status === 'failed') {
      Object.assign(slot, { status: 'failed', error: job.error_message ?? 'A arte não ficou pronta.' });
    } else {
      slot.status = 'waiting';
    }
    return true;
  }

  /** Vagas: os primeiros `max_angles` ângulos da estratégia aprovada × `images_per_angle` imagens; depois os vídeos (1º ângulo). */
  private async buildSlots(run: PilotRunRow): Promise<Slot[]> {
    const o = optionsOf(run);
    const s = await this.strategist.currentStrategy(run.workspace_id, run.campaign_id);
    const names = (s?.angulos_detalhados ?? []).map((a) => a?.nome).filter((n): n is string => !!n).slice(0, o.max_angles);
    const angles = names.length ? names : ['Principal'];
    const slots: Slot[] = [];
    for (const angle of angles) for (let i = 0; i < o.images_per_angle; i++) slots.push({ slot: slots.length + 1, kind: 'image', angle, status: 'pending' });
    for (let i = 0; i < o.videos; i++) slots.push({ slot: slots.length + 1, kind: 'video', angle: angles[0]!, status: 'pending' });
    return slots;
  }

  /** Proveniência: soma ao `extras` que o criativo já tem (legendas, capa) sem apagar nada. */
  private async mark(run: PilotRunRow, s: Slot) {
    const cr = await this.prisma.creatives.findFirst({ where: { id: s.creative_id!, workspace_id: run.workspace_id }, select: { extras: true } });
    if (!cr) return;
    const extras = { ...((cr.extras as Record<string, unknown> | null) ?? {}), pilot: { run_id: run.id, slot: s.slot, score: s.score ?? null } };
    await this.prisma.creatives.updateMany({ where: { id: s.creative_id!, workspace_id: run.workspace_id }, data: { extras: extras as Prisma.InputJsonObject } });
  }
}
