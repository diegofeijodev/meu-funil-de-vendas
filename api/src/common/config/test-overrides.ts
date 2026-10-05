/**
 * Overrides de base de provedor só para teste (provedores falsos do smoke/browser-check): `AI_OPENAI_BASE_URL`,
 * `AI_GEMINI_BASE_URL`, `META_GRAPH_BASE_URL`, `RESEND_API_URL`, `CALCOM_API_URL`.
 * Lista de permissão: só valem com NODE_ENV=development|test. NODE_ENV ausente, `production` ou qualquer outro valor = ignorados.
 */
export function testOverridesAllowed(env: { NODE_ENV?: string } | undefined | null): boolean {
  const e = env?.NODE_ENV;
  return e === 'development' || e === 'test';
}

/** Devolve o override (sem barra final) se permitido; senão o padrão. */
export function overrideBase(env: { NODE_ENV?: string } | undefined | null, value: string | undefined, fallback: string): string {
  return (value && testOverridesAllowed(env) ? value : fallback).replace(/\/$/, '');
}
