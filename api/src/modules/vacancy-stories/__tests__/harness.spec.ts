import { igWorld } from '../../instagram/__tests__/harness';
import { WS_A } from '../../media/__tests__/mem';

// A regra de `VACANCY_STORIES_WORKSPACE_IDS` mora em `common/config/vacancy-workspaces.ts` (teste em `common/__tests__`).
describe('vacancy-stories: harness', () => {
  it('harness: createMany com skipDuplicates respeita a chave única', async () => {
    const w = igWorld();
    const row = { workspace_id: WS_A, source: 'freela', external_id: 'x', fingerprint: 'f', snapshot: {}, starts_at: new Date() };
    expect(await w.prisma.vacancy_stories.createMany({ data: [row, row], skipDuplicates: true })).toEqual({ count: 1 });
    expect(w.t.vacancy_stories!.rows).toHaveLength(1);
  });
});
