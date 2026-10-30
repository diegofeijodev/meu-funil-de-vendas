import { HttpException, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../common/database/prisma.service';
import { ActivityService } from '../../activity/activity.service';
import { DEFAULT_ADS_CONFIG } from '../../ads/ads-config';
import { MetaPilotPublisher } from '../../ads/meta-pilot-publisher.service';
import type { PilotStep, StepResult } from '../pilot-runner.service';
import { optionsOf, type PilotRunRow } from '../pilot.types';

/** Nota mínima do crítico para uma arte do piloto ir ao anúncio sem a pessoa escolher (G1, dono 30/10). */
const MIN_ART_SCORE = 28;
const VIDEO_TYPES = new Set(['video', 'ugc', 'reels', 'story']);

type Cr = { id: string; status: string; type: string | null; extras: unknown };
type Extras = { pilot?: { run_id?: string; slot?: number; score?: number | null; auto_approved_at?: string }; excluded_from_ads_at?: string };
const pilotOf = (c: Cr) => (c.extras as Extras | null) ?? {};

/**
 * Anúncio na Meta, sempre PAUSADO (Fatia 4). Espera a campanha aprovada (o "Aprovar e começar" do dono decide na hora; o de marketing fica
 * em Approvals), a Meta conectada, destino e verba; com G1 aprova as artes do piloto com nota ≥ 28/50 (o vídeo pronto entra: o caminho de
 * criativos de campanha não dá nota a vídeo) e monta. Ligar continua só no "Ligar" da conferência (manage) — esta etapa nem tem como.
 */
@Injectable()
export class MetaStep implements PilotStep {
  constructor(
    private readonly prisma: PrismaService,
    private readonly publisher: MetaPilotPublisher,
    private readonly activity: ActivityService,
  ) {}

  async run(run: PilotRunRow): Promise<StepResult> {
    const o = optionsOf(run);
    if (!o.meta?.enabled) return { kind: 'skipped', note: 'Anúncio na Meta desligado no plano.' };
    const ws = run.workspace_id;
    const c = await this.prisma.campaigns.findFirst({ where: { id: run.campaign_id, workspace_id: ws } });
    if (!c) return { kind: 'skipped', note: 'Campanha não encontrada.' };
    if (c.meta_campaign_id) return { kind: 'skipped', note: 'Já enviada à Meta.' };

    if (c.status === 'pending_approval') {
      return { kind: 'wait', minutes: 5, code: 'WAITING_APPROVAL', message: 'O anúncio está esperando o dono ou um admin aprovar em Approvals.' };
    }
    if (c.status !== 'approved' && c.status !== 'active') {
      const req = run.approval_request_id
        ? await this.prisma.approval_requests.findFirst({ where: { id: run.approval_request_id, workspace_id: ws }, select: { status: true } })
        : null;
      if (req?.status === 'rejected') return { kind: 'skipped', note: 'Recusado em Approvals.' };
      return { kind: 'blocked', code: 'NOT_APPROVED', message: 'A campanha não está aprovada. Peça a aprovação no topo da campanha.', stopRun: true };
    }
    if ((await this.publisher.missingCredentials(ws)).length) {
      return { kind: 'wait', minutes: 30, code: 'META_NOT_CONNECTED', message: 'Conecte a Meta para montar o anúncio. Conferimos de novo sozinhos a cada 30 minutos.' };
    }
    if (!c.landing_url) return { kind: 'blocked', code: 'LANDING_MISSING', message: 'Falta dizer para onde vai quem clicar no anúncio.', stopRun: true };
    if (!(Number(c.budget_daily) > 0)) return { kind: 'blocked', code: 'BUDGET_MISSING', message: 'Falta dizer quanto gastar por dia no anúncio.', stopRun: true };

    // Padrão do piloto só quando a pessoa não configurou "Anúncios e regras": um conjunto por jeito de falar, públicos da estratégia.
    const cfg = c.ads_config && typeof c.ads_config === 'object' ? (c.ads_config as Record<string, unknown>) : {};
    if (!Object.keys(cfg).length) {
      await this.prisma.campaigns.updateMany({
        where: { id: c.id, workspace_id: ws },
        data: { ads_config: { ...DEFAULT_ADS_CONFIG, structure: 'per_angle', useStrategyAudiences: true } as unknown as Prisma.InputJsonObject },
      });
    }

    const crs: Cr[] = await this.prisma.creatives.findMany({ where: { campaign_id: c.id, workspace_id: ws }, select: { id: true, status: true, type: true, extras: true } });
    const approved = crs.filter((x) => x.status === 'approved' && !pilotOf(x).excluded_from_ads_at);
    if (!o.meta.review_creatives) {
      const pass = crs.filter((x) => {
        const p = pilotOf(x).pilot;
        if (p?.run_id !== run.id || x.status !== 'ready') return false;
        return VIDEO_TYPES.has(x.type ?? '') || (p.score ?? 0) >= MIN_ART_SCORE;
      });
      if (pass.length) {
        // Aprovado pela revisão automática (não por uma pessoa): fica marcado em cada arte e na trilha de auditoria.
        const at = new Date().toISOString();
        for (const x of pass) {
          const ex = pilotOf(x);
          await this.prisma.creatives.updateMany({
            where: { id: x.id, workspace_id: ws, status: 'ready' },
            data: { status: 'approved', extras: { ...ex, pilot: { ...ex.pilot, auto_approved_at: at } } as Prisma.InputJsonObject },
          });
        }
        await this.activity.log(ws, null, 'creative.auto_approved', 'campaign', {
          campaign_id: c.id, via: 'pilot', run_id: run.id, creative_ids: pass.map((x) => x.id), min_score: MIN_ART_SCORE,
        });
      } else if (!approved.length) {
        return { kind: 'blocked', code: 'NO_CREATIVE_PASSED', message: `Nenhuma arte passou na revisão automática (nota mínima ${MIN_ART_SCORE} de 50).`, stopRun: true };
      }
    } else if (!approved.some((x) => pilotOf(x).pilot?.run_id === run.id)) {
      // G2: a pessoa escolhe entre as artes DESTE piloto (aprovado antigo não conta, senão as artes novas nunca entrariam).
      return { kind: 'wait', minutes: 5, code: 'WAITING_CREATIVE_REVIEW', message: 'As artes estão prontas. Escolha quais vão para o anúncio (aprove na aba Criativos).' };
    }

    try {
      const r = await this.publisher.publishPaused(ws, c.id, { runId: run.id });
      const failed = (r.steps ?? []).filter((x) => x.status === 'failed');
      const note = failed.length
        ? `Montado na Meta e desligado. ${failed.length === 1 ? '1 parte não foi criada' : `${failed.length} partes não foram criadas`}: ${failed.map((x) => `${x.label}: ${x.detail}`).join(' · ')}.`
        : 'Montado na Meta e desligado.';
      return { kind: 'done', ref: r.campaignId, note };
    } catch (e) {
      // Publicação manual ao mesmo tempo (trava): confere de novo em 5 min, sem contar falha.
      if (e instanceof HttpException && e.getStatus() === 409) return { kind: 'wait', minutes: 5 };
      // Recusa da Meta (502): escrita em terceiro que pode ter ido pela metade não se repete sozinha — para e mostra a frase dela.
      if (e instanceof HttpException && e.getStatus() >= 500) {
        const m = (e.getResponse() as { message?: string }).message ?? e.message;
        return { kind: 'blocked', code: 'META_REFUSED', message: `A Meta recusou o anúncio: ${m}`, stopRun: true };
      }
      // Recusa com motivo (cidade, verba, período, destino): precisa da pessoa.
      if (e instanceof HttpException && e.getStatus() === 400) {
        const body = e.getResponse() as { code?: string; message?: string };
        return { kind: 'blocked', code: body.code && body.code !== 'BAD_REQUEST' ? body.code : 'META_REFUSED', message: body.message ?? 'A Meta recusou o anúncio.', stopRun: true };
      }
      throw e;
    }
  }
}
