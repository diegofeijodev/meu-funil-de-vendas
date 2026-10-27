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
import { CampaignIgCancel, IgCampaignService } from '../instagram/ig-campaign.service';
import { CAMPAIGN_FINISHED, MSG_CAMPAIGN_ENDED } from '../campaigns/campaign-labels';

export { CAMPAIGN_FINISHED, MSG_CAMPAIGN_ENDED };

export type EndChannel = 'meta' | 'google' | 'tiktok' | 'instagram';
export type EndChannelResult = { channel: EndChannel; ok: boolean; message: string };
export type EndCampaignResult = {
  ok: true;
  status: typeof CAMPAIGN_FINISHED;
  /** A campanha já estava encerrada (a ação é repetida sem quebrar: canais pausados de novo, posts que sobraram cancelados). */
  alreadyEnded: boolean;
  channels: EndChannelResult[];
  instagram: CampaignIgCancel;
};

/** Mensagem do provedor que pode ir para a tela (erros de domínio); o resto vira texto genérico e fica no log. */
const providerMessage = (e: unknown): string =>
  e instanceof HttpException
    ? errMessage(e)
    : e instanceof MetaError || e instanceof AdsProviderError || e instanceof AdsSetupError
      ? e.message
      : 'erro inesperado. Tente de novo em instantes.';

/** "3 posts agendados do Instagram foram cancelados." / "1 post agendado…" (+ o que já estava saindo; sem "0 posts"). */
export function instagramSummary(r: CampaignIgCancel): string {
  const n = r.cancelledPosts;
  const now = r.publishingNow;
  const done = !n ? '' : n === 1 ? '1 post agendado do Instagram foi cancelado.' : `${n} posts agendados do Instagram foram cancelados.`;
  const going = !now
    ? ''
    : now === 1
      ? '1 post do Instagram já estava sendo publicado e vai sair normalmente.'
      : `${now} posts do Instagram já estavam sendo publicados e vão sair normalmente.`;
  return [done, going].filter(Boolean).join(' ');
}

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
    private readonly instagram: IgCampaignService,
  ) {}

  async end(userId: string, workspaceId: string, campaignId: string): Promise<EndCampaignResult> {
    // Encerrar mexe na veiculação (gasto) de todos os canais: owner|admin, como aprovar/ativar.
    await this.access.require(userId, workspaceId, 'manage');
    const c = await this.prisma.campaigns.findFirst({ where: { id: campaignId, workspace_id: workspaceId } });
    if (!c) throw notFound('Campanha não encontrada.');
    const alreadyEnded = c.status === CAMPAIGN_FINISHED;

    // Encerrada PRIMEIRO: um "Ativar" concorrente que chegue depois daqui é recusado (e quem ativou antes é pausado logo abaixo).
    if (!alreadyEnded) await this.prisma.campaigns.updateMany({ where: { id: c.id, workspace_id: workspaceId }, data: { status: CAMPAIGN_FINISHED } });

    // 1) Canais: cada um isolado — falha num não impede os outros; a coluna de status só muda quando o canal confirmou.
    const channels: EndChannelResult[] = [];
    const attempt = async (channel: Exclude<EndChannel, 'instagram'>, where: string, fn: () => Promise<void>) => {
      try {
        await fn();
        channels.push({ channel, ok: true, message: `Anúncios pausados ${where}.` });
      } catch (e) {
        this.logger.warn(`[campaign-end] ${channel} da campanha ${c.id}: ${e instanceof Error ? e.message : e}`);
        channels.push({ channel, ok: false, message: `Não foi possível pausar ${where}: ${providerMessage(e)}` });
      }
    };
    if (c.meta_campaign_id) {
      await attempt('meta', 'na Meta', async () => {
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
      await attempt('google', 'no Google Ads', async () => {
        await this.google.setStatus(workspaceId, c.google_campaign_id!, 'PAUSED');
        await this.prisma.campaigns.updateMany({ where: { id: c.id, workspace_id: workspaceId }, data: { google_status: 'PAUSED' } });
      });
    }
    if (c.tiktok_campaign_id) {
      await attempt('tiktok', 'no TikTok Ads', async () => {
        await this.tiktok.setStatus(workspaceId, c.tiktok_campaign_id!, 'DISABLE');
        await this.prisma.campaigns.updateMany({ where: { id: c.id, workspace_id: workspaceId }, data: { tiktok_status: 'DISABLE' } });
      });
    }

    // 2) Instagram (módulo do Instagram, numa transação): posts não publicados que vieram desta campanha; publicados ficam.
    let instagram: CampaignIgCancel = { cancelledPosts: 0, cancelledJobs: 0, publishingNow: 0 };
    try {
      instagram = await this.instagram.cancelForCampaign(workspaceId, c.id);
      if (instagram.cancelledPosts || instagram.publishingNow) channels.push({ channel: 'instagram', ok: true, message: instagramSummary(instagram) });
    } catch (e) {
      this.logger.error(`[campaign-end] instagram da campanha ${c.id}: ${e instanceof Error ? e.message : e}`);
      channels.push({ channel: 'instagram', ok: false, message: 'Não foi possível cancelar os posts agendados do Instagram.' });
    }

    // 3) Pendências da campanha: recomendações da IA dispensadas e pedidos de aprovação cancelados (não reabrem nada depois).
    await this.prisma.ai_recommendations.updateMany({ where: { campaign_id: c.id, workspace_id: workspaceId, status: 'pending' }, data: { status: 'dismissed' } });
    await this.prisma.approval_requests.updateMany({
      where: { campaign_id: c.id, workspace_id: workspaceId, status: 'pending' },
      data: { status: 'cancelled', decided_at: new Date(), decided_by: userId },
    });

    // 4) Auditoria (a cada execução: registra o que cada canal respondeu).
    await this.activity.log(workspaceId, userId, 'campaign.ended', 'campaign', {
      campaign_id: c.id,
      already_ended: alreadyEnded,
      channels: channels.map((r) => ({ channel: r.channel, ok: r.ok })),
      ig_posts_cancelled: instagram.cancelledPosts,
    });
    return { ok: true, status: CAMPAIGN_FINISHED, alreadyEnded, channels, instagram };
  }
}
