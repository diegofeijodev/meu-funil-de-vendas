import { MetaError, PublishPermissionError } from '../meta-graph';
import { classifyPublishError, nextCheckDelay, toPublishError } from '../publish-block';
import { PublishingService } from '../publishing.service';
import { useVirtualClock } from '../../../common/__tests__/virtual-clock';
import { igWorld, seedPost, uuid } from './harness';

const H = 3600e3;
const meta = (code?: number) => new MetaError(`erro ${code ?? 'rede'}`, code);

describe('classifyPublishError (R1: pelo código, nunca pela mensagem)', () => {
  it('10 e 200–299 = permissão; 190 = token; o resto não classifica', () => {
    expect(classifyPublishError(meta(10))).toBe('permission');
    expect(classifyPublishError(meta(200))).toBe('permission');
    expect(classifyPublishError(meta(299))).toBe('permission');
    expect(classifyPublishError(meta(190))).toBe('token');
    for (const c of [100, 9004, 4, 300, 2]) expect(classifyPublishError(meta(c))).toBeNull();
    expect(classifyPublishError(meta())).toBeNull(); // rede (sem código)
    expect(classifyPublishError(new Error('Permissão insuficiente na Meta (#10)'))).toBeNull(); // texto não conta
    expect(classifyPublishError(null)).toBeNull();
  });

  it('toPublishError: só a permissão vira a subclasse (mesma mensagem e códigos); o resto passa igual', () => {
    const p = toPublishError(new MetaError('sem permissão', 10, 2207));
    expect(p).toBeInstanceOf(PublishPermissionError);
    expect(p).toBeInstanceOf(MetaError);
    expect(p).toMatchObject({ message: 'sem permissão', code: 10, subcode: 2207 });
    const token = meta(190);
    expect(toPublishError(token)).toBe(token);
    const net = new Error('queda');
    expect(toPublishError(net)).toBe(net);
    expect(classifyPublishError(p)).toBe('permission');
  });

  it('nextCheckDelay: 1 h, 3 h, 6 h, 12 h e teto de 24 h', () => {
    expect([0, 1, 2, 3, 4, 5, 9].map((n) => nextCheckDelay(n) / H)).toEqual([1, 1, 3, 6, 12, 24, 24]);
  });
});

describe('caminho de publicação: só a criação do container e o media_publish classificam', () => {
  const WS = igWorld().WS_A;
  const IG = 'ig-1';
  function setup() {
    const w = igWorld();
    w.t['instagram_accounts']!.rows.push({ id: uuid(), workspace_id: WS, ig_user_id: IG, status: 'connected' });
    const svc = new PublishingService(w.store, w.graph, (async () => new Response(null, { status: 200 })) as any);
    useVirtualClock(svc);
    return { w, svc };
  }
  const err = async (p: Promise<unknown>) => p.then(() => null, (e) => e);

  it('#10 no content_publishing_limit é engolido (publica igual)', async () => {
    const { w, svc } = setup();
    w.respond((path, opts) => {
      if (path === `/${IG}/content_publishing_limit`) return new MetaError('(#10) Requires instagram_content_publish permission', 10);
      if (path === `/${IG}/media` && opts.method === 'POST') return { id: 'c1' };
      if (path === '/c1') return { status_code: 'FINISHED' };
      if (path === `/${IG}/media_publish`) return { id: 'm1' };
      if (path === '/m1') return new MetaError('(#10) sem permissão no permalink', 10);
      return undefined;
    });
    const p = seedPost(w, { workspace_id: WS });
    expect(await svc.publishInstagramPost(p.id)).toMatchObject({ ok: true });
  });

  it('#10 ao criar o container e no media_publish = PublishPermissionError', async () => {
    const a = setup();
    a.w.respond((path, opts) => (path === `/${IG}/media` && opts.method === 'POST' ? new MetaError('(#10) Requires instagram_content_publish permission', 10) : undefined));
    expect(await err(a.svc.publishInstagramPost(seedPost(a.w, { workspace_id: WS }).id))).toBeInstanceOf(PublishPermissionError);

    const b = setup();
    b.w.respond((path, opts) => {
      if (path === `/${IG}/media` && opts.method === 'POST') return { id: 'c1' };
      if (path === '/c1') return { status_code: 'FINISHED' };
      if (path === `/${IG}/media_publish`) return new MetaError('(#200) Permissions error', 200);
      return undefined;
    });
    expect(await err(b.svc.publishInstagramPost(seedPost(b.w, { workspace_id: WS }).id))).toBeInstanceOf(PublishPermissionError);
  });

  it('190 ao criar o container continua MetaError comum (caminho do token, como hoje)', async () => {
    const { w, svc } = setup();
    w.respond((path, opts) => (path === `/${IG}/media` && opts.method === 'POST' ? new MetaError('token', 190) : undefined));
    const e = await err(svc.publishInstagramPost(seedPost(w, { workspace_id: WS }).id));
    expect(e).toBeInstanceOf(MetaError);
    expect(e).not.toBeInstanceOf(PublishPermissionError);
  });
});
