import { randomUUID } from 'node:crypto';
import { WorkspaceAccessService } from '../../access/access.service';
import { IgTable } from '../../instagram/__tests__/harness';
import { CrmConfigService } from '../crm-config.service';
import { CrmCoreService } from '../crm-core.service';
import { CrmLeadsService } from '../crm-leads.service';
import { CrmReportsService } from '../crm-reports.service';
import { SiteFormService } from '../site-form.service';
import { UnsubscribeLinkService } from '../unsubscribe-link.service';
import { UnsubscribeService } from '../unsubscribe.service';

export const WS_A = randomUUID();
export const WS_B = randomUUID();
export const OWNER = randomUUID();
export const ADMIN = randomUUID();
export const MARKETING = randomUUID();
export const VIEWER = randomUUID();
export const STRANGER = randomUUID();
export const OUTSIDER = randomUUID();

export const status = async (p: Promise<unknown>) => {
  try {
    await p;
    return 'ok';
  } catch (e: any) {
    return e.getStatus ? `${e.getStatus()}:${e.getResponse().message}` : `erro:${e.message}`;
  }
};

/** Prisma em memória com `$transaction` que DESFAZ tudo se o callback lançar (para provar atomicidade). */
export function crmWorld(env: Record<string, unknown> = {}) {
  const t = {
    crm_leads: new IgTable(() => ({ source: 'manual', score: 0, temperature: 'frio', tags: [], unsubscribed: false, ai_active: true, estimated_value: 0, stage_entered_at: new Date(), last_interaction_at: null })),
    crm_stages: new IgTable(() => ({ color: '#6366f1', position: 0, sla_hours: 24, is_won: false, is_lost: false })),
    crm_pipelines: new IgTable(() => ({ is_default: false })),
    crm_interactions: new IgTable(() => ({ kind: 'note', author_type: 'user', metadata: {} })),
    crm_stage_history: new IgTable(),
    crm_tasks: new IgTable(() => ({ status: 'open' })),
    crm_settings: new IgTable(() => ({ distribution: 'round_robin', default_owner_id: null })),
    crm_tags: new IgTable(() => ({ color: '#22d3ee' })),
    crm_loss_reasons: new IgTable(),
    crm_webhook_events: new IgTable(() => ({ status: 'processed' })),
    crm_cadences: new IgTable(() => ({ is_active: true, trigger_type: 'source', trigger_value: null, source: 'meta_lead_ads', steps: [] })),
    crm_cadence_runs: new IgTable(() => ({ status: 'running', step_index: 0 })),
    crm_cadence_events: new IgTable(),
    crm_integrations: new IgTable(() => ({ status: 'connected', config: {}, kind: 'site_form' })),
    crm_messages: new IgTable(),
    workspace_members: new IgTable(),
    profiles: new IgTable(),
  };
  const tables = Object.values(t);
  const log: { op: string; table: string; inTx: boolean }[] = [];
  let inTx = false;
  // registra TODA escrita (para provar que o "mover lead" roda inteiro dentro da transação)
  for (const [name, table] of Object.entries(t)) {
    for (const op of ['create', 'createMany', 'update', 'updateMany', 'upsert', 'delete', 'deleteMany']) {
      const orig = (table as any)[op]?.bind(table);
      if (!orig) continue;
      (table as any)[op] = (...a: any[]) => {
        log.push({ op, table: name, inTx });
        return orig(...a);
      };
    }
  }
  const prisma: any = {
    ...t,
    async $transaction(fn: (tx: any) => Promise<unknown>) {
      const snap = tables.map((x) => x.rows.map((r) => ({ ...r })));
      inTx = true;
      try {
        return await fn(prisma);
      } catch (e) {
        tables.forEach((x, i) => (x.rows = snap[i]!));
        throw e;
      } finally {
        inTx = false;
      }
    },
  };
  // IgTable não tem `delete` unitário.
  for (const table of tables) {
    (table as any).delete = async ({ where }: any) => {
      const i = table.rows.findIndex((r) => Object.entries(where).every(([k, v]) => r[k] === v));
      if (i < 0) throw new Error('registro não encontrado');
      log.push({ op: 'delete', table: 'x', inTx });
      return table.rows.splice(i, 1)[0];
    };
  }
  for (const [ws, user, role] of [
    [WS_A, OWNER, 'owner'], [WS_A, ADMIN, 'admin'], [WS_A, MARKETING, 'marketing'], [WS_A, VIEWER, 'viewer'], [WS_B, STRANGER, 'owner'],
  ] as const) t.workspace_members.rows.push({ id: randomUUID(), workspace_id: ws, user_id: user, role, created_at: new Date() });
  for (const u of [OWNER, ADMIN, MARKETING, VIEWER, STRANGER]) t.profiles.rows.push({ id: u, full_name: `Nome ${u.slice(0, 4)}`, email: `${u.slice(0, 4)}@x.test` });

  const defaults: any = { ensure: async () => false };
  const access = new WorkspaceAccessService(prisma);
  const core = new CrmCoreService(prisma);
  const leads = new CrmLeadsService(prisma, defaults);
  const config = new CrmConfigService(prisma, defaults);
  const reports = new CrmReportsService(prisma, defaults);
  const links = new UnsubscribeLinkService({ NODE_ENV: 'test', APP_URL: 'http://web.test/', UNSUBSCRIBE_SECRET: undefined, ...env } as any);
  const forms = new SiteFormService(prisma, core, defaults);
  const unsubscribe = new UnsubscribeService(prisma, links, core);

  // dados-base do workspace A e B
  const seed = (ws: string) => {
    const pipeline = { id: randomUUID(), workspace_id: ws, name: 'Funil', is_default: true, created_at: new Date() };
    t.crm_pipelines.rows.push(pipeline);
    const stages = ['Novo Lead', 'Qualificado', 'Ganho'].map((name, i) => ({
      id: randomUUID(), workspace_id: ws, pipeline_id: pipeline.id, name, position: i + 1, color: '#000', sla_hours: 24, is_won: name === 'Ganho', is_lost: false, created_at: new Date(),
    }));
    t.crm_stages.rows.push(...stages);
    return { pipeline, stages };
  };
  const A = seed(WS_A);
  const B = seed(WS_B);
  const addLead = async (ws: string, over: Record<string, unknown> = {}) =>
    t.crm_leads.create({ data: { workspace_id: ws, name: 'Lead', stage_id: (ws === WS_A ? A : B).stages[0]!.id, pipeline_id: (ws === WS_A ? A : B).pipeline.id, ...over } });
  return { prisma, t, log, access, core, leads, config, reports, links, forms, unsubscribe, A, B, addLead, defaults };
}
