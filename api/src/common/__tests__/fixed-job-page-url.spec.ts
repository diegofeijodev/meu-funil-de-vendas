import { validateEnv } from '../config/env.validation';

const base = { DATABASE_URL: 'x', JWT_SECRET: 'test-secret-with-16+chars' };
const prod = { NODE_ENV: 'production', CREDENTIALS_ENCRYPTION_KEY: 'k', UNSUBSCRIBE_SECRET: 'u', PUBLIC_URL: 'https://api.meufunil.app', APP_URL: 'https://meufunil.app' };

describe('FREELA_FIXED_JOB_PAGE_URL (página pública da vaga fixa, QR da arte CLT)', () => {
  it('ausente ou vazia (o compose manda "") = sem a página: a API sobe', () => {
    expect(validateEnv({ ...base, ...prod }).FREELA_FIXED_JOB_PAGE_URL).toBeUndefined();
    expect(validateEnv({ ...base, ...prod, FREELA_FIXED_JOB_PAGE_URL: '' }).FREELA_FIXED_JOB_PAGE_URL).toBeUndefined();
  });

  it('https com a barra no fim vale em produção', () => {
    expect(validateEnv({ ...base, ...prod, FREELA_FIXED_JOB_PAGE_URL: 'https://freelaservicos.com.br/vagas-fixas/' }).FREELA_FIXED_JOB_PAGE_URL).toBe(
      'https://freelaservicos.com.br/vagas-fixas/',
    );
  });

  it('sem a barra no fim, sem ser URL ou http em produção: a subida falha com o nome da variável', () => {
    expect(() => validateEnv({ ...base, ...prod, FREELA_FIXED_JOB_PAGE_URL: 'https://freelaservicos.com.br/vagas-fixas' })).toThrow(/FREELA_FIXED_JOB_PAGE_URL/);
    expect(() => validateEnv({ ...base, ...prod, FREELA_FIXED_JOB_PAGE_URL: 'vagas-fixas/' })).toThrow(/FREELA_FIXED_JOB_PAGE_URL/);
    expect(() => validateEnv({ ...base, ...prod, FREELA_FIXED_JOB_PAGE_URL: 'http://freelaservicos.com.br/vagas-fixas/' })).toThrow(/FREELA_FIXED_JOB_PAGE_URL/);
    expect(validateEnv({ ...base, NODE_ENV: 'test', FREELA_FIXED_JOB_PAGE_URL: 'http://127.0.0.1:3024/vagas-fixas/' }).FREELA_FIXED_JOB_PAGE_URL).toBe('http://127.0.0.1:3024/vagas-fixas/');
  });
});
