import { RateLimited } from '../ig-store.service';
import { quotaFrom } from '../publish-block';
import { PublishingService } from '../publishing.service';
import { useVirtualClock } from '../../../common/__tests__/virtual-clock';
import { VacancySchedulerService } from '../../vacancy-stories/vacancy-scheduler.service';
import { WS_B } from '../../media/__tests__/mem';
import { igWorld, seedPost, uuid } from './harness';

const WS = igWorld().WS_A;
const IG = 'ig-1';
const limit = (total: unknown, duration: unknown = 86400, usage = 0) => ({ data: [{ config: { quota_total: total, quota_duration: duration }, quota_usage: usage }] });

describe('quotaFrom (P1/V4)', () => {
  it('50 em 86400 s vale; ausente, outra janela, fora de 1–1000 ou não inteiro → null (fica o 25)', () => {
    expect(quotaFrom(limit(50))).toBe(50);
    expect(quotaFrom(limit(1))).toBe(1);
    expect(quotaFrom(limit(1000))).toBe(1000);
    expect(quotaFrom({ data: [{ quota_usage: 3 }] })).toBeNull();
    expect(quotaFrom(limit(50, 3600))).toBeNull();
    expect(quotaFrom(limit(5000))).toBeNull();
    expect(quotaFrom(limit(0))).toBeNull();
    expect(quotaFrom(limit(50.5))).toBeNull();
    expect(quotaFrom(limit('50'))).toBeNull();
    expect(quotaFrom(null)).toBeNull();
  });
});

function setup(resp: unknown) {
  const w = igWorld();
  w.t['instagram_accounts']!.rows.push({ id: uuid(), workspace_id: WS, ig_user_id: IG, status: 'connected', publish_quota_total: null });
  w.t['instagram_accounts']!.rows.push({ id: uuid(), workspace_id: WS_B, ig_user_id: 'ig-b', status: 'connected', publish_quota_total: null });
  w.respond((path, opts) => {
    if (path === `/${IG}/content_publishing_limit`) return resp;
    if (path === `/${IG}/media` && opts.method === 'POST') return { id: 'c1' };
    if (path === '/c1') return { status_code: 'FINISHED' };
    if (path === `/${IG}/media_publish`) return { id: 'm1' };
    return undefined;
  });
  const svc = new PublishingService(w.store, w.graph, (async () => new Response(null, { status: 200 })) as any);
  useVirtualClock(svc);
  const acc = (ws = WS) => w.t['instagram_accounts']!.rows.find((r) => r.workspace_id === ws)!;
  return { w, svc, acc };
}
const err = async (p: Promise<unknown>) => p.then(() => null, (e) => e);

describe('publicação usa o limite que a Meta informa', () => {
  it('pede config + quota_usage; 50 informado: 30 usados publica e o limite fica gravado (só nesta empresa)', async () => {
    const { w, svc, acc } = setup(limit(50, 86400, 30));
    expect(await svc.publishInstagramPost(seedPost(w, { workspace_id: WS }).id)).toMatchObject({ ok: true });
    expect(w.calls.find((c) => c.path === `/${IG}/content_publishing_limit`)!.opts.params).toEqual({ fields: 'config,quota_usage' });
    expect(acc().publish_quota_total).toBe(50);
    expect(acc().publish_quota_checked_at).toBeInstanceOf(Date);
    expect(acc(WS_B).publish_quota_total).toBeNull();
  });

  it('sem o número da Meta vale 25: 30 usados = RateLimited com o número', async () => {
    const { w, svc } = setup({ data: [{ quota_usage: 30 }] });
    const e = await err(svc.publishInstagramPost(seedPost(w, { workspace_id: WS }).id));
    expect(e).toBeInstanceOf(RateLimited);
    expect(e.message).toBe('Limite de 25 publicações em 24h atingido.');
  });

  it('contagem local usa o limite gravado', async () => {
    const { w, svc, acc } = setup(limit(3, 86400, 0));
    acc().publish_quota_total = 3;
    for (let i = 0; i < 3; i++) seedPost(w, { workspace_id: WS, status: 'published', published_at: new Date() });
    const e = await err(svc.publishInstagramPost(seedPost(w, { workspace_id: WS }).id));
    expect(e).toBeInstanceOf(RateLimited);
    expect(e.message).toBe('Limite de 3 publicações em 24h atingido.');
  });
});

describe('agenda das vagas: o espaço da Meta usa o limite informado (igRoom)', () => {
  it('50 → room 45 (folga de 5); sem número → 20', async () => {
    const { w, acc } = setup(limit(50));
    const sched = new VacancySchedulerService(w.prisma, w.store, {} as any, {} as any, { hooks: {} } as any, {} as any);
    acc().publish_quota_total = 50;
    expect((await sched.igRoom(WS, new Date())).room).toBe(45);
    expect((await sched.igRoom(WS_B, new Date())).room).toBe(20);
  });
});
