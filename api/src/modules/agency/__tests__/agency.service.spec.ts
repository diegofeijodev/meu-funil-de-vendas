import { randomUUID } from 'node:crypto';
import { AgencyService, ERR_ONLY_ADMIN_SOURCE, ERR_ONLY_ADMIN_TARGET, ERR_SAME_SOURCE } from '../agency.service';

const USER = randomUUID();
const [A, B, C, D] = [randomUUID(), randomUUID(), randomUUID(), randomUUID()];

/** Prisma mínimo: membros do usuário + workspaces (ai_inherit_from) + agregações vazias/fixas. */
function setup(memberships: Record<string, string>, agg: Partial<Record<string, any[]>> = {}) {
  const ws = new Map<string, { id: string; name: string; ai_inherit_from: string | null }>(
    [A, B, C, D].map((id, i) => [id, { id, name: `Empresa ${'ABCD'[i]}`, ai_inherit_from: null }]),
  );
  const members = Object.entries(memberships).map(([workspace_id, role], i) => ({ workspace_id, role, user_id: USER, created_at: new Date(i), workspace: ws.get(workspace_id) }));
  const group = (name: string) => async () => agg[name] ?? [];
  const prisma: any = {
    workspace_members: { findMany: async () => members },
    workspaces: {
      update: async ({ where, data }: any) => Object.assign(ws.get(where.id)!, data),
      updateMany: async ({ where, data }: any) => { where.id.in.forEach((id: string) => Object.assign(ws.get(id)!, data)); return { count: where.id.in.length }; },
    },
    performance_daily: { groupBy: group('perf') },
    crm_leads: { groupBy: group('leads') },
    ig_posts: { groupBy: async (a: any) => (a.where.status ? agg['igPending'] ?? [] : agg['posts'] ?? []) },
    approval_requests: { groupBy: group('approvals') },
    campaigns: { groupBy: group('active') },
    $transaction: async (fn: any) => fn(prisma),
  };
  return { svc: new AgencyService(prisma), ws };
}

const status = async (p: Promise<unknown>) => {
  try { await p; return 'ok'; } catch (e: any) { return `${e.getStatus()}:${e.getResponse().message}`; }
};

describe('AgencyService.setInheritance (precisa manage nas DUAS empresas)', () => {
  it('owner/admin de ambas → ok, e a origem fica sem herança (anti-corrente)', async () => {
    const { svc, ws } = setup({ [A]: 'owner', [B]: 'admin' });
    ws.get(B)!.ai_inherit_from = C;
    expect(await svc.setInheritance(USER, A, B)).toEqual({ ok: true });
    expect(ws.get(A)!.ai_inherit_from).toBe(B);
    expect(ws.get(B)!.ai_inherit_from).toBeNull();
  });

  it('null limpa a herança', async () => {
    const { svc, ws } = setup({ [A]: 'owner' });
    ws.get(A)!.ai_inherit_from = B;
    await svc.setInheritance(USER, A, null);
    expect(ws.get(A)!.ai_inherit_from).toBeNull();
  });

  it('não gerencia a empresa → 403 (marketing, viewer e não-membro)', async () => {
    for (const role of ['marketing', 'viewer']) {
      const { svc } = setup({ [A]: role, [B]: 'owner' });
      expect(await status(svc.setInheritance(USER, A, B))).toBe(`403:${ERR_ONLY_ADMIN_TARGET}`);
    }
    const { svc } = setup({ [B]: 'owner' });
    expect(await status(svc.setInheritance(USER, A, B))).toBe(`403:${ERR_ONLY_ADMIN_TARGET}`);
  });

  it('SEGURANÇA: gerencia a empresa mas NÃO a origem (chaves BYO de outro cliente) → 403 e nada muda', async () => {
    for (const role of [undefined, 'marketing', 'viewer']) {
      const { svc, ws } = setup({ [A]: 'owner', ...(role ? { [B]: role } : {}) });
      expect(await status(svc.setInheritance(USER, A, B))).toBe(`403:${ERR_ONLY_ADMIN_SOURCE}`);
      expect(ws.get(A)!.ai_inherit_from).toBeNull();
      expect(ws.get(B)!.ai_inherit_from).toBeNull();
    }
  });

  it('origem = a própria empresa → 400', async () => {
    const { svc } = setup({ [A]: 'owner' });
    expect(await status(svc.setInheritance(USER, A, A))).toBe(`400:${ERR_SAME_SOURCE}`);
  });
});

describe('AgencyService.applyToAll', () => {
  it('aplica a origem às empresas que o usuário administra (não às de marketing/viewer nem às alheias)', async () => {
    const { svc, ws } = setup({ [A]: 'owner', [B]: 'admin', [C]: 'marketing', [D]: 'viewer' });
    ws.get(A)!.ai_inherit_from = D;
    expect(await svc.applyToAll(USER, A)).toEqual({ updated: 1 });
    expect(ws.get(B)!.ai_inherit_from).toBe(A);
    expect(ws.get(A)!.ai_inherit_from).toBeNull();
    expect(ws.get(C)!.ai_inherit_from).toBeNull();
    expect(ws.get(D)!.ai_inherit_from).toBeNull();
  });

  it('origem que não administra → 403', async () => {
    const { svc } = setup({ [A]: 'marketing', [B]: 'owner' });
    expect(await status(svc.applyToAll(USER, A))).toBe(`403:${ERR_ONLY_ADMIN_SOURCE}`);
    expect(await status(svc.applyToAll(USER, C))).toBe(`403:${ERR_ONLY_ADMIN_SOURCE}`);
  });
});

describe('AgencyService.overview', () => {
  it('sem empresas → lista vazia', async () => {
    expect(await setup({}).svc.overview(USER)).toEqual({ workspaces: [] });
  });

  it('agrega por empresa (gasto, CPL, ROAS, pendências = aprovações + posts IG)', async () => {
    const { svc, ws } = setup({ [A]: 'owner', [B]: 'viewer' }, {
      perf: [{ workspace_id: A, _sum: { spend: 100, leads: 20, revenue: 300 } }],
      leads: [{ workspace_id: A, _count: { _all: 7 } }],
      posts: [{ workspace_id: B, _count: { _all: 3 } }],
      approvals: [{ workspace_id: A, _count: { _all: 2 } }],
      igPending: [{ workspace_id: A, _count: { _all: 1 } }],
      active: [{ workspace_id: A, _count: { _all: 4 } }],
    });
    ws.get(B)!.ai_inherit_from = A;
    const out = await svc.overview(USER);
    expect(out.workspaces[0]).toEqual({
      id: A, name: 'Empresa A', role: 'owner', inheritFrom: null,
      spend: 100, adLeads: 20, cpl: 5, roas: 3, crmLeads7d: 7, postsWeek: 0, pending: 3, activeCampaigns: 4,
    });
    expect(out.workspaces[1]).toEqual({
      id: B, name: 'Empresa B', role: 'viewer', inheritFrom: A,
      spend: 0, adLeads: 0, cpl: null, roas: null, crmLeads7d: 0, postsWeek: 3, pending: 0, activeCampaigns: 0,
    });
  });
});
