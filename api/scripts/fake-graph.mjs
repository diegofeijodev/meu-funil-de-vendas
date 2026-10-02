#!/usr/bin/env node
// Graph API FALSA da Meta, só para smoke e browser-check (nenhuma chamada à rede da Meta).
//   node scripts/fake-graph.mjs            → escuta em 127.0.0.1:3098 (PORT=...), prefixo /v24.0
// A API precisa subir com META_GRAPH_BASE_URL=http://127.0.0.1:3098/v24.0 (ignorado com NODE_ENV=production).
// Confere `access_token` + `appsecret_proof` (HMAC-SHA256 do token com FAKE_APP_SECRET, padrão "smoke-meta-secret") em TODA chamada:
// sem prova válida responde erro 190, como a Meta. Guarda um registro dos pedidos em GET /__log e zera com POST /__reset.
import { createHmac } from 'node:crypto';
import { createServer } from 'node:http';

const PORT = Number(process.env.PORT ?? 3098);
const SECRET = process.env.FAKE_APP_SECRET ?? 'smoke-meta-secret';
const pad = (d) => d.toISOString().slice(0, 10);
const days = (since, until) => {
  const out = [];
  for (let d = new Date(`${since}T12:00:00Z`); pad(d) <= until && out.length < 10; d = new Date(d.getTime() + 86400e3)) out.push(pad(d));
  return out;
};

let log = [];
let n = { campaign: 0, adset: 0, adcreative: 0, ad: 0, audience: 0, form: 0 };
const send = (res, status, body) => {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(body));
};

const server = createServer((req, res) => {
  let raw = '';
  req.on('data', (c) => (raw += c));
  req.on('end', () => {
    const url = new URL(req.url, 'http://x');
    const path = url.pathname.replace(/^\/v\d+\.\d+/, '');
    if (path === '/__log') return send(res, 200, log);
    if (path === '/__reset') { log = []; n = { campaign: 0, adset: 0, adcreative: 0, ad: 0, audience: 0, form: 0 }; return send(res, 200, { ok: true }); }
    const p = Object.fromEntries(new URLSearchParams(req.method === 'GET' ? url.search : raw));
    const params = {};
    for (const [k, v] of Object.entries(p)) { try { params[k] = JSON.parse(v); } catch { params[k] = v; } }
    const entry = { method: req.method, path, params: { ...params, access_token: undefined, appsecret_proof: undefined, bytes: params.bytes ? `<${String(params.bytes).length} bytes>` : undefined }, token: p.access_token };
    log.push(entry);

    // OAuth: não leva appsecret_proof (usa client_secret).
    if (path === '/oauth/access_token') {
      if (p.client_secret !== SECRET) return send(res, 400, { error: { message: 'Invalid client secret' } });
      if (p.code) return p.code === 'codigo-ruim' ? send(res, 400, { error: { message: 'Código inválido ou expirado' } }) : send(res, 200, { access_token: 'FAKE-SHORT-LIVED' });
      if (p.grant_type === 'fb_exchange_token') return send(res, 200, { access_token: 'FAKE-LONG-LIVED-TOKEN-0123456789', expires_in: 5184000 });
      return send(res, 400, { error: { message: 'bad request' } });
    }
    const proof = createHmac('sha256', SECRET).update(String(p.access_token ?? '')).digest('hex');
    if (!p.access_token || p.appsecret_proof !== proof) return send(res, 400, { error: { message: 'Invalid appsecret_proof', code: 190 } });

    const seg = path.split('/').filter(Boolean);
    const [a, b] = seg;
    const fields = String(params.fields ?? '');
    if (req.method === 'GET') {
      if (path === '/me') return send(res, 200, { id: '1', name: 'Fulano da Silva' });
      if (path === '/me/adaccounts') return send(res, 200, { data: [{ id: 'act_1001', name: 'Conta Smoke', account_status: 1, currency: 'BRL' }, { id: 'act_1002', name: 'Conta Inativa', account_status: 2, currency: 'BRL' }] });
      if (path === '/me/accounts') return send(res, 200, { data: [{ id: '2002', name: 'Página Smoke', instagram_business_account: { id: '3003', username: 'smoke_ig' } }, { id: '2003', name: 'Sem Instagram' }] });
      if (path === '/search') return send(res, 200, { data: params.type === 'adinterest' ? [{ id: '6003', name: 'Cerveja' }] : [{ key: '2490299', name: 'Valinhos', type: 'city' }] });
      if (b === 'adspixels') return send(res, 200, { data: [] });
      if (b === 'customaudiences') return send(res, 200, { data: [{ id: '5001', name: 'Compradores', subtype: 'CUSTOM', approximate_count_lower_bound: 1200 }] });
      if (a?.startsWith('act_') && ['campaigns', 'adsets', 'ads'].includes(b)) return send(res, 200, { data: [{ id: `${b}-1`, name: `${b} 1`, status: 'PAUSED', effective_status: 'PAUSED' }] });
      if (a?.startsWith('act_') && b === 'insights') {
        // por anúncio e por dia (level=ad) ou resumo de conta
        if (params.level === 'ad') {
          const ids = params.filtering?.[0]?.value ?? [];
          const rows = [];
          for (const cid of ids) {
            for (const d of days(params.time_range.since, params.time_range.until)) {
              // anúncio 1: caro (100 gasto, 2 leads); anúncio 2: bom (40 gasto, 8 leads)
              rows.push({ date_start: d, campaign_id: cid, adset_id: `${cid}0`, adset_name: 'Conjunto Smoke', ad_id: `${cid}1`, ad_name: 'Anúncio caro', spend: '100.00', impressions: '10000', reach: '8000', inline_link_clicks: '200', actions: [{ action_type: 'lead', value: '2' }], action_values: [] });
              rows.push({ date_start: d, campaign_id: cid, adset_id: `${cid}0`, adset_name: 'Conjunto Smoke', ad_id: `${cid}2`, ad_name: 'Anúncio bom', spend: '40.00', impressions: '5000', reach: '4000', inline_link_clicks: '150', actions: [{ action_type: 'lead', value: '8' }, { action_type: 'purchase', value: '1' }], action_values: [{ action_type: 'purchase', value: '250' }] });
            }
          }
          return send(res, 200, { data: rows });
        }
        return send(res, 200, { data: [{ spend: '140.00', impressions: '15000', clicks: '350', ctr: '2.33', cpc: '0.4', actions: [{ action_type: 'lead', value: '10' }] }] });
      }
      if (b === 'insights') return send(res, 200, { data: [{ spend: '90.5', impressions: '9000', clicks: '180', ctr: '2', cpc: '0.5', actions: [{ action_type: 'lead', value: '9' }] }] });
      if (a && !b) {
        if (fields.includes('access_token')) return send(res, 200, { access_token: 'FAKE-PAGE-TOKEN', id: a });
        if (fields.includes('daily_budget')) return send(res, 200, { daily_budget: '3000', name: 'Conjunto Smoke', effective_status: 'ACTIVE' });
        if (fields.includes('effective_status')) return send(res, 200, { effective_status: 'ACTIVE' });
        if (fields.includes('username')) return send(res, 200, { username: 'smoke_ig' });
        if (fields.includes('picture')) return send(res, 200, { picture: 'https://cdn.test/thumb.jpg' });
        if (fields.includes('account_status')) return send(res, 200, { name: 'Conta Smoke', account_status: 1, currency: 'BRL', timezone_name: 'America/Sao_Paulo' });
        return send(res, 200, { id: a, name: 'Página Smoke' });
      }
      return send(res, 404, { error: { message: `GET ${path} não existe na Graph falsa`, code: 100 } });
    }
    // POST
    if (b === 'campaigns') return send(res, 200, { id: String(7100000 + ++n.campaign) });
    if (b === 'adsets') return send(res, 200, { id: String(7200000 + ++n.adset) });
    if (b === 'adcreatives') return send(res, 200, { id: String(7300000 + ++n.adcreative) });
    if (b === 'ads') return send(res, 200, { id: String(7400000 + ++n.ad) });
    if (b === 'adimages') return send(res, 200, { images: { 'img.png': { hash: 'hash-smoke-1' } } });
    if (b === 'advideos') return send(res, 200, { id: '7500001' });
    if (b === 'leadgen_forms') return send(res, 200, { id: String(7600000 + ++n.form) });
    if (b === 'customaudiences') return send(res, 200, { id: String(5100000 + ++n.audience) });
    if (b === 'events') return send(res, 200, { events_received: (params.data ?? []).length });   // API de Conversões (CRM, Task 7)
    if (b === 'users') return send(res, 200, { audience_id: a, num_received: (params.payload?.data ?? []).length });
    if (a && !b) return send(res, 200, { success: true });   // status / orçamento
    return send(res, 404, { error: { message: `POST ${path} não existe na Graph falsa`, code: 100 } });
  });
});
server.listen(PORT, '127.0.0.1', () => console.log(`fake-graph em http://127.0.0.1:${PORT}/v24.0`));
