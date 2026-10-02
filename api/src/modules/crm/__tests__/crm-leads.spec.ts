import { randomUUID } from 'node:crypto';
import { WorkspaceAccessGuard } from '../../access/workspace-access.guard';
import { Reflector } from '@nestjs/core';
import { CrmResourcesController } from '../crm-resources.controller';
import { MAX_IMPORT_ROWS } from '../dto/crm.dto';
import { ADMIN, crmWorld, MARKETING, OWNER, OUTSIDER, STRANGER, status, VIEWER, WS_A, WS_B } from './harness';

describe('CRM — autorização (viewer só lê; id de outro workspace = 404)', () => {
  // o guard real, com o papel vindo da tabela de membros em memória
  const guardFor = async (userId: string, method: string, ws = WS_A) => {
    const w = crmWorld();
    const guard = new WorkspaceAccessGuard(w.access, new Reflector());
    // as rotas do controller real: sem @RequireAccess → GET = read, o resto = write
    const ctx: any = {
      switchToHttp: () => ({ getRequest: () => ({ method, user: { id: userId }, params: { workspaceId: ws } }) }),
      getHandler: () => CrmResourcesController.prototype.listLeads,
      getClass: () => CrmResourcesController,
    };
    return status(guard.canActivate(ctx));
  };

  it('viewer lê (GET) mas não escreve (POST/PATCH/PUT/DELETE)', async () => {
    expect(await guardFor(VIEWER, 'GET')).toBe('ok');
    for (const m of ['POST', 'PATCH', 'PUT', 'DELETE']) expect(await guardFor(VIEWER, m)).toBe('403:Seu perfil não tem permissão para esta ação.');
  });
  it('owner, admin e marketing escrevem; quem não é membro não lê nem escreve', async () => {
    for (const u of [OWNER, ADMIN, MARKETING]) expect(await guardFor(u, 'POST')).toBe('ok');
    expect(await guardFor(STRANGER, 'GET')).toBe('403:Você não tem acesso a esta empresa.');
    expect(await guardFor(OUTSIDER, 'POST')).toBe('403:Você não tem acesso a esta empresa.');
  });
  it('o controller usa o guard de workspace (rotas escopadas)', () => {
    const guards = Reflect.getMetadata('__guards__', CrmResourcesController) as unknown[];
    expect(guards).toContain(WorkspaceAccessGuard);
  });

  it('lead, etapa, tarefa e interações de OUTRO workspace → 404 (nada vaza)', async () => {
    const w = crmWorld();
    const mine = await w.addLead(WS_A);
    const theirs = await w.addLead(WS_B, { name: 'Alheio' });
    const task = await w.t.crm_tasks.create({ data: { workspace_id: WS_B, lead_id: theirs.id, title: 'x' } });
    expect(await status(w.leads.get(WS_A, theirs.id))).toBe('404:Lead não encontrado.');
    expect(await status(w.leads.interactions(WS_A, theirs.id))).toBe('404:Lead não encontrado.');
    expect(await status(w.leads.leadTasks(WS_A, theirs.id))).toBe('404:Lead não encontrado.');
    expect(await status(w.leads.update(WS_A, theirs.id, { ai_active: false }))).toBe('404:Lead não encontrado.');
    expect(await status(w.leads.move(OWNER, WS_A, theirs.id, w.A.stages[1]!.id))).toBe('404:Lead não encontrado.');
    expect(await status(w.leads.move(OWNER, WS_A, mine.id, w.B.stages[1]!.id))).toBe('404:Etapa não encontrada.');
    expect(await status(w.leads.addNote(OWNER, WS_A, theirs.id, { content: 'oi' }))).toBe('404:Lead não encontrado.');
    expect(await status(w.leads.setAi(OWNER, WS_A, theirs.id, false))).toBe('404:Lead não encontrado.');
    expect(await status(w.leads.createTask(WS_A, theirs.id, { title: 'x' }))).toBe('404:Lead não encontrado.');
    expect(await status(w.leads.updateTask(WS_A, task.id, { status: 'done' }))).toBe('404:Tarefa não encontrada.');
    expect(await status(w.leads.update(WS_A, mine.id, { stage_id: w.B.stages[0]!.id }))).toBe('404:Etapa não encontrada.');
    expect(await status(w.config.updateStage(WS_A, w.B.stages[0]!.id, { name: 'x' }))).toBe('404:Etapa não encontrada.');
    expect(await status(w.config.deleteStage(WS_A, w.B.stages[0]!.id))).toBe('404:Etapa não encontrada.');
    expect(await status(w.config.createStage(WS_A, { pipeline_id: w.B.pipeline.id, name: 'x' }))).toBe('404:Funil não encontrado.');
    expect(w.t.crm_interactions.rows).toHaveLength(0);
    expect((await w.leads.list(WS_A)).map((l: any) => l.id)).toEqual([mine.id]);
  });

  it('responsável tem de ser membro do workspace', async () => {
    const w = crmWorld();
    const lead = await w.addLead(WS_A);
    expect(await status(w.leads.update(WS_A, lead.id, { owner_id: STRANGER }))).toBe('400:Responsável inválido para este workspace.');
    expect(await status(w.leads.update(WS_A, lead.id, { owner_id: ADMIN }))).toBe('ok');
    expect(await status(w.config.saveSettings(WS_A, { distribution: 'fixed', default_owner_id: STRANGER }))).toBe('400:Responsável inválido para este workspace.');
  });
});

describe('CRM — mover lead (transação)', () => {
  it('numa transação só: etapa + stage_entered_at, histórico (de → para) e interação "Movido para X."', async () => {
    const w = crmWorld();
    const lead = await w.addLead(WS_A, { stage_entered_at: new Date('2020-01-01') });
    const [from, to] = [w.A.stages[0]!, w.A.stages[1]!];
    w.log.length = 0;
    const r: any = await w.leads.move(OWNER, WS_A, lead.id, to.id);
    expect(r.moved).toBe(true);
    expect(r.lead.stage_id).toBe(to.id);
    expect(r.lead.stage_entered_at.getTime()).toBeGreaterThan(Date.now() - 5000);
    expect(w.t.crm_stage_history.rows).toEqual([expect.objectContaining({ workspace_id: WS_A, lead_id: lead.id, from_stage_id: from.id, to_stage_id: to.id, moved_by: OWNER })]);
    expect(w.t.crm_interactions.rows).toEqual([expect.objectContaining({ lead_id: lead.id, kind: 'stage_change', author_type: 'user', content: 'Movido para Qualificado.' })]);
    // as 3 escritas aconteceram DENTRO da transação
    expect(w.log.map((l) => `${l.table}.${l.op}:${l.inTx}`)).toEqual(['crm_leads.update:true', 'crm_stage_history.create:true', 'crm_interactions.create:true']);
  });

  it('falha no meio desfaz tudo (o lead não fica movido sem histórico)', async () => {
    const w = crmWorld();
    const lead = await w.addLead(WS_A);
    const to = w.A.stages[1]!;
    const orig = w.t.crm_interactions.create.bind(w.t.crm_interactions);
    w.t.crm_interactions.create = (async () => { throw new Error('banco caiu'); }) as any;
    expect(await status(w.leads.move(OWNER, WS_A, lead.id, to.id))).toBe('erro:banco caiu');
    expect(w.t.crm_leads.rows[0]!.stage_id).toBe(w.A.stages[0]!.id);
    expect(w.t.crm_stage_history.rows).toHaveLength(0);
    w.t.crm_interactions.create = orig;
  });

  it('mesma etapa = nada a fazer (sem histórico, sem interação)', async () => {
    const w = crmWorld();
    const lead = await w.addLead(WS_A);
    const r: any = await w.leads.move(OWNER, WS_A, lead.id, w.A.stages[0]!.id);
    expect(r.moved).toBe(false);
    expect(w.t.crm_stage_history.rows).toHaveLength(0);
    expect(w.t.crm_interactions.rows).toHaveLength(0);
  });

  it('a ficha do lead (PATCH) troca a etapa SEM gravar histórico — quirk do protótipo mantido', async () => {
    const w = crmWorld();
    const lead = await w.addLead(WS_A);
    await w.leads.update(WS_A, lead.id, { stage_id: w.A.stages[2]!.id, stage_entered_at: new Date().toISOString() });
    expect(w.t.crm_leads.rows[0]!.stage_id).toBe(w.A.stages[2]!.id);
    expect(w.t.crm_stage_history.rows).toHaveLength(0);
    expect(w.t.crm_interactions.rows).toHaveLength(0);
  });
});

describe('CRM — ações em massa', () => {
  it('mover para etapa: só stage_id + stage_entered_at, sem histórico (quirk); atribuir responsável; aplicar tag (união)', async () => {
    const w = crmWorld();
    const a = await w.addLead(WS_A, { tags: ['VIP'] });
    const b = await w.addLead(WS_A, { tags: [] });
    const c = await w.addLead(WS_A, { name: 'fora da seleção' });
    expect(await w.leads.bulk(WS_A, { ids: [a.id, b.id], stage_id: w.A.stages[2]!.id })).toEqual({ updated: 2 });
    expect(w.t.crm_leads.rows.map((r) => r.stage_id)).toEqual([w.A.stages[2]!.id, w.A.stages[2]!.id, w.A.stages[0]!.id]);
    expect(w.t.crm_stage_history.rows).toHaveLength(0);
    await w.leads.bulk(WS_A, { ids: [a.id, b.id], owner_id: MARKETING });
    expect(w.t.crm_leads.rows.map((r) => r.owner_id)).toEqual([MARKETING, MARKETING, undefined]);
    await w.leads.bulk(WS_A, { ids: [a.id, b.id], add_tag: 'VIP' });
    expect(w.t.crm_leads.rows.map((r) => r.tags)).toEqual([['VIP'], ['VIP'], []]);
    await w.leads.bulk(WS_A, { ids: [b.id], add_tag: 'Investidor' });
    expect(w.t.crm_leads.rows[1]!.tags).toEqual(['VIP', 'Investidor']);
    expect(c.owner_id).toBeUndefined();
    await w.leads.bulk(WS_A, { ids: [a.id], owner_id: null });
    expect(w.t.crm_leads.rows[0]!.owner_id).toBeNull();
  });

  it('um id de outro workspace derruba a ação inteira (404) sem alterar nada', async () => {
    const w = crmWorld();
    const mine = await w.addLead(WS_A);
    const theirs = await w.addLead(WS_B);
    expect(await status(w.leads.bulk(WS_A, { ids: [mine.id, theirs.id], stage_id: w.A.stages[2]!.id }))).toBe('404:Lead não encontrado.');
    expect(await status(w.leads.bulk(WS_A, { ids: [mine.id, randomUUID()], add_tag: 'x' }))).toBe('404:Lead não encontrado.');
    expect(w.t.crm_leads.rows.every((r) => r.stage_id !== w.A.stages[2]!.id)).toBe(true);
  });

  it('sem ação → 400; etapa de outro workspace → 404; responsável de fora → 400', async () => {
    const w = crmWorld();
    const mine = await w.addLead(WS_A);
    expect(await status(w.leads.bulk(WS_A, { ids: [mine.id] }))).toBe('400:Nada para aplicar.');
    expect(await status(w.leads.bulk(WS_A, { ids: [mine.id], stage_id: w.B.stages[0]!.id }))).toBe('404:Etapa não encontrada.');
    expect(await status(w.leads.bulk(WS_A, { ids: [mine.id], owner_id: STRANGER }))).toBe('400:Responsável inválido para este workspace.');
  });
});

describe('CRM — criação e importação de CSV', () => {
  it('cria lead (nome obrigatório; funil/etapa conferidos); strings vazias do formulário são mantidas como no protótipo', async () => {
    const w = crmWorld();
    expect(await status(w.leads.create(WS_A, { name: '   ' }))).toBe('400:Informe o nome do lead.');
    expect(await status(w.leads.create(WS_A, { name: 'Ana', stage_id: w.B.stages[0]!.id }))).toBe('404:Etapa não encontrada.');
    expect(await status(w.leads.create(WS_A, { name: 'Ana', pipeline_id: w.B.pipeline.id }))).toBe('404:Funil não encontrado.');
    const l: any = await w.leads.create(WS_A, { name: ' Ana ', phone: '', email: 'a@b.co', city: 'SP', source: 'manual', pipeline_id: w.A.pipeline.id, stage_id: w.A.stages[0]!.id });
    expect(l).toEqual(expect.objectContaining({ workspace_id: WS_A, name: 'Ana', phone: '', email: 'a@b.co', city: 'SP', source: 'manual', stage_id: w.A.stages[0]!.id }));
  });

  it('importação: 1 insert com source "import"; teto de 5000 linhas com mensagem pt-BR e nada gravado', async () => {
    const w = crmWorld();
    const rows = [{ name: 'A', phone: '+5511999990000' }, { name: ' ', email: 'x@y.co' }, { name: 'C', city: 'Rio' }];
    expect(await w.leads.import(WS_A, { pipeline_id: w.A.pipeline.id, stage_id: w.A.stages[0]!.id, rows })).toEqual({ imported: 3 });
    expect(w.t.crm_leads.rows.map((r) => [r.name, r.source, r.stage_id])).toEqual([
      ['A', 'import', w.A.stages[0]!.id], ['Sem nome', 'import', w.A.stages[0]!.id], ['C', 'import', w.A.stages[0]!.id],
    ]);
    const big = Array.from({ length: MAX_IMPORT_ROWS + 1 }, (_, i) => ({ name: `L${i}` }));
    expect(await status(w.leads.import(WS_A, { rows: big }))).toBe(`400:Arquivo grande demais: importe no máximo ${MAX_IMPORT_ROWS} leads por vez (o arquivo tem ${MAX_IMPORT_ROWS + 1}).`);
    expect(w.t.crm_leads.rows).toHaveLength(3);
    const exact = Array.from({ length: MAX_IMPORT_ROWS }, (_, i) => ({ name: `L${i}` }));
    expect(await w.leads.import(WS_A, { rows: exact })).toEqual({ imported: MAX_IMPORT_ROWS });
    expect(await status(w.leads.import(WS_A, { stage_id: w.B.stages[0]!.id, rows }))).toBe('404:Etapa não encontrada.');
  });
});

describe('CRM — ficha do lead: nota, IA e tarefas', () => {
  it('nota grava a interação e atualiza last_interaction_at; nota vazia → 400', async () => {
    const w = crmWorld();
    const lead = await w.addLead(WS_A);
    expect(await status(w.leads.addNote(OWNER, WS_A, lead.id, { content: '   ' }))).toBe('400:Escreva a nota.');
    const n: any = await w.leads.addNote(OWNER, WS_A, lead.id, { content: ' ligar amanhã ' });
    expect(n).toEqual(expect.objectContaining({ kind: 'note', author_type: 'user', content: 'ligar amanhã', author_id: OWNER }));
    expect(w.t.crm_leads.rows[0]!.last_interaction_at).toBeInstanceOf(Date);
    expect((await w.leads.interactions(WS_A, lead.id)).map((i: any) => i.content)).toEqual(['ligar amanhã']);
  });

  it('Assumir conversa / Devolver para IA: alterna ai_active e grava a nota com o texto do protótipo', async () => {
    const w = crmWorld();
    const lead = await w.addLead(WS_A);
    expect(((await w.leads.setAi(OWNER, WS_A, lead.id, false)) as any).ai_active).toBe(false);
    expect(((await w.leads.setAi(OWNER, WS_A, lead.id, true)) as any).ai_active).toBe(true);
    expect(w.t.crm_interactions.rows.map((i) => i.content)).toEqual(['Atendimento assumido por humano (IA pausada).', 'Conversa devolvida para a IA.']);
  });

  it('tarefas: vence em 24 h por padrão; lista com o nome do lead; concluir/reabrir; status inválido barrado no DTO', async () => {
    const w = crmWorld();
    const lead = await w.addLead(WS_A, { name: 'Maria' });
    const before = Date.now();
    const t: any = await w.leads.createTask(WS_A, lead.id, { title: ' Retornar ' });
    expect(t.title).toBe('Retornar');
    expect(t.due_at.getTime() - before).toBeGreaterThanOrEqual(86_400_000 - 50);
    // `lead: { select: { name } }` do Prisma, simulado
    const orig = w.t.crm_tasks.findMany.bind(w.t.crm_tasks);
    w.t.crm_tasks.findMany = (async (a: any) => (await orig({ where: a.where, orderBy: a.orderBy })).map((r: any) => ({ ...r, lead: w.t.crm_leads.rows.find((l) => l.id === r.lead_id) ? { name: 'Maria' } : null }))) as any;
    const list: any[] = await w.leads.tasks(WS_A);
    expect(list[0]).toEqual(expect.objectContaining({ title: 'Retornar', status: 'open', crm_leads: { name: 'Maria' } }));
    expect(((await w.leads.updateTask(WS_A, t.id, { status: 'done' })) as any).status).toBe('done');
    expect(((await w.leads.updateTask(WS_A, t.id, { status: 'open' })) as any).status).toBe('open');
  });
});

describe('CRM — configurações', () => {
  it('etapas: cria com funil do workspace, edita, apaga; tags duplicadas → 409; motivos e distribuição', async () => {
    const w = crmWorld();
    const s: any = await w.config.createStage(WS_A, { pipeline_id: w.A.pipeline.id, name: ' Proposta ', position: 4 });
    expect(s).toEqual(expect.objectContaining({ name: 'Proposta', position: 4, pipeline_id: w.A.pipeline.id }));
    expect(((await w.config.updateStage(WS_A, s.id, { sla_hours: 12, color: '#ff0000' })) as any).sla_hours).toBe(12);
    expect(await status(w.config.updateStage(WS_A, s.id, { name: '  ' }))).toBe('400:Informe o nome da etapa.');
    await w.config.deleteStage(WS_A, s.id);
    expect(w.t.crm_stages.rows.find((r) => r.id === s.id)).toBeUndefined();

    await w.config.createTag(WS_A, { name: 'VIP' });
    expect(await status(w.config.createTag(WS_A, { name: ' VIP ' }))).toBe('409:Essa tag já existe.');
    await w.config.createTag(WS_B, { name: 'VIP' });
    const tag = w.t.crm_tags.rows[0]!;
    expect(await status(w.config.deleteTag(WS_B, tag.id))).toBe('404:Tag não encontrada.');
    await w.config.deleteTag(WS_A, tag.id);

    const r: any = await w.config.createLossReason(WS_A, { name: 'Sem orçamento' });
    expect(await status(w.config.deleteLossReason(WS_B, r.id))).toBe('404:Motivo de perda não encontrado.');
    await w.config.deleteLossReason(WS_A, r.id);

    await w.config.saveSettings(WS_A, { distribution: 'fixed', default_owner_id: ADMIN });
    expect(await w.config.settings(WS_A)).toEqual(expect.objectContaining({ distribution: 'fixed', default_owner_id: ADMIN }));
    await w.config.saveSettings(WS_A, { distribution: 'round_robin' });
    expect(((await w.config.settings(WS_A)) as any).default_owner_id).toBeNull();
  });

  it('membros: user_id, role e profiles {id, full_name, email} (formato do embed do PostgREST)', async () => {
    const w = crmWorld();
    const m: any[] = await w.config.members(WS_A);
    expect(m.map((x) => x.role).sort()).toEqual(['admin', 'marketing', 'owner', 'viewer']);
    expect(m[0].profiles).toEqual({ id: m[0].user_id, full_name: expect.any(String), email: expect.any(String) });
    expect(m.map((x) => x.user_id)).not.toContain(STRANGER);
  });

  it('leituras dos Indicadores só trazem o workspace da URL', async () => {
    const w = crmWorld();
    const a = await w.addLead(WS_A);
    const b = await w.addLead(WS_B);
    await w.t.crm_stage_history.create({ data: { workspace_id: WS_A, lead_id: a.id, to_stage_id: w.A.stages[0]!.id } });
    await w.t.crm_stage_history.create({ data: { workspace_id: WS_B, lead_id: b.id, to_stage_id: w.B.stages[0]!.id } });
    await w.t.crm_interactions.create({ data: { workspace_id: WS_B, lead_id: b.id } });
    expect((await w.reports.stageHistory(WS_A)).map((h: any) => h.lead_id)).toEqual([a.id]);
    expect(await w.reports.interactions(WS_A)).toEqual([]);
    const cad = await w.t.crm_cadences.create({ data: { workspace_id: WS_B, name: 'Alheia' } });
    const msgA = await w.t.crm_messages.create({ data: { workspace_id: WS_A, status: 'read' } });
    const msgB = await w.t.crm_messages.create({ data: { workspace_id: WS_B, status: 'read' } });
    await w.t.crm_cadence_events.create({ data: { workspace_id: WS_A, cadence_id: cad.id, event: 'sent', message_id: msgB.id } });
    await w.t.crm_cadence_events.create({ data: { workspace_id: WS_A, cadence_id: cad.id, event: 'sent', message_id: msgA.id } });
    const m: any = await w.reports.cadenceMetrics(WS_A);
    expect(m.cadences).toEqual([]);
    expect(m.messages.map((x: any) => x.id)).toEqual([msgA.id]);
    expect(Object.keys(m).sort()).toEqual(['cadences', 'events', 'history', 'messages', 'runs', 'stages']);
    expect(await w.reports.cadenceOptions(WS_B)).toEqual([{ id: cad.id, name: 'Alheia' }]);
    expect(await w.reports.cadenceOptions(WS_A)).toEqual([]);
  });
});
