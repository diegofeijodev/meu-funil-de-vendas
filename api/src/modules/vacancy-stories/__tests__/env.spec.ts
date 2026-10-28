import { igWorld } from '../../instagram/__tests__/harness';
import { WS_A } from '../../media/__tests__/mem';
import { parseVacancyWorkspaces } from '../vacancy-env';

const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';

describe('vacancy-stories: fundação', () => {
  it('lista de uuids vira Set; vazia = nenhuma empresa', () => {
    expect(parseVacancyWorkspaces('', 'production')).toEqual(new Set());
    expect(parseVacancyWorkspaces(` ${A} , ${B} `, 'production')).toEqual(new Set([A, B]));
  });
  it('* só em development/test', () => {
    expect(parseVacancyWorkspaces('*', 'test')).toBe('*');
    expect(() => parseVacancyWorkspaces('*', 'production')).toThrow(/VACANCY_STORIES_WORKSPACE_IDS/);
  });
  it('id inválido derruba a subida', () => expect(() => parseVacancyWorkspaces('abc', 'production')).toThrow(/abc/));
  it('harness: createMany com skipDuplicates respeita a chave única', async () => {
    const w = igWorld();
    const row = { workspace_id: WS_A, source: 'freela', external_id: 'x', fingerprint: 'f', snapshot: {}, starts_at: new Date() };
    expect(await w.prisma.vacancy_stories.createMany({ data: [row, row], skipDuplicates: true })).toEqual({ count: 1 });
    expect(w.t.vacancy_stories!.rows).toHaveLength(1);
  });
});
