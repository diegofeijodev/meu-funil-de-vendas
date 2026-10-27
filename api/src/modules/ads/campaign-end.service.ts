/**
 * "Encerrar campanha" (`POST /v1/workspaces/:workspaceId/campaigns/:id/end`, manage): pausa a campanha em todos os canais em que foi
 * publicada (Meta, Google, TikTok), cancela os posts do Instagram ainda não publicados que vieram dela e marca a campanha como
 * `finished` ("Encerrada"). Vive no módulo de anúncios porque precisa dos clientes dos canais (o de campanhas é importado por ele).
 */
import { HttpException, Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../common/database/prisma.service';
import { WorkspaceAccessService } from '../access/access.service';
import { ActivityService } from '../activity/activity.service';
import { MetaError } from '../instagram/meta-graph';
import { errMessage, notFound } from '../media/user-error';
import { AdsProviderError, AdsSetupError } from './ads-errors';
import { GoogleAdsClient } from './google-ads.client';
import { MetaOpsService } from './meta-ops.service';
import { TikTokAdsClient } from './tiktok-ads.client';

/** Status da campanha encerrada (já existia no rótulo do protótipo: `finished: "Encerrada"`). */
export const CAMPAIGN_FINISHED = 'finished';
/** Guarda dos botões de publicar/ativar numa campanha encerrada. */
export const MSG_CAMPAIGN_ENDED = 'Campanha encerrada.';

export type EndChannel = 'meta' | 'google' | 'tiktok' | 'instagram';
export type EndChannelResult = { channel: EndChannel; ok: boolean; message: string };
export type EndCampaignResult = {
  ok: true;
  status: typeof CAMPAIGN_FINISHED;
  /** A campanha já estava encerrada (a ação é repetida sem quebrar: canais pausados de novo, posts que sobraram cancelados). */
  alreadyEnded: boolean;
  channels: EndChannelResult[];
  instagram: { cancelledPosts: number; cancelledJobs: number; publishingNow: number };
};

/** Posts que ainda podem sair (o que está `publishing` neste instante fica: cancelar no meio deixaria a Meta e o banco divergentes). */
const KEEP = ['published', 'publishing', 'cancelled'];

/** Mensagem do provedor que pode ir para a tela (erros de domínio); o resto vira texto genérico e fica no log. */
const providerMessage = (e: unknown): string =>
  e instanceof HttpException
    ? errMessage(e)
    : e instanceof MetaError || e instanceof AdsProviderError || e instanceof AdsSetupError
      ? e.message
      : 'erro inesperado. Tente de novo em instantes.';

@Injectable()
export class CampaignEndService {
  private readonly logger = new Logger(CampaignEndService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly access: WorkspaceAccessService,
    private readonly ops: MetaOpsService,
    private readonly google: GoogleAdsClient,
    private readonly tiktok: TikTokAdsClient,
    private readonly activity: ActivityService,
  ) {}

  async end(userId: string, workspaceId: string, campaignId: string): Promise<EndCampaignResult> {
    // Encerrar mexe na veiculação (gasto) de todos os canais: owner|admin, como aprovar/ativar.
    await this.access.require(userId, workspaceId, 'manage');
    const c = await this.prisma.campaigns.findFirst({ where: { id: campaignId, workspace_id: workspaceId } });
    if (!c) throw notFound('Campanha não encontrada.');
    const alreadyEnded = c.status === CAMPAIGN_FINISHED;

    // 1) Canais: cada um isolado — falha num não impede os outros; a coluna de status só muda quando o canal confirmou.
    const channels: EndChannelResult[] = [];
    const attempt = async (channel: Exclude<EndChannel, 'instagram'>, label: string, fn: () => Promise<void>) => {
      try {
        await fn();
        channels.push({ channel, ok: true, message: `Anúncios pausados no ${label}.` });
      } catch (e) {
        this.logger.warn(`[campaign-end] ${channel} da campanha ${c.id}: ${e instanceof Error ? e.message : e}`);
        channels.push({ channel, ok: false, message: `Não foi possível pausar no ${label}: ${providerMessage(e)}` });
      }
    };
    if (c.meta_campaign_id) {
      await attempt('meta', 'Meta', async () => {
        await this.ops.setDeliveryStatus(
          workspaceId,
          {
            campaignId: c.meta_campaign_id!,
            adsetIds: (c.meta_adset_ids?.length ? c.meta_adset_ids : [c.meta_adset_id]).filter(Boolean) as string[],
            adIds: c.meta_ad_ids ?? [],
          },
          'PAUSED',
        );
        await this.prisma.campaigns.updateMany({ where: { id: c.id, workspace_id: workspaceId }, data: { meta_delivery_status: 'PAUSED' } });
      });
    }
    if (c.google_campaign_id) {
      await attempt('google', 'Google Ads', async () => {
        await this.google.setStatus(workspaceId, c.google_campaign_id!, 'PAUSED');
        await this.prisma.campaigns.updateMany({ where: { id: c.id, workspace_id: workspaceId }, data: { google_status: 'PAUSED' } });
      });
    }
    if (c.tiktok_campaign_id) {
      await attempt('tiktok', 'TikTok Ads', async () => {
        await this.tiktok.setStatus(workspaceId, c.tiktok_campaign_id!, 'DISABLE');
        await this.prisma.campaigns.updateMany({ where: { id: c.id, workspace_id: workspaceId }, data: { tiktok_status: 'DISABLE' } });
      });
    }

    // 2) Instagram: posts que vieram desta campanha — programações automáticas ligadas a ela (e as semanas recorrentes) e os planos
    //    criados por "Criar plano no Instagram". Publicados ficam intactos no perfil.
    let instagram = { cancelledPosts: 0, cancelledJobs: 0, publishingNow: 0 };
    try {
      instagram = await this.cancelInstagram(workspaceId, c.id);
      if (instagram.cancelledPosts || instagram.publishingNow) {
        channels.push({
          channel: 'instagram',
          ok: true,
          message:
            `${instagram.cancelledPosts} post(s) do Instagram cancelado(s).` +
            (instagram.publishingNow ? ` ${instagram.publishingNow} já estava(m) sendo publicado(s) e segue(m).` : ''),
        });
      }
    } catch (e) {
      this.logger.error(`[campaign-end] instagram da campanha ${c.id}: ${e instanceof Error ? e.message : e}`);
      channels.push({ channel: 'instagram', ok: false, message: 'Não foi possível cancelar os posts agendados do Instagram. Tente encerrar de novo.' });
    }

    // 3) Encerrada (condicional ao workspace; repetir não muda nada).
    if (!alreadyEnded) await this.prisma.campaigns.updateMany({ where: { id: c.id, workspace_id: workspaceId }, data: { status: CAMPAIGN_FINISHED } });

    // 4) Auditoria (a cada execução: registra o que cada canal respondeu).
    await this.activity.log(workspaceId, userId, 'campaign.ended', 'campaign', {
      campaign_id: c.id,
      already_ended: alreadyEnded,
      channels: channels.map((r) => ({ channel: r.channel, ok: r.ok })),
      ig_posts_cancelled: instagram.cancelledPosts,
    });
    return { ok: true, status: CAMPAIGN_FINISHED, alreadyEnded, channels, instagram };
  }

  /** Mesmo corte de `cancelAutoRun`: programações canceladas (sem recorrência), planos ativos pausados, posts e jobs pendentes cancelados. */
  private async cancelInstagram(workspaceId: string, campaignId: string) {
    const roots = await this.prisma.ig_auto_runs.findMany({ where: { campaign_id: campaignId, workspace_id: workspaceId }, select: { id: true } });
    const rootIds = roots.map((r) => r.id);
    const kids = rootIds.length
      ? await this.prisma.ig_auto_runs.findMany({ where: { parent_id: { in: rootIds }, workspace_id: workspaceId }, select: { id: true } })
      : [];
    const runIds = [...new Set([...rootIds, ...kids.map((k) => k.id)])];
    const plans = await this.prisma.ig_content_plans.findMany({ where: { campaign_id: campaignId, workspace_id: workspaceId }, select: { id: true } });
    const planIds = plans.map((p) => p.id);
    if (!runIds.length && !planIds.length) return { cancelledPosts: 0, cancelledJobs: 0, publishingNow: 0 };

    if (runIds.length) {
      await this.prisma.ig_auto_runs.updateMany({ where: { id: { in: runIds }, workspace_id: workspaceId }, data: { status: 'cancelled', recurring: false, locked_until: null } });
    }
    // Plano ativo pararia de gerar/publicar posts novos pelo piloto automático; rascunho fica como está.
    if (planIds.length) await this.prisma.ig_content_plans.updateMany({ where: { id: { in: planIds }, workspace_id: workspaceId, status: 'active' }, data: { status: 'paused' } });

    const origin = [...(runIds.length ? [{ run_id: { in: runIds } }] : []), ...(planIds.length ? [{ plan_id: { in: planIds } }] : [])];
    const posts = await this.prisma.ig_posts.findMany({ where: { workspace_id: workspaceId, OR: origin, status: { notIn: KEEP } }, select: { id: true } });
    const publishingNow = await this.prisma.ig_posts.count({ where: { workspace_id: workspaceId, OR: origin, status: 'publishing' } });
    const postIds = posts.map((p) => p.id);
    let cancelledJobs = 0;
    if (postIds.length) {
      cancelledJobs = (
        await this.prisma.publishing_jobs.updateMany({ where: { ig_post_id: { in: postIds }, workspace_id: workspaceId, status: 'pending' }, data: { status: 'cancelled', locked_at: null } })
      ).count;
      // Condicional ao status: um post que virou `publishing` entre a leitura e aqui não é tocado.
      await this.prisma.ig_posts.updateMany({ where: { id: { in: postIds }, workspace_id: workspaceId, status: { notIn: KEEP } }, data: { status: 'cancelled' } });
    }
    return { cancelledPosts: postIds.length, cancelledJobs, publishingNow };
  }
}
