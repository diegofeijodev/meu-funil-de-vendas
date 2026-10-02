import { bad } from './user-error';

/** Porta HTTP de TODA chamada externa deste domínio (provedores, Canva, MCP, download de mídia). Nos testes entra um fake. */
export type ExternalFetch = (url: string, init?: RequestInit) => Promise<Response>;
export const EXTERNAL_FETCH = Symbol('EXTERNAL_FETCH');

const PRIVATE_V4 = [/^0\./, /^10\./, /^127\./, /^169\.254\./, /^172\.(1[6-9]|2\d|3[01])\./, /^192\.168\./, /^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./];

/** Host que aponta para a própria máquina/rede interna (SSRF). Cobre `localhost`, IPs privados literais e `*.internal`/`*.local`. */
export function isInternalHost(hostname: string): boolean {
  const h = hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (h === 'localhost' || h.endsWith('.localhost') || h.endsWith('.internal') || h.endsWith('.local')) return true;
  if (/^\d+\.\d+\.\d+\.\d+$/.test(h)) return PRIVATE_V4.some((r) => r.test(h));
  if (h.includes(':')) return h === '::1' || h === '::' || /^f[cd]/.test(h) || /^fe[89ab]/.test(h) || h.startsWith('::ffff:');
  return false;
}

/** Só a própria máquina (dev): `localhost`, `127.x`, `::1`. Rede privada/link-local (metadados de nuvem) nunca. */
export function isLoopbackHost(hostname: string): boolean {
  const h = hostname.toLowerCase().replace(/^\[|\]$/g, '');
  return h === 'localhost' || h.endsWith('.localhost') || /^127\.\d+\.\d+\.\d+$/.test(h) || h === '::1';
}

/**
 * URL externa permitida: https (http só em dev apontando para máquina local) e nunca para a rede interna em produção.
 * Devolve a URL normalizada. `allowLocal` (NODE_ENV ≠ production) libera só o loopback da própria máquina.
 */
export function assertExternalUrl(raw: string, allowLocal: boolean, what = 'endereço'): string {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    throw bad(`${what[0]!.toUpperCase()}${what.slice(1)} inválido.`);
  }
  const internal = isInternalHost(u.hostname);
  const loopbackOk = allowLocal && isLoopbackHost(u.hostname);
  if (u.protocol !== 'https:' && !(loopbackOk && u.protocol === 'http:')) throw bad(`Use um endereço https:// (${what}).`);
  if (internal && !loopbackOk) throw bad(`O ${what} aponta para a rede interna e não é permitido.`);
  return u.toString();
}
