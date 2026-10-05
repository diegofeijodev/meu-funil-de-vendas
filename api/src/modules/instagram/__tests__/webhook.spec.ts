import { createHmac } from 'node:crypto';
import { WS_A, WS_B } from '../../media/__tests__/mem';
import { WebhookLedgerService } from '../../webhooks/webhook-ledger.service';
import { extractEvents, InstagramWebhookController } from '../instagram-webhook.controller';
import { igServices, igWorld, IgWorld, IgTable, uuid } from './harness';

const SECRET = 'segredo-do-app';
const sign = (raw: string, secret = SECRET) => `sha256=${createHmac('sha256', secret).update(raw).digest('hex')}`;
const OWN = 'ig-own-1';
const dm = (sender: string, mid: string, text: string | null = 'Oi!', extra: Record<string, unknown> = {}) => ({ sender: { id: sender }, timestamp: 1, message: { mid, text, ...extra } });
const body = (entry: unknown[]) => JSON.stringify({ object: 'instagram', entry });

function setup(vaultSecret: string | null = null) {
  const w: IgWorld = igWorld();
  const s = igServices(w);
  const integ = { id: uuid(), workspace_id: WS_A, kind: 'instagram', provider: 'meta', status: 'disconnected', config: {}, webhook_token: 'tok-abc', verify_token: 'vt-xyz' };
  w.t['crm_integrations']!.rows.push(integ);
  const pipe = { id: uuid(), workspace_id: WS_A };
  w.t['crm_pipelines']!.rows.push(pipe);
  const stage = { id: uuid(), workspace_id: WS_A, pipeline_id: pipe.id, position: 0 };
  w.t['crm_stages']!.rows.push(stage);
  w.prisma.workspace_members = new IgTable();
  const vault = { get: jest.fn(async (ws: string | null) => (ws === WS_A ? vaultSecret : null)) } as any;
  const ledger = new WebhookLedgerService(w.prisma, vault, { META_APP_SECRET: SECRET });
  const ctrl = new InstagramWebhookController(ledger, s.inbound);
  const reply: any = { status: jest.fn(), header: jest.fn() };
  const post = (raw: string, over: { token?: string; sig?: string | null; noRaw?: boolean } = {}) => {
    const req: any = { rawBody: over.noRaw ? undefined : Buffer.from(raw), headers: over.sig === null ? {} : { 'x-hub-signature-256': over.sig ?? sign(raw) } };
    return ctrl.receive(over.token ?? 'tok-abc', req, reply);
  };
  const statusSet = () => reply.status.mock.calls.map((c: any[]) => c[0]);
  return { w, s, integ, stage, ctrl, reply, post, statusSet, ledger };
}

describe('GET /api/public/webhooks/instagram/:token (verificação da Meta)', () => {
  it('devolve o hub.challenge em text/plain só com modo subscribe + verify_token da integração', async () => {
    const { ctrl, reply } = setup();
    expect(await ctrl.verify('tok-abc', { 'hub.mode': 'subscribe', 'hub.verify_token': 'vt-xyz', 'hub.challenge': '12345' }, reply)).toBe('12345');
    expect(reply.header).toHaveBeenCalledWith('Content-Type', 'text/plain');
    expect(reply.status).not.toHaveBeenCalled();
  });
  it.each([
    ['token errado', 'zzz', { 'hub.mode': 'subscribe', 'hub.verify_token': 'vt-xyz', 'hub.challenge': '1' }],
    ['verify_token errado', 'tok-abc', { 'hub.mode': 'subscribe', 'hub.verify_token': 'outro', 'hub.challenge': '1' }],
    ['modo errado', 'tok-abc', { 'hub.mode': 'unsubscribe', 'hub.verify_token': 'vt-xyz', 'hub.challenge': '1' }],
  ])('403 "Forbidden" com %s', async (_n, token, q) => {
    const { ctrl, reply } = setup();
    expect(await ctrl.verify(token as string, q as any, reply)).toBe('Forbidden');
    expect(reply.status).toHaveBeenCalledWith(403);
  });
  it('verify_token vazio guardado na integração nunca verifica (nem com hub.verify_token vazio)', async () => {
    const { w, ctrl, reply } = setup();
    w.t['crm_integrations']!.rows[0]!.verify_token = '';
    expect(await ctrl.verify('tok-abc', { 'hub.mode': 'subscribe', 'hub.verify_token': '', 'hub.challenge': '1' }, reply)).toBe('Forbidden');
  });
  it('integração de outro tipo (mesmo token) não vale para o Instagram', async () => {
    const { w, ctrl, reply } = setup();
    w.t['crm_integrations']!.rows[0]!.kind = 'whatsapp';
    expect(await ctrl.verify('tok-abc', { 'hub.mode': 'subscribe', 'hub.verify_token': 'vt-xyz', 'hub.challenge': '1' }, reply)).toBe('Forbidden');
  });
});

describe('POST — assinatura x-hub-signature-256 e idempotência', () => {
  it('404 sem integração; 401 sem assinatura/assinatura errada/corpo bruto ausente; 400 JSON inválido (assinado)', async () => {
    const { post, statusSet, s } = setup();
    const raw = body([{ id: OWN, messaging: [dm('u1', 'm1')] }]);
    expect(await post(raw, { token: 'nope' })).toBe('Not found');
    expect(await post(raw, { sig: null })).toBe('Invalid signature');
    expect(await post(raw, { sig: sign(raw, 'segredo-errado') })).toBe('Invalid signature');
    expect(await post(raw, { sig: 'sha1=abc' })).toBe('Invalid signature');
    expect(await post(raw, { noRaw: true })).toBe('Invalid signature');
    expect(await post('{nao-json', {})).toBe('Bad request');
    expect(statusSet()).toEqual([404, 401, 401, 401, 401, 400]);
    expect(s.inbound).toBeDefined();
  });

  it('aceita o App Secret salvo no cofre da empresa (quando o do ambiente não confere)', async () => {
    const { w, ledger } = setup('segredo-do-cofre');
    const raw = '{"a":1}';
    expect(await ledger.verifyMetaSignatureFor(raw, sign(raw, 'segredo-do-cofre'), WS_A)).toBe(true);
    expect(await ledger.verifyMetaSignatureFor(raw, sign(raw, 'segredo-do-cofre'), WS_B)).toBe(false); // o cofre é por empresa
    expect(await ledger.verifyMetaSignatureFor(raw, sign(raw, SECRET), WS_B)).toBe(true); // o do ambiente vale para todas
    expect(await ledger.verifyMetaSignatureFor(raw, undefined, WS_A)).toBe(false);
    void w;
  });

  it('Direct vira lead + conversa (janela de 24 h) + mensagem + interação; reentrega do mesmo mid não duplica; integração fica "connected"', async () => {
    const { w, post, integ, stage, s } = setup();
    w.respond((path) => (path === '/page1' ? { access_token: 'page-tok' } : path === '/u1' ? { name: 'Maria', username: 'maria' } : undefined));
    const raw = body([{ id: OWN, messaging: [dm('u1', 'mid-1', 'Quero chopp')] }]);
    expect(await post(raw)).toBe('ok');
    const lead = w.t['crm_leads']!.rows[0]!;
    expect(lead).toMatchObject({ workspace_id: WS_A, name: 'Maria', source: 'instagram_dm', instagram_id: 'u1', instagram_username: 'maria', pipeline_id: expect.any(String), stage_id: stage.id });
    expect(w.t['crm_stage_history']!.rows[0]).toMatchObject({ lead_id: lead.id, to_stage_id: stage.id });
    const conv = w.t['crm_conversations']!.rows[0]!;
    expect(conv).toMatchObject({ phone: 'ig:u1', provider: 'instagram', unread_count: 1, last_message_preview: 'Quero chopp', lead_id: lead.id });
    expect(conv.window_expires_at.getTime() - Date.now()).toBeGreaterThan(23 * 3600e3);
    expect(w.t['crm_messages']!.rows[0]).toMatchObject({ direction: 'in', message_type: 'text', body: 'Quero chopp', external_id: 'mid-1', status: 'received', workspace_id: WS_A });
    expect(w.t['crm_interactions']!.rows[0]).toMatchObject({ kind: 'message_in', content: 'Quero chopp', lead_id: lead.id });
    expect(lead.first_response_at).toBeInstanceOf(Date);
    expect(integ.status).toBe('connected');
    expect(w.t['crm_webhook_events']!.rows[0]).toMatchObject({ source: 'instagram', external_id: 'mid-1', status: 'processed', workspace_id: WS_A });
    expect(s.hooks.startCadence).toHaveBeenCalledWith(WS_A, lead.id, 'instagram_dm');
    expect(s.hooks.stopCadences).toHaveBeenCalledWith(lead.id, 'replied');
    expect(s.hooks.runSdr).toHaveBeenCalledWith(expect.objectContaining({ inboundText: 'Quero chopp', leadId: lead.id }));
    // reentrega
    expect(await post(raw)).toBe('ok');
    expect(w.t['crm_messages']!.rows).toHaveLength(1);
    expect(w.t['crm_leads']!.rows).toHaveLength(1);
    // segunda mensagem do mesmo contato reaproveita lead e conversa
    await post(body([{ id: OWN, messaging: [dm('u1', 'mid-2', 'E o preço?')] }]));
    expect(w.t['crm_leads']!.rows).toHaveLength(1);
    expect(w.t['crm_conversations']!.rows[0]!.unread_count).toBe(2);
  });

  it('descadastro ("SAIR") marca o lead, para as cadências e não aciona o SDR', async () => {
    const { w, post, s } = setup();
    await post(body([{ id: OWN, messaging: [dm('u9', 'mid-9', ' Sair. ')] }]));
    const lead = w.t['crm_leads']!.rows[0]!;
    expect(lead).toMatchObject({ unsubscribed: true, ai_active: false });
    expect(s.hooks.stopCadences).toHaveBeenCalledWith(lead.id, 'opt_out');
    expect(s.hooks.stopCadences).not.toHaveBeenCalledWith(lead.id, 'replied');
    expect(s.hooks.runSdr).not.toHaveBeenCalled();
  });

  it('SDR responde pela janela de 24 h do Instagram (DM enviada e gravada); sem SDR nada é enviado', async () => {
    const { w, post, s } = setup();
    w.respond((path, opts) => (path === '/page1' && opts.params?.fields === 'access_token' ? { access_token: 'page-tok' } : path === '/page1/messages' ? { message_id: 'out-1' } : undefined));
    s.hooks.runSdr.mockResolvedValueOnce({ reply: 'Claro! Temos chopp gelado.' });
    await post(body([{ id: OWN, messaging: [dm('u2', 'mid-5', 'Tem chopp?')] }]));
    const send = w.calls.find((c) => c.path === '/page1/messages')!;
    expect(send.opts).toMatchObject({ method: 'POST', token: 'page-tok', params: { recipient: { id: 'u2' }, message: { text: 'Claro! Temos chopp gelado.' } } });
    const out = w.t['crm_messages']!.rows.find((m) => m.direction === 'out')!;
    expect(out).toMatchObject({ status: 'sent', external_id: 'out-1', author_type: 'ai', body: 'Claro! Temos chopp gelado.' });
  });

  it('comentário com palavra-chave: resposta privada (comment_id) + resposta pública; lead da origem "instagram_comment"', async () => {
    const { w, integ, post } = setup();
    integ.config = { keywords: [{ word: 'QUERO', dm: 'Aqui está o link: https://x', publicReply: 'Te chamei no Direct!' }] };
    w.respond((path) => (path === '/page1' ? { access_token: 'page-tok' } : path === '/page1/messages' ? { message_id: 'out-2' } : undefined));
    const change = { field: 'comments', value: { id: 'c1', text: 'eu quero! 😍', from: { id: 'u3', username: 'joao' }, media: { id: 'media-7' } } };
    expect(await post(body([{ id: OWN, changes: [change] }]))).toBe('ok');
    expect(w.t['crm_leads']!.rows[0]).toMatchObject({ source: 'instagram_comment', instagram_username: 'joao', name: '@joao' });
    const priv = w.calls.find((c) => c.path === '/page1/messages')!;
    expect(priv.opts.params.recipient).toEqual({ comment_id: 'c1' });
    expect(w.calls.find((c) => c.path === '/c1/replies')!.opts.params).toEqual({ message: 'Te chamei no Direct!' });
    expect(w.t['crm_messages']!.rows[0]).toMatchObject({ direction: 'out', author_type: 'system', status: 'sent', external_id: 'out-2' });
    expect(w.t['crm_interactions']!.rows[0]).toMatchObject({ content: 'Comentou no Instagram: "eu quero! 😍"', metadata: { comment_id: 'c1', media_id: 'media-7' } });
    expect(w.t['crm_webhook_events']!.rows[0]!.external_id).toBe('comment:c1');
  });

  it('falha no processamento: 500 "retry later", evento "failed", integração em erro; a reentrega reprocessa', async () => {
    const { w, integ, post, s } = setup();
    w.t['crm_pipelines']!.rows.length = 0;
    const orig = s.inbound.handleInstagramInbound.bind(s.inbound);
    jest.spyOn(s.inbound, 'handleInstagramInbound').mockRejectedValueOnce(new Error('banco indisponível'));
    const raw = body([{ id: OWN, messaging: [dm('u5', 'mid-f', 'oi')] }]);
    expect(await post(raw)).toBe('retry later');
    expect(w.t['crm_webhook_events']!.rows[0]).toMatchObject({ status: 'failed', error_message: 'banco indisponível' });
    expect(integ).toMatchObject({ status: 'error', last_error: 'banco indisponível' });
    // Meta reenvia: o evento que falhou é reivindicado de novo (mesmo registro) e agora passa
    (s.inbound.handleInstagramInbound as jest.Mock).mockImplementation(orig);
    expect(await post(raw)).toBe('ok');
    expect(w.t['crm_webhook_events']!.rows).toHaveLength(1);
    expect(w.t['crm_webhook_events']!.rows[0]).toMatchObject({ status: 'processed', error_message: null });
    expect(integ).toMatchObject({ status: 'connected', last_error: null });
    expect(w.t['crm_messages']!.rows).toHaveLength(1);
  });

  it('evento ainda "processing" (< 10 min) não é reprocessado; travado há > 10 min é', async () => {
    const { w, ledger } = setup();
    const first = await ledger.claimEvent({ workspaceId: WS_A, source: 'instagram', externalId: 'e1', payload: {} });
    expect(first).toBeTruthy();
    expect(await ledger.claimEvent({ workspaceId: WS_A, source: 'instagram', externalId: 'e1' })).toBeNull();
    w.t['crm_webhook_events']!.rows[0]!.created_at = new Date(Date.now() - 11 * 60e3);
    expect(await ledger.claimEvent({ workspaceId: WS_A, source: 'instagram', externalId: 'e1' })).toBe(first);
    await ledger.finishEvent(first!, null);
    expect(await ledger.claimEvent({ workspaceId: WS_A, source: 'instagram', externalId: 'e1' })).toBeNull(); // processado
  });
});

describe('extractEvents', () => {
  it('ignora eco, mensagem da própria conta, sem mensagem e comentários da própria conta; mid ausente usa sender:timestamp', () => {
    const ev = extractEvents({
      entry: [
        {
          id: OWN,
          messaging: [
            { sender: { id: 'a' }, message: { mid: 'm1', text: 'oi', is_echo: true } },
            { sender: { id: OWN }, message: { mid: 'm2', text: 'eu' } },
            { sender: { id: 'b' } },
            { sender: { id: 'c' }, timestamp: 77, message: { text: 'sem mid' } },
            { sender: { id: 'd' }, message: { mid: 'm5', attachments: [{ type: 'image', payload: { url: 'https://cdn/x.jpg' } }] } },
          ],
          changes: [
            { field: 'comments', value: { id: 'k1', text: 'ótimo', from: { id: 'e', username: 'e1' } } },
            { field: 'comments', value: { id: 'k2', from: { id: OWN } } },
            { field: 'mentions', value: { id: 'k3', from: { id: 'f' } } },
          ],
        },
      ],
    });
    expect(ev.map((e) => e.id)).toEqual(['c:77', 'm5', 'comment:k1']);
    expect(ev[1]!.msg).toMatchObject({ kind: 'dm', igsid: 'd', text: null, attachmentUrl: 'https://cdn/x.jpg', attachmentType: 'image' });
    expect(ev[2]!.msg).toMatchObject({ kind: 'comment', igsid: 'e', username: 'e1', commentId: 'k1', text: 'ótimo' });
  });
});

describe('handleInstagramInbound — idempotência por external_id (índice único parcial)', () => {
  const inbound = (mid: string) => ({ kind: 'dm', igsid: 'u1', mid, text: 'Quero chopp', attachmentType: null, attachmentUrl: null }) as any;

  it('reentrega (pré-checagem): uma linha, contador 1, SDR uma vez', async () => {
    const { w, integ, s } = setup();
    w.respond(() => undefined);
    await s.inbound.handleInstagramInbound(integ as any, inbound('mid-x'));
    const interactions = w.t['crm_interactions']!.rows.length;
    await s.inbound.handleInstagramInbound(integ as any, inbound('mid-x'));
    expect(w.t['crm_messages']!.rows.filter((m) => m.direction === 'in')).toHaveLength(1);
    expect(w.t['crm_conversations']!.rows[0]!.unread_count).toBe(1);
    expect(w.t['crm_interactions']!.rows).toHaveLength(interactions);
    expect(s.hooks.runSdr).toHaveBeenCalledTimes(1);
  });

  it('corrida: pré-checagem não viu, o P2002 do índice barra a segunda sem efeitos colaterais', async () => {
    const { w, integ, s } = setup();
    await s.inbound.handleInstagramInbound(integ as any, inbound('mid-y'));
    const find = w.prisma.crm_messages.findFirst.bind(w.prisma.crm_messages);
    w.prisma.crm_messages.findFirst = async () => null;
    await s.inbound.handleInstagramInbound(integ as any, inbound('mid-y'));
    w.prisma.crm_messages.findFirst = find;
    expect(w.t['crm_messages']!.rows.filter((m) => m.direction === 'in')).toHaveLength(1);
    expect(w.t['crm_conversations']!.rows[0]!.unread_count).toBe(1);
    expect(s.hooks.runSdr).toHaveBeenCalledTimes(1);
  });

  it('mensagem e contador da conversa são atômicos: se o update falha, a mensagem não fica', async () => {
    const { w, integ, s } = setup();
    w.prisma.crm_conversations.update = async () => { throw new Error('banco caiu'); };
    await expect(s.inbound.handleInstagramInbound(integ as any, inbound('mid-z'))).rejects.toThrow('banco caiu');
    expect(w.t['crm_messages']!.rows.filter((m) => m.direction === 'in')).toHaveLength(0);
  });
});

describe('envio do Instagram — id do provedor repetido (P2002 do índice único)', () => {
  it('DM do SDR: a mensagem já entregue fica "sent" sem external_id, sem lançar nem marcar "failed"', async () => {
    const { w, s, integ } = setup();
    w.respond((path, opts) => (path === '/page1' && opts.params?.fields === 'access_token' ? { access_token: 'page-tok' } : path === '/page1/messages' ? { message_id: 'dup-1' } : undefined));
    await s.inbound.handleInstagramInbound(integ as any, { kind: 'dm', igsid: 'u9', mid: 'mid-a', text: 'Oi', attachmentType: null, attachmentUrl: null } as any);
    const lead = w.t['crm_leads']!.rows[0]!;
    w.t['crm_messages']!.rows.push({ id: uuid(), workspace_id: WS_A, direction: 'in', external_id: 'dup-1' });
    const update = w.prisma.crm_messages.update.bind(w.prisma.crm_messages);
    w.prisma.crm_messages.update = async (a: any) => {
      if (a.data.external_id === 'dup-1') throw Object.assign(new Error('Unique constraint failed'), { code: 'P2002' });
      return update(a);
    };
    const r = await s.inbound.sendInstagramAndStore({ workspaceId: WS_A, leadId: lead.id, text: 'Claro!' });
    const out = w.t['crm_messages']!.rows.find((m) => m.id === r.id)!;
    expect(out).toMatchObject({ direction: 'out', status: 'sent' });
    expect(out.external_id ?? null).toBeNull();
    expect(out.error_message ?? null).toBeNull();
  });

  it('DM: erro que não é P2002 continua marcando "failed" e lançando', async () => {
    const { w, s, integ } = setup();
    w.respond((path, opts) => (path === '/page1' && opts.params?.fields === 'access_token' ? { access_token: 'page-tok' } : path === '/page1/messages' ? { message_id: 'ok-1' } : undefined));
    await s.inbound.handleInstagramInbound(integ as any, { kind: 'dm', igsid: 'u8', mid: 'mid-b', text: 'Oi', attachmentType: null, attachmentUrl: null } as any);
    const lead = w.t['crm_leads']!.rows[0]!;
    const update = w.prisma.crm_messages.update.bind(w.prisma.crm_messages);
    w.prisma.crm_messages.update = async (a: any) => {
      if (a.data.external_id === 'ok-1') throw new Error('banco caiu');
      return update(a);
    };
    await expect(s.inbound.sendInstagramAndStore({ workspaceId: WS_A, leadId: lead.id, text: 'Claro!' })).rejects.toThrow('Não foi possível enviar no Instagram');
    expect(w.t['crm_messages']!.rows.find((m) => m.direction === 'out')).toMatchObject({ status: 'failed' });
  });

  it('resposta privada a comentário: id repetido grava a mensagem sem external_id e não lança', async () => {
    const { w, integ, post } = setup();
    integ.config = { keywords: [{ word: 'QUERO', dm: 'Aqui está o link' }] };
    w.t['crm_messages']!.rows.push({ id: uuid(), workspace_id: WS_A, direction: 'in', external_id: 'dup-2' });
    w.respond((path) => (path === '/page1' ? { access_token: 'page-tok' } : path === '/page1/messages' ? { message_id: 'dup-2' } : undefined));
    const change = { field: 'comments', value: { id: 'c9', text: 'eu quero', from: { id: 'u7', username: 'ana' }, media: { id: 'm1' } } };
    expect(await post(body([{ id: OWN, changes: [change] }]))).toBe('ok');
    const out = w.t['crm_messages']!.rows.filter((m) => m.direction === 'out');
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ status: 'sent', author_type: 'system', body: 'Aqui está o link' });
    expect(out[0]!.external_id ?? null).toBeNull();
  });
});
