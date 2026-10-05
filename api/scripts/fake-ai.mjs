#!/usr/bin/env node
// Provedores de IA FALSOS (OpenAI + Gemini, só a listagem de modelos), para o smoke da tela Integrações.
//   node scripts/fake-ai.mjs   → 127.0.0.1:3099 (PORT=...)
// A API precisa subir com AI_OPENAI_BASE_URL=http://127.0.0.1:3099/v1 e AI_GEMINI_BASE_URL=http://127.0.0.1:3099/v1beta
// (ignoradas com NODE_ENV=production). Chave válida: "sk-fake-good…" (OpenAI) / "AIzaFakeGood…" (Gemini); "…-quota…" → 429; o resto → 401.
import { createServer } from 'node:http';

const PORT = Number(process.env.PORT ?? 3099);
const send = (res, status, body) => { res.writeHead(status, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(body)); };

createServer((req, res) => {
  const url = new URL(req.url, 'http://x');
  const bearer = (req.headers.authorization ?? '').replace(/^Bearer /, '');
  const g = String(req.headers['x-goog-api-key'] ?? '');
  const key = bearer || g;
  if (key.includes('quota')) return send(res, 429, { error: 'quota' });
  if (url.pathname === '/v1/models' && bearer.startsWith('sk-fake-good')) return send(res, 200, { data: ['gpt-image-1', 'gpt-4o-mini', 'whisper-1'].map((id) => ({ id })) });
  if (url.pathname === '/v1beta/models' && g.startsWith('AIzaFakeGood')) {
    return send(res, 200, { models: ['gemini-2.5-flash-image', 'veo-3.0-fast-generate-preview', 'gemini-flash-latest'].map((name) => ({ name: `models/${name}` })) });
  }
  return send(res, 401, { error: 'unauthorized' });
}).listen(PORT, '127.0.0.1');
