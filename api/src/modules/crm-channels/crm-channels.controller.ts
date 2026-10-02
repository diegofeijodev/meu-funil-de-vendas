import { Body, Controller, ForbiddenException, Get, HttpCode, Param, Post, Query, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { AuthUser } from '../../common/auth/auth-user';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { PrismaService } from '../../common/database/prisma.service';
import { ParseUuidPipe } from '../../common/ids/uuid';
import { WorkspaceAccessService } from '../access/access.service';
import { WorkspaceAccessGuard } from '../access/workspace-access.guard';
import { UserFacingError } from './channel-errors';
import { CadenceService } from './cadence.service';
import * as D from './crm-channels.dto';
import { IntegrationsService } from './integrations.service';
import { SdrAgentService } from './sdr-agent.service';
import { WhatsAppService } from './whatsapp.service';

const MANAGE_MSG_INT = 'Sem permissão para alterar integrações deste workspace.';
const MANAGE_MSG_CAD = 'Sem permissão para alterar cadências deste workspace.';
const MANAGE_MSG_SDR = 'Sem permissão para configurar o agente deste workspace.';

/** Funções de servidor `crm-integrations.functions` (exceto `notifyMetaConversion`, que vive em `modules/ads`). */
@ApiTags('CRM canais')
@ApiBearerAuth()
@Controller('v1/crm-integrations')
export class CrmIntegrationsController {
  constructor(private readonly access: WorkspaceAccessService, private readonly svc: IntegrationsService, private readonly wa: WhatsAppService) {}

  private manage(u: AuthUser, ws: string) { return requireManager(this.access, u.id, ws, MANAGE_MSG_INT); }

  @Post('save-integration') @HttpCode(200)
  async save(@CurrentUser() u: AuthUser, @Body() d: D.SaveIntegrationDto) { await this.manage(u, d.workspaceId); return this.svc.save(d.workspaceId, d); }

  @Post('test-integration') @HttpCode(200)
  async test(@CurrentUser() u: AuthUser, @Body() d: D.KindDto) { await this.manage(u, d.workspaceId); return this.svc.test(d.workspaceId, d.kind); }

  @Post('disconnect-integration') @HttpCode(200)
  async disconnect(@CurrentUser() u: AuthUser, @Body() d: D.KindDto) { await this.manage(u, d.workspaceId); return this.svc.disconnect(d.workspaceId, d.kind); }

  @Post('load-meta-form-fields') @HttpCode(200)
  async fields(@CurrentUser() u: AuthUser, @Body() d: D.FormFieldsDto) { await this.manage(u, d.workspaceId); return this.svc.loadMetaFormFields(d.workspaceId, d.formId); }

  @Post('sync-whats-app-templates') @HttpCode(200)
  async sync(@CurrentUser() u: AuthUser, @Body() d: D.WsDto) { await this.manage(u, d.workspaceId); return this.svc.syncTemplates(d.workspaceId); }

  @Post('send-whats-app-message') @HttpCode(200)
  async send(@CurrentUser() u: AuthUser, @Body() d: D.SendWhatsAppDto) { await this.access.require(u.id, d.workspaceId, 'write'); return this.wa.sendFromUser(u.id, d); }

  @Post('import-meta-costs-now') @HttpCode(200)
  async costs(@CurrentUser() u: AuthUser, @Body() d: D.WsDto) { await this.manage(u, d.workspaceId); return this.svc.importCostsNow(d.workspaceId); }

  @Post('save-channel-secret') @HttpCode(200)
  async secret(@CurrentUser() u: AuthUser, @Body() d: D.SecretDto) { await this.manage(u, d.workspaceId); return this.svc.saveSecret(d.workspaceId, d.key, d.value); }

  @Post('channel-secrets-status') @HttpCode(200)
  async status(@CurrentUser() u: AuthUser, @Body() d: D.WsDto) { await this.access.require(u.id, d.workspaceId, 'read'); return this.svc.secretsStatus(d.workspaceId); }

  @Post('list-failed-events') @HttpCode(200)
  async failed(@CurrentUser() u: AuthUser, @Body() d: D.WsDto) { await this.manage(u, d.workspaceId); return this.svc.listFailedEvents(d.workspaceId); }

  @Post('reprocess-event') @HttpCode(200)
  async reprocess(@CurrentUser() u: AuthUser, @Body() d: D.EventDto) { await this.manage(u, d.workspaceId); return this.svc.reprocess(d.workspaceId, d.eventId); }

  @Post('send-instagram-message') @HttpCode(200)
  async ig(@CurrentUser() u: AuthUser, @Body() d: D.SendInstagramDto) { await this.access.require(u.id, d.workspaceId, 'write'); return this.svc.sendInstagram(u.id, d.workspaceId, d.leadId, d.body); }

  @Post('send-lead-email-now') @HttpCode(200)
  async email(@CurrentUser() u: AuthUser, @Body() d: D.SendEmailDto) { await this.access.require(u.id, d.workspaceId, 'write'); return this.svc.sendEmail(d.workspaceId, d.leadId, d.subject, d.body); }
}

/** owner/admin com a mensagem de negação do protótipo (não membro continua com a mensagem de acesso). */
async function requireManager(access: WorkspaceAccessService, userId: string, ws: string, msg: string) {
  await access.require(userId, ws, 'read');
  if (!(await access.can(userId, ws, 'manage'))) throw new ForbiddenException({ code: 'FORBIDDEN', message: msg });
}

@ApiTags('CRM canais')
@ApiBearerAuth()
@Controller('v1/crm-cadences')
export class CrmCadencesController {
  constructor(private readonly access: WorkspaceAccessService, private readonly svc: CadenceService) {}

  @Post('save-cadence') @HttpCode(200)
  async save(@CurrentUser() u: AuthUser, @Body() d: D.SaveCadenceDto) {
    await requireManager(this.access, u.id, d.workspaceId, MANAGE_MSG_CAD);
    if (!d.name.trim()) throw new UserFacingError('Informe o nome da cadência.');
    if (!d.steps.length) throw new UserFacingError('Adicione ao menos um passo.');
    return this.svc.save(d.workspaceId, d as never);
  }

  @Post('delete-cadence') @HttpCode(200)
  async remove(@CurrentUser() u: AuthUser, @Body() d: D.DeleteCadenceDto) { await requireManager(this.access, u.id, d.workspaceId, MANAGE_MSG_CAD); return this.svc.remove(d.workspaceId, d.id); }

  @Post('install-cadence-templates') @HttpCode(200)
  async install(@CurrentUser() u: AuthUser, @Body() d: D.WsDto) { await requireManager(this.access, u.id, d.workspaceId, MANAGE_MSG_CAD); return this.svc.installTemplates(d.workspaceId); }

  @Post('enroll-leads') @HttpCode(200)
  async enroll(@CurrentUser() u: AuthUser, @Body() d: D.EnrollDto) { await this.access.require(u.id, d.workspaceId, 'write'); return this.svc.enrollLeads(d.workspaceId, d.cadenceId, d.leadIds); }

  @Post('stop-lead-cadences') @HttpCode(200)
  async stop(@CurrentUser() u: AuthUser, @Body() d: D.StopLeadDto) { await this.access.require(u.id, d.workspaceId, 'write'); return this.svc.stopLeadCadences(d.workspaceId, d.leadId); }

  /** Só as cadências DESTA empresa (o protótipo executava as de todas). */
  @Post('run-cadences-now') @HttpCode(200)
  async run(@CurrentUser() u: AuthUser, @Body() d: D.WsDto) {
    await requireManager(this.access, u.id, d.workspaceId, MANAGE_MSG_CAD);
    const r = await this.svc.runDue(200, d.workspaceId);
    return { ...r, slaTasks: await this.svc.createSlaAlerts(500, d.workspaceId) };
  }
}

@ApiTags('CRM canais')
@ApiBearerAuth()
@Controller('v1/crm-sdr')
export class CrmSdrController {
  constructor(private readonly access: WorkspaceAccessService, private readonly svc: SdrAgentService) {}

  @Post('get-sdr-agent') @HttpCode(200)
  async get(@CurrentUser() u: AuthUser, @Body() d: D.WsDto) { await this.access.require(u.id, d.workspaceId, 'read'); return this.svc.get(d.workspaceId); }

  @Post('save-sdr-agent') @HttpCode(200)
  async save(@CurrentUser() u: AuthUser, @Body() d: D.SaveSdrDto) { await requireManager(this.access, u.id, d.workspaceId, MANAGE_MSG_SDR); return this.svc.save(d.workspaceId, d as never); }

  @Post('upload-sdr-document') @HttpCode(200)
  async upload(@CurrentUser() u: AuthUser, @Body() d: D.UploadSdrDocDto) { await requireManager(this.access, u.id, d.workspaceId, MANAGE_MSG_SDR); return this.svc.uploadDocument(d.workspaceId, d); }

  @Post('delete-sdr-document') @HttpCode(200)
  async del(@CurrentUser() u: AuthUser, @Body() d: D.DeleteSdrDocDto) { await requireManager(this.access, u.id, d.workspaceId, MANAGE_MSG_SDR); return this.svc.deleteDocument(d.workspaceId, d.documentId); }

  @Post('test-sdr-agent') @HttpCode(200)
  async test(@CurrentUser() u: AuthUser, @Body() d: D.TestSdrDto) { await this.access.require(u.id, d.workspaceId, 'read'); return this.svc.test(d.workspaceId, d.history); }
}

/** Leituras diretas de tabela do navegador (inbox, chat, templates, integrações, cadências). GET = read. */
@ApiTags('CRM canais')
@ApiBearerAuth()
@UseGuards(WorkspaceAccessGuard)
@Controller('v1/workspaces/:workspaceId/crm')
export class CrmChannelsResourcesController {
  constructor(private readonly prisma: PrismaService, private readonly svc: IntegrationsService, private readonly access: WorkspaceAccessService) {}

  @Get('conversations')
  async conversations(@Param('workspaceId', ParseUuidPipe) ws: string) {
    const rows = await this.prisma.crm_conversations.findMany({
      where: { workspace_id: ws }, orderBy: { last_message_at: { sort: 'desc', nulls: 'last' } }, take: 200,
      select: { id: true, phone: true, unread_count: true, last_message_at: true, last_message_preview: true, lead_id: true, lead: { select: { id: true, name: true, owner_id: true, unsubscribed: true, phone: true } } },
    });
    return rows.map(({ lead, ...r }) => ({ ...r, crm_leads: lead }));
  }

  /** Conversa mais recente do lead no canal (`instagram` ou WhatsApp); `null` se não houver. */
  @Get('leads/:leadId/conversation')
  async leadConversation(@Param('workspaceId', ParseUuidPipe) ws: string, @Param('leadId', ParseUuidPipe) leadId: string, @Query('channel') channel?: string) {
    const c = await this.prisma.crm_conversations.findFirst({
      where: { workspace_id: ws, lead_id: leadId, provider: channel === 'instagram' ? 'instagram' : { not: 'instagram' } },
      orderBy: { last_message_at: { sort: 'desc', nulls: 'last' } },
      select: { id: true, window_expires_at: true, unread_count: true, provider: true },
    });
    return c ?? null;
  }

  @Get('conversations/:id/messages')
  messages(@Param('workspaceId', ParseUuidPipe) ws: string, @Param('id', ParseUuidPipe) id: string) {
    return this.prisma.crm_messages.findMany({
      where: { workspace_id: ws, conversation_id: id }, orderBy: { created_at: 'asc' },
      select: { id: true, direction: true, message_type: true, body: true, media_url: true, status: true, created_at: true },
    });
  }

  @Get('wa-templates')
  waTemplates(@Param('workspaceId', ParseUuidPipe) ws: string, @Query('status') status?: string) {
    return this.prisma.crm_wa_templates.findMany({ where: { workspace_id: ws, ...(status ? { status } : {}) }, orderBy: { name: 'asc' }, select: { name: true, language: true, status: true, body_preview: true } });
  }

  @Get('quick-replies')
  quickReplies(@Param('workspaceId', ParseUuidPipe) ws: string) {
    return this.prisma.crm_quick_replies.findMany({ where: { workspace_id: ws }, orderBy: { title: 'asc' }, select: { id: true, title: true, body: true } });
  }

  @Get('integrations')
  async integrations(@Req() req: { user: AuthUser }, @Param('workspaceId', ParseUuidPipe) ws: string) {
    return this.svc.list(ws, await this.access.can(req.user.id, ws, 'manage'));
  }

  @Get('cadences')
  cadences(@Param('workspaceId', ParseUuidPipe) ws: string) {
    return this.prisma.crm_cadences.findMany({ where: { workspace_id: ws }, orderBy: { created_at: 'asc' } });
  }

  @Get('cadence-events')
  cadenceEvents(@Param('workspaceId', ParseUuidPipe) ws: string) {
    return this.prisma.crm_cadence_events.findMany({ where: { workspace_id: ws }, select: { cadence_id: true, step_index: true, event: true, message_id: true }, take: 20000 });
  }

  @Get('cadence-runs')
  cadenceRuns(@Param('workspaceId', ParseUuidPipe) ws: string) {
    return this.prisma.crm_cadence_runs.findMany({ where: { workspace_id: ws }, select: { cadence_id: true, status: true, stop_reason: true, step_index: true, next_run_at: true }, take: 20000 });
  }
}
