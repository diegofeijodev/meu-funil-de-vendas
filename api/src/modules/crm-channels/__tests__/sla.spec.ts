import { CadenceService } from '../cadence.service';

const HOUR = 3_600_000;

/** Prisma mínimo: leads fixos, tarefas em memória e `$transaction` em série (simula o advisory lock). */
function world(leads: any[]) {
  const tasks: any[] = [];
  const interactions: any[] = [];
  const queries: any[] = [];
  let chain: Promise<unknown> = Promise.resolve();
  const prisma: any = {
    crm_leads: { findMany: async (a: any) => { queries.push(a); return leads.slice(0, a.take); } },
    crm_tasks: {
      findFirst: async ({ where }: any) => tasks.find((t) => t.lead_id === where.lead_id && t.title === where.title) ?? null,
      create: async ({ data }: any) => { await new Promise((r) => setImmediate(r)); tasks.push({ id: String(tasks.length), ...data }); return data; },
    },
    $executeRaw: async () => 0,
    $transaction: (fn: (tx: any) => Promise<unknown>) => { const run = chain.then(() => fn(prisma)); chain = run.catch(() => undefined); return run; },
  };
  const core: any = { addInteraction: async (i: any) => { interactions.push(i); } };
  const svc = new CadenceService(prisma, core, {} as never, {} as never, {} as never);
  return { svc, tasks, interactions, queries };
}

const lead = (id: string, hoursInStage: number, over: Record<string, unknown> = {}) => ({
  id, name: `Lead ${id}`, owner_id: 'u1', workspace_id: 'w1', stage_entered_at: new Date(Date.now() - hoursInStage * HOUR),
  stage: { name: 'Novo', sla_hours: 24, is_won: false, is_lost: false }, ...over,
});

describe('createSlaAlerts', () => {
  it('cria a tarefa + interação só para quem estourou o SLA; rodar de novo não duplica', async () => {
    const w = world([lead('a', 30), lead('b', 5)]);
    expect(await w.svc.createSlaAlerts()).toBe(1);
    expect(w.tasks).toHaveLength(1);
    expect(w.tasks[0]).toMatchObject({ lead_id: 'a', title: 'SLA estourado em Novo — Lead a', status: 'open' });
    expect(w.interactions).toHaveLength(1);
    expect(await w.svc.createSlaAlerts()).toBe(0);
    expect(w.tasks).toHaveLength(1);
  });

  it('execuções simultâneas (cron + HTTP) criam UMA tarefa e UMA interação por lead', async () => {
    const w = world([lead('a', 30), lead('c', 48)]);
    const out = await Promise.all([w.svc.createSlaAlerts(), w.svc.createSlaAlerts(), w.svc.createSlaAlerts()]);
    expect(out.reduce((x, y) => x + y, 0)).toBe(2);
    expect(w.tasks).toHaveLength(2);
    expect(w.interactions).toHaveLength(2);
  });

  it('a janela só pega leads elegíveis (etapa com SLA, não ganha/perdida, sem tarefa SLA aberta), do mais antigo na etapa ao mais novo, e respeita o limite/empresa', async () => {
    const w = world([lead('a', 30)]);
    await w.svc.createSlaAlerts(50, 'w1');
    expect(w.queries[0]).toMatchObject({
      where: {
        workspace_id: 'w1',
        stage: { is_won: false, is_lost: false, sla_hours: { gt: 0 } },
        crm_tasks: { none: { status: 'open', title: { startsWith: 'SLA estourado em' } } },
      },
      orderBy: [{ stage_entered_at: 'asc' }, { id: 'asc' }],
      take: 50,
    });
  });

  it('defesa em profundidade: etapa ganha/perdida ou sem SLA que escape do filtro não gera alerta', async () => {
    const w = world([lead('a', 99, { stage: { name: 'Ganho', sla_hours: 24, is_won: true, is_lost: false } }), lead('b', 99, { stage: { name: 'X', sla_hours: null, is_won: false, is_lost: false } })]);
    expect(await w.svc.createSlaAlerts()).toBe(0);
  });
});
