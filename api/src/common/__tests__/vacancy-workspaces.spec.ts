import { validateEnv } from '../config/env.validation';
import { parseVacancyWorkspaces } from '../config/vacancy-workspaces';

const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';
const base = { DATABASE_URL: 'x', JWT_SECRET: 'test-secret-with-16+chars' };
const prod = { NODE_ENV: 'production', CREDENTIALS_ENCRYPTION_KEY: 'k', UNSUBSCRIBE_SECRET: 'u', PUBLIC_URL: 'https://api.meufunil.app', APP_URL: 'https://meufunil.app' };

describe('VACANCY_STORIES_WORKSPACE_IDS (stories das vagas)', () => {
  it('lista de uuids vira Set; vazia = nenhuma empresa', () => {
    expect(parseVacancyWorkspaces('', 'production')).toEqual(new Set());
    expect(parseVacancyWorkspaces(` ${A} , ${B} `, 'production')).toEqual(new Set([A, B]));
  });
  it('* só em development/test', () => {
    expect(parseVacancyWorkspaces('*', 'test')).toBe('*');
    expect(() => parseVacancyWorkspaces('*', 'production')).toThrow(/VACANCY_STORIES_WORKSPACE_IDS/);
  });
  it('id inválido derruba a subida', () => expect(() => parseVacancyWorkspaces('abc', 'production')).toThrow(/abc/));
  it('validateEnv usa a mesma regra (o boot de produção com "*" ou id inválido falha)', () => {
    expect(() => validateEnv({ ...base, ...prod, VACANCY_STORIES_WORKSPACE_IDS: '*' })).toThrow(/VACANCY_STORIES_WORKSPACE_IDS/);
    expect(() => validateEnv({ ...base, ...prod, VACANCY_STORIES_WORKSPACE_IDS: 'abc' })).toThrow(/VACANCY_STORIES_WORKSPACE_IDS/);
    expect(() => validateEnv({ ...base, ...prod, VACANCY_STORIES_WORKSPACE_IDS: `${A},${B}` })).not.toThrow();
    expect(() => validateEnv({ ...base, NODE_ENV: 'test', VACANCY_STORIES_WORKSPACE_IDS: '*' })).not.toThrow();
  });
});
