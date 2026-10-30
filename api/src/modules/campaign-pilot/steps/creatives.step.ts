import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../common/database/prisma.service';
import { CreativeService } from '../../creative/creative.service';
import { StrategistService } from '../../strategist/strategist.service';
import { slotCost } from '../pilot-estimate';
import type { PilotStep, StepResult } from '../pilot-runner.service';
import { optionsOf, stepsOf, type PilotRunRow, type Slot } from '../pilot.types';

type JobCost = { id: string; actual_cost: Prisma.Decimal | number | null; estimated_cost: Prisma.Decimal | number | null };

/** Créditos já gastos pelas peças do piloto: custo real do job (ou o estimado, enquanto o vídeo gera). Derivado, nunca guardado. */
export function spentCredits(slots: Slot[], jobs: JobCost[]): number {
  const ids = new Set(slots.map((s) => s.job_id).filter(Boolean));
  const total = jobs.filter((j) => ids.has(j.id)).reduce((s, j) => s + Number(j.actual_cost ?? j.estimated_cost ?? 0), 0);
  return Math.round(total * 100) / 100;
}

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

    // (b) no máximo uma peça nova
    const next = slots.find((x) => x.status === 'pending');
    if (next) {
      const jobIds = slots.map((x) => x.job_id).filter(Boolean) as string[];
      const jobs = jobIds.length
        ? await this.prisma.creative_generation_jobs.findMany({ where: { id: { in: jobIds }, workspace_id: ws }, select: { id: true, actual_cost: true, estimated_cost: true } })
        : [];
      const max = Number(run.max_credits ?? o.max_credits);
      if (spentCredits(slots, jobs) + slotCost(next.kind, o.variations) > max) {
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
        { runId: run.id },
      );
      next.job_id = out.jobId;
      if (out.status === 'ready' && out.creativeId) {
        Object.assign(next, { status: 'done', creative_id: out.creativeId, score: out.variations.find((v) => v.winner)?.score?.total ?? null });
        await this.mark(run, next);
      } else if (out.status === 'generating') {
        Object.assign(next, { status: 'waiting', creative_id: out.creativeId ?? null });
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
