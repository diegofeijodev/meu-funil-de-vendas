const T = require('./spec.js');
const fs = require('fs');
const out = [];
const raw = [];

const q = (s) => JSON.stringify(s);
const SORT = (c) => { const [n, d] = c.split(' '); return d === 'desc' ? `${n}(sort: Desc)` : n; };
const COLN = (c) => c.split(' ')[0];

// 1. parse columns
for (const tb of Object.values(T)) {
  tb.parsed = [];
  for (let spec of tb.cols) {
    let col = {};
    if (spec === 'id') spec = 'id u pk = gen_random_uuid()';
    if (spec === 'ws') spec = 'workspace_id u >workspaces cascade';
    if (spec === 'created') spec = 'created_at tz = now';
    if (spec === 'updated') { spec = 'updated_at tz = now'; col.updatedAt = true; }
    if (spec === 'updated_t') { spec = 'updated_at tz = now'; col.updatedAt = true; col.trigger = true; }
    const eq = spec.indexOf(' = ');
    let def = null;
    if (eq >= 0) { def = spec.slice(eq + 3).trim(); spec = spec.slice(0, eq); }
    const toks = spec.trim().split(/\s+/);
    col.name = toks[0]; col.type = toks[1]; col.def = def;
    col.nullable = false;
    for (const x of toks.slice(2)) {
      if (x === '?') col.nullable = true;
      else if (x === 'pk') col.pk = true;
      else if (x.startsWith('>')) col.fk = { table: x.slice(1) };
      else if (x === 'cascade' || x === 'setnull') col.fk.action = x;
      else throw new Error('bad token ' + x + ' in ' + tb.name);
    }
    if (col.fk && !col.fk.action) col.fk.action = 'cascade';
    tb.parsed.push(col);
    if (col.updatedAt && col.trigger) { tb.touch = true; }
  }
}

const baseType = (c) => {
  const m = { u: 'String', t: 'String', tz: 'DateTime', d: 'DateTime', n: 'Decimal', i: 'Int', bi: 'BigInt', b: 'Boolean', j: 'Json', 't[]': 'String[]', 'i[]': 'Int[]', workspace_role: 'workspace_role' };
  return m[c.type] ?? (() => { throw new Error('type ' + c.type); })();
};
const native = (c) => ({ u: ' @db.Uuid', tz: ' @db.Timestamptz(6)', d: ' @db.Date', n: ' @db.Decimal', j: ' @db.JsonB' }[c.type] ?? '');
const defAttr = (tb, c) => {
  const d = c.def;
  if (d === null) return '';
  if (d === 'gen_random_uuid()') return ' @default(dbgenerated("gen_random_uuid()"))';
  if (d.startsWith('dbg:')) return ` @default(dbgenerated(${q(d.slice(4))}))`;
  if (d === 'now') return ' @default(now())';
  switch (c.type) {
    case 't': { if (!(d.startsWith("'") && d.endsWith("'"))) throw new Error('text def ' + d); return ` @default(${q(d.slice(1, -1))})`; }
    case 'i': case 'bi': case 'n': return ` @default(${d})`;
    case 'b': return ` @default(${d})`;
    case 'j': JSON.parse(d); return ` @default(${q(d)})`;
    case 't[]': case 'i[]': return ` @default(${d.replace(/'/g, '"')})`;
    case 'workspace_role': return ` @default(${d})`;
    case 'tz': throw new Error('tz def ' + d);
  }
  throw new Error('def ' + c.type);
};
// array columns: NOT NULL with default '{}' unless explicit default
for (const tb of Object.values(T)) for (const c of tb.parsed) {
  if ((c.type === 't[]') && c.def === null) c.def = '[]';
}

// 2. relations
const fkOf = (tb) => tb.parsed.filter((c) => c.fk);
const isUniqueCol = (tb, col) => tb.parsed.find((c) => c.name === col)?.pk ||
  (tb.unique ?? []).some((u) => (Array.isArray(u) ? u : u.cols).length === 1 && (Array.isArray(u) ? u : u.cols)[0] === col);
const fwdName = (col) => (col === 'ai_inherit_from' ? 'ai_inherit_source' : col.replace(/_id$/, ''));
const backs = {}; // parentTable -> [lines]
for (const tb of Object.values(T)) {
  const fks = fkOf(tb);
  for (const c of fks) {
    const parent = T[c.fk.table];
    if (!parent) throw new Error('no table ' + c.fk.table);
    const sameCount = fks.filter((x) => x.fk.table === c.fk.table).length;
    const relName = `${tb.name}_${c.name}`;
    c.relField = fwdName(c.name);
    c.relName = relName;
    const act = c.fk.action === 'cascade' ? 'Cascade' : 'SetNull';
    c.relLine = `  ${c.relField} ${c.fk.table}${c.nullable ? '?' : ''} @relation(${q(relName)}, fields: [${c.name}], references: [id], onDelete: ${act})`;
    if (c.pk) c.relLine = c.relLine; // single pk fk
    const uniq = isUniqueCol(tb, c.name);
    const backName = sameCount > 1 || c.fk.table === tb.name ? `${tb.name}_${c.name}` : tb.name;
    const backType = uniq ? `${tb.name}?` : `${tb.name}[]`;
    (backs[c.fk.table] ??= []).push(`  ${backName} ${backType} @relation(${q(relName)})`);
  }
}

// 3. emit
out.push(`generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

enum workspace_role {
  owner
  admin
  marketing
  viewer
}
`);
let nChecks = 0;
for (const tb of Object.values(T)) {
  const lines = [];
  const names = new Set();
  const compositePk = tb.compositePk;
  for (const c of tb.parsed) {
    names.add(c.name);
    let l = `  ${c.name} ${baseType(c)}${c.nullable ? '?' : ''}`;
    const attrs = [];
    if (c.pk && !compositePk) attrs.push('@id');
    attrs.push(...[defAttr(tb, c).trim()].filter(Boolean));
    if (c.updatedAt) attrs.push('@updatedAt');
    const nat = native(c).trim();
    if (nat) attrs.splice(c.pk && !compositePk ? 1 : 0, 0, nat);
    // order: @id, native, default, updatedAt
    lines.push(`${l}${attrs.length ? ' ' + attrs.join(' ') : ''}`);
  }
  for (const c of fkOf(tb)) {
    if (names.has(c.relField)) throw new Error(`collision ${tb.name}.${c.relField}`);
    names.add(c.relField); lines.push(c.relLine);
  }
  for (const b of backs[tb.name] ?? []) {
    const nm = b.trim().split(' ')[0];
    if (names.has(nm)) throw new Error(`collision back ${tb.name}.${nm}`);
    names.add(nm); lines.push(b);
  }
  lines.push('');
  if (compositePk) lines.push(`  @@id([${compositePk.join(', ')}])`);
  for (const u of tb.unique ?? []) {
    const cols = Array.isArray(u) ? u : u.cols;
    lines.push(`  @@unique([${cols.join(', ')}]${u.name ? `, map: ${q(u.name)}` : ''})`);
  }
  for (const i of tb.idx ?? []) {
    const cols = Array.isArray(i) ? i : i.cols;
    lines.push(`  @@index([${cols.map(SORT).join(', ')}]${i.name ? `, map: ${q(i.name)}` : ''})`);
  }
  out.push(`model ${tb.name} {\n${lines.join('\n')}\n}\n`);

  // raw: checks + trigger
  for (const [expr] of tb.checks ?? []) {
    nChecks++;
    const col = expr.split(' ')[0];
    raw.push(`ALTER TABLE "${tb.name}" ADD CONSTRAINT "${tb.name}_${col}_check" CHECK (${expr});`);
  }
  if (tb.touch) raw.push(`CREATE TRIGGER touch_updated_at BEFORE UPDATE ON "${tb.name}" FOR EACH ROW EXECUTE FUNCTION touch_updated_at();`);
}
fs.writeFileSync('schema.prisma', out.join('\n'));
fs.writeFileSync('raw.sql', raw.join('\n') + '\n');
console.log('tables', Object.keys(T).length, 'checks', nChecks, 'triggers', raw.filter((r) => r.startsWith('CREATE TRIGGER')).length);
