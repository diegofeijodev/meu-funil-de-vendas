import { channelsWorld } from './world';
import { status } from '../../crm/__tests__/harness';

const INBOUND = (over: Record<string, unknown> = {}) => ({ externalId: 'ext-1', from: '5511988887777', type: 'text' as const, body: 'oi', profileName: 'Ana', ...over });

describe('WhatsApp — envio (opt-out e janela de 24 h)', () => {
  it('lead descadastrado: envio bloqueado (nada é gravado nem enviado)', async () => {
    const w = channelsWorld();
    const integ = await w.integration();
    const lead = await w.addLead(w.WS_A, { phone: '+5511988887777', unsubscribed: true });
    const conv = await w.whatsapp.ensureConversation({ integration: integ as never, phone: '+5511988887777', leadId: lead.id });
    expect(await status(w.whatsapp.sendAndStore({ integration: integ as never, conversationId: conv.id, leadId: lead.id, message: { to: '+5511988887777', kind: 'text', body: 'oi' } }))).toBe('400:Lead descadastrado: envios bloqueados.');
    expect(w.sent).toHaveLength(0);
    expect(w.t.crm_messages.rows).toHaveLength(0);
  });

  it('API oficial: texto fora da janela é recusado, template passa, texto dentro da janela passa', async () => {
    const w = channelsWorld({ provider: 'whatsapp_cloud' });
    const integ = await w.integration();
    const lead = await w.addLead(w.WS_A, { phone: '+5511988887777' });
    const conv = await w.whatsapp.ensureConversation({ integration: integ as never, phone: '+5511988887777', leadId: lead.id });
    const text = { to: '+5511988887777', kind: 'text' as const, body: 'oi' };
    expect(await status(w.whatsapp.sendAndStore({ integration: integ as never, conversationId: conv.id, leadId: lead.id, message: text }))).toBe('400:Fora da janela de 24 horas: envie um template aprovado.');
    expect(w.sent).toHaveLength(0);
    expect(await status(w.whatsapp.sendAndStore({ integration: integ as never, conversationId: conv.id, leadId: lead.id, message: { to: text.to, kind: 'template', templateName: 'boas_vindas' } }))).toBe('ok');
    await w.t.crm_conversations.update({ where: { id: conv.id }, data: { window_expires_at: new Date(Date.now() + 3600e3) } });
    expect(await status(w.whatsapp.sendAndStore({ integration: integ as never, conversationId: conv.id, leadId: lead.id, message: text }))).toBe('ok');
    expect(w.sent).toHaveLength(2);
  });

  it('Z-API não tem a regra das 24 h: texto livre passa', async () => {
    const w = channelsWorld({ provider: 'zapi' });
    const integ = await w.integration();
    const lead = await w.addLead(w.WS_A, { phone: '+5511988887777' });
    const conv = await w.whatsapp.ensureConversation({ integration: integ as never, phone: '+5511988887777', leadId: lead.id });
    expect(await status(w.whatsapp.sendAndStore({ integration: integ as never, conversationId: conv.id, leadId: lead.id, message: { to: '+5511988887777', kind: 'text', body: 'oi' } }))).toBe('ok');
    expect(w.t.crm_messages.rows[0]).toMatchObject({ status: 'sent', external_id: 'Z-1' });
  });

  it('mensagem do usuário: valida antes (lead de outro workspace = 404), pausa a IA e encerra cadências', async () => {
    const w = channelsWorld();
    await w.integration();
    const mine = await w.addLead(w.WS_A, { phone: '+5511988887777' });
    await w.t.crm_cadence_runs.create({ data: { workspace_id: w.WS_A, cadence_id: 'c', lead_id: mine.id, status: 'running' } });
    const r = await w.whatsapp.sendFromUser(w.OWNER, { workspaceId: w.WS_A, leadId: mine.id, kind: 'text', body: 'olá' });
    expect(r.externalId).toBe('Z-1');
    expect(w.t.crm_leads.rows.find((l) => l.id === mine.id)!.ai_active).toBe(false);
    expect(w.t.crm_cadence_runs.rows[0]).toMatchObject({ status: 'stopped', stop_reason: 'human_takeover' });
    expect(w.t.crm_interactions.rows.some((i) => i.kind === 'message_out')).toBe(true);
    const other = await w.addLead('00000000-0000-4000-8000-00000000000b', { phone: '+5511999990000' });
    expect(await status(w.whatsapp.sendFromUser(w.OWNER, { workspaceId: w.WS_A, leadId: other.id, kind: 'text', body: 'x' }))).toBe('400:Este lead não tem telefone cadastrado.');
  });

  it('mensagens de erro do protótipo', async () => {
    const w = channelsWorld();
    const lead = await w.addLead(w.WS_A, { phone: '+55119' });
    expect(await status(w.whatsapp.sendFromUser(w.OWNER, { workspaceId: w.WS_A, leadId: lead.id, kind: 'text', body: 'x' }))).toBe('400:Conecte o WhatsApp nas integrações do CRM.');
    await w.integration();
    const semFone = await w.addLead(w.WS_A, {});
    expect(await status(w.whatsapp.sendFromUser(w.OWNER, { workspaceId: w.WS_A, leadId: semFone.id, kind: 'text', body: 'x' }))).toBe('400:Este lead não tem telefone cadastrado.');
  });
});

describe('WhatsApp — recebimento', () => {
  it('número novo vira lead (origem whatsapp), conversa com janela de 24 h, mensagem e interação', async () => {
    const w = channelsWorld();
    const integ = await w.integration();
    const r = await w.whatsapp.handleInbound(integ as never, INBOUND());
    const lead = w.t.crm_leads.rows.find((l) => l.id === r.leadId)!;
    expect(lead).toMatchObject({ phone: '+5511988887777', source: 'whatsapp', name: 'Ana', workspace_id: w.WS_A });
    const conv = w.t.crm_conversations.rows[0]!;
    expect(conv.window_expires_at.getTime()).toBeGreaterThan(Date.now() + 23 * 3600e3);
    expect(conv.unread_count).toBe(1);
    expect(w.t.crm_messages.rows[0]).toMatchObject({ direction: 'in', status: 'received', body: 'oi' });
    expect(lead.first_response_at).toBeInstanceOf(Date);
  });

  it('anúncio click-to-WhatsApp marca origem e campanha', async () => {
    const w = channelsWorld();
    const integ = await w.integration();
    const r = await w.whatsapp.handleInbound(integ as never, INBOUND({ referral: { adId: 'AD1', campaignName: 'Camp X' } }));
    expect(w.t.crm_leads.rows.find((l) => l.id === r.leadId)).toMatchObject({ source: 'click_to_whatsapp', referral_ad_id: 'AD1', campaign_name: 'Camp X' });
  });

  it('opt-out: descadastra, desliga a IA, para cadências e NÃO aciona o SDR', async () => {
    const w = channelsWorld();
    const integ = await w.integration();
    await w.extra.crm_sdr_agents.create({ data: { workspace_id: w.WS_A } });
    const first = await w.whatsapp.handleInbound(integ as never, INBOUND({ externalId: 'a' }));
    await w.t.crm_cadence_runs.create({ data: { workspace_id: w.WS_A, cadence_id: 'c', lead_id: first.leadId, status: 'running' } });
    w.aiCalls.length = 0;
    await w.whatsapp.handleInbound(integ as never, INBOUND({ externalId: 'b', body: 'SAIR' }));
    expect(w.t.crm_leads.rows.find((l) => l.id === first.leadId)).toMatchObject({ unsubscribed: true, ai_active: false });
    expect(w.t.crm_cadence_runs.rows[0]).toMatchObject({ status: 'stopped', stop_reason: 'opt_out' });
    expect(w.aiCalls).toHaveLength(0);
    expect(w.t.crm_interactions.rows.some((i) => i.content === 'Lead pediu para sair. Envios automáticos bloqueados.')).toBe(true);
  });

  it('resposta do lead para a cadência (motivo replied) e o SDR responde no WhatsApp com autor ai', async () => {
    const w = channelsWorld();
    const integ = await w.integration();
    await w.extra.crm_sdr_agents.create({ data: { workspace_id: w.WS_A } });
    const first = await w.whatsapp.handleInbound(integ as never, INBOUND({ externalId: 'a', body: 'oi' }));
    await w.t.crm_cadence_runs.create({ data: { workspace_id: w.WS_A, cadence_id: 'c', lead_id: first.leadId, status: 'running' } });
    w.sent.length = 0;
    await w.whatsapp.handleInbound(integ as never, INBOUND({ externalId: 'b', body: 'quanto custa?' }));
    expect(w.t.crm_cadence_runs.rows[0]).toMatchObject({ status: 'stopped', stop_reason: 'replied' });
    const out = w.t.crm_messages.rows.filter((m) => m.direction === 'out');
    expect(out).toHaveLength(2); // uma para cada mensagem recebida
    expect(out.every((m) => m.author_type === 'ai' && m.body === 'Olá!')).toBe(true);
    expect(w.sent).toHaveLength(1);
  });

  it('áudio sem texto: o SDR recebe a transcrição', async () => {
    const w = channelsWorld();
    const integ = await w.integration();
    await w.extra.crm_sdr_agents.create({ data: { workspace_id: w.WS_A } });
    await w.whatsapp.handleInbound(integ as never, INBOUND({ type: 'audio', body: null, mediaUrl: 'https://cdn.test/a.ogg' }));
    expect(w.aiCalls[0]!.prompt).toContain('[Áudio do lead, transcrito] quero saber o preço');
  });

  it('telefone inválido é ignorado', async () => {
    const w = channelsWorld();
    const integ = await w.integration();
    expect(await w.whatsapp.handleInbound(integ as never, INBOUND({ from: '12' }))).toEqual({ ignored: 'telefone inválido' });
    expect(w.t.crm_leads.rows).toHaveLength(0);
  });
});
