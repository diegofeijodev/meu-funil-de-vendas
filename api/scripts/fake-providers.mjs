#!/usr/bin/env node
// Provedores FALSOS dos canais do CRM (Task 8), só para smoke e browser-check — nenhuma chamada de rede externa.
//   node scripts/fake-providers.mjs      → 127.0.0.1:3097 (PORT=...)
//   /zapi/…        Z-API (header Client-Token = FAKE_ZAPI_TOKEN, padrão "ztok-smoke-1")  send-text|send-image|send-audio
//   /evo/…         Evolution (header apikey = FAKE_EVO_KEY, padrão "evo-smoke-1")        message/sendText|sendMedia/:instância
//   /resend/…      Resend (Bearer)   POST /emails · GET /domains
//   /calcom/…      Cal.com (Bearer)  GET /slots · POST /bookings · GET /event-types/:id
//   /v1/chat/completions   gateway de IA (OpenAI-compatível) — o SDR; a decisão vem de POST /__ai { decision }
//   GET /__log (pedidos recebidos) · POST /__reset
// A API sobe com RESEND_API_URL=http://127.0.0.1:3097/resend CALCOM_API_URL=http://127.0.0.1:3097/calcom (ignoradas em produção).
import { createServer } from 'node:http';

const PORT = Number(process.env.PORT ?? 3097);
const ZAPI = process.env.FAKE_ZAPI_TOKEN ?? 'ztok-smoke-1';
const EVO = process.env.FAKE_EVO_KEY ?? 'evo-smoke-1';
let log = [];
let n = 0;
let aiDecision = null;
const send = (res, status, body) => { res.writeHead(status, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(body)); };
const decisao = (over = {}) => ({ resposta: 'Olá! Sou o agente. Em qual cidade você quer atuar?', campos_extraidos: { cidade: null, capital: null, prazo: null, decisor: null, email: null, observacoes: null }, score: 20, temperatura: 'morno', proxima_etapa: 'manter', transferir_humano: false, motivo: '', horario_escolhido: null, ...over });

createServer((req, res) => {
  let raw = '';
  req.on('data', (c) => (raw += c));
  req.on('end', () => {
    const url = new URL(req.url, 'http://x');
    const path = url.pathname;
    let body; try { body = raw ? JSON.parse(raw) : undefined; } catch { body = raw; }
    if (path === '/__log') return send(res, 200, log);
    if (path === '/__reset') { log = []; aiDecision = null; return send(res, 200, { ok: true }); } // n NÃO zera: ids de mensagem são únicos por workspace (índice parcial do banco)
    if (path === '/__ai') { aiDecision = body?.decision ?? null; return send(res, 200, { ok: true }); }
    log.push({ method: req.method, path, query: Object.fromEntries(url.searchParams), headers: { 'client-token': req.headers['client-token'], apikey: req.headers.apikey, authorization: req.headers.authorization, 'cal-api-version': req.headers['cal-api-version'] }, body });
    if (path.startsWith('/zapi/')) {
      if (req.headers['client-token'] !== ZAPI) return send(res, 401, { error: 'Client-Token inválido' });
      if (path === '/zapi/send-text/fail') return send(res, 500, { error: 'falha' });
      return send(res, 200, { messageId: `ZAPI-${++n}`, id: `ZAPI-${n}` });
    }
    if (path.startsWith('/evo/')) {
      if (req.headers.apikey !== EVO) return send(res, 401, { error: 'apikey inválida' });
      return send(res, 201, { key: { id: `EVO-${++n}` } });
    }
    if (path.startsWith('/resend/')) {
      if (!/^Bearer re_/.test(req.headers.authorization ?? '')) return send(res, 401, { message: 'API key inválida' });
      if (path === '/resend/domains') return send(res, 200, { data: [{ name: 'meufunil.test', status: 'verified' }, { name: 'pendente.test', status: 'pending' }] });
      if (path === '/resend/emails' && req.method === 'POST') return send(res, 200, { id: `resend-${++n}` });
    }
    if (path.startsWith('/calcom/')) {
      if (!/^Bearer cal_/.test(req.headers.authorization ?? '')) return send(res, 401, { error: 'unauthorized' });
      if (path === '/calcom/slots') return send(res, 200, { data: { '2026-10-07': [{ start: '2026-10-07T12:00:00.000Z' }, { start: '2026-10-07T13:00:00.000Z' }, { start: '2026-10-07T14:00:00.000Z' }], '2026-10-08': [{ start: '2026-10-08T12:00:00.000Z' }] } });
      if (path === '/calcom/bookings' && req.method === 'POST') return send(res, 201, { data: { uid: `bk-${++n}`, start: body?.start, meetingUrl: 'https://meet.test/abc' } });
      if (path.startsWith('/calcom/event-types/')) return send(res, 200, { data: { title: 'Reunião de 30 min', lengthInMinutes: 30 } });
    }
    if (path === '/v1/chat/completions') {
      const schema = body?.response_format?.json_schema?.name;
      const text = body?.messages?.[0]?.content ?? '';
      if (schema === 'sdr_decision') return send(res, 200, { choices: [{ message: { content: JSON.stringify(aiDecision ?? decisao()) } }], echo: String(text).slice(0, 80) });
      return send(res, 200, { choices: [{ message: { content: '{}' } }] });
    }
    return send(res, 404, { error: `rota ${req.method} ${path} não existe nos provedores falsos` });
  });
}).listen(PORT, '127.0.0.1', () => console.log(`fake-providers em http://127.0.0.1:${PORT}`));
