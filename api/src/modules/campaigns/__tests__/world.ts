import { randomUUID } from 'node:crypto';
import { WorkspaceAccessService } from '../../access/access.service';
import { FakeTable } from '../../brands/__tests__/fake-prisma';
import { CampaignGuardsService } from '../campaign-guards.service';

export const WS_A = randomUUID();
export const WS_B = randomUUID();
export const OWNER = randomUUID();
export const ADMIN = randomUUID();
export const MARKETING = randomUUID();
export const VIEWER = randomUUID();
export const STRANGER = randomUUID();

/** Papéis de teste: WS_A tem os quatro papéis; STRANGER só é membro de WS_B. */
const MEMBERS: [string, string, string][] = [
  [WS_A, OWNER, 'owner'], [WS_A, ADMIN, 'admin'], [WS_A, MARKETING, 'marketing'], [WS_A, VIEWER, 'viewer'],
  [WS_B, STRANGER, 'owner'],
];

export const status = async (p: Promise<unknown>) => {
  try { await p; return 'ok'; } catch (e: any) { return `${e.getStatus()}:${e.getResponse().message}`; }
};

/**
 * O `FakeTable` das marcas avalia `{ not: v }` errado quando o valor é igual ao filtrado (casa tudo).
 * Aqui `not` vira filtro pós-consulta (antes do `take`), com a semântica do SQL (`<>`).
 */
function withNot(table: FakeTable) {
  const orig = table.findMany.bind(table);
  table.findMany = (async (a: any = {}) => {
    const nots: [string, unknown][] = [];
    const where: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(a.where ?? {})) {
      if (v && typeof v === 'object' && !(v instanceof Date) && 'not' in (v as object)) nots.push([k, (v as any).not]);
      else where[k] = v;
    }
    if (!nots.length) return orig(a);
    const { take, ...rest } = a;
    const rows = (await orig({ ...rest, where })).filter((r: any) => nots.every(([k, val]) => r[k] != null && r[k] !== val));
    return take ? rows.slice(0, take) : rows;
  }) as any;
}

/** Prisma em memória com as tabelas do domínio de campanhas + `include` simples (`brand`, `campaign`). */
export function world() {
  const t = {
    brands: new FakeTable(() => ({ tone_of_voice: null })),
    campaigns: new FakeTable(() => ({ status: 'draft', budget_daily: 0, objective: 'leads' })),
    campaign_strategies: new FakeTable(() => ({ status: 'draft', version: 1 })),
    copies: new FakeTable(() => ({ status: 'draft', version: 1 })),
    creatives: new FakeTable(),
    performance_daily: new FakeTable(() => ({ source: 'meta' })),
    campaign_costs: new FakeTable(),
    personas: new FakeTable(),
    products: new FakeTable(),
    brand_learnings: new FakeTable(),
    approval_requests: new FakeTable(() => ({ status: 'pending', entity_id: null, summary: null })),
    ig_content_plans: new FakeTable(),
    activity_logs: new FakeTable(),
  };
  withNot(t.performance_daily);
  withNot(t.campaigns);
  const members = {
    findUnique: async ({ where }: any) => {
      const k = where.workspace_id_user_id;
      const m = MEMBERS.find(([w, u]) => w === k.workspace_id && u === k.user_id);
      return m ? { role: m[2] } : null;
    },
  };
  const withBrand = (row: any) => (row ? { ...row, brand: t.brands.rows.find((b) => b.id === row.brand_id) ?? null } : row);
  const withCampaign = (row: any) => ({ ...row, campaign: t.campaigns.rows.find((c) => c.id === row.campaign_id) ?? null });
  const cf = t.campaigns.findFirst.bind(t.campaigns);
  const cm = t.campaigns.findMany.bind(t.campaigns);
  t.campaigns.findFirst = (async (a: any) => { const r = await cf(a); return a?.include?.brand ? withBrand(r) : r; }) as any;
  t.campaigns.findMany = (async (a: any) => { const r = await cm(a); return a?.include?.brand ? r.map(withBrand) : r; }) as any;
  const af = t.approval_requests.findMany.bind(t.approval_requests);
  t.approval_requests.findMany = (async (a: any) => { const r = await af(a); return a?.include?.campaign ? r.map(withCampaign) : r; }) as any;

  const prisma: any = { ...t, workspace_members: members, $transaction: async (fn: any) => fn(prisma) };
  const logs: any[] = [];
  const activity: any = { log: async (...args: any[]) => { logs.push(args); } };
  const access = new WorkspaceAccessService(prisma);
  const guards = new CampaignGuardsService(prisma, access);
  return { t, prisma, logs, activity, access, guards };
}

/** Marca + campanha em WS_A. */
export async function seedCampaign(w: ReturnType<typeof world>, extra: Record<string, unknown> = {}) {
  const brand = await w.t.brands.create({ data: { workspace_id: WS_A, name: 'Bar do Zé', segment: 'Bar', tone_of_voice: 'descontraído' } });
  const campaign = await w.t.campaigns.create({
    data: { workspace_id: WS_A, brand_id: brand.id, name: 'Black Friday', objective: 'leads', budget_daily: 100, ...extra },
  });
  return { brand, campaign };
}
