import { isIP } from 'node:net';
import { promises as dns } from 'node:dns';
import { Agent, fetch as undiciFetch } from 'undici';
import { bad } from './user-error';

/** Porta HTTP de TODA chamada externa deste domínio (provedores, Canva, MCP, download de mídia). Nos testes entra um fake. */
export type ExternalFetch = (url: string, init?: RequestInit) => Promise<Response>;
export const EXTERNAL_FETCH = Symbol('EXTERNAL_FETCH');


/** Host em minúsculas, sem colchetes de IPv6 e sem o ponto final (`localhost.` = `localhost`). */
export const normalizeHost = (hostname: string): string => hostname.toLowerCase().replace(/^\[|\]$/g, '').replace(/\.+$/, '');

/** IPv6 → 8 grupos de 16 bits (aceita `::`, e o final em IPv4 pontuado). null se inválido. */
function parseV6(ip: string): number[] | null {
  let s = ip.toLowerCase().split('%')[0]!;
  const v4 = /(\d+\.\d+\.\d+\.\d+)$/.exec(s);
  if (v4) {
    const o = v4[1]!.split('.').map(Number);
    if (o.some((n) => n > 255)) return null;
    s = s.slice(0, -v4[1]!.length) + ((o[0]! << 8) | o[1]!).toString(16) + ':' + ((o[2]! << 8) | o[3]!).toString(16);
  }
  const halves = s.split('::');
  if (halves.length > 2) return null;
  const head = halves[0] ? halves[0].split(':') : [];
  const tail = halves.length === 2 && halves[1] ? halves[1].split(':') : [];
  const fill = halves.length === 2 ? 8 - head.length - tail.length : 0;
  if (fill < 0 || (halves.length === 1 && head.length !== 8)) return null;
  const groups = [...head, ...Array(fill).fill('0'), ...tail].map((g) => parseInt(g, 16));
  return groups.length === 8 && groups.every((g) => Number.isInteger(g) && g >= 0 && g <= 0xffff) ? groups : null;
}

function privateV4(o: number[]): boolean {
  const [a, b, c] = o as [number, number, number];
  return (
    a === 0 || a === 10 || a === 127 || a >= 224 || // "this" net, privada, loopback, multicast/reservado
    (a === 100 && b >= 64 && b <= 127) || // CGNAT
    (a === 169 && b === 254) || // link-local (metadados de nuvem)
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 192 && b === 0 && c === 0) ||
    (a === 198 && (b === 18 || b === 19))
  );
}

/** Endereço IP (v4 ou v6, inclusive IPv4 embutido em IPv6) de rede privada/loopback/link-local/única-local/metadados. */
export function isPrivateIp(ip: string): boolean {
  const h = normalizeHost(ip);
  const kind = isIP(h);
  if (kind === 4) return privateV4(h.split('.').map(Number));
  if (kind !== 6) return false;
  const g = parseV6(h);
  if (!g) return true; // não entendeu: trata como interno
  if (g.every((x) => x === 0)) return true; // ::
  if (g.slice(0, 7).every((x) => x === 0) && g[7] === 1) return true; // ::1
  if ((g[0]! & 0xfe00) === 0xfc00) return true; // fc00::/7
  if ((g[0]! & 0xffc0) === 0xfe80) return true; // fe80::/10
  if ((g[0]! & 0xff00) === 0xff00) return true; // multicast
  const embedded = (hi: number, lo: number) => privateV4([hi >> 8, hi & 255, lo >> 8, lo & 255]);
  if (g.slice(0, 5).every((x) => x === 0) && (g[5] === 0xffff || g[5] === 0)) return embedded(g[6]!, g[7]!); // ::ffff:a.b.c.d e ::a.b.c.d
  if (g[0] === 0x64 && g[1] === 0xff9b) return embedded(g[6]!, g[7]!); // NAT64
  if (g[0] === 0x2002) return embedded(g[1]!, g[2]!); // 6to4
  return false;
}

/** Host que aponta para a própria máquina/rede interna (SSRF). Cobre `localhost` (com ou sem ponto final), IPs privados literais e `*.internal`/`*.local`. */
export function isInternalHost(hostname: string): boolean {
  const h = normalizeHost(hostname);
  if (h === 'localhost' || h.endsWith('.localhost') || h.endsWith('.internal') || h.endsWith('.local')) return true;
  return isIP(h) !== 0 && isPrivateIp(h);
}

/** Só a própria máquina (dev): `localhost`, `127.x`, `::1`. Rede privada/link-local (metadados de nuvem) nunca. */
export function isLoopbackHost(hostname: string): boolean {
  const h = normalizeHost(hostname);
  return h === 'localhost' || h.endsWith('.localhost') || /^127\.\d+\.\d+\.\d+$/.test(h) || h === '::1';
}

export type Resolver = (hostname: string) => Promise<{ address: string; family: number }[]>;
const systemResolver: Resolver = (h) => dns.lookup(h, { all: true, verbatim: true });

/**
 * `lookup` do socket: resolve o nome, recusa se QUALQUER endereço resolvido for interno e devolve o endereço JÁ verificado —
 * a conexão vai para ele (não há segunda resolução, então DNS rebinding não escapa). Loopback só em dev e só para host loopback.
 */
export function createGuardedLookup(allowLocal: boolean, resolver: Resolver = systemResolver) {
  return (hostname: string, options: { all?: boolean }, cb: (err: Error | null, address?: unknown, family?: number) => void): void => {
    const host = normalizeHost(hostname);
    const fail = () => cb(Object.assign(new Error(`O endereço aponta para a rede interna e não é permitido (${host}).`), { code: 'EBLOCKED' }));
    const literal = isIP(host) !== 0;
    (literal ? Promise.resolve([{ address: host, family: isIP(host) }]) : resolver(host))
      .then((list) => {
        // Em dev, host loopback vale — mas só se TODOS os endereços resolvidos forem de fato loopback.
        const okLoop = allowLocal && isLoopbackHost(host) && list.every((a) => isLoopbackHost(a.address));
        if (!list.length || (!okLoop && list.some((a) => isPrivateIp(a.address)))) return fail();
        if (options?.all) return cb(null, list);
        cb(null, list[0]!.address, list[0]!.family);
      })
      .catch((e: Error) => cb(e));
  };
}

/** Fetch de saída com o guarda de conexão (DNS verificado e fixado). Quem segue redirecionamentos é o chamador (`redirect: 'manual'`). */
export function createGuardedFetch(allowLocal: boolean, resolver?: Resolver): ExternalFetch {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const agent = new Agent({ connect: { lookup: createGuardedLookup(allowLocal, resolver) as any } });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return ((url: string, init?: RequestInit) => undiciFetch(url, { ...(init as any), dispatcher: agent })) as unknown as ExternalFetch;
}

/**
 * URL externa permitida: https (http só em dev apontando para máquina local) e nunca para a rede interna em produção.
 * Devolve a URL normalizada. `allowLocal` (NODE_ENV = development|test) libera só o loopback da própria máquina.
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
