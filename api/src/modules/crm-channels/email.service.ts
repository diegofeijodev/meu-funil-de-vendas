import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../common/database/prisma.service';
import { CrmCoreService } from '../crm/crm-core.service';
import { UnsubscribeLinkService } from '../crm/unsubscribe-link.service';
import { ChannelHttp, ChannelSecrets } from './channel-http';
import { UserFacingError } from './channel-errors';

const escapeHtml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/**
 * E-mail do CRM pelo Resend (porte de `crm/email.server.ts`). Todo e-mail leva o link de descadastro assinado
 * (`UnsubscribeLinkService`, preso ao lead e à empresa) e o cabeçalho `List-Unsubscribe`.
 */
@Injectable()
export class EmailService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly http: ChannelHttp,
    private readonly secrets: ChannelSecrets,
    private readonly core: CrmCoreService,
    private readonly unsub: UnsubscribeLinkService,
  ) {}

  integration(workspaceId: string) {
    return this.prisma.crm_integrations.findFirst({ where: { workspace_id: workspaceId, kind: 'email' } });
  }

  /** Envia um e-mail para o lead e registra na linha do tempo. */
  async sendLeadEmail(args: { workspaceId: string; leadId: string; subject: string; body: string; authorType?: 'user' | 'ai' | 'system' }): Promise<{ id: string | null }> {
    const lead = await this.prisma.crm_leads.findFirst({ where: { id: args.leadId, workspace_id: args.workspaceId }, select: { id: true, email: true, name: true, unsubscribed: true } });
    if (!lead?.email) throw new UserFacingError('Lead sem e-mail.');
    if (lead.unsubscribed) throw new UserFacingError('Lead descadastrado: envios bloqueados.');
    const integration = await this.integration(args.workspaceId);
    if (!integration || integration.status !== 'connected') throw new UserFacingError('E-mail não configurado em CRM → Integrações.');
    const cfg = (integration.config ?? {}) as { from_email?: string; from_name?: string; reply_to?: string };
    if (!cfg.from_email) throw new UserFacingError('Remetente de e-mail não configurado.');
    const key = await this.secrets.get(args.workspaceId, 'RESEND_API_KEY');
    if (!key) throw new UserFacingError('Chave do Resend (RESEND_API_KEY) não configurada.');
    const link = this.unsub.link(args.workspaceId, lead.id);
    const html = `<div style="font-family:Arial,sans-serif;font-size:15px;line-height:1.5;color:#111">${escapeHtml(args.body).replace(/\n/g, '<br>')}</div>
<p style="font-size:12px;color:#888;margin-top:32px">Não quer mais receber? <a href="${link}">Descadastre-se</a>.</p>`;
    const res = await this.http.request(`${this.http.resendBase}/emails`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: cfg.from_name ? `${cfg.from_name} <${cfg.from_email}>` : cfg.from_email,
        to: [lead.email],
        subject: args.subject,
        html,
        text: `${args.body}\n\nDescadastrar: ${link}`,
        ...(cfg.reply_to ? { reply_to: cfg.reply_to } : {}),
        headers: { 'List-Unsubscribe': `<${link}>` },
      }),
    });
    if (!res.ok) throw new Error(`Resend [${res.status}]: ${res.text.slice(0, 300)}`);
    const id = (JSON.parse(res.text || '{}') as { id?: string }).id ?? null;
    await this.core.addInteraction({
      workspaceId: args.workspaceId,
      leadId: lead.id,
      kind: 'email_out',
      authorType: args.authorType ?? 'system',
      content: `E-mail enviado: ${args.subject}\n\n${args.body}`,
      metadata: { resend_id: id },
    });
    return { id };
  }

  /** Teste: valida a chave no Resend (lista domínios). */
  async domains(workspaceId: string): Promise<{ name: string; status: string }[]> {
    const key = await this.secrets.get(workspaceId, 'RESEND_API_KEY');
    if (!key) throw new UserFacingError('Chave do Resend (RESEND_API_KEY) não configurada.');
    const res = await this.http.request(`${this.http.resendBase}/domains`, { headers: { Authorization: `Bearer ${key}` } });
    if (!res.ok) throw new UserFacingError(`Resend recusou a chave (HTTP ${res.status}).`);
    const j = JSON.parse(res.text || '{}') as { data?: { name: string; status: string }[] };
    return (j.data ?? []).map((d) => ({ name: d.name, status: d.status }));
  }
}
