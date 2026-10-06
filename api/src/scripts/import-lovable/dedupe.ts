/**
 * Duplicatas que o protótipo aceitava e o nosso banco não (índices únicos criados pelas nossas migrações). As migrações
 * corrigiram os dados que existiam na época; a carga num banco vazio aplica as mesmas regras, em memória, antes de inserir.
 */
type Row = Record<string, unknown>;

const time = (v: unknown) => {
  const t = Date.parse(String(v ?? ''));
  return Number.isNaN(t) ? 0 : t;
};
const pairKey = (r: Row, cols: string[]) => cols.map((c) => String(r[c] ?? '')).join('\u0000');

/** Uma matrícula por (cadência, lead) — regra da migração 20261002160000: fica a mais recente (created_at, depois id). */
export function dedupeCadenceRuns(rows: Row[]): { rows: Row[]; droppedIds: string[] } {
  const best = new Map<string, Row>();
  const newer = (a: Row, b: Row) => {
    const d = time(a['created_at']) - time(b['created_at']);
    return d !== 0 ? d > 0 : String(a['id']) > String(b['id']);
  };
  for (const r of rows) {
    const k = pairKey(r, ['cadence_id', 'lead_id']);
    const cur = best.get(k);
    if (!cur || newer(r, cur)) best.set(k, r);
  }
  const keep = new Set(best.values());
  return { rows: rows.filter((r) => keep.has(r)), droppedIds: rows.filter((r) => !keep.has(r)).map((r) => String(r['id'])) };
}

/** Versão única por pai — regra da migração 20261002150000: só nos pais com versão repetida, renumera 1..n na ordem (version, created_at, id). */
export function renumberVersions(rows: Row[], parent: string): { rows: Row[]; renumbered: number } {
  const groups = new Map<string, Row[]>();
  for (const r of rows) {
    if (r[parent] == null) continue; // pai nulo não colide no índice único
    const k = String(r[parent]);
    groups.set(k, [...(groups.get(k) ?? []), r]);
  }
  const changed = new Map<Row, Row>();
  for (const g of groups.values()) {
    if (new Set(g.map((r) => Number(r['version']))).size === g.length) continue;
    const sorted = [...g].sort(
      (a, b) => Number(a['version']) - Number(b['version']) || time(a['created_at']) - time(b['created_at']) || String(a['id']).localeCompare(String(b['id'])),
    );
    sorted.forEach((r, i) => {
      if (Number(r['version']) !== i + 1) changed.set(r, { ...r, version: i + 1 });
    });
  }
  return { rows: rows.map((r) => changed.get(r) ?? r), renumbered: changed.size };
}

/** Tabelas com (pai, versão) único no nosso schema. */
export const VERSIONED_TABLES: Record<string, string> = { campaign_strategies: 'campaign_id', copies: 'campaign_id', creative_versions: 'creative_id' };

/** Linhas que a carga grava para a tabela (o `--verify` espera a mesma contagem). */
export function prepareRows(table: string, rows: Row[]): { rows: Row[]; droppedIds: string[]; renumbered: number } {
  if (table === 'crm_cadence_runs') {
    const r = dedupeCadenceRuns(rows);
    return { rows: r.rows, droppedIds: r.droppedIds, renumbered: 0 };
  }
  const parent = VERSIONED_TABLES[table];
  if (parent) {
    const r = renumberVersions(rows, parent);
    return { rows: r.rows, droppedIds: [], renumbered: r.renumbered };
  }
  return { rows, droppedIds: [], renumbered: 0 };
}
