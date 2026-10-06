import { stat } from 'node:fs/promises';
import { quoteIdent } from './columns';
import type { FileTarget } from './copy-files';
import { CONNECTION_SECRET_COLUMNS, Db, SchemaInfo, SKIP_TABLES, TEXTUAL_TYPES } from './db';
import { prepareRows } from './dedupe';
import { exportedFilePath, Manifest, readCheckedTable, tableKeys } from './export-reader';
import { STORAGE_LIKE } from './storage-links';

export type VerifyFindings = {
  countMismatches: { table: string; expected: number; actual: number }[];
  orphans: { table: string; column: string; count: number }[];
  missingFiles: string[];
  remainingLinks: { table: string; column: string; count: number }[];
  unreadableCredentials: number;
  /** Publicações da fila do Instagram ou posts automáticos vencidos ainda pendentes (sairiam sozinhos ao subir a API). */
  overduePending: number;
};
export type VerifyContext = { schema: SchemaInfo; manifest: Manifest; expectedUsers: number; exportDir: string; files: FileTarget; decrypt: (v: string) => string | null; now: Date };

/** Coluna → tabela-mãe usada para achar linhas órfãs (conta ou empresa que não veio). */
const PARENTS: Record<string, string> = { workspace_id: 'workspaces', user_id: 'users', owner_id: 'users', created_by: 'users' };

export async function collectFindings(db: Db, ctx: VerifyContext): Promise<VerifyFindings> {
  const f: VerifyFindings = { countMismatches: [], orphans: [], missingFiles: [], remainingLinks: [], unreadableCredentials: 0, overduePending: 0 };
  const all = new Set(ctx.schema.keys());
  const scalar = async (sql: string, ...args: unknown[]) => (await db.$queryRawUnsafe<{ n: number }[]>(sql, ...args))[0]?.n ?? 0;

  // 1) Contagens: o destino tem ao menos o que o manifesto diz (a API pode ter criado linhas depois da carga).
  for (const { schema, table, count } of tableKeys(ctx.manifest)) {
    if (schema !== 'public' || SKIP_TABLES.has(table) || !all.has(table)) continue;
    // A carga descarta duplicatas que o banco novo não aceita: a contagem esperada é a das linhas preparadas.
    const expected = table === 'crm_cadence_runs' ? prepareRows(table, readCheckedTable(ctx.exportDir, ctx.manifest, 'public', table)).rows.length : count;
    const actual = await scalar(`SELECT count(*)::int AS n FROM public.${quoteIdent(table, all)}`);
    if (actual < expected) f.countMismatches.push({ table, expected, actual });
  }
  const users = await scalar('SELECT count(*)::int AS n FROM public.users');
  if (users < ctx.expectedUsers) f.countMismatches.push({ table: 'users', expected: ctx.expectedUsers, actual: users });

  // 2) Órfãos e 3) links restantes, coluna a coluna.
  for (const [table, info] of ctx.schema) {
    const t = quoteIdent(table, all);
    const allowed = new Set(info.types.keys());
    for (const [col, parent] of Object.entries(PARENTS)) {
      if (table === 'users' || info.types.get(col) !== 'uuid') continue;
      const c = quoteIdent(col, allowed);
      const n = await scalar(`SELECT count(*)::int AS n FROM public.${t} x WHERE x.${c} IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.${parent} p WHERE p.id = x.${c})`);
      if (n) f.orphans.push({ table, column: col, count: n });
    }
    for (const [col, type] of info.types) {
      if (!TEXTUAL_TYPES.has(type)) continue;
      const c = quoteIdent(col, allowed);
      const n = await scalar(`SELECT count(*)::int AS n FROM public.${t} WHERE ${c}::text LIKE $1`, STORAGE_LIKE);
      if (n) f.remainingLinks.push({ table, column: col, count: n });
    }
  }

  // 4) Arquivos: cada objeto exportado está no UPLOADS_DIR com o mesmo tamanho.
  for (const o of ctx.manifest.objects) {
    const [src, dest] = await Promise.all([stat(exportedFilePath(ctx.exportDir, o.bucket_id, o.name)), stat(ctx.files.resolvePath(o.bucket_id, o.name)).catch(() => null)]);
    if (!dest || dest.size !== src.size) f.missingFiles.push(`${o.bucket_id}/${o.name}`);
  }

  // 5) Credenciais: toda não vazia decifra com a chave atual.
  const values = await db.$queryRawUnsafe<{ v: string | null }[]>(
    `SELECT value AS v FROM public.app_credentials UNION ALL ${CONNECTION_SECRET_COLUMNS.map((c) => `SELECT ${quoteIdent(c, new Set(CONNECTION_SECRET_COLUMNS))} AS v FROM public.mcp_connections`).join(' UNION ALL ')}`,
  );
  f.unreadableCredentials = values.filter((r) => r.v && r.v.trim() && ctx.decrypt(r.v) === null).length;

  // 6) Nada vencido pode estar esperando para sair sozinho quando a API subir.
  const nowIso = ctx.now.toISOString();
  f.overduePending =
    (await scalar(`SELECT count(*)::int AS n FROM public.publishing_jobs WHERE channel = 'instagram_organic' AND status IN ('pending','running') AND run_at < $1::timestamptz`, nowIso)) +
    (await scalar(`SELECT count(*)::int AS n FROM public.ig_posts WHERE automation IS NOT NULL AND status IN ('ready','approved','needs_review') AND scheduled_at < $1::timestamptz`, nowIso));
  return f;
}

export function verdict(f: VerifyFindings): { ok: boolean; lines: string[] } {
  const lines: string[] = [];
  for (const m of f.countMismatches) lines.push(`contagem menor que o manifesto em ${m.table}: ${m.actual} de ${m.expected}`);
  for (const o of f.orphans) lines.push(`linhas órfãs em ${o.table}.${o.column}: ${o.count}`);
  if (f.missingFiles.length) lines.push(`arquivos ausentes: ${f.missingFiles.length} — ${f.missingFiles.slice(0, 20).join(', ')}`);
  if (f.unreadableCredentials) lines.push(`credenciais ilegíveis: ${f.unreadableCredentials}`);
  if (f.overduePending) lines.push(`publicações/posts vencidos ainda pendentes: ${f.overduePending}`);
  const ok = !f.countMismatches.length && !f.orphans.length && !f.missingFiles.length && !f.unreadableCredentials && !f.overduePending;
  for (const l of f.remainingLinks) lines.push(`aviso: links do Lovable restantes em ${l.table}.${l.column}: ${l.count}`);
  lines.push(ok ? 'verificação: ok' : 'verificação: PENDÊNCIAS');
  return { ok, lines };
}
