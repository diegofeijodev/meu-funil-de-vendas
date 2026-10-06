export type TargetColumn = { name: string; nullable: boolean; hasDefault: boolean; generated: boolean };
export type ColumnPlan = { insert: string[]; sourceOnly: string[]; missingRequired: string[] };

const IDENT = /^[a-z_][a-z0-9_]*$/;

/** Colunas do INSERT = chaves presentes nas linhas exportadas ∩ colunas não geradas do destino (na ordem do destino). */
export function planColumns(rows: Record<string, unknown>[], target: TargetColumn[]): ColumnPlan {
  const source = new Set<string>();
  for (const r of rows) for (const k of Object.keys(r)) source.add(k);
  const known = new Set(target.map((c) => c.name));
  return {
    insert: target.filter((c) => !c.generated && source.has(c.name)).map((c) => c.name),
    sourceOnly: [...source].filter((k) => !known.has(k)).sort(),
    missingRequired: rows.length
      ? target.filter((c) => !c.generated && !c.nullable && !c.hasDefault && !source.has(c.name)).map((c) => c.name)
      : [],
  };
}

/** Identificador SQL entre aspas — só se estiver na lista de permissão (vinda do information_schema do destino). */
export function quoteIdent(name: string, allowed: ReadonlySet<string>): string {
  if (!IDENT.test(name) || !allowed.has(name)) throw new Error(`identificador não permitido: ${JSON.stringify(name)}`);
  return `"${name}"`;
}
