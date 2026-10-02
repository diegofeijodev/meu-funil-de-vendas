import { channelsWorld } from './world';

const decision = (over: Record<string, unknown> = {}) => ({ resposta: 'Ok!', campos_extraidos: { cidade: null, capital: null, prazo: null, decisor: null, email: null, observacoes: null }, score: 70, temperatura: 'quente', proxima_etapa: 'manter', transferir_humano: false, motivo: '', horario_escolhido: null, ...over });

async function setup(ai: (p?: string, m?: string) => unknown, leadOver: Record<string, unknown> = {}) {
  const w = channelsWorld({ ai });
  const agent = await w.extra.crm_sdr_agents.create({ data: { workspace_id: w.WS_A } });
  const lead = await w.addLead(w.WS_A, { phone: '+5511988887777', owner_id: w.OWNER, ...leadOver });
  return { w, agent, lead, run: (text = 'oi') => w.sdr.run({ workspaceId: w.WS_A, leadId: lead.id, inboundText: text }) };
}

describe('SDR — aplicação da decisão', () => {
  it('qualificado: move a etapa POR NOME, grava histórico, score, temperatura, cidade e e-mail', async () => {
    const { w, lead, run } = await setup(() => decision({ proxima_etapa: 'qualificado', campos_extraidos: { cidade: 'Campinas', email: 'a@b.co' } }));
    const r: any = await run();
    expect(r.reply).toBe('Ok!');
    const row = w.t.crm_leads.rows.find((l) => l.id === lead.id)!;
    expect(row.stage_id).toBe(w.A.stages[1]!.id);
    expect(row).toMatchObject({ score: 70, temperature: 'quente', city: 'Campinas', email: 'a@b.co', ai_active: true });
    expect(w.t.crm_stage_history.rows).toEqual([expect.objectContaining({ lead_id: lead.id, from_stage_id: w.A.stages[0]!.id, to_stage_id: w.A.stages[1]!.id })]);
    expect(w.extra.crm_sdr_runs.rows[0]).toMatchObject({ mode: 'live', status: 'ok', score: 70, handoff: false });
  });

  it('transferir para humano: pausa a IA, cria tarefa "Assumir conversa", para cadências e NÃO muda a etapa', async () => {
    const { w, lead, run } = await setup(() => decision({ proxima_etapa: 'qualificado', transferir_humano: true, motivo: 'negociação de preço' }));
    await w.t.crm_cadence_runs.create({ data: { workspace_id: w.WS_A, cadence_id: 'c', lead_id: lead.id, status: 'running' } });
    await run();
    const row = w.t.crm_leads.rows.find((l) => l.id === lead.id)!;
    expect(row).toMatchObject({ ai_active: false, stage_id: w.A.stages[0]!.id });
    expect(w.t.crm_tasks.rows[0]).toMatchObject({ title: 'Assumir conversa: negociação de preço', assignee_id: w.OWNER, status: 'open' });
    expect(w.t.crm_cadence_runs.rows[0]).toMatchObject({ status: 'stopped' });
    expect(w.t.crm_stage_history.rows).toHaveLength(0);
    expect(w.t.crm_interactions.rows.some((i) => String(i.content).startsWith('IA pausada e conversa transferida para humano. Motivo: negociação de preço.'))).toBe(true);
  });

  it('perdido: etapa marcada como perdida, motivo da perda e IA desligada', async () => {
    const { w, lead, run } = await setup(() => decision({ proxima_etapa: 'perdido', motivo: 'sem perfil' }));
    const lost = await w.t.crm_stages.create({ data: { workspace_id: w.WS_A, pipeline_id: w.A.pipeline.id, name: 'Descartado', position: 9, is_lost: true } });
    await run();
    expect(w.t.crm_leads.rows.find((l) => l.id === lead.id)).toMatchObject({ stage_id: lost.id, loss_reason: 'sem perfil', ai_active: false });
  });

  it('reunião agendada com horário livre + e-mail: reserva no Cal.com, tarefa com o horário e confirmação anexada à resposta', async () => {
    const iso = '2026-10-07T17:00:00.000Z';
    const { w, run } = await setup(() => decision({ proxima_etapa: 'reuniao_agendada', horario_escolhido: iso, campos_extraidos: { email: 'lead@x.co' } }));
    w.calendar.availableSlots = async () => [iso];
    const r: any = await run();
    expect(w.calendar.bookSlot).toHaveBeenCalledWith(w.WS_A, expect.objectContaining({ start: iso, email: 'lead@x.co' }));
    expect(r.reply).toContain('Reuniao confirmada para');
    expect(w.t.crm_tasks.rows[0]!.title).toMatch(/^Reuniao com Lead em /);
  });

  it('horário fora da lista: NÃO reserva, cria tarefa "Confirmar reuniao"', async () => {
    const { w, run } = await setup(() => decision({ proxima_etapa: 'reuniao_agendada', horario_escolhido: '2026-10-07T18:00:00.000Z', campos_extraidos: { email: 'lead@x.co' } }));
    w.calendar.availableSlots = async () => ['2026-10-07T17:00:00.000Z'];
    await run();
    expect(w.calendar.bookSlot).not.toHaveBeenCalled();
    expect(w.t.crm_tasks.rows[0]!.title).toBe('Confirmar reuniao com Lead');
  });
});

describe('SDR — guardas', () => {
  it('agente inativo, lead descadastrado e ai_active=false não chamam a IA', async () => {
    const a = await setup(() => decision());
    await a.w.extra.crm_sdr_agents.update({ where: { id: a.agent.id }, data: { is_active: false } });
    expect(await a.run()).toEqual({ skipped: 'agente inativo' });
    const b = await setup(() => decision(), { unsubscribed: true });
    expect(await b.run()).toEqual({ skipped: 'IA pausada para este lead' });
    const c = await setup(() => decision(), { ai_active: false });
    expect(await c.run()).toEqual({ skipped: 'IA pausada para este lead' });
    expect([a, b, c].every((x) => x.w.aiCalls.length === 0)).toBe(true);
  });

  it('max_messages: passou do limite, pausa a IA e entrega a humano sem chamar a IA', async () => {
    const { w, lead, agent, run } = await setup(() => decision());
    await w.extra.crm_sdr_agents.update({ where: { id: agent.id }, data: { max_messages: 2 } });
    for (let i = 0; i < 3; i++) await w.t.crm_messages.create({ data: { workspace_id: w.WS_A, lead_id: lead.id, conversation_id: 'c', direction: 'in', body: `m${i}` } });
    expect(await run()).toEqual({ handoff: true, reason: 'limite de mensagens' });
    expect(w.t.crm_leads.rows.find((l) => l.id === lead.id)!.ai_active).toBe(false);
    expect(w.aiCalls).toHaveLength(0);
  });

  it('fora do horário: responde a mensagem de ausência UMA vez a cada 12 h, sem IA', async () => {
    const { w, lead, agent, run } = await setup(() => decision());
    await w.extra.crm_sdr_agents.update({ where: { id: agent.id }, data: { business_hours: { timezone: 'America/Sao_Paulo', days: [], start: '00:00', end: '00:01' } } });
    // days vazio cai no padrão seg–sex: força "fechado" com início=fim
    await w.extra.crm_sdr_agents.update({ where: { id: agent.id }, data: { business_hours: { timezone: 'America/Sao_Paulo', days: [0, 1, 2, 3, 4, 5, 6], start: '03:00', end: '03:00' } } });
    expect(await run()).toEqual({ offHours: true, reply: 'Fora do horário' });
    await w.t.crm_messages.create({ data: { workspace_id: w.WS_A, lead_id: lead.id, conversation_id: 'c', direction: 'out', body: 'Fora do horário' } });
    expect(await run()).toEqual({ offHours: true, reply: null });
    expect(w.aiCalls).toHaveLength(0);
  });

  it('falha da IA: registra execução com erro e não derruba o atendimento', async () => {
    const { w, run } = await setup(() => { throw new Error('gateway caiu'); });
    expect(await run()).toEqual({ error: 'falha na execucao do agente' });
    expect(w.extra.crm_sdr_runs.rows[0]).toMatchObject({ status: 'error', error_message: 'gateway caiu' });
  });

  it('resposta vazia da IA conta como erro', async () => {
    const { run } = await setup(() => decision({ resposta: '' }));
    expect(await run()).toEqual({ error: 'falha na execucao do agente' });
  });

  it('modelo recusado (400) cai para o padrão', async () => {
    const { AiError } = await import('../../ai/ai-error');
    const { w, agent, run } = await setup((_p?: string, model?: string) => { if (model === 'google/gemini-3.1-pro') throw new AiError('IA respondeu 400: modelo'); return decision(); });
    await w.extra.crm_sdr_agents.update({ where: { id: agent.id }, data: { model: 'google/gemini-3.1-pro' } });
    const r: any = await run();
    expect(r.reply).toBe('Ok!');
    expect(w.aiCalls.map((c) => c.model)).toEqual(['google/gemini-3.1-pro', 'openai/gpt-6-astra']);
  });

  it('o prompt leva só histórico do próprio lead (últimas 20) e a base de conhecimento', async () => {
    const { w, lead, agent, run } = await setup(() => decision());
    await w.extra.crm_sdr_agents.update({ where: { id: agent.id }, data: { knowledge_text: 'Vendemos pizza.' } });
    await w.extra.crm_sdr_documents.create({ data: { workspace_id: w.WS_A, agent_id: agent.id, file_name: 'faq.txt', extracted_text: 'Aberto 24h' } });
    const other = await w.addLead(w.WS_A, { phone: '+5511900000000' });
    await w.t.crm_messages.create({ data: { workspace_id: w.WS_A, lead_id: other.id, conversation_id: 'c', direction: 'in', body: 'SEGREDO DE OUTRO' } });
    await w.t.crm_messages.create({ data: { workspace_id: w.WS_A, lead_id: lead.id, conversation_id: 'd', direction: 'in', body: 'minha dúvida' } });
    await run('minha dúvida');
    const p = w.aiCalls[0]!.prompt;
    expect(p).toContain('Vendemos pizza.');
    expect(p).toContain('# faq.txt\nAberto 24h');
    expect(p).toContain('LEAD: minha dúvida');
    expect(p).not.toContain('SEGREDO DE OUTRO');
  });
});
