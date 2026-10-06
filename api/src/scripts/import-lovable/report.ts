import { MissingFile } from './storage-links';

export type Mode = 'import' | 'dry-run' | 'verify' | 'only-files';

/** Só contagens, ids, nomes e caminhos — nunca valores de credencial, token, senha ou e-mail. */
export type ImportReport = {
  mode: Mode;
  database: string;
  tables: { table: string; rows: number; sourceOnly: string[] }[];
  skippedTables: string[];
  users: { imported: number; skipped: { id: string; reason: string }[]; noLogin: string[]; nonBcrypt: string[] };
  links: { changed: number; missing: MissingFile[] };
  credentials: { reencrypted: number; encryptedPlain: number; skippedLegacy: number; connectionsEncrypted: number; blank: number };
  dedupe: { cadenceRunsDropped: number; versionsRenumbered: number };
  overdue: { jobsCancelled: number; postsFailed: number; cadencesKept: number; cadencesStopped: number; otherPending: { table: string; count: number }[] };
  leasesCleared: number;
  files: { copied: number; skipped: number } | null;
};

export function emptyReport(mode: Mode, database: string): ImportReport {
  return {
    mode,
    database,
    tables: [],
    skippedTables: [],
    users: { imported: 0, skipped: [], noLogin: [], nonBcrypt: [] },
    links: { changed: 0, missing: [] },
    credentials: { reencrypted: 0, encryptedPlain: 0, skippedLegacy: 0, connectionsEncrypted: 0, blank: 0 },
    dedupe: { cadenceRunsDropped: 0, versionsRenumbered: 0 },
    overdue: { jobsCancelled: 0, postsFailed: 0, cadencesKept: 0, cadencesStopped: 0, otherPending: [] },
    leasesCleared: 0,
    files: null,
  };
}

const list = (xs: string[], max = 20) => (xs.length <= max ? xs.join(', ') : `${xs.slice(0, max).join(', ')} (+${xs.length - max})`);

export function formatReport(r: ImportReport): string[] {
  const out = [`modo: ${r.mode} · banco: ${r.database}`];
  out.push(`tabelas carregadas: ${r.tables.length} (${r.tables.reduce((n, t) => n + t.rows, 0)} linhas)`);
  for (const t of r.tables) if (t.sourceOnly.length) out.push(`  dado não migrado em ${t.table}: ${list(t.sourceOnly)}`);
  if (r.skippedTables.length) out.push(`tabelas puladas de propósito: ${list(r.skippedTables)}`);
  const u = r.users;
  out.push(`contas: ${u.imported} importadas; ${u.skipped.length} de fora${u.skipped.length ? ` (${list(u.skipped.map((s) => `${s.id}:${s.reason}`))})` : ''}`);
  if (u.noLogin.length) out.push(`  sem senha nem Google (só entram com login Google configurado): ${u.noLogin.length} — ${list(u.noLogin)}`);
  if (u.nonBcrypt.length) out.push(`  hash de senha fora do bcrypt: ${u.nonBcrypt.length} — ${list(u.nonBcrypt)}`);
  out.push(`links do Lovable reescritos: ${r.links.changed}; mantidos (arquivo não exportado): ${r.links.missing.length}`);
  if (r.links.missing.length) out.push(`  ${list(r.links.missing.map((m) => `${m.bucket}/${m.key}`))}`);
  const c = r.credentials;
  out.push(`credenciais: ${c.reencrypted} recifradas (enc:v1→enc:v2), ${c.encryptedPlain} cifradas (texto puro), ${c.blank} vazias, ${c.skippedLegacy} não importadas; tokens de conexões cifrados: ${c.connectionsEncrypted}`);
  const d = r.dedupe;
  if (d.cadenceRunsDropped || d.versionsRenumbered) {
    out.push(`duplicatas que o banco novo não aceita: ${d.cadenceRunsDropped} matrícula(s) de cadência descartada(s) (fica a mais recente), ${d.versionsRenumbered} versão(ões) renumerada(s)`);
  }
  out.push(`travas zeradas: ${r.leasesCleared}`);
  const o = r.overdue;
  out.push(`vencidos: ${o.jobsCancelled} publicação(ões) cancelada(s), ${o.postsFailed} post(s) com falha; cadências: ${o.cadencesKept} seguem, ${o.cadencesStopped} paradas (>3 dias)`);
  for (const p of o.otherPending) out.push(`  pendente vencido em ${p.table}: ${p.count} (decidir antes da virada)`);
  out.push(r.files ? `arquivos: ${r.files.copied} copiados, ${r.files.skipped} já estavam` : `arquivos: não copiados (${r.mode})`);
  return out;
}
