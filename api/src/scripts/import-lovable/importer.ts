import { PrismaClient } from '@prisma/client';
import { AuthIdentity, AuthUser, mapUsers } from './auth-map';
import { planColumns, quoteIdent } from './columns';
import { copyExportedFiles, FileTarget } from './copy-files';
import { assertTarget, CONNECTION_SECRET_COLUMNS, Db, readSchema, SchemaInfo, SKIP_TABLES, TEXTUAL_TYPES } from './db';
import { assertObjects, Manifest, readManifest, readTable, tableKeys } from './export-reader';
import { decryptLegacy, isLegacyEncrypted, isOurEncrypted } from './legacy-crypto';
import { emptyReport, ImportReport, Mode } from './report';
import { LinkResolver, rewriteLinks, STORAGE_LIKE } from './storage-links';
import { collectFindings, verdict } from './verify';

export type ImportDeps = {
  prisma: PrismaClient;
  files: FileTarget & { signedUrl(bucket: string, key: string): string };
  vault: { encryptValue(v: string): string; decryptValue(v: string | null | undefined): string | null };
  legacySecret: string | null;
  buckets: readonly string[];
};
export type ImportOptions = { exportDir: string; expectDb: string; mode: Mode; skipCredentials: boolean; now: Date };

export const LEASE_COLUMNS = ['lease_until', 'lease_token', 'locked_until', 'locked_at'];
export const OVERDUE_POST_MESSAGE = 'O horário passou durante a mudança de sistema. Reagende pela tela.';
export const CADENCE_STOP_AFTER_MS = 3 * 86400e3;
export const CADENCE_STOP_REASON = 'Parada na mudança de sistema: o próximo passo venceu há mais de 3 dias.';
const USER_COLUMNS = ['id', 'email', 'password_hash', 'google_sub', 'token_version', 'created_at'];
const PENDING_STATUSES = ['queued', 'pending', 'scheduled', 'running', 'processing'];
const TIME_COLUMNS = ['scheduled_at', 'run_at', 'next_run_at', 'send_at'];

class DryRunRollback extends Error {}

const columnsOf = (schema: SchemaInfo, table: string) => new Set(schema.get(table)?.columns.map((c) => c.name) ?? []);

async function insertRows(db: Db, schema: SchemaInfo, table: string, columns: string[], rows: Record<string, unknown>[]) {
  if (!rows.length || !columns.length) return;
  const t = quoteIdent(table, new Set(schema.keys()));
  const allowed = columnsOf(schema, table);
  const list = columns.map((c) => quoteIdent(c, allowed)).join(', ');
  for (let i = 0; i < rows.length; i += 500) {
    const batch = rows.slice(i, i + 500).map((r) => Object.fromEntries(columns.map((c) => [c, r[c] ?? null])));
    await db.$executeRawUnsafe(
      `INSERT INTO public.${t} (${list}) OVERRIDING SYSTEM VALUE SELECT ${list} FROM jsonb_populate_recordset(NULL::public.${t}, $1::jsonb)`,
      JSON.stringify(batch),
    );
  }
}

async function loadTables(db: Db, schema: SchemaInfo, dir: string, manifest: Manifest, report: ImportReport): Promise<string[]> {
  const loaded: string[] = [];
  for (const { schema: s, table, count } of tableKeys(manifest)) {
    if (s !== 'public') continue;
    if (SKIP_TABLES.has(table)) {
      report.skippedTables.push(table);
      continue;
    }
    const info = schema.get(table);
    if (!info) throw new Error(`A tabela ${table} da exportação não existe no banco novo. Nada foi gravado.`);
    const rows = readTable(dir, 'public', table);
    if (rows.length !== count) throw new Error(`tables/public.${table}.json tem ${rows.length} linha(s); o manifesto diz ${count}. Refaça o pull.`);
    const plan = planColumns(rows, info.columns);
    if (plan.missingRequired.length) throw new Error(`${table}: coluna(s) obrigatória(s) sem valor na exportação: ${plan.missingRequired.join(', ')}. Nada foi gravado.`);
    await insertRows(db, schema, table, plan.insert, rows);
    report.tables.push({ table, rows: rows.length, sourceOnly: plan.sourceOnly });
    loaded.push(table);
  }
  return loaded;
}

async function rewriteAllLinks(db: Db, schema: SchemaInfo, tables: string[], resolve: LinkResolver, report: ImportReport) {
  const all = new Set(schema.keys());
  for (const table of tables) {
    const t = quoteIdent(table, all);
    const allowed = columnsOf(schema, table);
    for (const [col, type] of schema.get(table)!.types) {
      if (!TEXTUAL_TYPES.has(type)) continue;
      const c = quoteIdent(col, allowed);
      const isArray = type.startsWith('_');
      const rows = await db.$queryRawUnsafe<{ ctid: string; v: unknown }[]>(
        `SELECT ctid::text AS ctid, ${isArray ? `to_jsonb(${c})` : c} AS v FROM public.${t} WHERE ${c}::text LIKE $1`,
        STORAGE_LIKE,
      );
      for (const row of rows) {
        const r = rewriteLinks(row.v, resolve);
        report.links.missing.push(...r.missing);
        if (!r.changed) continue;
        report.links.changed += r.changed;
        const isJson = type === 'json' || type === 'jsonb';
        const value = isJson || isArray ? JSON.stringify(r.value) : (r.value as string);
        const set = isArray
          ? `ARRAY(SELECT jsonb_array_elements_text($1::jsonb))::${type === '_text' ? 'text[]' : 'varchar[]'}`
          : isJson ? `$1::${type}` : '$1';
        await db.$executeRawUnsafe(`UPDATE public.${t} SET ${c} = ${set} WHERE ctid = $2::tid`, value, row.ctid);
      }
    }
  }
}

function decryptOrFail(value: string, secret: string, what: string): string {
  try {
    return decryptLegacy(value, secret);
  } catch {
    throw new Error(`${what} não decifra com a LEGACY_CREDENTIALS_ENCRYPTION_KEY (chave errada?). Nada foi gravado.`);
  }
}

async function migrateCredentials(db: Db, schema: SchemaInfo, deps: ImportDeps, report: ImportReport) {
  const creds = await db.$queryRawUnsafe<{ id: string; value: string }[]>('SELECT id::text AS id, value FROM public.app_credentials');
  for (const c of creds) {
    if (!c.value.trim() || isOurEncrypted(c.value)) continue;
    let plain = c.value;
    if (isLegacyEncrypted(c.value)) {
      if (!deps.legacySecret) {
        await db.$executeRawUnsafe('DELETE FROM public.app_credentials WHERE id = $1::uuid', c.id);
        report.credentials.skippedLegacy++;
        continue;
      }
      plain = decryptOrFail(c.value, deps.legacySecret, `A credencial ${c.id}`);
      report.credentials.reencrypted++;
    } else {
      report.credentials.encryptedPlain++;
    }
    await db.$executeRawUnsafe('UPDATE public.app_credentials SET value = $1 WHERE id = $2::uuid', deps.vault.encryptValue(plain), c.id);
  }
  const allowed = columnsOf(schema, 'mcp_connections');
  for (const col of CONNECTION_SECRET_COLUMNS) {
    if (!allowed.has(col)) continue;
    const c = quoteIdent(col, allowed);
    const rows = await db.$queryRawUnsafe<{ id: string; v: string }[]>(
      `SELECT id::text AS id, ${c} AS v FROM public.mcp_connections WHERE ${c} IS NOT NULL AND btrim(${c}) <> '' AND ${c} NOT LIKE 'enc:v2:%'`,
    );
    for (const r of rows) {
      let plain = r.v;
      if (isLegacyEncrypted(r.v)) {
        if (!deps.legacySecret) {
          await db.$executeRawUnsafe(`UPDATE public.mcp_connections SET ${c} = NULL WHERE id = $1::uuid`, r.id);
          report.credentials.skippedLegacy++;
          continue;
        }
        plain = decryptOrFail(r.v, deps.legacySecret, `O token ${col} da conexão ${r.id}`);
      }
      await db.$executeRawUnsafe(`UPDATE public.mcp_connections SET ${c} = $1 WHERE id = $2::uuid`, deps.vault.encryptValue(plain), r.id);
      report.credentials.connectionsEncrypted++;
    }
  }
}

async function clearLeases(db: Db, schema: SchemaInfo, tables: string[]): Promise<number> {
  let n = 0;
  const all = new Set(schema.keys());
  for (const table of tables) {
    const info = schema.get(table)!;
    const allowed = columnsOf(schema, table);
    for (const col of LEASE_COLUMNS) {
      const meta = info.columns.find((x) => x.name === col);
      if (!meta || !meta.nullable) continue;
      const c = quoteIdent(col, allowed);
      n += await db.$executeRawUnsafe(`UPDATE public.${quoteIdent(table, all)} SET ${c} = NULL WHERE ${c} IS NOT NULL`);
    }
  }
  return n;
}

async function applyOverdue(db: Db, schema: SchemaInfo, tables: string[], now: Date, report: ImportReport) {
  const nowIso = now.toISOString();
  const jobs = await db.$queryRawUnsafe<{ ig_post_id: string | null }[]>(
    `UPDATE public.publishing_jobs SET status = 'cancelled', locked_at = NULL, log = $1
      WHERE status IN ('queued','processing') AND run_at < $2::timestamptz RETURNING ig_post_id::text AS ig_post_id`,
    OVERDUE_POST_MESSAGE,
    nowIso,
  );
  report.overdue.jobsCancelled = jobs.length;
  const ids = [...new Set(jobs.map((j) => j.ig_post_id).filter((x): x is string => !!x))];
  report.overdue.postsFailed = ids.length
    ? await db.$executeRawUnsafe(
        `UPDATE public.ig_posts SET status = 'failed', failure_kind = 'publish', last_error = $1
          WHERE id = ANY($2::uuid[]) AND status IN ('scheduled','publishing','approved','ready')`,
        OVERDUE_POST_MESSAGE,
        ids,
      )
    : 0;
  report.overdue.cadencesStopped = await db.$executeRawUnsafe(
    `UPDATE public.crm_cadence_runs SET status = 'stopped', stop_reason = $1 WHERE status = 'running' AND next_run_at < $2::timestamptz`,
    CADENCE_STOP_REASON,
    new Date(now.getTime() - CADENCE_STOP_AFTER_MS).toISOString(),
  );
  const [kept] = await db.$queryRawUnsafe<{ n: number }[]>(
    `SELECT count(*)::int AS n FROM public.crm_cadence_runs WHERE status = 'running' AND next_run_at < $1::timestamptz`,
    nowIso,
  );
  report.overdue.cadencesKept = kept?.n ?? 0;
  const all = new Set(schema.keys());
  for (const table of tables) {
    if (table === 'publishing_jobs' || table === 'crm_cadence_runs') continue;
    const allowed = columnsOf(schema, table);
    if (!allowed.has('status')) continue;
    for (const col of TIME_COLUMNS) {
      if (!allowed.has(col)) continue;
      const [row] = await db.$queryRawUnsafe<{ n: number }[]>(
        `SELECT count(*)::int AS n FROM public.${quoteIdent(table, all)} WHERE status::text = ANY($1::text[]) AND ${quoteIdent(col, allowed)} < $2::timestamptz`,
        PENDING_STATUSES,
        nowIso,
      );
      if (row?.n) report.overdue.otherPending.push({ table: `${table}.${col}`, count: row.n });
    }
  }
}

function legacyCount(dir: string): number {
  const values = [
    ...readTable(dir, 'public', 'app_credentials').map((r) => r['value']),
    ...readTable(dir, 'public', 'mcp_connections').flatMap((r) => CONNECTION_SECRET_COLUMNS.map((c) => r[c])),
  ];
  return values.filter((v) => typeof v === 'string' && isLegacyEncrypted(v)).length;
}

export async function runImport(opts: ImportOptions, deps: ImportDeps): Promise<{ report: ImportReport; verify?: { ok: boolean; lines: string[] } }> {
  const db: Db = deps.prisma;
  const manifest = readManifest(opts.exportDir);
  const usersPlan = () =>
    mapUsers(readTable(opts.exportDir, 'auth', 'users') as AuthUser[], readTable(opts.exportDir, 'auth', 'identities') as AuthIdentity[], opts.now);

  if (opts.mode === 'verify') {
    const database = await assertTarget(db, opts.expectDb, false);
    const schema = await readSchema(db);
    const findings = await collectFindings(db, {
      schema,
      manifest,
      expectedUsers: usersPlan().users.length,
      exportDir: opts.exportDir,
      files: deps.files,
      decrypt: (v) => deps.vault.decryptValue(v),
    });
    return { report: emptyReport('verify', database), verify: verdict(findings) };
  }

  if (opts.mode === 'only-files') {
    const database = await assertTarget(db, opts.expectDb, false);
    assertObjects(opts.exportDir, manifest, deps.buckets);
    const report = emptyReport('only-files', database);
    report.files = await copyExportedFiles(opts.exportDir, manifest, deps.files);
    return { report };
  }

  const database = await assertTarget(db, opts.expectDb, true);
  assertObjects(opts.exportDir, manifest, deps.buckets);
  for (const o of manifest.objects) deps.files.resolvePath(o.bucket_id, o.name); // chave inválida aborta antes de gravar
  const plan = usersPlan(); // e-mail repetido aborta aqui
  const legacy = legacyCount(opts.exportDir);
  if (legacy && !deps.legacySecret && !opts.skipCredentials) {
    throw new Error(`Há ${legacy} credencial(is) cifrada(s) pelo Lovable (enc:v1). Defina LEGACY_CREDENTIALS_ENCRYPTION_KEY no .env ou rode com --skip-credentials. Nada foi gravado.`);
  }
  const schema = await readSchema(db);
  const report = emptyReport(opts.mode, database);
  report.users = { imported: plan.users.length, skipped: plan.skipped, noLogin: plan.noLogin, nonBcrypt: plan.nonBcrypt };
  const exported = new Set(manifest.objects.map((o) => `${o.bucket_id}/${o.name}`));
  const resolve: LinkResolver = (bucket, key) => (exported.has(`${bucket}/${key}`) ? deps.files.signedUrl(bucket, key) : null);

  try {
    await deps.prisma.$transaction(
      async (tx) => {
        await tx.$executeRawUnsafe('SET LOCAL session_replication_role = replica');
        const loaded = await loadTables(tx, schema, opts.exportDir, manifest, report);
        await insertRows(tx, schema, 'users', USER_COLUMNS, plan.users as unknown as Record<string, unknown>[]);
        await rewriteAllLinks(tx, schema, loaded, resolve, report);
        await migrateCredentials(tx, schema, deps, report);
        report.leasesCleared = await clearLeases(tx, schema, loaded);
        await applyOverdue(tx, schema, loaded, opts.now, report);
        if (opts.mode === 'dry-run') throw new DryRunRollback();
      },
      { timeout: 60 * 60e3, maxWait: 60e3 },
    );
  } catch (e) {
    if (!(e instanceof DryRunRollback)) throw e;
  }
  if (opts.mode === 'import') report.files = await copyExportedFiles(opts.exportDir, manifest, deps.files);
  return { report };
}
