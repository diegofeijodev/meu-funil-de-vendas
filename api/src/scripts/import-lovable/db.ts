import { Prisma } from '@prisma/client';
import { TargetColumn } from './columns';

export type Db = Pick<Prisma.TransactionClient, '$queryRawUnsafe' | '$executeRawUnsafe'>;
export type TableInfo = { columns: TargetColumn[]; types: Map<string, string> };
export type SchemaInfo = Map<string, TableInfo>;

/** Os agendamentos do Lovable (pg_cron) não podem acionar /api/public/cron/* do sistema novo. */
export const SKIP_TABLES = new Set(['cron_tokens']);
/** Colunas onde pode haver link de arquivo (`data_type`, ou `udt_name` para arrays). */
export const TEXTUAL_TYPES = new Set(['text', 'character varying', 'json', 'jsonb', '_text', '_varchar']);
/** Só o que o nosso código decifra na leitura (`McpService`). */
export const CONNECTION_SECRET_COLUMNS = ['access_token', 'refresh_token', 'oauth_client_secret', 'oauth_code_verifier'];

export async function readSchema(db: Db): Promise<SchemaInfo> {
  const rows = await db.$queryRawUnsafe<
    { table_name: string; column_name: string; is_nullable: string; column_default: string | null; is_generated: string; is_identity: string; data_type: string; udt_name: string }[]
  >(
    `SELECT table_name, column_name, is_nullable, column_default, is_generated, is_identity, data_type, udt_name
       FROM information_schema.columns WHERE table_schema = 'public' ORDER BY table_name, ordinal_position`,
  );
  const out: SchemaInfo = new Map();
  for (const r of rows) {
    const t = out.get(r.table_name) ?? { columns: [], types: new Map<string, string>() };
    t.columns.push({ name: r.column_name, nullable: r.is_nullable === 'YES', hasDefault: r.column_default !== null || r.is_identity === 'YES', generated: r.is_generated === 'ALWAYS' });
    t.types.set(r.column_name, r.data_type === 'ARRAY' ? r.udt_name : r.data_type);
    out.set(r.table_name, t);
  }
  return out;
}

/** O banco conectado é o esperado (e, para carregar, está vazio). Devolve o nome. */
export async function assertTarget(db: Db, expectDb: string, mustBeEmpty: boolean): Promise<string> {
  const [row] = await db.$queryRawUnsafe<{ db: string }[]>('SELECT current_database() AS db');
  const name = row?.db ?? '';
  if (name !== expectDb) throw new Error(`O banco conectado é "${name}", não "${expectDb}" (--expect-db). Nada foi gravado.`);
  if (mustBeEmpty) {
    const [c] = await db.$queryRawUnsafe<{ u: number; w: number }[]>('SELECT (SELECT count(*) FROM public.users)::int AS u, (SELECT count(*) FROM public.workspaces)::int AS w');
    if ((c?.u ?? 0) || (c?.w ?? 0)) throw new Error(`O banco "${name}" não está vazio (${c?.u} usuário(s), ${c?.w} empresa(s)). A importação só roda em banco vazio. Nada foi gravado.`);
  }
  return name;
}
