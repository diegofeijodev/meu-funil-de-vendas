import { createHmac } from 'node:crypto';
import { ADMIN, MARKETING, OWNER, STRANGER, VIEWER, WS_A, WS_B, crmWorld, status } from '../../crm/__tests__/harness';
import { WebhookLedgerService } from '../../webhooks/webhook-ledger.service';
import { CrmCadencesController, CrmIntegrationsController, CrmSdrController } from '../crm-channels.controller';
import { LeadgenWebhookController, WhatsAppWebhookController, safeEqual } from '../crm-webhooks.controller';
import { channelsWorld } from './world';

const u = (id: string) => ({ id }) as never;
const spy = () => new Proxy({}, { get: (_t, k) => (k === 'then' ? undefined : jest.fn(async () => ({ ok: true }))) }) as any;

describe('autorização das ações (viewer só lê; integrações/SDR/cadências = owner|admin)', () => {
  const w = crmWorld();
  const integ = new CrmIntegrationsController(w.access, spy(), spy());
  const cad = new CrmCadencesController(w.access, spy());
  const sdr = new CrmSdrController(w.access, spy());
  const L = '00000000-0000-4000-8000-0000000000aa';
  const bodies = {
    integ: [
      ['save', { workspaceId: WS_A, kind: 'email', provider: 'resend' }], ['test', { workspaceId: WS_A, kind: 'email' }], ['disconnect', { workspaceId: WS_A, kind: 'email' }],
      ['fields', { workspaceId: WS_A, formId: '1' }], ['sync', { workspaceId: WS_A }], ['costs', { workspaceId: WS_A }], ['secret', { workspaceId: WS_A, key: 'ZAPI_TOKEN', value: 'x'.repeat(10) }],
      ['failed', { workspaceId: WS_A }], ['reprocess', { workspaceId: WS_A, eventId: L }],
    ],
    write: [['send', { workspaceId: WS_A, leadId: L, kind: 'text', body: 'a' }], ['ig', { workspaceId: WS_A, leadId: L, body: 'a' }], ['email', { workspaceId: WS_A, leadId: L, subject: 's', body: 'b' }]],
  } as const;

  it('integrações: marketing e viewer → "Sem permissão para alterar integrações deste workspace."; owner/admin passam', async () => {
    for (const [fn, body] of bodies.integ) {
      for (const user of [MARKETING, VIEWER]) expect(await status((integ as any)[fn](u(user), body))).toBe('403:Sem permissão para alterar integrações deste workspace.');
      for (const user of [OWNER, ADMIN]) expect(await status((integ as any)[fn](u(user), body))).toBe('ok');
      expect(await status((integ as any)[fn](u(STRANGER), body))).toBe('403:Você não tem acesso a esta empresa.');
    }
  });
  it('envios: viewer bloqueado, marketing passa, quem é de outro workspace não passa', async () => {
    for (const [fn, body] of bodies.write) {
      expect(await status((integ as any)[fn](u(VIEWER), body))).toBe('403:Seu perfil não tem permissão para esta ação.');
      expect(await status((integ as any)[fn](u(MARKETING), body))).toBe('ok');
      expect(await status((integ as any)[fn](u(STRANGER), body))).toBe('403:Você não tem acesso a esta empresa.');
    }
  });
  it('status das credenciais: qualquer membro lê (inclusive viewer)', async () => {
    expect(await status(integ.status(u(VIEWER), { workspaceId: WS_A }))).toBe('ok');
    expect(await status(integ.status(u(STRANGER), { workspaceId: WS_A }))).toBe('403:Você não tem acesso a esta empresa.');
  });
  it('cadências: gerir = owner|admin; matricular = escrita; viewer não executa nada', async () => {
    const step = { channel: 'wa_text', delay_minutes: 0 };
    const save = { workspaceId: WS_A, name: 'x', triggerType: 'manual', isActive: false, steps: [step], exitRules: {} };
    for (const user of [MARKETING, VIEWER]) {
      expect(await status(cad.save(u(user), save as never))).toBe('403:Sem permissão para alterar cadências deste workspace.');
      expect(await status(cad.run(u(user), { workspaceId: WS_A }))).toBe('403:Sem permissão para alterar cadências deste workspace.');
      expect(await status(cad.install(u(user), { workspaceId: WS_A }))).toBe('403:Sem permissão para alterar cadências deste workspace.');
      expect(await status(cad.remove(u(user), { workspaceId: WS_A, id: L }))).toBe('403:Sem permissão para alterar cadências deste workspace.');
    }
    expect(await status(cad.enroll(u(VIEWER), { workspaceId: WS_A, cadenceId: L, leadIds: [] }))).toBe('403:Seu perfil não tem permissão para esta ação.');
    expect(await status(cad.enroll(u(MARKETING), { workspaceId: WS_A, cadenceId: L, leadIds: [] }))).toBe('ok');
    expect(await status(cad.save(u(ADMIN), save as never))).toBe('ok');
    expect(await status(cad.save(u(OWNER), { ...save, name: '  ' } as never))).toBe('400:Informe o nome da cadência.');
    expect(await status(cad.save(u(OWNER), { ...save, steps: [] } as never))).toBe('400:Adicione ao menos um passo.');
  });
  it('SDR: configurar = owner|admin; ler e testar = membro', async () => {
    expect(await status(sdr.save(u(MARKETING), { workspaceId: WS_A } as never))).toBe('403:Sem permissão para configurar o agente deste workspace.');
    expect(await status(sdr.upload(u(VIEWER), { workspaceId: WS_A } as never))).toBe('403:Sem permissão para configurar o agente deste workspace.');
    expect(await status(sdr.del(u(MARKETING), { workspaceId: WS_A, documentId: L }))).toBe('403:Sem permissão para configurar o agente deste workspace.');
    expect(await status(sdr.get(u(VIEWER), { workspaceId: WS_A }))).toBe('ok');
    expect(await status(sdr.test(u(VIEWER), { workspaceId: WS_A, history: [] }))).toBe('ok');
    expect(await status(sdr.get(u(STRANGER), { workspaceId: WS_A }))).toBe('403:Você não tem acesso a esta empresa.');
    expect(await status(sdr.get(u(OWNER), { workspaceId: WS_B }))).toBe('403:Você não tem acesso a esta empresa.');
  });
});

describe('cadências — ids de outro workspace (serviço real)', () => {
  it('apagar/atualizar cadência de outro workspace não tem efeito (404 ao salvar)', async () => {
    const w = channelsWorld();
    const foreign = await w.t.crm_cadences.create({ data: { workspace_id: WS_B, name: 'Alheia', steps: [] } });
    const err = async (p: Promise<unknown>) => { try { await p; return 'ok'; } catch (e: any) { return `${e.getStatus()}:${e.getResponse().message}`; } };
    await w.cadences.remove(WS_A, foreign.id);
    expect(w.t.crm_cadences.rows).toHaveLength(1);
    expect(await err(w.cadences.save(WS_A, { id: foreign.id, name: 'x', triggerType: 'manual', isActive: true, steps: [], exitRules: {} } as never))).toBe('404:Cadência não encontrada.');
    expect(w.t.crm_cadences.rows[0]!.name).toBe('Alheia');
  });
});

// ---------------------------------------------------------------- webhooks
const APP_SECRET = 'app-secret-xyz';
const sign = (raw: string, secret = APP_SECRET) => `sha256=${createHmac('sha256', secret).update(raw).digest('hex')}`;
const reply = () => { const r: any = { code: 200, headers: {} }; r.status = (c: number) => { r.code = c; return r; }; r.header = (k: string, v: string) => { r.headers[k] = v; return r; }; return r; };

function hooks(provider = 'whatsapp_cloud', secrets: Record<string, string> = {}) {
  const w = channelsWorld({ provider, secrets: { ZAPI_TOKEN: 'z-12345678', ...secrets } });
  const vault: any = { get: async () => null, has: async () => false };
  const ledger = new WebhookLedgerService(w.prisma, vault, { META_APP_SECRET: APP_SECRET } as never);
  const handled: any[] = [];
  const wa: any = { handleInbound: jest.fn(async (_i: any, m: any) => { handled.push(m); }), applyStatusUpdate: jest.fn() };
  const leadgen: any = { ingest: jest.fn(async () => ({ leadId: 'l', duplicated: false })) };
  return { w, ledger, wa, leadgen, handled, ctrl: new WhatsAppWebhookController(ledger, wa, w.secrets), lg: new LeadgenWebhookController(ledger, leadgen) };
}
const cloudBody = (id = 'wamid.1') => JSON.stringify({ entry: [{ changes: [{ value: { messages: [{ id, from: '5511988887777', type: 'text', text: { body: 'oi' } }], statuses: [{ id: 'wamid.0', status: 'read' }] } }] }] });

describe('webhook WhatsApp', () => {
  it('GET de verificação: token certo devolve o desafio; verify_token errado/modo errado/token de URL errado → 403', async () => {
    const h = hooks();
    const i = await h.w.integration({ verify_token: 'segredo-verify' });
    const q = (over = {}) => ({ 'hub.mode': 'subscribe', 'hub.verify_token': 'segredo-verify', 'hub.challenge': 'abc123', ...over });
    const r1 = reply();
    expect(await h.ctrl.get(i.webhook_token, q(), r1)).toBe('abc123');
    for (const [tok, over] of [[i.webhook_token, { 'hub.verify_token': 'segredo-verifX' }], [i.webhook_token, { 'hub.mode': 'unsubscribe' }], ['nao-existe', {}], [i.webhook_token, { 'hub.verify_token': '' }]] as const) {
      const r = reply();
      expect(await h.ctrl.get(tok, q(over), r)).toBe('Forbidden');
      expect(r.code).toBe(403);
    }
  });
  it('POST Cloud: sem assinatura / assinatura de outro segredo / corpo adulterado → 401 e nada processado', async () => {
    const h = hooks();
    const i = await h.w.integration();
    const raw = cloudBody();
    for (const sig of [undefined, sign(raw, 'outro-segredo'), sign(raw).slice(0, -2) + '00', sign(cloudBody('outro'))]) {
      const r = reply();
      expect(await h.ctrl.post(i.webhook_token, { 'x-hub-signature-256': sig }, { rawBody: Buffer.from(raw) } as never, r)).toBe('Invalid signature');
      expect(r.code).toBe(401);
    }
    expect(h.handled).toHaveLength(0);
    expect(h.w.t.crm_webhook_events.rows).toHaveLength(0);
  });
  it('POST Cloud válido: processa uma vez; reenvio do mesmo id é ignorado (ledger idempotente); recibo aplicado; falha fica "failed" e pode ser reprocessada', async () => {
    const h = hooks();
    const i = await h.w.integration();
    const raw = cloudBody();
    const post = () => h.ctrl.post(i.webhook_token, { 'x-hub-signature-256': sign(raw) }, { rawBody: Buffer.from(raw) } as never, reply());
    expect(await post()).toBe('ok');
    expect(await post()).toBe('ok');
    expect(h.handled).toHaveLength(1);
    expect(h.w.t.crm_webhook_events.rows).toEqual([expect.objectContaining({ source: 'whatsapp_message', external_id: 'wamid.1', status: 'processed' })]);
    expect(h.wa.applyStatusUpdate).toHaveBeenCalledWith(WS_A, 'wamid.0', 'read');
    // falha: marca failed (200 — falhas são registradas, não reenviadas) e o reenvio reprocessa
    h.wa.handleInbound.mockRejectedValueOnce(new Error('banco caiu'));
    const raw2 = cloudBody('wamid.2');
    const post2 = () => h.ctrl.post(i.webhook_token, { 'x-hub-signature-256': sign(raw2) }, { rawBody: Buffer.from(raw2) } as never, reply());
    expect(await post2()).toBe('ok');
    expect(h.w.t.crm_webhook_events.rows.find((e) => e.external_id === 'wamid.2')).toMatchObject({ status: 'failed', error_message: 'banco caiu' });
    await post2();
    expect(h.w.t.crm_webhook_events.rows.find((e) => e.external_id === 'wamid.2')).toMatchObject({ status: 'processed' });
  });
  it('POST: integração de outro tipo/token desconhecido → 404; corpo que não é JSON → 400', async () => {
    const h = hooks();
    const i = await h.w.integration();
    const lead = await h.w.integration({ kind: 'meta_lead_ads', provider: 'meta' });
    const r = reply();
    expect(await h.ctrl.post(lead.webhook_token, {}, { rawBody: Buffer.from('{}') } as never, r)).toBe('Not found');
    expect(r.code).toBe(404);
    const r2 = reply();
    expect(await h.ctrl.post(i.webhook_token, { 'x-hub-signature-256': sign('lixo') }, { rawBody: Buffer.from('lixo') } as never, r2)).toBe('Bad request');
    expect(r2.code).toBe(400);
  });
  it('Z-API sem segredo salvo: vale o token da URL; com WHATSAPP_WEBHOOK_SECRET exige o cabeçalho (Client-Token/x-webhook-secret/apikey), em tempo constante', async () => {
    const open = hooks('zapi');
    const i = await open.w.integration();
    const raw = JSON.stringify({ phone: '5511988887777', messageId: 'z1', text: { message: 'oi' } });
    expect(await open.ctrl.post(i.webhook_token, {}, { rawBody: Buffer.from(raw) } as never, reply())).toBe('ok');
    expect(open.handled).toHaveLength(1);

    const locked = hooks('zapi', { WHATSAPP_WEBHOOK_SECRET: 'segredo-do-webhook' });
    const j = await locked.w.integration();
    const r = reply();
    expect(await locked.ctrl.post(j.webhook_token, { 'client-token': 'errado' }, { rawBody: Buffer.from(raw) } as never, r)).toBe('Invalid secret');
    expect(r.code).toBe(401);
    expect(locked.handled).toHaveLength(0);
    for (const hdr of ['client-token', 'x-webhook-secret', 'apikey']) {
      const l = hooks('zapi', { WHATSAPP_WEBHOOK_SECRET: 'segredo-do-webhook' });
      const k = await l.w.integration();
      expect(await l.ctrl.post(k.webhook_token, { [hdr]: 'segredo-do-webhook' }, { rawBody: Buffer.from(raw) } as never, reply())).toBe('ok');
    }
  });
  it('comparação em tempo constante', () => {
    expect(safeEqual('abc', 'abc')).toBe(true);
    expect(safeEqual('abc', 'abd')).toBe(false);
    expect(safeEqual('abc', 'abcd')).toBe(false);
    expect(safeEqual('', '')).toBe(false);
  });
});

describe('webhook Meta Lead Ads', () => {
  const body = (id = '9001') => JSON.stringify({ entry: [{ changes: [{ value: { leadgen_id: id } }] }] });
  it('assinatura inválida → 401; válido processa uma vez (idempotente); falha → 500 "retry later" e reenvio reprocessa', async () => {
    const h = hooks();
    const i = await h.w.integration({ kind: 'meta_lead_ads', provider: 'meta' });
    const raw = body();
    const r = reply();
    expect(await h.lg.post(i.webhook_token, 'sha256=00', { rawBody: Buffer.from(raw) } as never, r)).toBe('Invalid signature');
    expect(r.code).toBe(401);
    const post = () => { const rr = reply(); return h.lg.post(i.webhook_token, sign(raw), { rawBody: Buffer.from(raw) } as never, rr).then((o) => [o, rr.code]); };
    expect(await post()).toEqual(['ok', 200]);
    expect(await post()).toEqual(['ok', 200]);
    expect(h.leadgen.ingest).toHaveBeenCalledTimes(1);
    const raw2 = body('9002');
    h.leadgen.ingest.mockRejectedValueOnce(new Error('Graph fora'));
    const rr = reply();
    expect(await h.lg.post(i.webhook_token, sign(raw2), { rawBody: Buffer.from(raw2) } as never, rr)).toBe('retry later');
    expect(rr.code).toBe(500);
    expect(h.w.t.crm_integrations.rows.find((x) => x.id === i.id)).toMatchObject({ status: 'error', last_error: 'Graph fora' });
    const rr2 = reply();
    expect(await h.lg.post(i.webhook_token, sign(raw2), { rawBody: Buffer.from(raw2) } as never, rr2)).toBe('ok');
    expect(h.leadgen.ingest).toHaveBeenCalledTimes(3);
  });
  it('GET: verify_token e modo conferidos', async () => {
    const h = hooks();
    const i = await h.w.integration({ kind: 'meta_lead_ads', provider: 'meta', verify_token: 'vt-lead' });
    expect(await h.lg.get(i.webhook_token, { 'hub.mode': 'subscribe', 'hub.verify_token': 'vt-lead', 'hub.challenge': '77' }, reply())).toBe('77');
    const r = reply();
    expect(await h.lg.get(i.webhook_token, { 'hub.mode': 'subscribe', 'hub.verify_token': 'x', 'hub.challenge': '77' }, r)).toBe('Forbidden');
    expect(r.code).toBe(403);
  });
});
