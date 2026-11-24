import { uuid } from '../../instagram/__tests__/harness';
import { CLT_FEED_DOWN, FeedDownError } from '../vacancy-feed';
import { fixedJob, vacancyWorld } from './world';


describe('VacancyFeedClient — vagas fixas (M12)', () => {
  it('recentClt: uma chamada com limit=100, envelope { data }; item fora do formato é descartado sem derrubar os outros', async () => {
    const w = vacancyWorld();
    const ok = fixedJob();
    w.feed.state.clt = [ok, { ...fixedJob(), role: '' }, { ...fixedJob(), publishedAt: 'ontem' }, { id: 'x' } as never];
    const list = await w.feedClient.recentClt();
    expect(list.map((x) => x.id)).toEqual([ok.id]);
    expect(w.feed.state.urls).toEqual(['http://freela.test/v1/fixed-jobs/public/recent?limit=100']);
    w.cleanup();
  });

  it('campos opcionais ausentes viram null/[]; horário e benefício fora do formato saem só eles', async () => {
    const w = vacancyWorld();
    const raw = { ...fixedJob(), category: undefined, companyName: undefined, city: undefined, uf: undefined, salary: undefined, workSchedule: undefined,
      description: undefined, expiresAt: undefined, workScheduleSlots: [{ day: 'Segunda', start: '08:00', end: '17:00' }, { day: 'Terça', start: '8h', end: '17:00' }],
      benefits: ['VT', '', 7] } as never;
    w.feed.state.clt = [raw];
    const [v] = await w.feedClient.recentClt();
    expect(v).toMatchObject({ category: null, companyName: null, city: null, uf: null, salary: null, workSchedule: null, description: null, expiresAt: null });
    expect(v!.workScheduleSlots).toEqual([{ day: 'Segunda', start: '08:00', end: '17:00' }]);
    expect(v!.benefits).toEqual(['VT']);
    w.cleanup();
  });

  it('cltById: aberta → a vaga; 404 (fechada, vencida, inexistente) → null; formato inválido → null', async () => {
    const w = vacancyWorld();
    const v = fixedJob();
    const closed = fixedJob();
    w.feed.state.clt = [v, closed, { ...fixedJob(), id: 'ruim', salary: { minInCents: -1, maxInCents: 2 } }];
    w.feed.state.cltClosed.add(closed.id);
    expect((await w.feedClient.cltById(v.id))?.id).toBe(v.id);
    expect(await w.feedClient.cltById(closed.id)).toBeNull();
    expect(await w.feedClient.cltById(uuid())).toBeNull();
    expect(await w.feedClient.cltById('ruim')).toBeNull();
    expect(w.feed.state.urls[0]).toBe(`http://freela.test/v1/fixed-jobs/public/${v.id}`);
    w.cleanup();
  });

  it('fora do ar (503, rede ou corpo ilegível) → FeedDownError com o texto das vagas fixas; as diárias seguem', async () => {
    const w = vacancyWorld();
    w.feed.state.cltDown = true;
    w.feed.state.vacancies = [];
    await expect(w.feedClient.recentClt()).rejects.toThrow(new FeedDownError(CLT_FEED_DOWN));
    await expect(w.feedClient.cltById(uuid())).rejects.toBeInstanceOf(FeedDownError);
    await expect(w.feedClient.recent()).resolves.toEqual([]);
    const net = vacancyWorld();
    jest.spyOn(net.feedClient as never, 'get' as never).mockRejectedValueOnce(new FeedDownError() as never);
    await expect(net.feedClient.recentClt()).rejects.toThrow(CLT_FEED_DOWN);
    w.cleanup();
    net.cleanup();
  });
});
