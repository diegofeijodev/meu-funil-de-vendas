#!/usr/bin/env node
// Exportação SINTÉTICA no formato do pull.mjs (manifest.json + tables/ + storage/), para os testes ponta a ponta
// do importador e do pull. Nada real: ids, e-mails e segredos inventados.
//   node scripts/lovable-export/make-fixture.mjs --out <pasta> --legacy-secret <segredo>
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

const argv = process.argv.slice(2);
const flag = (n) => { const i = argv.indexOf(n); return i >= 0 ? argv[i + 1] : undefined; };
const OUT = flag('--out');
const SECRET = flag('--legacy-secret');
if (!OUT || !SECRET) { console.error('uso: --out <pasta> --legacy-secret <segredo>'); process.exit(1); }

const WS = '11111111-1111-4111-8111-111111111111';
const U1 = '22222222-2222-4222-8222-222222222221'; // senha (bcrypt)
const U2 = '22222222-2222-4222-8222-222222222222'; // só Google
const U3 = '22222222-2222-4222-8222-222222222223'; // apagada no Lovable
const id = (n) => `55555555-5555-4555-8555-${String(n).padStart(12, '0')}`;
const SB = 'https://abcdefghijklmnop.supabase.co/storage/v1/object';
const H = 3600e3;
const D = 24 * H;
const now = Date.now();
const at = (ms) => new Date(now + ms).toISOString();

/** Igual ao protótipo (`credentials.server.ts`): AES-GCM do WebCrypto, chave = SHA-256 do segredo. */
async function encV1(value, secret) {
  const raw = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(secret));
  const key = await crypto.subtle.importKey('raw', raw, { name: 'AES-GCM' }, false, ['encrypt']);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(value)));
  return `enc:v1:${Buffer.from(iv).toString('base64')}:${Buffer.from(ct).toString('base64')}`;
}

const files = {
  [`creative-assets/brands/${WS}/logo.png`]: 'PNG-logo-e2e',
  'creative-assets/2026-09-30/criativo ação.png': 'PNG-criativo-e2e',
  [`ig-media/posts/${WS}/p1.jpg`]: 'JPG-post-e2e',
};

const tables = {
  'auth.users': [
    { id: U1, email: 'Dono@Exemplo.com', encrypted_password: '$2a$10$' + 'a'.repeat(53), created_at: at(-90 * D), deleted_at: null, banned_until: null, is_anonymous: false },
    { id: U2, email: 'google@exemplo.com', encrypted_password: '', created_at: at(-30 * D), deleted_at: null, banned_until: null, is_anonymous: false },
    { id: U3, email: 'apagada@exemplo.com', encrypted_password: '$2a$10$' + 'b'.repeat(53), created_at: at(-60 * D), deleted_at: at(-D), banned_until: null, is_anonymous: false },
  ],
  'auth.identities': [
    { id: id(1), user_id: U2, provider: 'google', provider_id: '109876543210987654321', identity_data: { sub: '109876543210987654321' } },
  ],
  'public.profiles': [
    { id: U1, email: 'dono@exemplo.com', full_name: 'Dono E2E', avatar_url: null, created_at: at(-90 * D) },
    { id: U2, email: 'google@exemplo.com', full_name: 'Google E2E', avatar_url: null, created_at: at(-30 * D) },
    { id: U3, email: 'apagada@exemplo.com', full_name: 'Apagada E2E', avatar_url: null, created_at: at(-60 * D) },
  ],
  'public.workspaces': [{ id: WS, name: 'Empresa E2E', slug: 'empresa-e2e', owner_id: U1, created_at: at(-90 * D) }],
  'public.workspace_members': [{ id: id(2), workspace_id: WS, user_id: U1, role: 'owner', created_at: at(-90 * D) }],
  'public.brands': [
    { id: id(3), workspace_id: WS, name: 'Marca E2E', logo_url: `${SB}/sign/creative-assets/brands/${WS}/logo.png?token=eyJhbGciOi.e2e`, created_at: at(-80 * D), updated_at: '2026-01-02T03:04:05+00:00' },
  ],
  'public.creatives': [
    { id: id(4), workspace_id: WS, title: 'Criativo com galeria', preview_url: `${SB}/sign/creative-assets/2026-09-30/criativo%20a%C3%A7%C3%A3o.png?token=t1`, extras: { gallery: [{ url: `${SB}/public/ig-media/posts/${WS}/p1.jpg` }], nota: 'sem link' } },
    { id: id(5), workspace_id: WS, title: 'Criativo sem arquivo', preview_url: `${SB}/sign/creative-assets/sumiu/arquivo.png?token=t2`, extras: {} },
  ],
  'public.ig_posts': [
    { id: id(6), workspace_id: WS, format: 'feed_image', status: 'scheduled', scheduled_at: at(-2 * D), media: [{ url: `${SB}/sign/ig-media/posts/${WS}/p1.jpg?token=t3`, type: 'image' }], lease_until: at(H), automation: null },
    { id: id(7), workspace_id: WS, format: 'feed_image', status: 'scheduled', scheduled_at: at(2 * D), media: [], lease_until: null, automation: null },
    // publicação interrompida (job running vencido) e publicação em andamento com horário futuro
    { id: id(21), workspace_id: WS, format: 'feed_image', status: 'publishing', scheduled_at: at(-D), media: [], lease_until: null, automation: null },
    { id: id(23), workspace_id: WS, format: 'feed_image', status: 'publishing', scheduled_at: at(3 * D), media: [], lease_until: null, automation: null },
    // modo automático: aprovado com horário vencido (sairia "publicando agora") e pronto com horário futuro
    { id: id(24), workspace_id: WS, format: 'feed_image', status: 'approved', scheduled_at: at(-3 * H), media: [], lease_until: null, automation: 'publish' },
    { id: id(25), workspace_id: WS, format: 'feed_image', status: 'ready', scheduled_at: at(5 * H), media: [], lease_until: null, automation: 'publish' },
  ],
  'public.publishing_jobs': [
    // status reais da fila do Instagram (protótipo e PublishingService): pending → running
    { id: id(8), workspace_id: WS, channel: 'instagram_organic', target: 'instagram', status: 'pending', run_at: at(-2 * D), ig_post_id: id(6), locked_at: null, log: 'agendado' },
    { id: id(9), workspace_id: WS, channel: 'instagram_organic', target: 'instagram', status: 'pending', run_at: at(2 * D), ig_post_id: id(7), locked_at: null, log: null },
    { id: id(20), workspace_id: WS, channel: 'instagram_organic', target: 'instagram', status: 'running', run_at: at(-D), ig_post_id: id(21), locked_at: at(-D), log: null },
    { id: id(22), workspace_id: WS, channel: 'instagram_organic', target: 'instagram', status: 'running', run_at: at(3 * D), ig_post_id: id(23), locked_at: at(-H), log: null },
  ],
  'public.crm_leads': [{ id: id(10), workspace_id: WS, name: 'Lead E2E' }, { id: id(19), workspace_id: WS, name: 'Lead E2E 2' }],
  'public.crm_cadences': [{ id: id(11), workspace_id: WS, name: 'Cadência E2E' }],
  'public.crm_cadence_runs': [
    { id: id(12), workspace_id: WS, cadence_id: id(11), lead_id: id(10), status: 'running', next_run_at: at(-D), lease_token: id(18), lease_until: at(H), created_at: at(-10 * D) },
    { id: id(13), workspace_id: WS, cadence_id: id(11), lead_id: id(19), status: 'running', next_run_at: at(-5 * D), lease_token: null, lease_until: null, created_at: at(-10 * D) },
    // o protótipo não tinha a restrição (cadência, lead): duplicata mais antiga — a carga fica com a mais recente
    { id: id(27), workspace_id: WS, cadence_id: id(11), lead_id: id(10), status: 'running', next_run_at: at(-2 * D), lease_token: null, lease_until: null, created_at: at(-20 * D) },
  ],
  'public.app_credentials': [
    { id: id(14), workspace_id: null, key: 'META_APP_SECRET', value: await encV1('segredo-meta-e2e', SECRET), updated_at: at(-D) },
    { id: id(15), workspace_id: WS, key: 'OPENAI_API_KEY', value: 'sk-texto-puro-e2e', updated_at: at(-D) },
    { id: id(16), workspace_id: WS, key: 'RESEND_API_KEY', value: '', updated_at: at(-D) },
    { id: id(26), workspace_id: WS, key: 'META_TOKEN_EXPIRES_AT', value: await encV1('', SECRET), updated_at: at(-D) },
  ],
  'public.mcp_connections': [
    { id: id(17), workspace_id: WS, provider: 'canva', server_url: 'https://mcp.canva.com/mcp', access_token: 'token-puro-e2e', status: 'connected' },
  ],
  'public.cron_tokens': [{ name: 'instagram', token: 'token-cron-e2e', created_at: at(-D) }],
};

mkdirSync(join(OUT, 'tables'), { recursive: true });
for (const [k, rows] of Object.entries(tables)) writeFileSync(join(OUT, 'tables', `${k}.json`), JSON.stringify(rows));
const objects = [];
for (const [p, content] of Object.entries(files)) {
  const [bucket, ...rest] = p.split('/');
  const dest = join(OUT, 'storage', p);
  mkdirSync(dirname(dest), { recursive: true });
  writeFileSync(dest, content);
  objects.push({ bucket_id: bucket, name: rest.join('/'), size: Buffer.byteLength(content) });
}
const manifest = {
  counts: Object.fromEntries(Object.entries(tables).map(([k, rows]) => [k, rows.length])),
  buckets: [{ id: 'creative-assets', public: false }, { id: 'ig-media', public: false }],
  objects,
};
writeFileSync(join(OUT, 'manifest.json'), JSON.stringify(manifest, null, 2));
console.log(`exportação sintética em ${OUT}: ${Object.keys(tables).length} tabelas, ${objects.length} arquivos`);
