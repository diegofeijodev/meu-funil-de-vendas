import { AiCreditAlertsService } from '../ai-credit-alerts.service';
import { AiKeysService } from '../ai-keys.service';
import { AiVendor } from '../ai.types';

const AGENCY = '11111111-1111-4111-8111-111111111111';
const CHILD = '22222222-2222-4222-8222-222222222222';
const OTHER = '33333333-3333-4333-8333-333333333333';

type Row = { workspace_id: string; vendor: string; message: string; first_at: Date; last_at: Date };

/** Banco em memória com o subconjunto do Prisma que o aviso usa. */
function memPrisma(names: Record<string, string> = {}) {
  const rows: Row[] = [];
  const hit = (r: Row, w: any) => (w.OR ?? [w]).some((c: any) => r.workspace_id === c.workspace_id && r.vendor === c.vendor);
  const prisma: any = {
    rows,
    fail: false,
    ai_credit_alerts: {
      upsert: async ({ where, create, update }: any) => {
        if (prisma.fail) throw new Error('banco fora do ar');
        const k = where.workspace_id_vendor;
        const cur = rows.find((r) => r.workspace_id === k.workspace_id && r.vendor === k.vendor);
        if (cur) Object.assign(cur, update);
        else rows.push({ ...create });
      },
      deleteMany: async ({ where }: any) => {
        if (prisma.fail) throw new Error('banco fora do ar');
        for (let i = rows.length - 1; i >= 0; i--) if (hit(rows[i]!, where)) rows.splice(i, 1);
      },
      findMany: async ({ where }: any) => rows.filter((r) => hit(r, where)),
    },
    workspaces: { findUnique: async ({ where }: any) => (names[where.id] ? { id: where.id, name: names[where.id] } : null) },
  };
  return prisma;
}

/** Chaves: `own[ws][vendor]` = a empresa tem a própria; `inherit[ws]` = agência. */
function memKeys(own: Record<string, AiVendor[]>, inherit: Record<string, string> = {}) {
  return {
    resolve: async (ws: string, vendor: AiVendor) => {
      if (own[ws]?.includes(vendor)) return { key: `k-${ws}-${vendor}`, ownerId: ws };
      const src = inherit[ws];
      return src && own[src]?.includes(vendor) ? { key: `k-${src}-${vendor}`, ownerId: src } : null;
    },
  } as unknown as AiKeysService;
}

function setup(o: { own: Record<string, AiVendor[]>; inherit?: Record<string, string>; gateway?: boolean }) {
  const prisma = memPrisma({ [AGENCY]: 'Freela App', [CHILD]: 'Frutá Frozen' });
  const svc = new AiCreditAlertsService(prisma, memKeys(o.own, o.inherit), o.gateway ? { AI_GATEWAY_URL: 'https://gw', AI_GATEWAY_API_KEY: 'k' } : {});
  return { svc, prisma };
}

describe('AiCreditAlertsService — gravação na empresa DONA da chave', () => {
  it('falta de saldo grava; a 2ª falha mantém first_at e atualiza last_at/mensagem; sucesso apaga só aquele provedor', async () => {
    const { svc, prisma } = setup({ own: { [AGENCY]: ['openai', 'gemini'] } });
    await svc.exhausted(AGENCY, 'openai', 'sem saldo 1');
    const first = prisma.rows[0].first_at as Date;
    await new Promise((r) => setTimeout(r, 5));
    await svc.exhausted(AGENCY, 'openai', 'sem saldo 2');
    await svc.exhausted(AGENCY, 'gemini', 'sem saldo g');
    expect(prisma.rows).toHaveLength(2);
    expect(prisma.rows[0]).toMatchObject({ workspace_id: AGENCY, vendor: 'openai', message: 'sem saldo 2', first_at: first });
    expect(prisma.rows[0].last_at.getTime()).toBeGreaterThan(first.getTime());
    await svc.recovered(AGENCY, 'openai');
    expect(prisma.rows.map((r: Row) => r.vendor)).toEqual(['gemini']);
  });

  it('herança: a falha da filha grava na agência; com a própria OpenAI e o Gemini herdado, cada provedor vai para a sua dona', async () => {
    const { svc, prisma } = setup({ own: { [AGENCY]: ['openai', 'gemini'], [CHILD]: ['openai'] }, inherit: { [CHILD]: AGENCY } });
    await svc.exhausted(CHILD, 'gemini', 'g');
    await svc.exhausted(CHILD, 'openai', 'o');
    expect(prisma.rows.map((r: Row) => `${r.workspace_id === AGENCY ? 'agência' : 'filha'}:${r.vendor}`).sort()).toEqual(['agência:gemini', 'filha:openai']);
    // A chave da agência que voltou a responder pela filha limpa o aviso da agência.
    await svc.recovered(CHILD, 'gemini');
    expect(prisma.rows.map((r: Row) => r.vendor)).toEqual(['openai']);
  });

  it('sem chave nenhuma não grava nada (falha de quem não tem dona)', async () => {
    const { svc, prisma } = setup({ own: {} });
    await svc.exhausted(OTHER, 'openai', 'x');
    expect(prisma.rows).toHaveLength(0);
  });

  it('best-effort: banco fora do ar não lança (a chamada de IA segue)', async () => {
    const { svc, prisma } = setup({ own: { [AGENCY]: ['openai'] } });
    prisma.fail = true;
    await expect(svc.exhausted(AGENCY, 'openai', 'x')).resolves.toBeUndefined();
    await expect(svc.recovered(AGENCY, 'openai')).resolves.toBeUndefined();
    await expect(svc.noteTest(AGENCY, 'openai', { ok: false, kind: 'noCredit', error: 'x' })).resolves.toBeUndefined();
    await expect(svc.clear(AGENCY, 'openai')).resolves.toBeUndefined();
  });

  it('teste da chave: ok apaga, sem saldo grava, limite por minuto e chave recusada não mexem', async () => {
    const { svc, prisma } = setup({ own: { [AGENCY]: ['openai'] } });
    await svc.noteTest(AGENCY, 'openai', { ok: false, kind: 'noCredit', error: 'Conta sem créditos. Adicione saldo na OpenAI e teste de novo.' });
    expect(prisma.rows[0]).toMatchObject({ message: 'Conta sem créditos. Adicione saldo na OpenAI e teste de novo.' });
    await svc.noteTest(AGENCY, 'openai', { ok: false, kind: 'rateLimited', error: 'pedidos demais' });
    await svc.noteTest(AGENCY, 'openai', { ok: false, kind: 'refused', error: 'recusada' });
    await svc.noteTest(AGENCY, 'openai', { ok: false, error: 'rede' });
    expect(prisma.rows).toHaveLength(1);
    await svc.noteTest(AGENCY, 'openai', { ok: true });
    expect(prisma.rows).toHaveLength(0);
  });
});

describe('AiCreditAlertsService.status — o que a faixa mostra', () => {
  it('nada sem chave ou sem aviso', async () => {
    expect(await setup({ own: {} }).svc.status(AGENCY)).toBeNull();
    expect(await setup({ own: { [AGENCY]: ['openai'] } }).svc.status(AGENCY)).toBeNull();
  });

  it('todos os provedores com chave sem saldo e sem gateway → stopped (fallback null); com gateway → partial pelo app', async () => {
    for (const gateway of [false, true]) {
      const { svc } = setup({ own: { [AGENCY]: ['openai', 'gemini'] }, gateway });
      await svc.exhausted(AGENCY, 'openai', 'o');
      await svc.exhausted(AGENCY, 'gemini', 'g');
      const st = await svc.status(AGENCY);
      expect(st).toMatchObject({ level: gateway ? 'partial' : 'stopped', fallback: gateway ? 'app' : null, inherited_from: null });
      expect(st!.vendors.map((v) => [v.vendor, v.label])).toEqual([['openai', 'ChatGPT (OpenAI)'], ['gemini', 'Gemini (Google)']]);
    }
  });

  it('um sem saldo e o outro funcionando → partial com o outro como fallback', async () => {
    const { svc } = setup({ own: { [AGENCY]: ['openai', 'gemini'] } });
    await svc.exhausted(AGENCY, 'gemini', 'g');
    expect(await svc.status(AGENCY)).toMatchObject({ level: 'partial', fallback: 'openai', vendors: [{ vendor: 'gemini' }] });
  });

  it('só uma chave, sem saldo → stopped', async () => {
    const { svc } = setup({ own: { [AGENCY]: ['openai'] } });
    await svc.exhausted(AGENCY, 'openai', 'o');
    expect(await svc.status(AGENCY)).toMatchObject({ level: 'stopped', fallback: null });
  });

  it('herança: a filha vê o aviso da agência com o nome dela; aviso de provedor sem chave não conta', async () => {
    const { svc, prisma } = setup({ own: { [AGENCY]: ['openai', 'gemini'] }, inherit: { [CHILD]: AGENCY } });
    await svc.exhausted(AGENCY, 'openai', 'o');
    await svc.exhausted(AGENCY, 'gemini', 'g');
    expect(await svc.status(CHILD)).toMatchObject({ level: 'stopped', inherited_from: { id: AGENCY, name: 'Freela App' } });
    // Linha órfã (chave removida da filha depois) não aparece: a filha não tem a própria OpenAI.
    prisma.rows.push({ workspace_id: CHILD, vendor: 'openai', message: 'velho', first_at: new Date(0), last_at: new Date(0) });
    expect((await svc.status(CHILD))!.vendors.every((v) => v.owner_id === AGENCY)).toBe(true);
  });

  it('isolamento: o aviso de uma empresa não aparece em outra que não herda dela', async () => {
    const { svc } = setup({ own: { [AGENCY]: ['openai'], [OTHER]: ['openai'] } });
    await svc.exhausted(AGENCY, 'openai', 'o');
    expect(await svc.status(OTHER)).toBeNull();
    expect(await svc.status(AGENCY)).not.toBeNull();
  });
});
