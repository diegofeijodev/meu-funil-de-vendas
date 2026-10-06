/** Linhas candidatas no SQL (`coluna::text LIKE`). */
export const STORAGE_LIKE = '%.supabase.co/storage/v1/%';

/**
 * URL do Storage do Lovable/Supabase: `https://<ref>.supabase.co/storage/v1/object/(sign|public|authenticated)/<bucket>/<caminho>[?query]`.
 * O caminho para em `?`, `#`, aspas, espaço, `<`, `>`, `\` e `)` (link em markdown); um caminho cortado errado não acha arquivo e fica listado.
 */
const STORAGE_URL = /https:\/\/[a-z0-9]+\.supabase\.co\/storage\/v1\/object\/(?:sign|public|authenticated)\/([A-Za-z0-9_-]+)\/([^?#"'\s<>\\)]+)(?:\?[^#"'\s<>\\)]*)?/g;

export type LinkResolver = (bucket: string, key: string) => string | null;
export type MissingFile = { bucket: string; key: string };

function decodeKey(raw: string): string | null {
  try {
    return raw.split('/').map((s) => decodeURIComponent(s)).join('/');
  } catch {
    return null;
  }
}

/** Troca toda URL do Storage do Lovable pela nossa (via `resolve`); o que não resolve fica como está e é listado. Percorre JSON aninhado. */
export function rewriteLinks<T>(value: T, resolve: LinkResolver): { value: T; changed: number; missing: MissingFile[] } {
  let changed = 0;
  const missing: MissingFile[] = [];
  const inString = (s: string) =>
    s.replace(STORAGE_URL, (full: string, bucket: string, rawKey: string) => {
      const key = decodeKey(rawKey);
      const url = key ? resolve(bucket, key) : null;
      if (!url) {
        missing.push({ bucket, key: key ?? rawKey });
        return full;
      }
      changed++;
      return url;
    });
  const walk = (v: unknown): unknown => {
    if (typeof v === 'string') return inString(v);
    if (Array.isArray(v)) return v.map(walk);
    if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v as Record<string, unknown>).map(([k, x]) => [k, walk(x)]));
    return v;
  };
  return { value: walk(value) as T, changed, missing };
}
