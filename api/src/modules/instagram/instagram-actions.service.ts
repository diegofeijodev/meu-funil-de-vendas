import { Injectable } from '@nestjs/common';
import { WorkspaceAccessService } from '../access/access.service';
import { ProviderChoice } from '../creative/creative.types';
import { UserError, notFound } from '../media/user-error';
import { AccountService } from './account.service';
import { AutoCalendarService } from './auto-calendar.service';
import { AutopilotService } from './autopilot.service';
import { ContentService } from './content.service';
import { CreateAutoCalendarDto, GenerateNextAutoMediaDto, PreviewAutoCalendarDto } from './instagram.dto';
import { Engine } from './ig-types';
import { IgStore, errText } from './ig-store.service';
import { MediaGenerationService } from './media-generation.service';
import { MetricsService } from './metrics.service';
import { PublishingService } from './publishing.service';
import { computeSlots } from './slots';

/**
 * Corpo das 21 server functions do Instagram (`instagram.functions` + `auto-calendar.functions`) com a autorização no servidor:
 * conectar/trocar/desconectar conta e programação "publica sozinho" = dono/admin; o resto que escreve = dono/admin/marketing
 * (o protótipo deixava "qualquer membro" — inclusive viewer — agendar/gerar; agora viewer só lê).
 */
@Injectable()
export class InstagramActionsService {
  constructor(
    private readonly access: WorkspaceAccessService,
    private readonly store: IgStore,
    private readonly account: AccountService,
    private readonly content: ContentService,
    private readonly mediaGen: MediaGenerationService,
    private readonly publishing: PublishingService,
    private readonly metrics: MetricsService,
    private readonly autopilot: AutopilotService,
    private readonly auto: AutoCalendarService,
  ) {}

  // ------------------------------------------------------------------ conta

  async connect(userId: string, workspaceId: string, pageId?: string) {
    await this.access.require(userId, workspaceId, 'manage');
    return this.account.connectInstagramAccount(workspaceId, pageId);
  }

  async listOptions(userId: string, workspaceId: string) {
    await this.access.require(userId, workspaceId, 'manage');
    return this.account.listInstagramOptions(workspaceId);
  }

  async syncHistory(userId: string, workspaceId: string) {
    await this.access.require(userId, workspaceId, 'write');
    return this.account.syncInstagramHistory(workspaceId);
  }

  async disconnect(userId: string, workspaceId: string) {
    await this.access.require(userId, workspaceId, 'manage');
    return this.account.disconnectInstagramAccount(workspaceId);
  }

  // ------------------------------------------------------------------ conteúdo

  async generateContentCalendar(userId: string, workspaceId: string, planId: string, weeks = 1, engine: Engine = 'auto') {
    await this.access.require(userId, workspaceId, 'write');
    return this.content.generateContentCalendar(workspaceId, planId, weeks, engine);
  }

  async suggestPillars(userId: string, workspaceId: string, input: { brandId?: string | null; objective?: string; tone?: string; audience?: string }) {
    await this.access.require(userId, workspaceId, 'write');
    return this.content.suggestPillars(workspaceId, input);
  }

  async regenerateCaption(userId: string, workspaceId: string, postId: string, instructions: string | undefined, engine: Engine = 'auto') {
    await this.access.require(userId, workspaceId, 'write');
    await this.store.getPost(postId, workspaceId);
    return this.content.regenerateCaption(workspaceId, postId, instructions, engine);
  }

  // ------------------------------------------------------------------ mídia

  async generatePostAssets(userId: string, workspaceId: string, postId: string, provider: ProviderChoice = 'auto', adjust?: string) {
    await this.access.require(userId, workspaceId, 'write');
    return this.mediaGen.generatePostAssets(workspaceId, postId, provider, adjust || undefined);
  }

  async uploadPostMedia(userId: string, workspaceId: string, postId: string, file: { filename: string; mimetype: string; bytes: Buffer }) {
    await this.access.require(userId, workspaceId, 'write');
    return this.mediaGen.uploadOwnMedia(workspaceId, postId, file);
  }

  // ------------------------------------------------------------------ aprovação, agenda, publicação

  async approvePost(userId: string, workspaceId: string, postId: string) {
    await this.access.require(userId, workspaceId, 'write');
    const post = await this.store.getPost(postId, workspaceId);
    if (!(post.media as unknown[] | null)?.length) throw new UserError('Gere a mídia antes de aprovar.');
    await this.store.patchPost(postId, { status: 'approved', rejection_reason: null, approved_at: new Date() });
    try {
      await this.autopilot.afterApproval(workspaceId, postId);
    } catch (e) {
      // O agendamento pós-aprovação não derruba a aprovação (o piloto agenda no próximo ciclo).
      await this.store.logEvent({ workspace_id: workspaceId, plan_id: post.plan_id, post_id: postId, kind: 'failure', level: 'error', message: `Falha ao agendar após a aprovação: ${errText(e)}` });
    }
    return { ok: true };
  }

  async rejectPost(userId: string, workspaceId: string, postId: string, reason: string) {
    await this.access.require(userId, workspaceId, 'write');
    await this.store.getPost(postId, workspaceId);
    await this.store.patchPost(postId, { status: 'cancelled', rejection_reason: reason });
    return { ok: true };
  }

  async schedulePost(userId: string, workspaceId: string, postId: string, scheduledAt: string) {
    await this.access.require(userId, workspaceId, 'write');
    return this.publishing.schedulePost(workspaceId, postId, scheduledAt);
  }

  async publishInstagramPost(userId: string, workspaceId: string, postId: string) {
    await this.access.require(userId, workspaceId, 'write');
    await this.store.getPost(postId, workspaceId);
    try {
      return await this.publishing.publishInstagramPost(postId, workspaceId);
    } catch (e) {
      const msg = errText(e);
      await this.store.patchPost(postId, { status: 'failed', last_error: msg });
      return { ok: false as const, sandbox: false, error: msg };
    }
  }

  async collectPostMetrics(userId: string, workspaceId: string, postId: string) {
    await this.access.require(userId, workspaceId, 'write');
    return this.metrics.collectPostMetrics(postId, undefined, workspaceId);
  }

  async collectAccountInsightsNow(userId: string, workspaceId: string) {
    await this.access.require(userId, workspaceId, 'write');
    return this.metrics.collectAccountInsights(workspaceId);
  }

  // ------------------------------------------------------------------ calendário automático

  async createAutoCalendar(userId: string, d: CreateAutoCalendarDto) {
    if (d.times.length + d.storyTimes.length === 0 && !d.asap) throw new UserError('Informe ao menos um horário.');
    // Publicar sem aprovação é só para dono/admin; com aprovação, quem edita.
    await this.access.require(userId, d.workspaceId, d.mode === 'publish' ? 'manage' : 'write');
    return this.auto.createAutoRun(d.workspaceId, userId, {
      startDate: d.startDate, endDate: d.endDate, weekdays: d.weekdays, times: d.times, storyTimes: d.storyTimes, formats: d.formats, asap: d.asap,
      planId: d.planId, brandId: d.brandId, campaignId: d.campaignId, focus: d.focus, mode: d.mode, recurring: d.recurring,
    });
  }

  /** Programação + papel de escrita na empresa DELA (quem não é membro vê "não encontrada"). */
  private async ownedRun(userId: string, runId: string) {
    const run = await this.auto.runOf(runId);
    if (!(await this.access.roleOf(userId, run.workspace_id))) throw notFound('Programação não encontrada.');
    await this.access.require(userId, run.workspace_id, 'write');
    return run;
  }

  async fillAutoCalendar(userId: string, runId: string) {
    const run = await this.ownedRun(userId, runId);
    return this.auto.fillAutoRun(run.id);
  }

  async generateNextAutoMedia(userId: string, d: GenerateNextAutoMediaDto) {
    const run = await this.ownedRun(userId, d.runId);
    return this.auto.generateNextAutoMedia(run.workspace_id, run.id, d.withinHours ?? 6);
  }

  async cancelAutoCalendar(userId: string, runId: string) {
    const run = await this.ownedRun(userId, runId);
    return this.auto.cancelAutoRun(run.workspace_id, run.id);
  }

  /** Prévia dos horários antes de criar (sem gastar IA; só exige estar logado). */
  previewAutoCalendar(d: PreviewAutoCalendarDto) {
    try {
      const { slots, skipped } = computeSlots({ startDate: d.startDate, endDate: d.endDate, weekdays: d.weekdays, times: d.times, storyTimes: d.storyTimes, formats: d.formats, asap: d.asap });
      return { ok: true as const, total: slots.length, skipped, first: slots[0]?.at ?? null, last: slots[slots.length - 1]?.at ?? null, slots: slots.slice(0, 200) };
    } catch (e) {
      return { ok: false as const, error: e instanceof UserError ? errText(e) : 'Configuração inválida.' };
    }
  }
}
