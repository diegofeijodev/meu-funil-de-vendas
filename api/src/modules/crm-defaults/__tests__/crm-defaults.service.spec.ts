import { randomUUID } from 'node:crypto';
import { DEFAULT_LOSS_REASONS, DEFAULT_STAGES, DEFAULT_TAGS } from '../crm-defaults.data';
import { CrmDefaultsService } from '../crm-defaults.service';

// Prisma em memória com as 5 tabelas que o serviço toca.
function fakePrisma() {
  const t = { pipelines: [] as any[], stages: [] as any[], loss: [] as any[], tags: [] as any[], settings: [] as any[] };
  const byWs = (rows: any[], where: any) => rows.filter((r) => r.workspace_id === where.workspace_id);
  const db: any = {
    crm_pipelines: {
      count: async ({ where }: any) => byWs(t.pipelines, where).length,
      create: async ({ data }: any) => { const r = { id: randomUUID(), ...data }; t.pipelines.push(r); return r; },
    },
    crm_stages: { createMany: async ({ data }: any) => { t.stages.push(...data); return { count: data.length }; } },
    crm_loss_reasons: {
      count: async ({ where }: any) => byWs(t.loss, where).length,
      createMany: async ({ data }: any) => { t.loss.push(...data); return { count: data.length }; },
    },
    crm_tags: {
      createMany: async ({ data }: any) => {
        for (const d of data) if (!t.tags.some((x) => x.workspace_id === d.workspace_id && x.name === d.name)) t.tags.push(d);
        return { count: data.length };
      },
    },
    crm_settings: {
      findUnique: async ({ where }: any) => t.settings.find((s) => s.workspace_id === where.workspace_id) ?? null,
      create: async ({ data }: any) => { t.settings.push(data); return data; },
    },
    $executeRaw: async () => 0,
    $transaction: async (fn: any) => fn(db),
  };
  return { db, t };
}
const WS = '11111111-1111-4111-8111-111111111111';
const WS2 = '22222222-2222-4222-8222-222222222222';

describe('CrmDefaultsService.ensure', () => {
  it('cria funil padrão (8 etapas), 5 motivos de perda, 4 tags e crm_settings', async () => {
    const { db, t } = fakePrisma();
    expect(await new CrmDefaultsService(db).ensure(WS)).toBe(true);
    expect(t.pipelines).toHaveLength(1);
    expect(t.pipelines[0]).toMatchObject({ name: 'Funil Padrão', is_default: true, workspace_id: WS });
    expect(t.stages.map((s) => s.name)).toEqual(DEFAULT_STAGES.map((s) => s.name));
    expect(t.stages.every((s) => s.pipeline_id === t.pipelines[0].id)).toBe(true);
    expect(t.stages.filter((s) => s.is_won).map((s) => s.name)).toEqual(['Ganho']);
    expect(t.stages.filter((s) => s.is_lost).map((s) => s.name)).toEqual(['Perdido']);
    expect(t.stages.map((s) => s.position)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    expect(t.loss.map((l) => l.name)).toEqual([...DEFAULT_LOSS_REASONS]);
    expect(t.tags.map((x) => x.name)).toEqual(DEFAULT_TAGS.map((x) => x.name));
    expect(t.settings).toEqual([{ workspace_id: WS, distribution: 'round_robin' }]);
  });

  it('é idempotente: chamadas repetidas e simultâneas não duplicam nada', async () => {
    const { db, t } = fakePrisma();
    const svc = new CrmDefaultsService(db);
    const results = [await svc.ensure(WS), await svc.ensure(WS), await svc.ensure(WS)];
    expect(results).toEqual([true, false, false]);
    expect(t.pipelines).toHaveLength(1);
    expect(t.stages).toHaveLength(8);
    expect(t.loss).toHaveLength(5);
    expect(t.tags).toHaveLength(4);
    expect(t.settings).toHaveLength(1);
  });

  it('workspaces são independentes', async () => {
    const { db, t } = fakePrisma();
    const svc = new CrmDefaultsService(db);
    await svc.ensure(WS);
    expect(await svc.ensure(WS2)).toBe(true);
    expect(t.pipelines).toHaveLength(2);
    expect(t.stages).toHaveLength(16);
  });

  it('crm_settings é o marcador: se já existe, não recria motivos apagados de propósito', async () => {
    const { db, t } = fakePrisma();
    t.settings.push({ workspace_id: WS, distribution: 'manual' });
    expect(await new CrmDefaultsService(db).ensure(WS)).toBe(false);
    expect(t.pipelines).toHaveLength(0);
    expect(t.loss).toHaveLength(0);
  });

  it('workspace com funil próprio (sem settings) não ganha um segundo funil nem motivos duplicados', async () => {
    const { db, t } = fakePrisma();
    t.pipelines.push({ id: 'p', workspace_id: WS, name: 'Meu funil', is_default: true });
    t.loss.push({ workspace_id: WS, name: 'Outro' });
    await new CrmDefaultsService(db).ensure(WS);
    expect(t.pipelines).toHaveLength(1);
    expect(t.stages).toHaveLength(0);
    expect(t.loss).toHaveLength(1);
    expect(t.settings).toHaveLength(1);
  });
});
