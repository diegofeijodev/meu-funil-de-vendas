import { existsSync, readFileSync, statSync } from 'node:fs';
import * as path from 'node:path';

export type ManifestObject = { bucket_id: string; name: string; size: number | null };
export type Manifest = { counts: Record<string, number>; buckets: { id: string; public: boolean }[]; objects: ManifestObject[] };

/** `manifest.json` gravado pelo `pull.mjs`. */
export function readManifest(dir: string): Manifest {
  const m = JSON.parse(readFileSync(path.join(dir, 'manifest.json'), 'utf8')) as Manifest;
  if (!m || typeof m.counts !== 'object' || !Array.isArray(m.objects)) throw new Error('manifest.json inválido');
  return m;
}

/** `public.<tabela>` / `auth.<tabela>` do manifesto, com a contagem esperada. */
export function tableKeys(m: Manifest): { schema: string; table: string; count: number }[] {
  return Object.entries(m.counts).map(([k, count]) => {
    const [schema, table] = k.split('.');
    return { schema: schema ?? '', table: table ?? '', count };
  });
}

export function readTable(dir: string, schema: string, table: string): Record<string, unknown>[] {
  const file = path.join(dir, 'tables', `${schema}.${table}.json`);
  if (!existsSync(file)) throw new Error(`exportação incompleta: falta tables/${schema}.${table}.json`);
  const rows = JSON.parse(readFileSync(file, 'utf8')) as unknown;
  if (!Array.isArray(rows)) throw new Error(`tables/${schema}.${table}.json não é uma lista`);
  return rows as Record<string, unknown>[];
}

/** Tabela exportada conferida contra o manifesto (linhas = contagem); serve para `public.*` e `auth.*`. */
export function readCheckedTable(dir: string, m: Manifest, schema: string, table: string): Record<string, unknown>[] {
  const key = `${schema}.${table}`;
  if (!(key in m.counts)) throw new Error(`${key} não está no manifesto da exportação. Refaça o pull.`);
  const rows = readTable(dir, schema, table);
  if (rows.length !== Number(m.counts[key])) throw new Error(`tables/${key}.json tem ${rows.length} linha(s); o manifesto diz ${m.counts[key]}. Refaça o pull.`);
  return rows;
}

/** Caminho do arquivo exportado, sem sair de `<dir>/storage/<bucket>`. */
export function exportedFilePath(dir: string, bucket: string, name: string): string {
  const base = path.resolve(dir, 'storage', bucket);
  const full = path.resolve(base, name);
  if (!name || !bucket || bucket.includes('/') || bucket.includes('..') || !full.startsWith(base + path.sep)) {
    throw new Error(`caminho de arquivo inválido na exportação: ${bucket}/${name}`);
  }
  return full;
}

/** Todo objeto do manifesto está num bucket conhecido e foi baixado com o tamanho certo. */
export function assertObjects(dir: string, m: Manifest, buckets: readonly string[]): void {
  const unknown = [...new Set(m.objects.map((o) => o.bucket_id).filter((b) => !buckets.includes(b)))];
  if (unknown.length) throw new Error(`buckets fora do previsto na exportação: ${unknown.join(', ')} (só ${buckets.join(', ')})`);
  const bad: string[] = [];
  for (const o of m.objects) {
    const p = exportedFilePath(dir, o.bucket_id, o.name);
    if (!existsSync(p) || (o.size != null && statSync(p).size !== Number(o.size))) bad.push(`${o.bucket_id}/${o.name}`);
  }
  if (bad.length) throw new Error(`${bad.length} arquivo(s) da exportação ausentes ou com tamanho diferente: ${bad.slice(0, 10).join(', ')}`);
}
