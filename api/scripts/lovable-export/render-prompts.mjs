#!/usr/bin/env node
// Monta os prompts do Lovable com o SQL da exportação e o HASH do token (o token em si nunca entra no prompt).
//   node scripts/lovable-export/render-prompts.mjs --hash <sha256 hex> [--only exportacao|limpeza]
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const AQUI = dirname(fileURLToPath(import.meta.url));
const argv = process.argv.slice(2);
const flag = (n) => { const i = argv.indexOf(n); return i >= 0 ? argv[i + 1] : undefined; };
const HASH = flag('--hash') ?? '';
if (!/^[0-9a-f]{64}$/.test(HASH)) { console.error('--hash precisa ser o SHA-256 (64 hex) do token'); process.exit(1); }
const only = flag('--only');
// Substituição por função: o SQL tem `$$`, que num texto de substituição viraria `$`.
const sql = readFileSync(join(AQUI, 'export_meufunil.sql'), 'utf8').replaceAll('__TOKEN_SHA256__', () => HASH);
const exportacao = readFileSync(join(AQUI, 'prompt-exportacao.md'), 'utf8').replace('__SQL__', () => sql.trimEnd()).replaceAll('__TOKEN_SHA256__', () => HASH);
const limpeza = readFileSync(join(AQUI, 'prompt-limpeza.md'), 'utf8');
if (only !== 'limpeza') console.log(exportacao);
if (only !== 'exportacao') console.log(limpeza);
