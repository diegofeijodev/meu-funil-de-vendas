#!/usr/bin/env node
// Puxa a exportação do Lovable Cloud (função SQL `export_meufunil` + endereço de arquivos do app). Roda no EC2.
//
//   node scripts/lovable-export/pull.mjs --env <arquivo com SUPABASE_URL e SUPABASE_PUBLISHABLE_KEY> \
//        --token-file <arquivo> --out <pasta> --file-url <https://<app>.lovable.app/api/export-file> [--check-only]
//
// Grava <out>/manifest.json, <out>/tables/<schema>.<tabela>.json e <out>/storage/<bucket>/<caminho> (pasta 700).
// --check-only: só o manifesto e os totais (linhas e arquivos por bucket), para conferir o disco antes de baixar.
// Confere no fim: linhas por tabela = manifesto e todo arquivo baixado com o tamanho certo. Sai 1 se algo não bater.
import { chmodSync, existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

const argv = process.argv.slice(2);
const flag = (n) => { const i = argv.indexOf(n); return i >= 0 && argv[i + 1] ? argv[i + 1] : undefined; };
const envText = readFileSync(flag('--env') ?? '', 'utf8');
const envVal = (k) => (envText.match(new RegExp(`^${k}\\s*=\\s*["']?([^"'\\s]+)`, 'm')) ?? [])[1];
const SUPABASE_URL = envVal('SUPABASE_URL')?.replace(/\/+$/, '');
const ANON = envVal('SUPABASE_PUBLISHABLE_KEY') ?? envVal('SUPABASE_ANON_KEY');
const TOKEN = readFileSync(flag('--token-file') ?? '', 'utf8').trim();
const OUT = resolve(flag('--out') ?? './lovable-export');
const FILE_URL = flag('--file-url') ?? '';
const CHECK_ONLY = argv.includes('--check-only');
const PAGE = 1000;
if (!SUPABASE_URL || !ANON) { console.error('faltam SUPABASE_URL / SUPABASE_PUBLISHABLE_KEY no --env'); process.exit(1); }
if (!TOKEN) { console.error('--token-file vazio'); process.exit(1); }

const RPC = `${SUPABASE_URL}/rest/v1/rpc/export_meufunil`;
const rpcHeaders = { apikey: ANON, Authorization: `Bearer ${ANON}`, 'content-type': 'application/json' };

async function comRetry(nome, fn) {
  for (let tentativa = 1; ; tentativa++) {
    const r = await fn();
    if (r.ok) return r;
    const texto = await r.text();
    if (tentativa >= 3 || r.status < 500) throw new Error(`${nome} → HTTP ${r.status}: ${texto.slice(0, 300)}`);
    await new Promise((ok) => setTimeout(ok, 1500 * tentativa));
  }
}

async function rpc(action, schema = null, table = null, limit = 500, offset = 0) {
  const body = JSON.stringify({ p_token: TOKEN, p_action: action, p_schema: schema, p_table: table, p_limit: limit, p_offset: offset });
  const r = await comRetry(`${action} ${schema ?? ''}.${table ?? ''}`, () => fetch(RPC, { method: 'POST', headers: rpcHeaders, body }));
  return r.json();
}

async function file(bucket, name) {
  if (!FILE_URL) throw new Error('falta --file-url para baixar arquivos');
  const u = `${FILE_URL}?bucket=${encodeURIComponent(bucket)}&name=${encodeURIComponent(name)}`;
  const r = await comRetry(`arquivo ${bucket}/${name}`, () => fetch(u, { headers: { 'x-export-token': TOKEN } }));
  return Buffer.from(await r.arrayBuffer());
}

const mb = (n) => `${(n / 1024 / 1024).toFixed(1)} MB`;
mkdirSync(OUT, { recursive: true, mode: 0o700 });
chmodSync(OUT, 0o700);
const manifest = await rpc('manifest');
writeFileSync(join(OUT, 'manifest.json'), JSON.stringify(manifest, null, 2));
const linhas = Object.values(manifest.counts).reduce((a, b) => a + Number(b), 0);
const porBucket = {};
for (const o of manifest.objects) porBucket[o.bucket_id] = (porBucket[o.bucket_id] ?? 0) + 1;
const bytes = manifest.objects.reduce((a, o) => a + Number(o.size ?? 0), 0);
console.log(`manifesto: ${Object.keys(manifest.counts).length} tabelas, ${linhas} linhas`);
console.log(`arquivos: ${manifest.objects.length} (${Object.entries(porBucket).map(([b, n]) => `${b}: ${n}`).join(', ')}), ${mb(bytes)}`);
if (CHECK_ONLY) process.exit(0);

mkdirSync(join(OUT, 'tables'), { recursive: true });
let falhas = 0;
for (const [chave, esperado] of Object.entries(manifest.counts)) {
  const [schema, table] = chave.split('.');
  const rows = [];
  for (let offset = 0; offset < esperado; offset += PAGE) {
    const { rows: pagina } = await rpc('table', schema, table, PAGE, offset);
    rows.push(...pagina);
    if (pagina.length === 0) break;
  }
  writeFileSync(join(OUT, 'tables', `${chave}.json`), JSON.stringify(rows));
  const ok = rows.length === Number(esperado);
  if (!ok) falhas++;
  console.log(`${ok ? 'OK   ' : 'FALHA'} ${chave}: ${rows.length}/${esperado}`);
}

let baixados = 0;
for (const o of manifest.objects) {
  const destino = join(OUT, 'storage', o.bucket_id, o.name);
  if (existsSync(destino) && (o.size == null || statSync(destino).size === Number(o.size))) { baixados++; continue; }
  try {
    const b = await file(o.bucket_id, o.name);
    mkdirSync(dirname(destino), { recursive: true });
    writeFileSync(destino, b);
    if (o.size != null && b.length !== Number(o.size)) { falhas++; console.log(`FALHA tamanho ${o.bucket_id}/${o.name}: ${b.length} ≠ ${o.size}`); }
    baixados++;
  } catch (e) {
    falhas++;
    console.log(`FALHA arquivo ${o.bucket_id}/${o.name}: ${e.message}`);
  }
}
console.log(`arquivos baixados: ${baixados}/${manifest.objects.length} em ${join(OUT, 'storage')}`);
console.log(falhas ? `\n${falhas} falha(s)` : '\nexportação completa e conferida');
process.exit(falhas ? 1 : 0);
