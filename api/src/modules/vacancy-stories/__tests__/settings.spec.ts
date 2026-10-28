jest.setTimeout(60_000);

import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { WorkspaceAccessGuard } from '../../access/workspace-access.guard';
import { AiError } from '../../ai/ai-error';
import { uuid } from '../../instagram/__tests__/harness';
import { ImageService, imageHeaderSize } from '../../media/image.service';
import { MARKETING, OWNER, STRANGER, VIEWER, WS_A, WS_B, status } from '../../media/__tests__/mem';
import { VacancyGateGuard } from '../vacancy-gate.service';
import { templateReadPrompt } from '../vacancy-prompts';
import { DISABLED_REASON, DONT_POST_REASON } from '../vacancy-reasons';
import { UpdateVacancySettingsDto } from '../vacancy-stories.dto';
import { VacancyStoriesController } from '../vacancy-stories.controller';
import { countVacancyStoriesOnDay } from '../vacancy-usage';
import { TEMPLATE_TEXTS_SCHEMA } from '../vacancy-verify';
import { vacancyWorld, type VacancyWorld } from './world';

const NOT_FOUND = '404:Página não encontrada.';
const FORBIDDEN = '403:Seu perfil não tem permissão para esta ação.';
const WRONG_TYPE = '400:Esse arquivo não serve. Envie uma imagem PNG ou JPG.';
const NO_BRAND = '400:Cadastre uma marca em Marcas antes de enviar a arte modelo.';
const YELLOW = 0xffd400ff;
const DARK = 0x202030ff;

let v: VacancyWorld;
beforeEach(() => {
  v = vacancyWorld();
});
afterEach(() => v.cleanup());

const IMG = new ImageService();
const made = new Map<string, Promise<Buffer>>();
/**
 * Arte modelo sintética: borda amarela de 32 px e miolo escuro (a cor dominante da imagem inteira é a escura). Feita uma vez por
 * tamanho (codificar PNG grande no jest é lento).
 */
function template(w = 1024, h = 1536): Promise<Buffer> {
  const k = `${w}x${h}`;
  if (!made.has(k)) {
    const img = IMG.blank(w, h, YELLOW);
    img.composite(IMG.blank(w - 64, h - 64, DARK), 32, 32);
    made.set(k, IMG.encode(img, true).then((b) => Buffer.from(b)));
  }
  return made.get(k)!;
}
/** Arte pequena (lado menor = 600 px) para os testes que não olham a imagem. */
const small = () => template(600, 900);
const upload = (bytes: Buffer, filename = 'modelo.png', mime = 'image/png', user = OWNER, ws = WS_A) =>
  v.settings.uploadTemplate(user, ws, { bytes, mime, filename });
const settingsRow = () => v.t['vacancy_story_settings']!.rows.find((r) => r.workspace_id === WS_A);
/** Arte modelo já salva (sem passar pelo envio). */
const seedTemplate = () => {
  const b = v.brand();
  const asset = { id: uuid(), workspace_id: WS_A, brand_id: b.id, kind: 'vacancy_template', name: 'modelo.png', url: 'https://cdn.test/modelo.png', storage_path: null };
  v.t['brand_assets']!.rows.push(asset);
  const tpl = { brand_id: b.id, template_asset_id: asset.id, template_texts: ['Frutá'], template_bg: '#ffd400', template_landscape: false };
  const row = settingsRow();
  if (row) Object.assign(row, tpl);
  else v.t['vacancy_story_settings']!.rows.push({
    ...{ enabled: false, enabled_at: null, enabled_by: null, cities: [], daily_cap: 10, window_start: '08:00', window_end: '21:00', min_lead_minutes: 120, vendor: 'openai', auto_publish: false, last_poll_at: null, last_poll_ok_at: null, last_poll_error: null, recent_cities: [], preview: {}, ai_error: null, ai_error_at: null },
    ...tpl, workspace_id: WS_A, created_at: new Date(), updated_at: new Date(),
  });
  return asset;
};
const logs = (action: string) => v.t['activity_logs']!.rows.filter((r) => r.action === action);
const vacancyPost = (over: Record<string, unknown> = {}) => {
  const p = { id: uuid(), workspace_id: WS_A, source: 'vacancy', format: 'story_image', status: 'pending_approval', creative_brief: { vacancy: {} }, scheduled_at: null, published_at: null, rejection_reason: null, created_at: new Date(), ...over };
  v.t['ig_posts']!.rows.push(p);
  return p;
};
const storyRow = (over: Record<string, unknown> = {}) => {
  const r = { id: uuid(), workspace_id: WS_A, source: 'freela', external_id: uuid(), status: 'new', snapshot: {}, fingerprint: 'f', starts_at: new Date(Date.now() + 86_400_000), skip_reason: null, ig_post_id: null, used_fallback: false, mismatch_attempts: 0, redo_count: 0, lease_until: null, created_at: new Date(), ...over };
  v.t['vacancy_stories']!.rows.push(r);
  return r;
};

describe('isolamento (lista = só a empresa A)', () => {
  const ctx = (workspaceId: string) => ({ switchToHttp: () => ({ getRequest: () => ({ params: { workspaceId } }) }) }) as never;

  it('o portão das rotas responde 404 "Página não encontrada." para B e libera A', async () => {
    const g = new VacancyGateGuard(v.gate);
    expect(await status(Promise.resolve().then(() => g.canActivate(ctx(WS_B))))).toBe(NOT_FOUND);
    expect(g.canActivate(ctx(WS_A))).toBe(true);
    // id em maiúsculas é a mesma empresa
    expect(g.canActivate(ctx(WS_A.toUpperCase()))).toBe(true);
    expect(v.gate.allowed(WS_B)).toBe(false);
  });

  it('todas as rotas do controller (GET/PATCH settings, enable, template, stories…) passam pelo portão e depois pelo acesso (R20)', () => {
    expect(Reflect.getMetadata('__guards__', VacancyStoriesController)).toEqual([VacancyGateGuard, WorkspaceAccessGuard]);
  });

  it('R20: o portão vem antes do acesso — viewer de B no PATCH e editor de B no ligar recebem 404, não 403', async () => {
    const viewerB = uuid();
    const editorB = uuid();
    v.member(WS_B, viewerB, 'viewer');
    v.member(WS_B, editorB, 'marketing');
    // só o acesso barraria com 403
    expect(await status(v.access.require(viewerB, WS_B, 'write'))).toBe(FORBIDDEN);
    expect(await status(v.access.require(editorB, WS_B, 'manage'))).toBe(FORBIDDEN);

    expect(await status(v.settings.update(viewerB, WS_B, { daily_cap: 5 }))).toBe(NOT_FOUND);
    expect(await status(v.settings.enable(editorB, WS_B))).toBe(NOT_FOUND);
    expect(await status(v.settings.disable(editorB, WS_B))).toBe(NOT_FOUND);
    expect(await status(v.settings.setAutoPublish(viewerB, WS_B, true))).toBe(NOT_FOUND);
    expect(await status(upload(await small(), 'modelo.png', 'image/png', viewerB, WS_B))).toBe(NOT_FOUND);
    // empresa da lista: quem não é membro continua recebendo o erro de acesso
    expect(await status(v.settings.enable(STRANGER, WS_A))).toBe('403:Você não tem acesso a esta empresa.');
  });

  it('os serviços também recusam B, mesmo para o dono de B', async () => {
    expect(await status(v.settings.view(WS_B))).toBe(NOT_FOUND);
    expect(await status(v.settings.update(STRANGER, WS_B, { daily_cap: 5 }))).toBe(NOT_FOUND);
    expect(await status(v.settings.enable(STRANGER, WS_B))).toBe(NOT_FOUND);
    expect(await status(v.settings.disable(STRANGER, WS_B))).toBe(NOT_FOUND);
    expect(await status(v.settings.setAutoPublish(STRANGER, WS_B, true))).toBe(NOT_FOUND);
    expect(await status(upload(await small(), 'modelo.png', 'image/png', STRANGER, WS_B))).toBe(NOT_FOUND);
    expect(v.t['vacancy_story_settings']!.rows).toHaveLength(0);
  });

  it('lista "*" (só em test/development) libera todas', () => {
    const all = vacancyWorld({ list: '*' });
    try {
      expect(all.gate.allowed(WS_B)).toBe(true);
    } finally {
      all.cleanup();
    }
  });
});

describe('ajustes', () => {
  it('GET settings em A cria a configuração com os padrões', async () => {
    const view = await v.settings.view(WS_A);
    expect(view).toMatchObject({
      enabled: false, enabled_at: null, auto_publish: false, template: null, template_bg: null, cities: [], daily_cap: 10,
      window_start: '08:00', window_end: '21:00', min_lead_minutes: 120, vendor: 'openai', last_poll_at: null, last_poll_ok_at: null,
      last_poll_error: null, recent_cities: [], instagram: { connected: false, username: null }, today: { posted: 0, scheduled: 0, cap: 10 },
      pending_approval: 0, counts: { ready: 0, to_approve: 0 }, ai_error: null, ai_error_at: null, preview: {},
      recent_outcomes: { n: 0, first_try: 0, redone: 0, fallback: 0, not_posted: 0 }, week: { total: 0, fallback: 0 },
    });
    expect(v.t['vacancy_story_settings']!.rows).toHaveLength(1);
    await v.settings.view(WS_A);
    expect(v.t['vacancy_story_settings']!.rows).toHaveLength(1);
  });

  it('PATCH com início depois do fim → 400; daily_cap 21 → 400 (DTO e serviço); viewer → 403', async () => {
    expect(await status(v.settings.update(OWNER, WS_A, { window_start: '21:00', window_end: '08:00' }))).toBe('400:O início precisa ser antes do fim.');
    // só o início muda: compara com o fim já salvo (21:00)
    expect(await status(v.settings.update(OWNER, WS_A, { window_start: '22:00' }))).toBe('400:O início precisa ser antes do fim.');
    expect(await status(v.settings.update(OWNER, WS_A, { window_start: '25:00', window_end: '26:00' }))).toMatch(/^400:/);
    expect(await status(v.settings.update(OWNER, WS_A, { daily_cap: 21 }))).toMatch(/^400:/);

    const dto = async (body: Record<string, unknown>) => (await validate(plainToInstance(UpdateVacancySettingsDto, body), { whitelist: true, forbidNonWhitelisted: true })).map((e) => e.property);
    expect(await dto({ daily_cap: 21 })).toEqual(['daily_cap']);
    expect(await dto({ daily_cap: 0 })).toEqual(['daily_cap']);
    expect(await dto({ min_lead_minutes: 90 })).toEqual(['min_lead_minutes']);
    expect(await dto({ vendor: 'midjourney' })).toEqual(['vendor']);
    expect(await dto({ window_start: '8h' })).toEqual(['window_start']);
    expect(await dto({ cities: Array.from({ length: 51 }, (_, i) => `C${i}`) })).toEqual(['cities']);
    expect(await dto({ enabled: true })).toEqual(['enabled']);
    expect(await dto({ daily_cap: 20, min_lead_minutes: 240, vendor: 'gemini', window_start: '09:30', window_end: '20:00', cities: ['Campinas'] })).toEqual([]);

    expect(await status(v.settings.update(VIEWER, WS_A, { daily_cap: 5 }))).toBe(FORBIDDEN);
  });

  it('PATCH válido grava (cidades sem repetição nem vazias) e devolve a view', async () => {
    const view = await v.settings.update(MARKETING, WS_A, { daily_cap: 15, window_start: '09:00', window_end: '20:30', min_lead_minutes: 240, vendor: 'gemini', cities: [' Campinas ', 'campinas', '', 'Jundiaí'] });
    expect(view).toMatchObject({ daily_cap: 15, window_start: '09:00', window_end: '20:30', min_lead_minutes: 240, vendor: 'gemini', cities: ['Campinas', 'Jundiaí'], today: { cap: 15 } });
    expect(settingsRow()).toMatchObject({ daily_cap: 15, vendor: 'gemini', cities: ['Campinas', 'Jundiaí'] });
  });
});

describe('ligar, desligar e postar sozinho', () => {
  it('ligar sem arte modelo → 400; viewer/editor → 403; dono liga, grava a marca d\'água e o log', async () => {
    expect(await status(v.settings.enable(OWNER, WS_A))).toBe('400:Envie a arte modelo para poder ligar.');
    seedTemplate();
    expect(await status(v.settings.enable(VIEWER, WS_A))).toBe(FORBIDDEN);
    expect(await status(v.settings.enable(MARKETING, WS_A))).toBe(FORBIDDEN);
    expect(settingsRow()!.enabled).toBe(false);

    const before = Date.now();
    const view = await v.settings.enable(OWNER, WS_A);
    expect(view.enabled).toBe(true);
    const row = settingsRow()!;
    expect(row.enabled).toBe(true);
    expect(row.enabled_by).toBe(OWNER);
    expect(row.enabled_at.getTime()).toBeGreaterThanOrEqual(before);
    expect(row.enabled_at.getTime()).toBeLessThanOrEqual(Date.now());
    expect(logs('vacancy_stories.enable')).toEqual([expect.objectContaining({ workspace_id: WS_A, actor_id: OWNER, entity_type: 'vacancy_stories' })]);
  });

  it('religar depois de desligar move a marca d\'água', async () => {
    seedTemplate();
    await v.settings.enable(OWNER, WS_A);
    const first = settingsRow()!.enabled_at as Date;
    settingsRow()!.enabled_at = new Date(first.getTime() - 3_600_000);
    await v.settings.disable(OWNER, WS_A);
    await v.settings.enable(OWNER, WS_A);
    expect(settingsRow()!.enabled_at.getTime()).toBeGreaterThanOrEqual(first.getTime());
  });

  it('postar sozinho: só owner/admin, com log', async () => {
    expect(await status(v.settings.setAutoPublish(MARKETING, WS_A, true))).toBe(FORBIDDEN);
    const view = await v.settings.setAutoPublish(OWNER, WS_A, true);
    expect(view.auto_publish).toBe(true);
    expect(settingsRow()!.auto_publish).toBe(true);
    expect(logs('vacancy_stories.auto_publish')).toEqual([expect.objectContaining({ actor_id: OWNER, metadata: { auto_publish: true } })]);
  });

  it('desligar cancela a fila e os posts de vaga não publicados (com os jobs) e grava os motivos', async () => {
    seedTemplate();
    await v.settings.enable(OWNER, WS_A);
    const fresh = storyRow({ status: 'new' });
    const pending = vacancyPost({ status: 'pending_approval' });
    const pendingRow = storyRow({ status: 'handed_off', ig_post_id: pending.id });
    const scheduled = vacancyPost({ status: 'scheduled', scheduled_at: new Date(Date.now() + 3_600_000) });
    const scheduledRow = storyRow({ status: 'handed_off', ig_post_id: scheduled.id });
    const job = { id: uuid(), workspace_id: WS_A, ig_post_id: scheduled.id, status: 'pending', channel: 'instagram_organic', run_at: scheduled.scheduled_at };
    v.t['publishing_jobs']!.rows.push(job);
    // fora do alcance: já publicado, post normal agendado, linha pulada e outra empresa
    const published = vacancyPost({ status: 'published', published_at: new Date() });
    const normal = vacancyPost({ source: 'app', status: 'scheduled' });
    const skipped = storyRow({ status: 'skipped', skip_reason: 'A vaga não tem valor informado.' });
    const other = storyRow({ workspace_id: WS_B, status: 'new' });

    expect(await status(v.settings.disable(VIEWER, WS_A))).toBe(FORBIDDEN);
    const out = await v.settings.disable(OWNER, WS_A);
    expect(out).toEqual({ ok: true, cancelled: 3 });

    expect(fresh).toMatchObject({ status: 'cancelled', skip_reason: DISABLED_REASON });
    expect(pending.status).toBe('cancelled');
    expect(scheduled.status).toBe('cancelled');
    expect(job.status).toBe('cancelled');
    expect(pendingRow.skip_reason).toBe(DISABLED_REASON);
    expect(scheduledRow.skip_reason).toBe(DISABLED_REASON);
    expect(published.status).toBe('published');
    expect(normal.status).toBe('scheduled');
    expect(skipped).toMatchObject({ status: 'skipped', skip_reason: 'A vaga não tem valor informado.' });
    expect(other.status).toBe('new');
    expect(settingsRow()!.enabled).toBe(false);
    expect(logs('vacancy_stories.disable')).toEqual([expect.objectContaining({ actor_id: OWNER, metadata: { cancelled: 3 } })]);
    expect(DISABLED_REASON).toBe('Os stories das vagas foram desligados.');
  });
});

describe('arte modelo', () => {
  const TEXTS = ['Frutá', 'Rio abaixo', 'Itupeva', 'R$ 95,95'];

  it('PNG em pé com borda amarela: grava o arquivo, a marca e o que a IA leu', async () => {
    const brand = v.brand();
    v.jsonBy['vacancy_template_texts'] = () => ({ textos: TEXTS });
    const out = await upload(await template());

    const assets = v.t['brand_assets']!.rows;
    expect(assets).toHaveLength(1);
    expect(assets[0]).toMatchObject({ workspace_id: WS_A, brand_id: brand.id, kind: 'vacancy_template', name: 'modelo.png' });
    expect(assets[0]!.storage_path).toMatch(new RegExp(`^brands/${WS_A}/[0-9a-f-]+\\.png$`));
    expect(v.storedFiles()).toEqual([`creative-assets/${assets[0]!.storage_path}`]);
    expect(settingsRow()).toMatchObject({ template_asset_id: assets[0]!.id, template_texts: TEXTS, template_bg: '#ffd400', template_landscape: false, brand_id: brand.id });
    expect(out.warning).toBeNull();
    expect(out.template).toMatchObject({ asset_id: assets[0]!.id, landscape: false, texts_count: 4 });
    expect(out.template!.url).toContain(assets[0]!.storage_path);
    expect(out.template_bg).toBe('#ffd400');

    // leitura: imagem reduzida a 1024 px, prompt e schema da Task 4
    expect(v.ai.json).toHaveBeenCalledTimes(1);
    const [ws, req] = v.ai.json.mock.calls[0]!;
    expect(ws).toBe(WS_A);
    expect(req).toMatchObject({ name: 'vacancy_template_texts', prompt: templateReadPrompt(), schema: TEMPLATE_TEXTS_SCHEMA });
    expect(req.images).toHaveLength(1);
    const dim = imageHeaderSize(req.images[0].bytes)!;
    expect(Math.max(dim.width, dim.height)).toBe(1024);
  });

  it('Review Focus #2: a IA não lê texto nenhum → salva com 0 textos; arte deitada → aviso "landscape"', async () => {
    v.brand();
    v.jsonBy['vacancy_template_texts'] = () => ({ textos: [] });
    const out = await upload(await small());
    expect(out.template!.texts_count).toBe(0);
    expect(settingsRow()!.template_texts).toEqual([]);

    v.jsonBy['vacancy_template_texts'] = () => ({ nada: 'disso' });
    const deitada = await upload(await template(1536, 1024));
    expect(deitada.warning).toBe('landscape');
    expect(deitada.template).toMatchObject({ landscape: true, texts_count: 0 });
    expect(settingsRow()).toMatchObject({ template_landscape: true, template_texts: [] });
  });

  it('Review Focus #4: empresa sem marca → 400 e nada gravado (nem arquivo)', async () => {
    v.jsonBy['vacancy_template_texts'] = () => ({ textos: TEXTS });
    expect(await status(upload(await small()))).toBe(NO_BRAND);
    expect(v.t['brand_assets']!.rows).toHaveLength(0);
    expect(v.storedFiles()).toEqual([]);
    expect(v.ai.json).not.toHaveBeenCalled();
    expect(settingsRow()?.template_asset_id ?? null).toBeNull();
  });

  it('usa a marca dos ajustes; sem ela, a marca mais antiga da empresa', async () => {
    v.jsonBy['vacancy_template_texts'] = () => ({ textos: [] });
    const nova = v.brand({ created_at: new Date('2026-10-01T00:00:00Z') });
    const antiga = v.brand({ created_at: new Date('2026-01-01T00:00:00Z') });
    v.brand({ workspace_id: WS_B, created_at: new Date('2025-01-01T00:00:00Z') });
    await upload(await small());
    expect(settingsRow()!.brand_id).toBe(antiga.id);
    settingsRow()!.brand_id = nova.id;
    await upload(await small());
    expect(v.t['brand_assets']!.rows.at(-1)!.brand_id).toBe(nova.id);
  });

  it('SVG/PDF/GIF/WEBP disfarçado de .png (e WEBP com o próprio nome) → 400 e nada gravado', async () => {
    v.brand();
    v.jsonBy['vacancy_template_texts'] = () => ({ textos: [] });
    const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="1080" height="1920"></svg>');
    const pdf = Buffer.from('%PDF-1.4\n%âãÏÓ\n1 0 obj\n<<>>\nendobj\n');
    const gif = Buffer.concat([Buffer.from('GIF89a'), Buffer.from([0x38, 0x04, 0x80, 0x07, 0, 0, 0]), Buffer.alloc(64)]);
    // WEBP de verdade (1×1, sem perdas): fora (R19), mesmo com nome e tipo de WEBP
    const webp = Buffer.from('UklGRhoAAABXRUJQVlA4TA0AAAAvAAAAEAcQERGIiP4HAA==', 'base64');
    expect(webp.subarray(0, 4).toString('latin1')).toBe('RIFF');
    expect(webp.subarray(8, 12).toString('latin1')).toBe('WEBP');
    for (const bytes of [svg, pdf, gif, webp]) expect(await status(upload(bytes))).toBe(WRONG_TYPE);
    expect(await status(upload(webp, 'arte.webp', 'image/webp'))).toBe(WRONG_TYPE);
    expect(v.ai.json).not.toHaveBeenCalled();
    expect(v.t['brand_assets']!.rows).toHaveLength(0);
    expect(v.storedFiles()).toEqual([]);
  });

  it('acima de 10 MB e lado menor abaixo de 600 px → 400 com o texto', async () => {
    v.brand();
    v.jsonBy['vacancy_template_texts'] = () => ({ textos: [] });
    const big = Buffer.concat([await small(), Buffer.alloc(Math.round(10.5 * 1024 * 1024))]);
    expect(await status(upload(big))).toBe('400:A imagem tem 10,6 MB e o máximo é 10 MB. Envie uma menor.');
    expect(await status(upload(await template(500, 800)))).toBe('400:A arte modelo precisa ter pelo menos 600 px de largura.');
    expect(v.storedFiles()).toEqual([]);
  });

  it('JPEG passa (tipo pelo conteúdo, não pelo nome)', async () => {
    v.brand();
    v.jsonBy['vacancy_template_texts'] = () => ({ textos: ['Oi'] });
    const img = v.images.blank(600, 900, YELLOW);
    const jpg = Buffer.from(await v.images.encode(img, false));
    const out = await upload(jpg, 'arte.webp', 'image/webp');
    expect(out.template!.texts_count).toBe(1);
    expect(v.t['brand_assets']!.rows[0]!.storage_path).toMatch(/\.jpg$/);
  });

  it('a leitura da IA falha → erro repassado, nenhuma brand_assets nem arquivo sobra', async () => {
    v.brand();
    v.jsonBy['vacancy_template_texts'] = () => {
      throw new AiError('A chave do ChatGPT (OpenAI) está sem crédito. Coloque crédito na conta da OpenAI ou cole outra chave em Integrações.');
    };
    expect(await status(upload(await small()))).toBe('502:A chave do ChatGPT (OpenAI) está sem crédito. Coloque crédito na conta da OpenAI ou cole outra chave em Integrações.');
    expect(v.t['brand_assets']!.rows).toHaveLength(0);
    expect(v.storedFiles()).toEqual([]);
    expect(settingsRow()?.template_asset_id ?? null).toBeNull();
  });

  it('viewer não envia', async () => {
    v.brand();
    expect(await status(upload(await small(), 'modelo.png', 'image/png', VIEWER))).toBe(FORBIDDEN);
  });
});

describe('situação (view)', () => {
  // 2026-10-29T15:00:00Z = 12h de quinta, 29/10, em Brasília
  const NOW = new Date('2026-10-29T15:00:00Z');
  const at = (iso: string) => new Date(iso);

  it('hoje (dia de Brasília), contagens, Instagram e resultados recentes', async () => {
    v.t['instagram_accounts']!.rows.push({ id: uuid(), workspace_id: WS_A, ig_user_id: 'ig1', status: 'connected', username: 'freelaservicos' });
    // hoje: 1 publicado + 3 a caminho (um às 23h de Brasília = 02:00Z do dia seguinte)
    vacancyPost({ status: 'published', published_at: at('2026-10-29T13:00:00Z'), created_at: at('2026-10-29T10:00:00Z') });
    vacancyPost({ status: 'scheduled', scheduled_at: at('2026-10-29T20:00:00Z'), created_at: at('2026-10-29T10:00:00Z') });
    vacancyPost({ status: 'scheduled', scheduled_at: at('2026-10-30T02:00:00Z'), created_at: at('2026-10-29T10:00:00Z') });
    vacancyPost({ status: 'pending_approval', created_at: at('2026-10-29T14:00:00Z') });
    // fora de hoje / fora da conta
    vacancyPost({ status: 'scheduled', scheduled_at: at('2026-10-30T04:00:00Z'), created_at: at('2026-10-29T10:00:00Z') });
    vacancyPost({ status: 'published', published_at: at('2026-10-29T02:00:00Z'), created_at: at('2026-10-28T20:00:00Z') });
    vacancyPost({ status: 'cancelled', scheduled_at: at('2026-10-29T18:00:00Z') });
    vacancyPost({ status: 'approved', source: 'app', scheduled_at: at('2026-10-29T18:00:00Z') });
    vacancyPost({ workspace_id: WS_B, status: 'published', published_at: at('2026-10-29T13:00:00Z') });

    expect(await countVacancyStoriesOnDay(v.prisma, WS_A, '2026-10-29')).toEqual({ posted: 1, scheduled: 3 });
    const view = await v.settings.view(WS_A, NOW);
    expect(view.today).toEqual({ posted: 1, scheduled: 3, cap: 10 });
    expect(view.instagram).toEqual({ connected: true, username: 'freelaservicos' });
    // prontos = ready|approved|scheduled de vaga (2 agendados hoje + 1 amanhã); para aprovar = pending_approval
    expect(view.counts).toEqual({ ready: 3, to_approve: 1 });
    expect(view.pending_approval).toBe(1);
  });

  it('resultados dos últimos stories e da semana', async () => {
    const mk = (row: Record<string, unknown>, post: Record<string, unknown> = {}) => {
      const p = vacancyPost({ status: 'published', created_at: at('2026-10-27T12:00:00Z'), ...post });
      storyRow({ status: 'handed_off', ig_post_id: p.id, ...row });
    };
    mk({ mismatch_attempts: 0 });
    mk({ mismatch_attempts: 2 });
    mk({ used_fallback: true, mismatch_attempts: 3 }, { creative_brief: { vacancy: { used_fallback: true } } });
    mk({ mismatch_attempts: 0 }, { status: 'cancelled', rejection_reason: DONT_POST_REASON });
    storyRow({ status: 'cancelled', skip_reason: DONT_POST_REASON });
    // não entram: cancelada por desligar, pulada, e post de 8 dias atrás só fica fora da semana
    storyRow({ status: 'cancelled', skip_reason: DISABLED_REASON });
    storyRow({ status: 'skipped', skip_reason: 'A vaga não tem valor informado.' });
    vacancyPost({ status: 'published', created_at: at('2026-10-21T12:00:00Z'), creative_brief: { vacancy: { used_fallback: true } } });

    const view = await v.settings.view(WS_A, NOW);
    expect(view.recent_outcomes).toEqual({ n: 5, first_try: 1, redone: 1, fallback: 1, not_posted: 2 });
    expect(view.week).toEqual({ total: 4, fallback: 1 });
  });
});
