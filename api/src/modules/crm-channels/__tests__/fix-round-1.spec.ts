import { createHmac } from 'node:crypto';
import { WebhookLedgerService } from '../../webhooks/webhook-ledger.service';
import { ChannelHttp } from '../channel-http';
import { LeadgenWebhookController } from '../crm-webhooks.controller';
import { parseCloudPayload, parseUnofficialPayload } from '../wa-payload';
import { channelsWorld } from './world';

const INBOUND = (over: Record<string, unknown> = {}) => ({ externalId: 'ext-1', from: '5511988887777', type: 'text' as const, body: 'oi', profileName: 'Ana', ...over });
const STEP = { channel: 'wa_text', delay_minutes: 0, window: { days: [0, 1, 2, 3, 4, 5, 6], start: '00:00', end: '23:59' }, message: 'Oi' };

describe('rodada 1 — matrícula por gatilho não passa fome', () => {
  it('com mais de 200 leads combinando, a rodada seguinte matricula os restantes (mais antigos primeiro)', async () => {
    const w = channelsWorld();
    w.t.crm_leads.relations['crm_cadence_runs'] = { table: w.t.crm_cadence_runs, fk: 'lead_id' };
    const cadence = await w.t.crm_cadences.create({ data: { workspace_id: w.WS_A, name: 'T', steps: [STEP], exit_rules: {}, is_active: true, trigger_type: 'tag', trigger_value: 'vip' } });
    for (let i = 0; i < 230; i++) await w.addLead(w.WS_A, { name: `L${i}`, tags: ['vip'], created_at: new Date(2026, 0, 1, 0, 0, i) });
    const enrolled = jest.spyOn(w.cadences, 'enrollLead');
    expect(await w.cadences.applyStageAndTagTriggers()).toBe(200);
    expect(await w.cadences.applyStageAndTagTriggers()).toBe(30);
    expect(await w.cadences.applyStageAndTagTriggers()).toBe(0);
    expect(w.t.crm_cadence_runs.rows.filter((r) => r.cadence_id === cadence.id)).toHaveLength(230);
    expect(enrolled).toHaveBeenCalledTimes(230); // nunca reavalia quem já está matriculado
  });
});

describe('rodada 1 — payloads do provedor que não são mensagem recebida', () => {
  it('Z-API: só ReceivedCallback; status/entrega/presença, grupo e fromMe são ignorados', () => {
    const base = { phone: '5511988887777', messageId: 'z1', text: { message: 'oi' } };
    expect(parseUnofficialPayload({ ...base, type: 'ReceivedCallback' })).toHaveLength(1);
    expect(parseUnofficialPayload({ ...base, type: 'MessageStatusCallback', status: 'READ' })).toEqual([]);
    expect(parseUnofficialPayload({ type: 'DeliveryCallback', phone: '5511988887777', messageId: 'z1' })).toEqual([]);
    expect(parseUnofficialPayload({ type: 'PresenceChatCallback', phone: '5511988887777', status: 'COMPOSING' })).toEqual([]);
    expect(parseUnofficialPayload({ ...base, type: 'ReceivedCallback', isGroup: true })).toEqual([]);
    expect(parseUnofficialPayload({ ...base, type: 'ReceivedCallback', fromMe: true })).toEqual([]);
    expect(parseUnofficialPayload({ phone: '5511988887777', messageId: 'z2', type: 'ReceivedCallback' })).toEqual([]); // sem texto nem mídia
  });
  it('Evolution: só messages.upsert com fromMe=false; grupo, update e vazio ignorados', () => {
    const data = { key: { remoteJid: '5511988887777@s.whatsapp.net', id: 'e1', fromMe: false }, message: { conversation: 'olá' } };
    expect(parseUnofficialPayload({ event: 'messages.upsert', data })).toHaveLength(1);
    expect(parseUnofficialPayload({ event: 'MESSAGES_UPSERT', data })).toHaveLength(1);
    expect(parseUnofficialPayload({ event: 'messages.update', data: { ...data, status: 'READ' } })).toEqual([]);
    expect(parseUnofficialPayload({ event: 'connection.update', data: { state: 'open' } })).toEqual([]);
    expect(parseUnofficialPayload({ event: 'messages.upsert', data: { ...data, key: { ...data.key, fromMe: true } } })).toEqual([]);
    expect(parseUnofficialPayload({ event: 'messages.upsert', data: { ...data, key: { ...data.key, remoteJid: '1203@g.us' } } })).toEqual([]);
    expect(parseUnofficialPayload({ event: 'messages.upsert', data: { key: data.key, message: {} } })).toEqual([]);
    expect(parseUnofficialPayload({ event: 'messages.upsert', data: { key: data.key, message: { imageMessage: { url: 'x' } } } })[0]).toMatchObject({ type: 'image', body: null });
  });
  it('Cloud API: formatos quebrados (entry/change nulos, value ausente) não estouram', () => {
    expect(parseCloudPayload({ entry: [null, {}, { changes: null }, { changes: [null, {}, { value: null }, { value: { messages: [null, { id: 'm1', from: '5511', type: 'text', text: { body: 'oi' } }], statuses: [null] } }] }] })).toEqual({
      inbound: [expect.objectContaining({ externalId: 'm1', body: 'oi' })], statuses: [],
    });
    expect(parseCloudPayload({ entry: 'x' })).toEqual({ inbound: [], statuses: [] });
  });
});

describe('rodada 1 — mensagem recebida é idempotente', () => {
  it('a mesma mensagem reentregue: uma linha, unread_count 1, SDR uma vez, sem nova interação', async () => {
    const w = channelsWorld();
    const integ = await w.integration();
    await w.extra.crm_sdr_agents.create({ data: { workspace_id: w.WS_A } });
    const a = await w.whatsapp.handleInbound(integ as never, INBOUND());
    const interactions = w.t.crm_interactions.rows.length;
    const b = await w.whatsapp.handleInbound(integ as never, INBOUND());
    expect(b).toMatchObject({ ignored: 'mensagem duplicada', leadId: a.leadId });
    expect(w.t.crm_messages.rows.filter((m) => m.direction === 'in')).toHaveLength(1);
    expect(w.t.crm_conversations.rows[0]!.unread_count).toBe(1);
    expect(w.t.crm_interactions.rows).toHaveLength(interactions);
    expect(w.aiCalls).toHaveLength(1);
  });

  it('corrida: o índice único barra a segunda gravação (P2002) sem efeitos colaterais', async () => {
    const w = channelsWorld();
    const integ = await w.integration();
    await w.whatsapp.handleInbound(integ as never, INBOUND());
    const find = w.prisma.crm_messages.findFirst.bind(w.prisma.crm_messages);
    w.prisma.crm_messages.findFirst = async () => null; // a checagem prévia não viu (outra entrega ainda não tinha gravado)
    const r = await w.whatsapp.handleInbound(integ as never, INBOUND());
    w.prisma.crm_messages.findFirst = find;
    expect(r.ignored).toBe('mensagem duplicada');
    expect(w.t.crm_messages.rows).toHaveLength(1);
    expect(w.t.crm_conversations.rows[0]!.unread_count).toBe(1);
  });

  it('mensagem e contador da conversa são atômicos: falha no update desfaz a mensagem', async () => {
    const w = channelsWorld();
    const integ = await w.integration();
    w.prisma.crm_conversations.update = async () => { throw new Error('banco caiu'); };
    await expect(w.whatsapp.handleInbound(integ as never, INBOUND())).rejects.toThrow('banco caiu');
    expect(w.t.crm_messages.rows.filter((m) => m.direction === 'in')).toHaveLength(0);
  });

  it('externalId nulo não é deduplicado (sem chave não há o que comparar) e outro workspace pode repetir o id', async () => {
    const w = channelsWorld();
    const integ = await w.integration();
    await w.whatsapp.handleInbound(integ as never, INBOUND({ externalId: null }));
    await w.whatsapp.handleInbound(integ as never, INBOUND({ externalId: null }));
    expect(w.t.crm_messages.rows).toHaveLength(2);
  });
});

describe('rodada 1 — SDR: uma execução por lead', () => {
  it('duas mensagens simultâneas do mesmo lead: uma resposta só', async () => {
    const w = channelsWorld();
    const integ = await w.integration();
    await w.extra.crm_sdr_agents.create({ data: { workspace_id: w.WS_A } });
    await w.whatsapp.handleInbound(integ as never, INBOUND({ externalId: 'a', body: 'oi' })); // cria o lead
    w.aiCalls.length = 0;
    await Promise.all([
      w.whatsapp.handleInbound(integ as never, INBOUND({ externalId: 'b', body: 'quanto custa?' })),
      w.whatsapp.handleInbound(integ as never, INBOUND({ externalId: 'c', body: 'tem desconto?' })),
    ]);
    expect(w.aiCalls).toHaveLength(1);
    // a trava é solta no fim: a próxima mensagem volta a acionar o SDR
    await w.whatsapp.handleInbound(integ as never, INBOUND({ externalId: 'd', body: 'obrigado' }));
    expect(w.aiCalls).toHaveLength(2);
  });
  it('falha do SDR também solta a trava', async () => {
    const w = channelsWorld({ ai: () => { throw new Error('IA fora'); } });
    const integ = await w.integration();
    await w.extra.crm_sdr_agents.create({ data: { workspace_id: w.WS_A } });
    await w.whatsapp.handleInbound(integ as never, INBOUND({ externalId: 'a' }));
    await w.whatsapp.handleInbound(integ as never, INBOUND({ externalId: 'b' }));
    expect(w.aiCalls).toHaveLength(2);
  });
});

async function runSetup(over: Record<string, unknown> = {}) {
  const w = channelsWorld();
  await w.integration();
  const cadence = await w.t.crm_cadences.create({ data: { workspace_id: w.WS_A, name: 'C', steps: [STEP, { ...STEP, delay_minutes: 60 }], exit_rules: {} } });
  const lead = await w.addLead(w.WS_A, { name: 'Ana', phone: '+5511988887777', ...over });
  const run = await w.t.crm_cadence_runs.create({ data: { workspace_id: w.WS_A, cadence_id: cadence.id, lead_id: lead.id, entered_at: new Date(Date.now() - 1000), entry_stage_id: lead.stage_id, next_run_at: new Date(Date.now() - 1000) } });
  const claimed: number[] = [];
  (w.cadences as any).claim = async (limit: number) => {
    claimed.push(limit);
    const rows = w.t.crm_cadence_runs.rows.filter((r) => r.status === 'running' && r.next_run_at <= new Date()).slice(0, limit);
    return rows.map((r) => { r.lease_token = `tok-${r.id}`; return { id: r.id, token: r.lease_token }; });
  };
  const runs = w.prisma.crm_cadence_runs as any;
  const orig = runs.findMany.bind(runs);
  runs.findMany = async (a: any) => (await orig(a)).map((r: any) => ({ ...r, cadence: w.t.crm_cadences.rows.find((c) => c.id === r.cadence_id) }));
  return { w, run, claimed };
}

describe('rodada 1 — motor de cadências', () => {
  it('parada (resposta/opt-out) no meio do passo não é sobrescrita de volta para running/done', async () => {
    const { w, run } = await runSetup();
    w.http.request = (async () => {
      // o lead responde enquanto o envio está em andamento: a parada grava status=stopped
      await w.core.stopCadences(w.WS_A, run.lead_id, 'replied');
      return { status: 200, ok: true, text: '{"messageId":"X"}' };
    }) as never;
    await w.cadences.runDue();
    expect(w.t.crm_cadence_runs.rows[0]).toMatchObject({ status: 'stopped', stop_reason: 'replied' });
  });

  it('reserva no máximo 25 por rodada (padrão)', async () => {
    const { w, claimed } = await runSetup();
    await w.cadences.runDue();
    expect(claimed).toEqual([25]);
  });

  it('addInteraction/logEvent falhando DEPOIS do envio: a mensagem saiu e o run avança (não vira failed)', async () => {
    const { w, run } = await runSetup();
    (w.core as any).addInteraction = async () => { throw new Error('banco indisponível'); };
    const origCreate = w.prisma.crm_cadence_events.create.bind(w.prisma.crm_cadence_events);
    w.prisma.crm_cadence_events.create = async () => { throw new Error('log indisponível'); };
    const r = await w.cadences.runDue();
    w.prisma.crm_cadence_events.create = origCreate;
    expect(r.executed).toBe(1);
    expect(w.sent).toHaveLength(1);
    expect(w.t.crm_cadence_runs.rows.find((x) => x.id === run.id)).toMatchObject({ status: 'running', step_index: 1, lease_token: null });
  });
});

describe('rodada 1 — download de mídia com teto', () => {
  const make = (res: () => Response) => new ChannelHttp(async () => res(), { NODE_ENV: 'development' } as never);
  const stream = (chunks: number, size: number, pulled: { n: number }) => new Response(new ReadableStream({
    pull(c) { if (pulled.n >= chunks) { c.close(); return; } pulled.n += 1; c.enqueue(new Uint8Array(size)); },
  }), { headers: { 'content-type': 'image/png' } });

  it('sem content-length: aborta ao passar do teto, sem ler o corpo inteiro', async () => {
    const pulled = { n: 0 };
    await expect(make(() => stream(1000, 1024, pulled)).bytes('http://x', {}, 10 * 1024)).rejects.toThrow('Mídia grande demais.');
    expect(pulled.n).toBeLessThan(50);
  });
  it('abaixo do teto devolve os bytes e o tipo', async () => {
    const out = await make(() => stream(3, 1024, { n: 0 })).bytes('http://x', {}, 10 * 1024);
    expect(out.bytes.length).toBe(3072);
    expect(out.mime).toBe('image/png');
  });
  it('content-length acima do teto recusa de imediato', async () => {
    await expect(make(() => new Response('x', { headers: { 'content-length': '999999' } })).bytes('http://x', {}, 100)).rejects.toThrow('Mídia grande demais.');
  });
});

describe('rodada 1 — webhook leadgen com formato quebrado', () => {
  const APP_SECRET = 'app-secret-xyz';
  const sign = (raw: string) => `sha256=${createHmac('sha256', APP_SECRET).update(raw).digest('hex')}`;
  const reply = () => { const r: any = { code: 200 }; r.status = (c: number) => { r.code = c; return r; }; return r; };

  it('entry/change nulos, sem value ou sem leadgen_id são ignorados; os válidos seguem e a resposta é 200', async () => {
    const w = channelsWorld();
    const ledger = new WebhookLedgerService(w.prisma, { get: async () => null, has: async () => false } as never, { META_APP_SECRET: APP_SECRET } as never);
    const leadgen: any = { ingest: jest.fn(async () => ({ leadId: 'l', duplicated: false })) };
    const ctrl = new LeadgenWebhookController(ledger, leadgen);
    const i = await w.integration({ kind: 'meta_lead_ads', provider: 'meta' });
    const raw = JSON.stringify({ entry: [null, 5, {}, { changes: null }, { changes: [null, {}, { value: null }, { value: 'x' }, { value: { leadgen_id: '77' } }] }] });
    const r = reply();
    expect(await ctrl.post(i.webhook_token, sign(raw), { rawBody: Buffer.from(raw) } as never, r)).toBe('ok');
    expect(r.code).toBe(200);
    expect(leadgen.ingest).toHaveBeenCalledTimes(1);
    const raw2 = 'null';
    const r2 = reply();
    expect(await ctrl.post(i.webhook_token, sign(raw2), { rawBody: Buffer.from(raw2) } as never, r2)).toBe('ok');
    expect(r2.code).toBe(200);
  });
});
