/**
 * Regras puras do Pinterest (Fatia 6). Sem API oficial de busca (beta, só parceiros), o "puxar automático" usa o que o Pinterest
 * publica para qualquer pessoa (testado em 29/10/2026):
 *  - Pin: oEmbed (`/oembed.json?url=`) → `thumbnail_url`; sem ele, `og:image` da página do Pin;
 *  - pasta/perfil público: RSS (`<pasta>.rss`, `<perfil>/feed.rss`) com os 25 Pins mais novos.
 * As imagens vêm de `i.pinimg.com` em 236x; o mesmo caminho em `736x` existe (`originals` dá 403).
 */

export type PinterestLink =
  | { kind: 'pin'; pinId: string; url: string }
  | { kind: 'shortlink'; url: string }
  | { kind: 'board' | 'profile'; url: string; rssUrl: string };

export type RssPin = { pinId: string; link: string; imageUrl: string; title: string };

const PINTEREST_HOST = /(^|\.)pinterest\.(com|com\.br|co\.uk|ca|com\.mx|pt|es|fr|de|it|com\.au)$/;
const ID = /^[A-Za-z0-9_-]{1,80}$/;
/** Primeiros segmentos que não são perfis (páginas do próprio Pinterest). */
const RESERVED = new Set(['pin', 'search', 'ideas', 'today', 'settings', 'business', 'explore', 'login', 'logout', 'resource', 'about', 'help', 'categories', 'topics', 'news_hub', 'oembed.json', 'videos', '_', 'shopping']);
const BASE = 'https://www.pinterest.com';

/** Host que o download pode buscar (o resto é recusado a cada salto de redirecionamento). */
export const isPinterestHost = (host: string) => PINTEREST_HOST.test(host.toLowerCase()) || host.toLowerCase() === 'pin.it';
export const isPinImageHost = (host: string) => host.toLowerCase() === 'i.pinimg.com';

export function parsePinterestLink(raw: string): PinterestLink | null {
  const text = (raw ?? '').trim();
  if (!text || /\s/.test(text)) return null;
  let u: URL;
  try {
    u = new URL(/^https?:\/\//i.test(text) ? text : `https://${text}`);
  } catch {
    return null;
  }
  const host = u.hostname.toLowerCase();
  let seg: string[];
  try {
    seg = u.pathname.split('/').filter(Boolean).map((s) => decodeURIComponent(s));
  } catch {
    return null; // % quebrado no caminho: não é um link de Pin/pasta.
  }
  if (host === 'pin.it') return seg.length === 1 && ID.test(seg[0]!) ? { kind: 'shortlink', url: `https://pin.it/${seg[0]}` } : null;
  if (!PINTEREST_HOST.test(host) || !seg.length) return null;
  if (seg[0] === 'pin') return seg[1] && ID.test(seg[1]) ? { kind: 'pin', pinId: seg[1], url: `${BASE}/pin/${seg[1]}/` } : null;
  const user = seg[0]!;
  if (RESERVED.has(user.toLowerCase()) || !ID.test(user)) return null;
  const board = seg[1];
  if (!board || board.startsWith('_') || board === 'pins' || !ID.test(board)) {
    return { kind: 'profile', url: `${BASE}/${user}/`, rssUrl: `${BASE}/${user}/feed.rss` };
  }
  return { kind: 'board', url: `${BASE}/${user}/${board}/`, rssUrl: `${BASE}/${user}/${board}.rss` };
}

/** `i.pinimg.com/<tamanho>/…` → `i.pinimg.com/736x/…`; qualquer outro host = null. */
export function pinImage736(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    const u = new URL(url);
    if (u.protocol !== 'https:' || !isPinImageHost(u.hostname)) return null;
    const parts = u.pathname.split('/').filter(Boolean);
    if (parts.length < 2) return null;
    return `https://i.pinimg.com/736x/${parts.slice(1).join('/')}`;
  } catch {
    return null;
  }
}

const decode = (s: string) =>
  s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&amp;/g, '&');
const pick = (block: string, tag: string) => {
  const m = new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`).exec(block);
  return m ? decode(m[1]!.replace(/^<!\[CDATA\[|\]\]>$/g, '')).trim() : '';
};

export function parseRss(xml: string): RssPin[] {
  if (!/<rss[\s>]/.test(xml ?? '')) return [];
  const out: RssPin[] = [];
  for (const m of xml.matchAll(/<item>([\s\S]*?)<\/item>/g)) {
    const block = m[1]!;
    const pinId = /\/pin\/([A-Za-z0-9_-]{1,80})/.exec(pick(block, 'link'))?.[1];
    const img = /<img[^>]+src="([^"]+)"/.exec(pick(block, 'description'))?.[1];
    const imageUrl = pinImage736(img);
    if (!pinId || !imageUrl || out.some((p) => p.pinId === pinId)) continue;
    out.push({ pinId, link: `${BASE}/pin/${pinId}/`, imageUrl, title: pick(block, 'title').slice(0, 200) });
  }
  return out;
}

export function pinImageFromOembed(json: unknown): string | null {
  const t = (json as { thumbnail_url?: unknown } | null)?.thumbnail_url;
  return typeof t === 'string' ? pinImage736(t) : null;
}

export function ogImage(html: string): string | null {
  const m =
    /<meta[^>]+property=["']og:image["'][^>]*content=["']([^"']+)["']/i.exec(html ?? '') ??
    /<meta[^>]+content=["']([^"']+)["'][^>]*property=["']og:image["']/i.exec(html ?? '');
  return m ? pinImage736(decode(m[1]!)) : null;
}

/** Título da pasta/perfil no RSS (o `<title>` do `<channel>`, antes do 1º item). */
export function rssTitle(xml: string): string | null {
  const head = (xml ?? '').split('<item>')[0] ?? '';
  const m = /<channel>[\s\S]*?<title>([\s\S]*?)<\/title>/.exec(head);
  const t = m ? decode(m[1]!).trim().slice(0, 200) : '';
  return t || null;
}
