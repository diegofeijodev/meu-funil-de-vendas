#!/usr/bin/env node
// Imita o Lovable na exportação, só para o teste do pull: POST /rest/v1/rpc/export_meufunil (manifest | table)
// e GET /api/export-file, servindo uma exportação sintética (make-fixture.mjs).
//   node scripts/lovable-export/fake-lovable.mjs --dir <export> --token <token> --port-file <arquivo>
import { createServer } from 'node:http';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const argv = process.argv.slice(2);
const flag = (n) => { const i = argv.indexOf(n); return i >= 0 ? argv[i + 1] : undefined; };
const DIR = flag('--dir'); const TOKEN = flag('--token'); const PORT_FILE = flag('--port-file');
const json = (res, status, body) => { res.writeHead(status, { 'content-type': 'application/json' }); res.end(JSON.stringify(body)); };

const server = createServer((req, res) => {
  const url = new URL(req.url, 'http://x');
  if (req.method === 'POST' && url.pathname === '/rest/v1/rpc/export_meufunil') {
    if (!req.headers.apikey) return json(res, 401, { message: 'sem apikey' });
    let raw = '';
    req.on('data', (c) => { raw += c; });
    req.on('end', () => {
      const b = JSON.parse(raw || '{}');
      if (b.p_token !== TOKEN) return json(res, 400, { message: 'forbidden' });
      if (b.p_action === 'manifest') return json(res, 200, JSON.parse(readFileSync(join(DIR, 'manifest.json'), 'utf8')));
      if (b.p_action === 'table') {
        const file = join(DIR, 'tables', `${b.p_schema}.${b.p_table}.json`);
        if (!existsSync(file)) return json(res, 400, { message: 'tabela não permitida' });
        const rows = JSON.parse(readFileSync(file, 'utf8'));
        return json(res, 200, { rows: rows.slice(b.p_offset, b.p_offset + Math.min(b.p_limit, 2000)) });
      }
      return json(res, 400, { message: 'ação inválida' });
    });
    return;
  }
  if (req.method === 'GET' && url.pathname === '/api/export-file') {
    if (req.headers['x-export-token'] !== TOKEN) { res.writeHead(403); return res.end(); }
    const bucket = url.searchParams.get('bucket'); const name = url.searchParams.get('name');
    const file = join(DIR, 'storage', bucket, name);
    if (!existsSync(file)) { res.writeHead(404); return res.end(); }
    res.writeHead(200, { 'content-type': 'application/octet-stream' });
    return res.end(readFileSync(file));
  }
  res.writeHead(404); res.end();
});
server.listen(0, '127.0.0.1', () => writeFileSync(PORT_FILE, String(server.address().port)));
