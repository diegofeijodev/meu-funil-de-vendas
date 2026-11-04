import { AiCreditAlertsService, AiKeyUse } from '../ai-credit-alerts.service';
import { AiKeysService } from '../ai-keys.service';
import { AiVendor } from '../ai.types';

const AGENCY = '11111111-1111-4111-8111-111111111111';
const CHILD = '22222222-2222-4222-8222-222222222222';
const OTHER = '33333333-3333-4333-8333-333333333333';

type Row = { workspace_id: string; vendor: string; reason: string; message: string; first_at: Date; last_at: Date };

/** Banco em memória com o subconjunto do Prisma que o aviso usa; conta as idas ao banco (para provar o cache). */
function memPrisma(names: Record<string, string> = {}) {
  const rows: Row[] = [];
  const hit = (r: Row, w: any) => (w.OR ?? [w]).some((c: any) => r.workspace_id === c.workspace_id && r.vendor === c.vendor && (!c.reason || r.reason === c.reason));
  const prisma: any = {
    rows,
    fail: false,
    hits: 0,
    ai_credit_alerts: {
      upsert: async ({ where, create, update }: any) => {
        prisma.hits++;
        if (prisma.fail) throw new Error('banco fora do ar');
        const k = where.workspace_id_vendor;
        const cur = rows.find((r) => r.workspace_id === k.workspace_id && r.vendor === k.vendor);
        if (cur) Object.assign(cur, update);
        else rows.push({ ...create });
      },
      deleteMany: async ({ where }: any) => {
        prisma.hits++;
        if (prisma.fail) throw new Error('banco fora do ar');
        for (let i = rows.length - 1; i >= 0; i--) if (hit(rows[i]!, where)) rows.splice(i, 1);
      },
      findMany: async ({ where }: any) => rows.filter((r) => hit(r, where)),
    },
    workspaces: { findUnique: async ({ where }: any) => (names[where.id] ? { id: where.id, name: names[where.id] } : null) },
  };
  return prisma;
}

/** Chaves: `own[ws]` = provedores com a própria chave; `inherit[ws]` = agência. Conta as resoluções (cada uma = leituras no cofre). */
function memKeys(own: Record<string, AiVendor[]>, inherit: Record<string, string> = {}) {
  const keys = {
    resolves: 0,
    resolve: async (ws: string, vendor: AiVendor) => {
      keys.resolves++;
      if (own[ws]?.includes(vendor)) return { key: `k-${ws}-${vendor}`, ownerId: ws };
      const src = inherit[ws];
      return src && own[src]?.includes(vendor) ? { key: `k-${src}-${vendor}`, ownerId: src } : null;
    },
  };
  return keys;
}

function setup(o: { own: Record<string, AiVendor[]>; inherit?: Record<string, string>; gateway?: boolean }) {
  const prisma = memPrisma({ [AGENCY]: 'Freela App', [CHILD]: 'Frutá Frozen' });
  const keys = memKeys(o.own, o.inherit);
  const svc = new AiCreditAlertsService(prisma, keys as unknown as AiKeysService, o.gateway ? { AI_GATEWAY_URL: 'https://gw', AI_GATEWAY_API_KEY: 'k' } : {});
  return { svc, prisma, keys };
}
/** Uso da chave que `memKeys` devolveria para (ws, provedor). */
const use = (workspaceId: string, vendor: AiVendor, owner = workspaceId, scope: AiKeyUse['scope'] = 'text'): AiKeyUse => ({ workspaceId, vendor, key: `k-${owner}-${vendor}`, scope });

describe('AiCreditAlertsService — gravação na empresa DONA da chave', () => {
  it('falta de saldo grava; a 2ª falha mantém first_at e atualiza last_at/mensagem; sucesso apaga só aquele provedor', async () => {
    const { svc, prisma } = setup({ own: { [AGENCY]: ['openai', 'gemini'] } });
    await svc.exhausted(use(AGENCY, 'openai'), 'no_credit', 'sem saldo 1');
    const first = prisma.rows[0].first_at as Date;
    await new Promise((r) => setTimeout(r, 5));
    await svc.exhausted(use(AGENCY, 'openai'), 'no_credit', 'sem saldo 2');
    await svc.exhausted(use(AGENCY, 'gemini'), 'no_credit', 'sem saldo g');
    expect(prisma.rows).toHaveLength(2);
    expect(prisma.rows[0]).toMatchObject({ workspace_id: AGENCY, vendor: 'openai', reason: 'no_credit', message: 'sem saldo 2', first_at: first });
    expect(prisma.rows[0].last_at.getTime()).toBeGreaterThan(first.getTime());
    await svc.recovered(use(AGENCY, 'openai'));
    expect(prisma.rows.map((r: Row) => r.vendor)).toEqual(['gemini']);
  });

  it('herança: a falha da filha grava na agência; com a própria OpenAI e o Gemini herdado, cada provedor vai para a sua dona', async () => {
    const { svc, prisma } = setup({ own: { [AGENCY]: ['openai', 'gemini'], [CHILD]: ['openai'] }, inherit: { [CHILD]: AGENCY } });
    await svc.exhausted(use(CHILD, 'gemini', AGENCY), 'no_credit', 'g');
    await svc.exhausted(use(CHILD, 'openai'), 'no_credit', 'o');
    expect(prisma.rows.map((r: Row) => `${r.workspace_id === AGENCY ? 'agência' : 'filha'}:${r.vendor}`).sort()).toEqual(['agência:gemini', 'filha:openai']);
    await svc.recovered(use(CHILD, 'gemini', AGENCY));
    expect(prisma.rows.map((r: Row) => r.vendor)).toEqual(['openai']);
  });

  it('cota de hoje: grava só no modelo de texto; imagem/vídeo não gravam nem apagam o limite de hoje (só a falta de saldo)', async () => {
    const { svc, prisma } = setup({ own: { [AGENCY]: ['gemini'] } });
    await svc.exhausted(use(AGENCY, 'gemini', AGENCY, 'media'), 'daily_limit', 'limite do Veo');
    expect(prisma.rows).toHaveLength(0);
    await svc.exhausted(use(AGENCY, 'gemini'), 'daily_limit', 'limite do texto');
    expect(prisma.rows[0]).toMatchObject({ reason: 'daily_limit', message: 'limite do texto' });
    await svc.recovered(use(AGENCY, 'gemini', AGENCY, 'media')); // a imagem saiu: prova saldo, não a cota do texto
    expect(prisma.rows).toHaveLength(1);
    await svc.recovered(use(AGENCY, 'gemini')); // o texto voltou
    expect(prisma.rows).toHaveLength(0);
    // Falta de saldo por imagem/vídeo grava (a conta inteira parou) e o sucesso de mídia apaga.
    await svc.exhausted(use(AGENCY, 'gemini', AGENCY, 'media'), 'no_credit', 'sem saldo');
    expect(prisma.rows[0]).toMatchObject({ reason: 'no_credit' });
    await svc.recovered(use(AGENCY, 'gemini', AGENCY, 'media'));
    expect(prisma.rows).toHaveLength(0);
  });

  it('sem chave nenhuma não grava nada (falha de quem não tem dona)', async () => {
    const { svc, prisma } = setup({ own: {} });
    await svc.exhausted(use(OTHER, 'openai'), 'no_credit', 'x');
    expect(prisma.rows).toHaveLength(0);
  });

  it('best-effort: banco fora do ar não lança (a chamada de IA segue)', async () => {
    const { svc, prisma } = setup({ own: { [AGENCY]: ['openai'] } });
    prisma.fail = true;
    await expect(svc.exhausted(use(AGENCY, 'openai'), 'no_credit', 'x')).resolves.toBeUndefined();
    await expect(svc.recovered(use(AGENCY, 'openai'))).resolves.toBeUndefined();
    await expect(svc.noteTest(AGENCY, 'openai', 'k', { ok: false, kind: 'noCredit', error: 'x' })).resolves.toBeUndefined();
    await expect(svc.clear(AGENCY, 'openai')).resolves.toBeUndefined();
  });

  it('teste da chave: ok apaga, sem saldo e limite de hoje gravam (com o motivo), pedidos demais e chave recusada não mexem', async () => {
    const { svc, prisma } = setup({ own: { [AGENCY]: ['openai'] } });
    await svc.noteTest(AGENCY, 'openai', 'k', { ok: false, kind: 'noCredit', error: 'Conta sem créditos. Adicione saldo na OpenAI e teste de novo.' });
    expect(prisma.rows[0]).toMatchObject({ reason: 'no_credit', message: 'Conta sem créditos. Adicione saldo na OpenAI e teste de novo.' });
    await svc.noteTest(AGENCY, 'openai', 'k', { ok: false, kind: 'rateLimited', error: 'pedidos demais' });
    await svc.noteTest(AGENCY, 'openai', 'k', { ok: false, kind: 'refused', error: 'recusada' });
    await svc.noteTest(AGENCY, 'openai', 'k', { ok: false, error: 'rede' });
    expect(prisma.rows).toHaveLength(1);
    await svc.noteTest(AGENCY, 'openai', 'k', { ok: false, kind: 'dailyLimit', error: 'limite de hoje' });
    expect(prisma.rows[0]).toMatchObject({ reason: 'daily_limit', message: 'limite de hoje' });
    await svc.noteTest(AGENCY, 'openai', 'k', { ok: true });
    expect(prisma.rows).toHaveLength(0);
  });
});

describe('AiCreditAlertsService — cache do caminho feliz (uma instância só)', () => {
  it('depois do 1º sucesso, os seguintes não tocam o banco nem o cofre; uma falha gravada invalida', async () => {
    const { svc, prisma, keys } = setup({ own: { [AGENCY]: ['openai'] } });
    await svc.recovered(use(AGENCY, 'openai'));
    const [hits, resolves] = [prisma.hits, keys.resolves];
    for (let i = 0; i < 5; i++) await svc.recovered(use(AGENCY, 'openai'));
    expect([prisma.hits, keys.resolves]).toEqual([hits, resolves]);
    await svc.exhausted(use(AGENCY, 'openai'), 'no_credit', 'sem saldo');
    expect(prisma.rows).toHaveLength(1);
    await svc.recovered(use(AGENCY, 'openai'));
    expect(prisma.rows).toHaveLength(0);
  });

  it('a mesma chave em duas empresas: o aviso gravado para uma invalida o cache de todas que usam a chave', async () => {
    const { svc, prisma } = setup({ own: { [AGENCY]: ['openai'], [CHILD]: ['openai'] } });
    const same = (ws: string): AiKeyUse => ({ workspaceId: ws, vendor: 'openai', key: 'k-igual', scope: 'text' });
    await svc.recovered(same(AGENCY));
    await svc.recovered(same(CHILD));
    await svc.exhausted(same(CHILD), 'no_credit', 'sem saldo');
    await svc.recovered(same(AGENCY)); // apaga só a linha da agência (que não existe) e volta ao cache
    await svc.recovered(same(CHILD)); // a da filha também é conferida, não fica presa no cache
    expect(prisma.rows).toHaveLength(0);
  });

  it('limite de hoje invalida só o cache de texto; o de imagem/vídeo segue (ele só olha falta de saldo)', async () => {
    const { svc, prisma } = setup({ own: { [AGENCY]: ['gemini'] } });
    await svc.recovered(use(AGENCY, 'gemini', AGENCY, 'media'));
    await svc.recovered(use(AGENCY, 'gemini'));
    await svc.exhausted(use(AGENCY, 'gemini'), 'daily_limit', 'limite');
    const hits = prisma.hits;
    await svc.recovered(use(AGENCY, 'gemini', AGENCY, 'media'));
    expect(prisma.hits).toBe(hits);
    expect(prisma.rows).toHaveLength(1);
    await svc.recovered(use(AGENCY, 'gemini'));
    expect(prisma.rows).toHaveLength(0);
  });

  it('sucesso que termina DEPOIS de uma falha mais nova não marca o cache (o aviso novo não fica preso)', async () => {
    const { svc, prisma } = setup({ own: { [AGENCY]: ['openai'] } });
    const realDelete = prisma.ai_credit_alerts.deleteMany;
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    // O DELETE do sucesso roda (não havia aviso) e fica parado antes de voltar.
    prisma.ai_credit_alerts.deleteMany = async (a: any) => {
      await realDelete(a);
      prisma.ai_credit_alerts.deleteMany = realDelete;
      await gate;
    };
    const ok = svc.recovered(use(AGENCY, 'openai'));
    await new Promise((r) => setTimeout(r, 0));
    await svc.exhausted(use(AGENCY, 'openai'), 'no_credit', 'sem saldo'); // a falha grava enquanto o sucesso não terminou
    release();
    await ok;
    expect(prisma.rows).toHaveLength(1);
    await svc.recovered(use(AGENCY, 'openai')); // sem a trava de versão, o cache diria "limpo" e o aviso ficaria
    expect(prisma.rows).toHaveLength(0);
  });
});

describe('AiCreditAlertsService.status — o que a faixa mostra', () => {
  it('nada sem chave ou sem aviso', async () => {
    expect(await setup({ own: {} }).svc.status(AGENCY)).toBeNull();
    expect(await setup({ own: { [AGENCY]: ['openai'] } }).svc.status(AGENCY)).toBeNull();
  });

  it('todos os provedores com chave sem saldo e sem gateway → stopped (fallback null); com gateway → partial com fallback app', async () => {
    for (const gateway of [false, true]) {
      const { svc } = setup({ own: { [AGENCY]: ['openai', 'gemini'] }, gateway });
      await svc.exhausted(use(AGENCY, 'openai'), 'no_credit', 'o');
      await svc.exhausted(use(AGENCY, 'gemini'), 'daily_limit', 'g');
      const st = await svc.status(AGENCY);
      expect(st).toMatchObject({ level: gateway ? 'partial' : 'stopped', fallback: gateway ? 'app' : null, inherited_from: null });
      expect(st!.vendors.map((v) => [v.vendor, v.label, v.reason])).toEqual([['openai', 'ChatGPT (OpenAI)', 'no_credit'], ['gemini', 'Gemini (Google)', 'daily_limit']]);
    }
  });

  it('um sem saldo e o outro funcionando → partial com o outro como fallback', async () => {
    const { svc } = setup({ own: { [AGENCY]: ['openai', 'gemini'] } });
    await svc.exhausted(use(AGENCY, 'gemini'), 'no_credit', 'g');
    expect(await svc.status(AGENCY)).toMatchObject({ level: 'partial', fallback: 'openai', vendors: [{ vendor: 'gemini' }] });
  });

  it('só uma chave, sem saldo → stopped', async () => {
    const { svc } = setup({ own: { [AGENCY]: ['openai'] } });
    await svc.exhausted(use(AGENCY, 'openai'), 'no_credit', 'o');
    expect(await svc.status(AGENCY)).toMatchObject({ level: 'stopped', fallback: null });
  });

  it('herança: a filha vê o aviso da agência com o nome dela; aviso de provedor sem chave não conta', async () => {
    const { svc, prisma } = setup({ own: { [AGENCY]: ['openai', 'gemini'] }, inherit: { [CHILD]: AGENCY } });
    await svc.exhausted(use(AGENCY, 'openai'), 'no_credit', 'o');
    await svc.exhausted(use(AGENCY, 'gemini'), 'no_credit', 'g');
    expect(await svc.status(CHILD)).toMatchObject({ level: 'stopped', inherited_from: { id: AGENCY, name: 'Freela App' } });
    prisma.rows.push({ workspace_id: CHILD, vendor: 'openai', reason: 'no_credit', message: 'velho', first_at: new Date(0), last_at: new Date(0) });
    expect((await svc.status(CHILD))!.vendors.every((v) => v.owner_id === AGENCY)).toBe(true);
  });

  it('isolamento: o aviso de uma empresa não aparece em outra que não herda dela', async () => {
    const { svc } = setup({ own: { [AGENCY]: ['openai'], [OTHER]: ['openai'] } });
    await svc.exhausted(use(AGENCY, 'openai'), 'no_credit', 'o');
    expect(await svc.status(OTHER)).toBeNull();
    expect(await svc.status(AGENCY)).not.toBeNull();
  });
});
