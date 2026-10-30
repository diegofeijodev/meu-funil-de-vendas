import { FakeTable } from '../../brands/__tests__/fake-prisma';

export const WS_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
export const WS_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
export const OWNER = '22222222-2222-4222-8222-222222222222';
export const T0 = new Date('2026-10-30T12:00:00Z');
export const min = (n: number, from = T0) => new Date(from.getTime() + n * 60_000);

/** Banco em memória do piloto: as tabelas que o runner e as etapas leem/escrevem. */
export function pilotDb() {
  const t = {
    campaign_pilot_runs: new FakeTable(() => ({
      status: 'planning', current_step: 'strategy', options: {}, steps: {}, lease_until: null, next_run_at: null, approved_at: null, approved_by: null,
      strategy_version: null, max_credits: null, estimated_credits: null, approval_request_id: null, updated_at: new Date(),
    })),
    campaigns: new FakeTable(() => ({ status: 'draft' })),
    campaign_strategies: new FakeTable(),
    copies: new FakeTable(),
    brands: new FakeTable(),
    ig_auto_runs: new FakeTable(),
    ig_content_plans: new FakeTable(),
    creatives: new FakeTable(() => ({ extras: {} })),
    creative_generation_jobs: new FakeTable(),
  };
  const prisma: any = { ...t, $transaction: async (fn: any) => fn(prisma) };
  const logs: any[][] = [];
  const activity: any = { log: async (...a: any[]) => { logs.push(a); } };
  return { t, prisma, activity, logs };
}

export async function seedRun(db: ReturnType<typeof pilotDb>, extra: Record<string, unknown> = {}, ws = WS_A) {
  const campaign = await db.t.campaigns.create({ data: { workspace_id: ws, name: 'Jundiaí', status: 'draft' } });
  const run = await db.t.campaign_pilot_runs.create({
    data: { workspace_id: ws, campaign_id: campaign.id, created_by: OWNER, idempotency_key: `k-${campaign.id}`, next_run_at: T0, created_at: min(-1), ...extra },
  });
  return { campaign, run };
}

/** Linha atual (a tabela guarda por referência: os testes leem daqui). */
export const rowOf = (db: ReturnType<typeof pilotDb>, id: string) => db.t.campaign_pilot_runs.rows.find((r: any) => r.id === id)!;
