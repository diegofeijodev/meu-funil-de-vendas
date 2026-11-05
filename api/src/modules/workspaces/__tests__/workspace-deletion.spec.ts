import { randomUUID } from 'node:crypto';
import { Logger } from '@nestjs/common';
import { NOT_A_MEMBER, WorkspaceAccessService } from '../../access/access.service';
import { CampaignChannels, confirmNameMatches, deletionBlockers, ERR_NAME_MISMATCH, ERR_ONLY_OWNER_DELETES, liveCampaigns } from '../workspace-deletion';
import { globalKeysOf, WorkspaceDeletionService } from '../workspace-deletion.service';

const camp = (over: Partial<CampaignChannels> = {}): CampaignChannels => ({
  id: randomUUID(),
  name: 'Campanha',
  meta_campaign_id: null,
  meta_delivery_status: null,
  google_campaign_id: null,
  google_status: null,
  tiktok_campaign_id: null,
  tiktok_status: null,
  ...over,
});

describe('regras puras do "Apagar empresa"', () => {
  it('nome confere com trim nas pontas; maiúsculas contam; vazio nunca confere', () => {
    expect(confirmNameMatches('  Freela Serviços ', 'Freela Serviços')).toBe(true);
    expect(confirmNameMatches('freela serviços', 'Freela Serviços')).toBe(false);
    expect(confirmNameMatches('Freela', 'Freela Serviços')).toBe(false);
    expect(confirmNameMatches('   ', '   ')).toBe(false);
    expect(confirmNameMatches(undefined, 'X')).toBe(false);
  });

  it('ligada = publicada e NÃO pausada no canal, olhando a veiculação (encerrada com Meta ACTIVE ainda gasta)', () => {
    const a = camp({ name: 'Ativa', meta_campaign_id: 'm1', meta_delivery_status: 'ACTIVE' });
    const ended = camp({ name: 'Encerrada mas ligada', meta_campaign_id: 'm2', meta_delivery_status: 'ACTIVE' });
    const paused = camp({ name: 'Pausada', meta_campaign_id: 'm3', meta_delivery_status: 'PAUSED' });
    const unknown = camp({ name: 'Sem status', meta_campaign_id: 'm4', meta_delivery_status: null });
    const draft = camp({ name: 'Rascunho' });
    const google = camp({ name: 'Google', google_campaign_id: 'g1', google_status: 'ENABLED' });
    const googlePaused = camp({ name: 'Google pausada', google_campaign_id: 'g2', google_status: 'PAUSED' });
    const tiktok = camp({ name: 'TikTok', tiktok_campaign_id: 't1', tiktok_status: 'ENABLE' });
    const tiktokOff = camp({ name: 'TikTok desligada', tiktok_campaign_id: 't2', tiktok_status: 'DISABLE' });
    const live = liveCampaigns([a, ended, paused, unknown, draft, google, googlePaused, tiktok, tiktokOff]);
    expect(live.map((l) => `${l.channel}:${l.name}`)).toEqual(['meta:Ativa', 'meta:Encerrada mas ligada', 'meta:Sem status', 'google:Google', 'tiktok:TikTok']);
  });

  it('bloqueios: Meta (com os nomes), Google/TikTok (sem repetir a campanha) e última empresa, nessa ordem', () => {
    const m1 = { id: 'a', name: 'Black Friday', channel: 'meta' as const };
    const m2 = { id: 'b', name: 'Natal', channel: 'meta' as const };
    const g = { id: 'c', name: 'Busca', channel: 'google' as const };
    const t = { id: 'c', name: 'Busca', channel: 'tiktok' as const };
    const b = deletionBlockers({ live: [m1, m2, g, t], memberships: 1 });
    expect(b.map((x) => x.code)).toEqual(['LIVE_META_CAMPAIGNS', 'LIVE_OTHER_AD_CAMPAIGNS', 'LAST_WORKSPACE']);
    expect(b[0].message).toBe('Estas campanhas ainda estão ligadas na Meta: Black Friday, Natal. Encerre a campanha (ou pause na Meta) antes de apagar a empresa.');
    expect(b[0].items).toEqual([{ id: 'a', name: 'Black Friday' }, { id: 'b', name: 'Natal' }]);
    expect(b[1].items).toEqual([{ id: 'c', name: 'Busca' }]);
    expect(b[1].message).toMatch(/^Esta campanha ainda está ligada no Google Ads ou no TikTok Ads: Busca\./);
    expect(b[2].message).toBe('Esta é a sua única empresa. Crie outra empresa antes de apagar esta.');
    expect(deletionBlockers({ live: [m1], memberships: 2 })[0].message).toMatch(/^Esta campanha ainda está ligada na Meta: Black Friday\./);
    expect(deletionBlockers({ live: [], memberships: 2 })).toEqual([]);
  });
});

// ---------------- serviço (Prisma falso em memória) ----------------

const OWNER = randomUUID();
const ADMIN = randomUUID();
const VIEWER = randomUUID();
const STRANGER = randomUUID();
const WS = randomUUID();
const OTHER = randomUUID(); // outra empresa do dono
const HEIR_MINE = randomUUID(); // herda a IA de WS; o dono também é membro
const HEIR_FOREIGN = randomUUID(); // herda a IA de WS; de outro cliente

type State = {
  members: { workspace_id: string; user_id: string; role: string }[];
  workspaces: { id: string; name: string; ai_inherit_from: string | null; created_at: Date }[];
  campaigns: (CampaignChannels & { workspace_id: string; created_at: Date })[];
  counts: Record<string, number>;
};

function initial(): State {
  return {
    members: [
      { workspace_id: WS, user_id: OWNER, role: 'owner' },
      { workspace_id: WS, user_id: ADMIN, role: 'admin' },
      { workspace_id: WS, user_id: VIEWER, role: 'viewer' },
      { workspace_id: OTHER, user_id: OWNER, role: 'owner' },
      { workspace_id: HEIR_MINE, user_id: OWNER, role: 'admin' },
    ],
    workspaces: [
      { id: WS, name: 'Freela Serviços', ai_inherit_from: null, created_at: new Date(1) },
      { id: OTHER, name: 'Freela App', ai_inherit_from: null, created_at: new Date(2) },
      { id: HEIR_MINE, name: 'Frutá Frozen', ai_inherit_from: WS, created_at: new Date(3) },
      { id: HEIR_FOREIGN, name: 'Cliente Alheio', ai_inherit_from: WS, created_at: new Date(4) },
    ],
    campaigns: [],
    counts: { brands: 2, creatives: 7, media_assets: 4, crm_leads: 31, instagram_accounts: 1, meta_accounts: 1, mcp_connections: 0, integration_connections: 1, crm_integrations: 0 },
  };
}

/** Banco falso: `log` grava cada chamada com o "lado" (prisma/tx) para provar o que roda dentro da transação. */
function makeDb(state: State, side: 'prisma' | 'tx', log: string[]) {
  const rec = (s: string) => log.push(`${side}:${s}`);
  const counter = (table: string) => ({ count: async ({ where }: any) => (where.workspace_id === WS ? state.counts[table] ?? 0 : 0) });
  return {
    workspace_members: {
      findUnique: async ({ where }: any) =>
        state.members.find((m) => m.workspace_id === where.workspace_id_user_id.workspace_id && m.user_id === where.workspace_id_user_id.user_id) ?? null,
      count: async ({ where }: any) => state.members.filter((m) => (where.user_id ? m.user_id === where.user_id : m.workspace_id === where.workspace_id)).length,
      findMany: async ({ where }: any) => state.members.filter((m) => m.user_id === where.user_id && where.workspace_id.in.includes(m.workspace_id)),
    },
    workspaces: {
      findUnique: async ({ where }: any) => {
        const w = state.workspaces.find((x) => x.id === where.id);
        return w ? { id: w.id, name: w.name } : null;
      },
      findMany: async ({ where, select }: any) =>
        state.workspaces
          .filter((w) => w.ai_inherit_from === where.ai_inherit_from && w.id !== where.NOT?.id)
          .map((w) => Object.fromEntries(Object.keys(select).map((k) => [k, (w as any)[k]]))),
      delete: async ({ where }: any) => {
        rec(`workspaces.delete:${where.id}`);
        state.workspaces = state.workspaces.filter((w) => w.id !== where.id);
        state.workspaces.forEach((w) => { if (w.ai_inherit_from === where.id) w.ai_inherit_from = null; });
      },
    },
    campaigns: {
      findMany: async ({ where }: any) => state.campaigns.filter((c) => c.workspace_id === where.workspace_id),
      count: async ({ where }: any) => state.campaigns.filter((c) => c.workspace_id === where.workspace_id).length,
    },
    ig_posts: { count: async ({ where }: any) => (where.workspace_id !== WS ? 0 : where.status === 'published' ? 12 : 3) },
    app_credentials: {
      count: async ({ where }: any) => (where.workspace_id === null ? 2 : where.workspace_id === WS ? 1 : 0),
      deleteMany: async ({ where }: any) => { rec(`app_credentials.deleteMany:${JSON.stringify(where)}`); return { count: 2 }; },
    },
    oauth_states: { deleteMany: async ({ where }: any) => { rec(`oauth_states.deleteMany:${where.workspace_id}`); return { count: 1 }; } },
    brands: counter('brands'),
    creatives: counter('creatives'),
    media_assets: counter('media_assets'),
    crm_leads: counter('crm_leads'),
    instagram_accounts: counter('instagram_accounts'),
    meta_accounts: counter('meta_accounts'),
    mcp_connections: counter('mcp_connections'),
    integration_connections: counter('integration_connections'),
    crm_integrations: counter('crm_integrations'),
    $executeRaw: async (strings: TemplateStringsArray, ...values: unknown[]) => { rec(`exec:${strings.join('?').trim()}|${values.join(',')}`); return 1; },
    $queryRaw: async (strings: TemplateStringsArray, ...values: unknown[]) => {
      rec(`query:${strings.join('?').trim()}`);
      const w = state.workspaces.find((x) => x.id === values[0]);
      return w ? [{ name: w.name }] : [];
    },
  };
}

function setup(opts: { txState?: (s: State) => void; filesFail?: boolean } = {}) {
  const state = initial();
  const log: string[] = [];
  const prisma: any = makeDb(state, 'prisma', log);
  const txOptions: unknown[] = [];
  prisma.$transaction = async (fn: (tx: unknown) => Promise<unknown>, o: unknown) => {
    txOptions.push(o);
    opts.txState?.(state);
    log.push('tx:begin');
    const r = await fn(makeDb(state, 'tx', log));
    log.push('tx:commit');
    return r;
  };
  const files = {
    removeWorkspaceFolders: jest.fn(async (id: string) => {
      log.push(`files:${id}`);
      if (opts.filesFail) throw new Error('disco cheio');
      return [`creative-assets/brands/${id}`];
    }),
  };
  const svc = new WorkspaceDeletionService(prisma, new WorkspaceAccessService(prisma), files as any);
  return { svc, state, log, files, txOptions };
}

/** Só as escritas que apagam (a trava `workspace-delete:<user>` não conta). */
const deletes = (log: string[]) => log.filter((l) => /\.delete(Many)?:/.test(l));

const err = async (p: Promise<unknown>) => {
  try { await p; return 'ok'; } catch (e: any) { const r = e.getResponse(); return `${e.getStatus()}:${r.code}:${r.message}`; }
};

let logSpy: jest.SpyInstance;
let warnSpy: jest.SpyInstance;
beforeEach(() => {
  logSpy = jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
  warnSpy = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
});
afterEach(() => jest.restoreAllMocks());

describe('WorkspaceDeletionService — só o dono', () => {
  it('admin, viewer e quem não é membro recebem 403 no preview e no apagar; nada é apagado', async () => {
    const { svc, log } = setup();
    expect(await err(svc.preview(ADMIN, WS))).toBe(`403:FORBIDDEN:${ERR_ONLY_OWNER_DELETES}`);
    expect(await err(svc.remove(ADMIN, WS, 'Freela Serviços'))).toBe(`403:FORBIDDEN:${ERR_ONLY_OWNER_DELETES}`);
    expect(await err(svc.remove(VIEWER, WS, 'Freela Serviços'))).toBe(`403:FORBIDDEN:${ERR_ONLY_OWNER_DELETES}`);
    expect(await err(svc.remove(STRANGER, WS, 'Freela Serviços'))).toBe(`403:FORBIDDEN:${NOT_A_MEMBER}`);
    expect(deletes(log)).toEqual([]);
  });

  it('id malformado → 404 (antes do banco)', async () => {
    const { svc } = setup();
    expect(await err(svc.preview(OWNER, 'xxx'))).toBe('404:NOT_FOUND:Não encontrado.');
  });
});

describe('WorkspaceDeletionService.preview', () => {
  it('contagens, herdeiros (nome só das empresas do usuário) e sem bloqueio', async () => {
    const { svc, state } = setup();
    state.campaigns.push({ ...camp({ name: 'Pausada', meta_campaign_id: 'm', meta_delivery_status: 'PAUSED' }), workspace_id: WS, created_at: new Date() });
    const p = await svc.preview(OWNER, WS);
    expect(p.workspace).toEqual({ id: WS, name: 'Freela Serviços' });
    expect(p.counts).toEqual({
      brands: 2,
      campaigns: 1,
      creatives: 7,
      media_assets: 4,
      ig_posts_pending: 3,
      ig_posts_published: 12,
      crm_leads: 31,
      members: 3,
      saved_keys: 3, // 1 do cofre da empresa + 2 de IA no cofre global
      connections: 3, // Instagram + Meta + 1 integração
    });
    expect(p.inheritors).toEqual([{ id: HEIR_MINE, name: 'Frutá Frozen' }]);
    expect(p.inheritors_hidden).toBe(1);
    expect(p.blockers).toEqual([]);
  });

  it('campanha ligada na Meta e última empresa aparecem como bloqueios com o que fazer', async () => {
    const { svc, state } = setup();
    state.members = state.members.filter((m) => !(m.user_id === OWNER && m.workspace_id !== WS));
    const live = camp({ name: 'Black Friday', meta_campaign_id: 'm', meta_delivery_status: 'ACTIVE' });
    state.campaigns.push({ ...live, workspace_id: WS, created_at: new Date() });
    const p = await svc.preview(OWNER, WS);
    expect(p.blockers.map((b) => b.code)).toEqual(['LIVE_META_CAMPAIGNS', 'LAST_WORKSPACE']);
    expect(p.blockers[0].items).toEqual([{ id: live.id, name: 'Black Friday' }]);
  });
});

describe('WorkspaceDeletionService.remove', () => {
  it('nome errado → 400 NAME_MISMATCH e nada é apagado', async () => {
    const { svc, log, files } = setup();
    expect(await err(svc.remove(OWNER, WS, 'Freela'))).toBe(`400:NAME_MISMATCH:${ERR_NAME_MISMATCH}`);
    expect(deletes(log)).toEqual([]);
    expect(files.removeWorkspaceFolders).not.toHaveBeenCalled();
  });

  it('campanha ligada na Meta → 409 LIVE_META_CAMPAIGNS com os nomes; nada é apagado', async () => {
    const { svc, state, log } = setup();
    state.campaigns.push({ ...camp({ name: 'Black Friday', meta_campaign_id: 'm1', meta_delivery_status: 'ACTIVE' }), workspace_id: WS, created_at: new Date() });
    state.campaigns.push({ ...camp({ name: 'Natal', meta_campaign_id: 'm2', meta_delivery_status: 'ACTIVE', }), workspace_id: WS, created_at: new Date() });
    expect(await err(svc.remove(OWNER, WS, 'Freela Serviços'))).toBe(
      '409:LIVE_META_CAMPAIGNS:Estas campanhas ainda estão ligadas na Meta: Black Friday, Natal. Encerre a campanha (ou pause na Meta) antes de apagar a empresa.',
    );
    expect(deletes(log)).toEqual([]);
  });

  it('última empresa do usuário → 409 LAST_WORKSPACE', async () => {
    const { svc, state } = setup();
    state.members = state.members.filter((m) => !(m.user_id === OWNER && m.workspace_id !== WS));
    expect(await err(svc.remove(OWNER, WS, 'Freela Serviços'))).toBe('409:LAST_WORKSPACE:Esta é a sua única empresa. Crie outra empresa antes de apagar esta.');
  });

  it('bloqueio conferido DENTRO da transação: campanha ligada entre o preview e o clique → 409, nada apagado', async () => {
    const { svc, log } = setup({
      txState: (s) => s.campaigns.push({ ...camp({ name: 'Ligada agora', meta_campaign_id: 'm', meta_delivery_status: 'ACTIVE' }), workspace_id: WS, created_at: new Date() }),
    });
    expect(await err(svc.remove(OWNER, WS, 'Freela Serviços'))).toMatch(/^409:LIVE_META_CAMPAIGNS:Esta campanha ainda está ligada na Meta: Ligada agora\./);
    expect(deletes(log)).toEqual([]);
  });

  it('sucesso: trava + oauth_states + chaves globais com o id + workspaces numa transação; arquivos só depois do commit; log de auditoria', async () => {
    const { svc, state, log, files, txOptions } = setup();
    await expect(svc.remove(OWNER, WS, '  Freela Serviços  ')).resolves.toBeUndefined();
    expect(txOptions).toEqual([{ maxWait: 10_000, timeout: 120_000 }]);
    const inTx = log.slice(log.indexOf('tx:begin'), log.indexOf('tx:commit'));
    expect(inTx.find((l) => l.startsWith('tx:exec:'))).toBe(`tx:exec:SELECT pg_advisory_xact_lock(hashtext(?))|workspace-delete:${OWNER}`);
    expect(inTx).toContain('tx:query:SELECT name FROM workspaces WHERE id = ?::uuid FOR UPDATE');
    expect(inTx).toContain(`tx:oauth_states.deleteMany:${WS}`);
    expect(inTx).toContain(`tx:app_credentials.deleteMany:${JSON.stringify(globalKeysOf(WS))}`);
    expect(inTx[inTx.length - 1]).toBe(`tx:workspaces.delete:${WS}`);
    // Nada de escrita fora da transação; os arquivos vêm depois do commit.
    expect(deletes(log).filter((l) => l.startsWith('prisma:'))).toEqual([]);
    expect(log.indexOf(`files:${WS}`)).toBeGreaterThan(log.indexOf('tx:commit'));
    expect(files.removeWorkspaceFolders).toHaveBeenCalledWith(WS);
    // Herdeiros perdem a herança (FK SET NULL); a outra empresa do dono fica.
    expect(state.workspaces.map((w) => [w.name, w.ai_inherit_from])).toEqual([['Freela App', null], ['Frutá Frozen', null], ['Cliente Alheio', null]]);
    const line = String(logSpy.mock.calls.map((c) => c[0]).find((m) => String(m).startsWith('[workspace-delete]')));
    const audit = JSON.parse(line.replace('[workspace-delete] ', ''));
    expect(audit).toMatchObject({
      action: 'workspace.deleted',
      user_id: OWNER,
      workspace_id: WS,
      name: 'Freela Serviços',
      inheritors_unlinked: [HEIR_MINE, HEIR_FOREIGN],
      oauth_states: 1,
      global_keys: 2,
      file_folders: [`creative-assets/brands/${WS}`],
    });
    expect(audit.counts).toMatchObject({ crm_leads: 31, members: 3 });
  });

  it('falha ao apagar arquivos não vira erro: a empresa já foi apagada, fica só o aviso no log', async () => {
    const { svc, state } = setup({ filesFail: true });
    await expect(svc.remove(OWNER, WS, 'Freela Serviços')).resolves.toBeUndefined();
    expect(state.workspaces.some((w) => w.id === WS)).toBe(false);
    expect(warnSpy.mock.calls.map((c) => String(c[0])).some((m) => m.includes('disco cheio'))).toBe(true);
  });

  it('empresa sumiu entre o acesso e a trava → 404', async () => {
    const { svc } = setup({ txState: (s) => { s.workspaces = s.workspaces.filter((w) => w.id !== WS); } });
    expect(await err(svc.remove(OWNER, WS, 'Freela Serviços'))).toBe('404:NOT_FOUND:Não encontrado.');
  });

  it('chaves globais: só as do cofre global (workspace_id nulo) que terminam com ":<id>"', () => {
    expect(globalKeysOf(WS)).toEqual({ workspace_id: null, key: { endsWith: `:${WS}`, mode: 'insensitive' } });
  });
});
