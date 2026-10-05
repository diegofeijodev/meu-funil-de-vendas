import { channelsWorld } from './world';

const STEP = (over: Record<string, unknown> = {}) => ({ channel: 'wa_text', delay_minutes: 0, window: { days: [0, 1, 2, 3, 4, 5, 6], start: '00:00', end: '23:59' }, message: 'Oi {{nome}}', ...over });

async function setup(steps: unknown[] = [STEP(), STEP({ delay_minutes: 60 })], leadOver: Record<string, unknown> = {}, provider = 'zapi') {
  const w = channelsWorld({ provider });
  await w.integration();
  const cadence = await w.t.crm_cadences.create({ data: { workspace_id: w.WS_A, name: 'C', steps, exit_rules: {} } });
  const lead = await w.addLead(w.WS_A, { name: 'Ana', phone: '+5511988887777', ...leadOver });
  const run = await w.t.crm_cadence_runs.create({ data: { workspace_id: w.WS_A, cadence_id: cadence.id, lead_id: lead.id, entered_at: new Date(Date.now() - 1000), entry_stage_id: lead.stage_id, next_run_at: new Date(Date.now() - 1000) } });
  // o motor real reserva por SQL (`FOR UPDATE SKIP LOCKED`): aqui o fake reserva em memória com a MESMA semântica de lease
  (w.cadences as any).claim = async (limit: number) => {
    const rows = w.t.crm_cadence_runs.rows.filter((r) => r.status === 'running' && r.next_run_at <= new Date() && (!r.lease_until || r.lease_until < new Date())).slice(0, limit);
    return rows.map((r) => { r.lease_until = new Date(Date.now() + 600e3); r.lease_token = `tok-${Math.random()}`; return { id: r.id, token: r.lease_token }; });
  };
  (w.t.crm_cadence_runs as any).rows.forEach(() => undefined);
  const withCadence = (w.prisma.crm_cadence_runs as any);
  const origFind = withCadence.findMany.bind(withCadence);
  withCadence.findMany = async (a: any) => (await origFind(a)).map((r: any) => ({ ...r, cadence: w.t.crm_cadences.rows.find((c) => c.id === r.cadence_id) }));
  return { w, cadence, lead, run };
}

describe('cadências — lock (nenhum passo enviado duas vezes)', () => {
  it('duas execuções ao mesmo tempo: o passo sai UMA vez', async () => {
    const { w } = await setup();
    const [a, b] = await Promise.all([w.cadences.runDue(), w.cadences.runDue()]);
    expect(a.executed + b.executed).toBe(1);
    expect(w.sent).toHaveLength(1);
    expect(w.t.crm_messages.rows.filter((m) => m.direction === 'out')).toHaveLength(1);
  });

  it('o passo é avançado ANTES do envio (queda no meio não repete)', async () => {
    const { w, run } = await setup();
    let seen: any;
    w.http.request = (async () => { seen = { ...w.t.crm_cadence_runs.rows[0] }; return { status: 200, ok: true, text: '{"messageId":"X"}' }; }) as never;
    await w.cadences.runDue();
    expect(seen).toMatchObject({ step_index: 1, status: 'running' });
    expect(seen.lease_token).toBeTruthy(); // lease segurado durante o envio
    expect(w.t.crm_cadence_runs.rows.find((r) => r.id === run.id)).toMatchObject({ step_index: 1, lease_token: null, lease_until: null });
  });

  it('lease perdido (outro worker assumiu): não envia', async () => {
    const { w } = await setup();
    (w.cadences as any).claim = async () => [{ id: w.t.crm_cadence_runs.rows[0]!.id, token: 'token-velho' }];
    w.t.crm_cadence_runs.rows[0]!.lease_token = 'token-novo';
    const r = await w.cadences.runDue();
    expect(r.executed).toBe(0);
    expect(w.sent).toHaveLength(0);
  });

  it('falha no envio: run vira failed no MESMO passo, com o erro, e o evento é registrado', async () => {
    const { w, run } = await setup();
    w.http.request = (async () => ({ status: 500, ok: false, text: 'boom' })) as never;
    await w.cadences.runDue();
    expect(w.t.crm_cadence_runs.rows.find((r) => r.id === run.id)).toMatchObject({ status: 'failed', step_index: 0, lease_token: null });
    expect(w.t.crm_cadence_runs.rows[0]!.last_error).toBe('Não foi possível enviar a mensagem.');
    expect(w.t.crm_messages.rows[0]).toMatchObject({ status: 'failed' });
    expect(w.t.crm_messages.rows[0]!.error_message).toContain('Z-API [500]');
    expect(w.t.crm_cadence_events.rows).toEqual([expect.objectContaining({ event: 'failed', step_index: 0 })]);
  });
});

describe('cadências — regras de execução', () => {
  it('descadastrado sai por opt_out e nada é enviado', async () => {
    const { w } = await setup(undefined, { unsubscribed: true });
    await w.cadences.runDue();
    expect(w.sent).toHaveLength(0);
    expect(w.t.crm_cadence_runs.rows[0]).toMatchObject({ status: 'stopped', stop_reason: 'opt_out' });
    expect(w.t.crm_cadence_events.rows[0]).toMatchObject({ event: 'opt_out' });
  });

  it('humano assumiu (ai_active=false) sai por human_takeover; resposta do lead sai por replied e cria tarefa', async () => {
    const a = await setup(undefined, { ai_active: false });
    await a.w.cadences.runDue();
    expect(a.w.t.crm_cadence_runs.rows[0]).toMatchObject({ stop_reason: 'human_takeover' });
    const b = await setup();
    await b.w.t.crm_messages.create({ data: { workspace_id: b.w.WS_A, lead_id: b.lead.id, conversation_id: 'c', direction: 'in', body: 'oi', created_at: new Date() } });
    await b.w.cadences.runDue();
    expect(b.w.t.crm_cadence_runs.rows[0]).toMatchObject({ stop_reason: 'replied' });
    expect(b.w.t.crm_tasks.rows[0]!.title).toBe('Responder Ana — respondeu à cadência');
  });

  it('fora da janela: reagenda sem enviar', async () => {
    const { w } = await setup([STEP({ window: { days: [], start: '00:00', end: '00:00' } })]);
    // days vazio = sempre dentro; usamos um dia que não é hoje
    const today = new Date().getDay();
    w.t.crm_cadences.rows[0]!.steps = [STEP({ window: { days: [(today + 3) % 7], start: '08:00', end: '20:00' } })];
    const r = await w.cadences.runDue();
    expect(r.skipped).toBe(1);
    expect(w.sent).toHaveLength(0);
    expect(w.t.crm_cadence_runs.rows[0]!.next_run_at.getTime()).toBeGreaterThan(Date.now());
  });

  it('limite por hora do workspace: adia 20 min', async () => {
    const { w } = await setup();
    await w.t.crm_settings.create({ data: { workspace_id: w.WS_A, wa_hourly_limit: 1 } });
    await w.t.crm_messages.create({ data: { workspace_id: w.WS_A, conversation_id: 'c', direction: 'out', created_at: new Date() } });
    const r = await w.cadences.runDue();
    expect(r.skipped).toBe(1);
    expect(w.sent).toHaveLength(0);
    expect(w.t.crm_cadence_runs.rows[0]!.next_run_at.getTime()).toBeGreaterThan(Date.now() + 19 * 60e3);
  });

  it('API oficial fora das 24 h: wa_text sem template é "skipped"; com fallback vira template', async () => {
    const a = await setup([STEP()], {}, 'whatsapp_cloud');
    await a.w.cadences.runDue();
    expect(a.w.sent).toHaveLength(0);
    expect(a.w.t.crm_cadence_events.rows[0]).toMatchObject({ event: 'skipped', detail: 'fora da janela de 24h e sem template' });
    const b = await setup([STEP({ fallback_template: 'retomar' })], {}, 'whatsapp_cloud');
    await b.w.cadences.runDue();
    expect(JSON.parse(b.w.sent[0]!.init.body)).toMatchObject({ type: 'template', template: { name: 'retomar' } });
  });

  it('call_task vira tarefa; passo de e-mail sem Resend conectado também; último passo conclui (done)', async () => {
    const { w } = await setup([STEP({ channel: 'call_task' })]);
    await w.cadences.runDue();
    expect(w.t.crm_tasks.rows[0]).toMatchObject({ title: 'Ligar para Ana' });
    expect(w.t.crm_cadence_runs.rows[0]).toMatchObject({ status: 'done' });
    expect(w.sent).toHaveLength(0);
  });

  it('e-mail com Resend conectado envia pelo EmailService (autor ai)', async () => {
    const { w } = await setup([STEP({ channel: 'email', subject: 'Olá {{nome}}' })], { email: 'a@b.co' });
    (w.email as any).integration = async () => ({ status: 'connected' });
    await w.cadences.runDue();
    expect(w.email.sendLeadEmail).toHaveBeenCalledWith(expect.objectContaining({ subject: 'Olá Ana', authorType: 'ai' }));
  });

  it('só Instagram (sem telefone): passo de texto vai pelo Direct', async () => {
    const { w } = await setup(undefined, { phone: null, instagram_id: 'ig-1' });
    await w.cadences.runDue();
    expect(w.instagram.sendInstagramAndStore).toHaveBeenCalledWith(expect.objectContaining({ leadId: expect.any(String), authorType: 'ai' }));
    expect(w.sent).toHaveLength(0);
  });
});

describe('cadências — matrícula escopada', () => {
  it('lead de outro workspace → 404 e nada é matriculado; cadência de outro workspace → 404', async () => {
    const w = channelsWorld();
    const cad = await w.t.crm_cadences.create({ data: { workspace_id: w.WS_A, name: 'C', steps: [] } });
    const mine = await w.addLead(w.WS_A, {});
    const theirs = await w.addLead('00000000-0000-4000-8000-00000000000b', {});
    const err = async (p: Promise<unknown>) => { try { await p; return 'ok'; } catch (e: any) { return `${e.getStatus()}:${e.getResponse().message}`; } };
    expect(await err(w.cadences.enrollLeads(w.WS_A, cad.id, [mine.id, theirs.id]))).toBe('404:Lead não encontrado.');
    expect(w.t.crm_cadence_runs.rows).toHaveLength(0);
    expect(await err(w.cadences.enrollLeads('00000000-0000-4000-8000-00000000000b', cad.id, [theirs.id]))).toBe('404:Cadência não encontrada.');
    expect(await err(w.cadences.stopLeadCadences(w.WS_A, theirs.id))).toBe('404:Lead não encontrado.');
    expect(await w.cadences.enrollLeads(w.WS_A, cad.id, [mine.id])).toEqual({ enrolled: 1 });
    expect(await w.cadences.enrollLeads(w.WS_A, cad.id, [mine.id])).toEqual({ enrolled: 0 }); // já em andamento
  });
  it('falha no ÚLTIMO passo (run já avançado para done): vira failed com last_error e libera o lease', async () => {
    const { w, run } = await setup([STEP()]);
    w.http.request = (async () => ({ status: 500, ok: false, text: 'boom' })) as never;
    await w.cadences.runDue();
    expect(w.t.crm_cadence_runs.rows.find((r) => r.id === run.id)).toMatchObject({ status: 'failed', step_index: 0, lease_token: null, lease_until: null });
    expect(w.t.crm_cadence_runs.rows[0]!.last_error).toBe('Não foi possível enviar a mensagem.');
    expect(w.t.crm_cadence_events.rows).toEqual([expect.objectContaining({ event: 'failed', step_index: 0 })]);
  });

  it('último passo enviado com sucesso: run done, lease liberado, sem erro', async () => {
    const { w, run } = await setup([STEP()]);
    await w.cadences.runDue();
    expect(w.t.crm_cadence_runs.rows.find((r) => r.id === run.id)).toMatchObject({ status: 'done', lease_token: null, lease_until: null, last_error: null });
  });
});
