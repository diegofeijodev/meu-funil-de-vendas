import { uuid } from '../../instagram/__tests__/harness';
import { WS_A } from '../../media/__tests__/mem';
import { approveUntil, displayOf, storyDetail, storyView, type StoryPost } from '../vacancy-display';
import { previewForView } from '../vacancy-preview-state';
import { WAIT_CAP } from '../vacancy-reasons';
import { fingerprint } from '../vacancy-text';
import type { FreelaVacancy, SettingsRow, StoryRow } from '../vacancy-types';

const NOW = new Date('2026-10-29T13:00:00Z'); // quinta, 10h em Brasília
const MIN = 60_000;
const HOUR = 60 * MIN;
const at = (ms: number) => new Date(NOW.getTime() + ms);
const TOMORROW_8H = new Date('2026-10-30T11:00:00Z');

/** Sábado 31/10, 18h às 23h em Brasília, Coco Bambu em Campinas, R$ 150. */
const vac = (o: Partial<FreelaVacancy> = {}): FreelaVacancy => ({
  id: uuid(), title: 'Garçom', serviceType: 'garcom', city: 'Campinas', date: '2026-10-31',
  startTime: '2026-10-31T21:00:00Z', endTime: '2026-11-01T02:00:00Z', amountInCents: 15000,
  contractorName: 'COCO BAMBU', publishedAt: '2026-10-29T10:00:00Z', ...o,
});

/** Janela 8h–21h, antecedência 2 h, até 10 por dia. */
const settings = (o: Partial<SettingsRow> = {}): SettingsRow => ({
  workspace_id: WS_A, brand_id: null, enabled: true, enabled_at: new Date('2026-10-29T09:00:00Z'), enabled_by: null, template_asset_id: uuid(),
  template_texts: [], template_bg: null, template_landscape: false, cities: [], daily_cap: 10, window_start: '08:00', window_end: '21:00',
  min_lead_minutes: 120, vendor: 'openai', auto_publish: false, last_poll_at: null, last_poll_ok_at: null, last_poll_error: null,
  recent_cities: [], preview: {}, ai_error: null, ai_error_at: null, created_at: NOW, updated_at: NOW, ...o,
});

const row = (o: Partial<StoryRow> = {}, v: FreelaVacancy = vac()): StoryRow => ({
  id: uuid(), workspace_id: WS_A, source: 'freela', external_id: v.id, status: 'new', skip_reason: null, wait_reason: null,
  snapshot: v as unknown as StoryRow['snapshot'], fingerprint: fingerprint(v), starts_at: new Date(v.startTime), template_asset_id: null,
  lease_until: null, next_attempt_at: null, not_before: null, forced: false, post_now: false, mismatch_attempts: 0, ai_error_count: 0,
  redo_count: 0, attempts_log: [], used_fallback: false, feedback: null, ig_post_id: null, created_at: NOW, updated_at: NOW, ...o,
});

const ALL_KEYS = ['funcao', 'estabelecimento', 'cidade', 'valor', 'data', 'inicio', 'fim'];
const post = (o: Partial<StoryPost> = {}): StoryPost => ({
  id: uuid(), status: 'ready', scheduled_at: null, published_at: null, last_error: null, rejection_reason: null, ig_permalink: null, ai_generation_log: [],
  media: [{ url: 'https://cdn.test/story.jpg', type: 'image', order: 0 }],
  creative_brief: { compose: false, vacancy: { checked_fields: ALL_KEYS, used_fallback: false, attempts: 1 } },
  ...o,
});
/** Linha entregue ligada ao post. */
const delivered = (p: StoryPost, o: Partial<StoryRow> = {}, v?: FreelaVacancy) => row({ status: 'handed_off', ig_post_id: p.id, ...o }, v);

const pick = (d: ReturnType<typeof displayOf>) => ({ display: d.display, label: d.label, support: d.support, reason: d.reason });

describe('displayOf — situações da lista (UI §4)', () => {
  const s = settings();

  it('na fila: linha nova (e a que espera depois de erro da IA, com o motivo no apoio)', () => {
    expect(pick(displayOf(row(), null, s, NOW))).toEqual({ display: 'queued', label: 'Na fila para criar a arte', support: null, reason: null });
    const ai = 'A IA não conseguiu criar a arte: a chave da OpenAI está sem crédito.';
    expect(pick(displayOf(row({ status: 'waiting', wait_reason: ai, next_attempt_at: at(5 * MIN) }), null, s, NOW))).toEqual({
      display: 'queued', label: 'Na fila para criar a arte', support: ai, reason: null,
    });
  });

  it('gerando: "Criando a arte" / "Tentativa {n} de 3" pelo contador ao vivo do gerador (R28: mismatch_attempts + 1, máx. 3)', () => {
    expect(pick(displayOf(row({ status: 'generating' }), null, s, NOW))).toEqual({
      display: 'generating', label: 'Criando a arte', support: 'Tentativa 1 de 3', reason: null,
    });
    expect(displayOf(row({ status: 'generating', mismatch_attempts: 1 }), null, s, NOW).support).toBe('Tentativa 2 de 3');
    expect(displayOf(row({ status: 'generating', mismatch_attempts: 2 }), null, s, NOW).support).toBe('Tentativa 3 de 3');
    // O log de uma rodada anterior (erro da IA) não conta: só o contador ao vivo.
    const old = [1, 2].map((n) => ({ n, at: NOW.toISOString(), kind: 'ai', ok: false, wrong: ['valor'], forbidden: [] }));
    expect(displayOf(row({ status: 'generating', attempts_log: old }), null, s, NOW).support).toBe('Tentativa 1 de 3');
    expect(displayOf(row({ status: 'generating', mismatch_attempts: 3 }), null, s, NOW).support).toBe('Tentativa 3 de 3');
  });

  it('esperando o horário: chegou às 22h10 → "Vai ao ar amanhã às 8h"; chegou às 7h → "Vai ao ar às 8h"', () => {
    const p = post({ status: 'scheduled', scheduled_at: TOMORROW_8H });
    const night = new Date('2026-10-30T01:10:00Z'); // 22h10 de quinta
    expect(pick(displayOf(delivered(p), p, s, night))).toEqual({
      display: 'waiting_window', label: 'Esperando o horário', support: 'Vai ao ar amanhã às 8h', reason: null,
    });
    const early = new Date('2026-10-30T10:00:00Z'); // 7h de sexta
    expect(displayOf(delivered(p), p, s, early).support).toBe('Vai ao ar às 8h');
    // Dentro da janela, empurrado para amanhã sem o limite cheio (15 min entre stories perto do fim, limite da Meta).
    expect(displayOf(delivered(p), p, s, NOW, { capFull: false }).display).toBe('waiting_window');
  });

  it('esperando a vez: linha no limite e post empurrado para amanhã com o limite cheio (B4: o máximo, não a contagem)', () => {
    const cap = 'O máximo de hoje (10) já está preenchido. Vai ao ar amanhã às 8h, se ainda der tempo de divulgar.';
    expect(pick(displayOf(row({ status: 'waiting', wait_reason: WAIT_CAP, not_before: TOMORROW_8H }), null, s, NOW))).toEqual({
      display: 'waiting_cap', label: 'Esperando a vez', support: cap, reason: null,
    });
    const p = post({ status: 'scheduled', scheduled_at: TOMORROW_8H });
    expect(pick(displayOf(delivered(p), p, s, NOW, { capFull: true }))).toEqual({ display: 'waiting_cap', label: 'Esperando a vez', support: cap, reason: null });
    expect(displayOf(row({ status: 'waiting', wait_reason: WAIT_CAP, not_before: TOMORROW_8H }), null, settings({ daily_cap: 1 }), NOW).support).toBe(
      'O máximo de hoje (1) já está preenchido. Vai ao ar amanhã às 8h, se ainda der tempo de divulgar.',
    );
    expect(displayOf(delivered(p), p, settings({ daily_cap: 1 }), NOW, { capFull: true }).support).toBe(
      'O máximo de hoje (1) já está preenchido. Vai ao ar amanhã às 8h, se ainda der tempo de divulgar.',
    );
    // Empurrado pelo limite de publicações da Meta (não pelo do dia): o aviso do limite da conta.
    expect(pick(displayOf(delivered(p), p, s, NOW, { capFull: false, igFull: true }))).toEqual({
      display: 'waiting_cap', label: 'Esperando a vez', reason: null,
      support: 'A conta está perto do limite do Instagram (25 publicações em 24 h, somando os posts normais). Vai ao ar amanhã às 8h.',
    });
    // Dois dias depois: sem "amanhã".
    expect(displayOf(row({ status: 'waiting', wait_reason: WAIT_CAP, not_before: new Date('2026-10-31T11:00:00Z') }), null, s, NOW).support).toBe(
      'O máximo de hoje (10) já está preenchido. Vai ao ar dia 31/10 às 8h, se ainda der tempo de divulgar.',
    );
  });

  it('esperando aprovação: vaga às 18h15 → "Aprove até 16h" (antecedência + 15 min de folga da fila)', () => {
    const v = vac({ startTime: '2026-10-29T21:15:00Z', endTime: '2026-10-30T02:00:00Z' });
    const p = post({ status: 'pending_approval' });
    const d = displayOf(delivered(p, {}, v), p, s, NOW);
    expect(pick(d)).toEqual({
      display: 'to_approve', label: 'Esperando sua aprovação', support: 'Aprove até 16h. Depois disso não dá tempo de divulgar.', reason: null,
    });
    expect(d.approve_until).toEqual(new Date('2026-10-29T19:00:00Z'));
  });

  it('A4: "Aprovar" só até o prazo de aprovação (16h para a vaga das 18h15)', () => {
    const v = vac({ startTime: '2026-10-29T21:15:00Z', endTime: '2026-10-30T02:00:00Z' });
    const p = post({ status: 'pending_approval' });
    expect(storyView(delivered(p, {}, v), p, s, new Date('2026-10-29T18:59:00Z')).can.approve).toBe(true);
    expect(storyView(delivered(p, {}, v), p, s, new Date('2026-10-29T19:00:00Z')).can.approve).toBe(false);
  });

  it('prazo de aprovação respeita a janela: vaga amanhã às 9h → até 21h de hoje; vaga às 23h30 → até 21h', () => {
    expect(approveUntil(new Date('2026-10-30T12:00:00Z'), s)).toEqual(new Date('2026-10-30T00:00:00Z'));
    expect(approveUntil(new Date('2026-10-30T02:30:00Z'), s)).toEqual(new Date('2026-10-30T00:00:00Z'));
    const v = vac({ startTime: '2026-10-30T12:00:00Z', endTime: '2026-10-30T18:00:00Z' });
    const p = post({ status: 'pending_approval' });
    expect(displayOf(delivered(p, {}, v), p, s, NOW).support).toBe('Aprove até 21h. Depois disso não dá tempo de divulgar.');
  });

  it('pronto (sozinho): "Pronto, vai ao ar às 14h50"; sem horário (Instagram desconectado) → apoio com o motivo', () => {
    const p = post({ status: 'scheduled', scheduled_at: new Date('2026-10-29T17:50:00Z') });
    expect(pick(displayOf(delivered(p), p, s, NOW))).toEqual({ display: 'ready', label: 'Pronto, vai ao ar às 14h50', support: null, reason: null });
    const off = post({ status: 'ready', last_error: 'Conecte o Instagram para publicar.' });
    expect(pick(displayOf(delivered(off), off, s, NOW))).toEqual({
      display: 'ready', label: 'Pronto para ir ao ar', support: 'Conecte o Instagram para publicar.', reason: null,
    });
  });

  it('no ar até amanhã; depois de 24 h "Ficou 24 h no ar"', () => {
    const p = post({ status: 'published', published_at: at(-HOUR), scheduled_at: at(-HOUR) });
    expect(pick(displayOf(delivered(p), p, s, NOW))).toEqual({ display: 'live', label: 'No ar até amanhã às 9h', support: null, reason: null });
    const old = post({ status: 'published', published_at: at(-25 * HOUR) });
    expect(pick(displayOf(delivered(old), old, s, NOW))).toEqual({ display: 'was_live', label: 'Ficou 24 h no ar', support: null, reason: null });
    // Publicado ontem às 14h: no ar até hoje às 14h.
    const y = post({ status: 'published', published_at: new Date('2026-10-28T17:00:00Z') });
    expect(displayOf(delivered(y), y, s, NOW).label).toBe('No ar até 14h');
  });

  it('pulada: "Não virou story" com o motivo', () => {
    expect(pick(displayOf(row({ status: 'skipped', skip_reason: 'Cidade fora da sua lista: Jundiaí.' }), null, s, NOW))).toEqual({
      display: 'skipped', label: 'Não virou story', support: null, reason: 'Cidade fora da sua lista: Jundiaí.',
    });
  });

  it('cancelada: motivo da linha primeiro, depois "Você escolheu não postar." (recusado) e o erro do post; expirada também', () => {
    const c = (r: StoryRow, p: StoryPost | null) => pick(displayOf(r, p, s, NOW));
    const off = 'Os stories das vagas foram desligados.';
    expect(c(row({ status: 'cancelled', skip_reason: off }), null)).toEqual({ display: 'cancelled', label: 'Não foi ao ar', support: null, reason: off });
    const started = 'A vaga começou antes de ir ao ar.';
    const p1 = post({ status: 'cancelled', last_error: 'Limite de 25 publicações por dia.', rejection_reason: 'qualquer' });
    expect(c(delivered(p1, { skip_reason: started }), p1).reason).toBe(started);
    const p2 = post({ status: 'cancelled', rejection_reason: 'Texto errado' });
    expect(c(delivered(p2), p2).reason).toBe('Você escolheu não postar.');
    const p3 = post({ status: 'cancelled', last_error: 'Post cancelado.' });
    expect(c(delivered(p3), p3).reason).toBe('Post cancelado.');
    const expired = 'Não coube no máximo de 10 stories de vagas por dia antes do início da vaga (Sáb, 31/10 às 18h).';
    expect(c(row({ status: 'expired', skip_reason: expired }), null)).toEqual({ display: 'cancelled', label: 'Não foi ao ar', support: null, reason: expired });
  });

  it('falhou: motivo da linha; post recusado pelo Instagram → "O Instagram recusou a publicação: {motivo}."', () => {
    const many = 'A vaga mudou muitas vezes no Freela. Crie o story de novo quando ela estiver definida.';
    expect(pick(displayOf(row({ status: 'failed', skip_reason: many }), null, s, NOW))).toEqual({
      display: 'failed', label: 'Não conseguimos criar o story', support: null, reason: many,
    });
    const p = post({ status: 'failed', last_error: 'A mídia não está no formato aceito.' });
    expect(pick(displayOf(delivered(p), p, s, NOW))).toEqual({
      display: 'failed', label: 'Não conseguimos criar o story', support: null,
      reason: 'O Instagram recusou a publicação: A mídia não está no formato aceito.',
    });
  });
});

describe('storyView / storyDetail', () => {
  const s = settings();

  it('campos da vaga, link do Freela, mídia e ações de um story esperando aprovação', () => {
    const v = vac();
    const p = post({ status: 'pending_approval', ig_permalink: null });
    const r = delivered(p, { attempts_log: [{ n: 1, at: NOW.toISOString(), kind: 'ai', ok: true, wrong: [], forbidden: [] }] }, v);
    const view = storyView(r, p, s, NOW);
    expect(view).toMatchObject({
      id: r.id, external_id: v.id, status: 'handed_off', display: 'to_approve', label: 'Esperando sua aprovação',
      funcao: 'Garçom', estabelecimento: 'Coco Bambu', valor: 'R$ 150', quando: 'Sáb 31/10 · 18h às 23h', cidade: 'Campinas',
      starts_at: new Date(v.startTime), approve_until: new Date('2026-10-31T18:45:00Z'), scheduled_at: null, published_at: null,
      permalink: null, thumb_url: 'https://cdn.test/story.jpg', media_url: 'https://cdn.test/story.jpg', attempts: 1, used_fallback: false,
      redo_count: 0, ig_post_id: p.id, is_test: false, freela_url: `https://www.freelaservicosapp.com.br/vagas/${v.id}`, own_art: false,
      can: { approve: true, dont_post: true, post_now: false, create_anyway: false, redo: true, retry: false },
    });
  });

  it('ações por situação: postar agora só esperando; criar mesmo assim só pulada/cancelada com a vaga por começar; refazer até o teto', () => {
    const can = (r: StoryRow, p: StoryPost | null, o: { now?: Date; s?: SettingsRow } = {}) => storyView(r, p, o.s ?? s, o.now ?? NOW).can;
    expect(can(row(), null)).toEqual({ approve: false, dont_post: true, post_now: false, create_anyway: false, redo: false, retry: false });
    expect(can(row({ status: 'generating' }), null)).toEqual({ approve: false, dont_post: false, post_now: false, create_anyway: false, redo: false, retry: false });
    expect(can(row({ status: 'waiting', wait_reason: WAIT_CAP, not_before: TOMORROW_8H }), null)).toMatchObject({ post_now: true, dont_post: true });
    const sched = post({ status: 'scheduled', scheduled_at: TOMORROW_8H });
    expect(can(delivered(sched), sched)).toMatchObject({ post_now: true, dont_post: true, redo: true });
    expect(can(delivered(sched, { redo_count: 3 }), sched)).toMatchObject({ redo: false });
    const soon = post({ status: 'scheduled', scheduled_at: at(30 * MIN) });
    expect(can(delivered(soon), soon)).toMatchObject({ post_now: false, dont_post: true });
    const publishing = post({ status: 'publishing', scheduled_at: at(-MIN) });
    expect(can(delivered(publishing), publishing)).toEqual({ approve: false, dont_post: false, post_now: false, create_anyway: false, redo: false, retry: false });

    const test = row({ status: 'skipped', skip_reason: 'Parece vaga de teste: o nome da empresa tem “teste”.' }, vac({ contractorName: 'Bar Teste' }));
    expect(can(test, null)).toMatchObject({ create_anyway: true });
    expect(storyView(test, null, s, NOW)).toMatchObject({ is_test: true, contractor_name: 'Bar Teste', estabelecimento: null });
    // Vaga já começou, vaga fechada ou função desligada: sem "Criar story mesmo assim".
    expect(can(test, null, { now: new Date('2026-11-01T00:00:00Z') })).toMatchObject({ create_anyway: false });
    expect(can(row({ status: 'cancelled', skip_reason: 'A vaga não está mais aberta no Freela (preenchida ou cancelada).' }), null)).toMatchObject({ create_anyway: false });
    expect(can(test, null, { s: settings({ enabled: false }) })).toMatchObject({ create_anyway: false });
    // R30: sem valor ou sem cidade não volta; dentro da antecedência + 15 min também não.
    expect(can(row({ status: 'skipped', skip_reason: 'A vaga não tem valor informado.' }), null)).toMatchObject({ create_anyway: false });
    expect(can(row({ status: 'skipped', skip_reason: 'A vaga não tem cidade informada.' }), null)).toMatchObject({ create_anyway: false });
    const soonVac = (ms: number) => vac({ startTime: at(ms).toISOString(), endTime: at(ms + 4 * HOUR).toISOString() });
    const close = 'A vaga começa Qui, 29/10 às 12h10. Para dar tempo de divulgar, o story teria de ir ao ar até as 10h10.';
    expect(can(row({ status: 'skipped', skip_reason: close }, soonVac(2 * HOUR + 10 * MIN)), null)).toMatchObject({ create_anyway: false });
    expect(can(row({ status: 'skipped', skip_reason: close }, soonVac(2 * HOUR + 20 * MIN)), null)).toMatchObject({ create_anyway: true });
    // Não postado depois da entrega: volta pelo "Criar story mesmo assim".
    const mine = post({ status: 'cancelled', rejection_reason: 'Você escolheu não postar.' });
    expect(can(delivered(mine, { skip_reason: 'Você escolheu não postar.' }), mine)).toMatchObject({ create_anyway: true, redo: false });

    expect(can(row({ status: 'failed', skip_reason: 'x' }), null)).toMatchObject({ retry: true, redo: false });
    const failed = post({ status: 'failed', last_error: 'erro' });
    expect(can(delivered(failed), failed)).toMatchObject({ retry: true, redo: false, dont_post: false });
  });

  it('valor e cidade ausentes ficam nulos (vaga pulada sem valor)', () => {
    const v = vac({ amountInCents: null, city: null });
    expect(storyView(row({ status: 'skipped', skip_reason: 'A vaga não tem valor informado.' }, v), null, s, NOW)).toMatchObject({ valor: null, cidade: null, funcao: 'Garçom' });
  });

  it('detalhe: conferência campo a campo, tentativas e texto alternativo', () => {
    const v = vac({ contractorName: null });
    const log = [
      { n: 1, at: NOW.toISOString(), kind: 'ai', ok: false, wrong: ['inicio'], forbidden: [] },
      { n: 2, at: NOW.toISOString(), kind: 'ai', ok: true, wrong: [], forbidden: [] },
    ];
    const p = post({ status: 'pending_approval', creative_brief: { vacancy: { checked_fields: ALL_KEYS, used_fallback: false, attempts: 2 } } });
    const d = storyDetail(delivered(p, { attempts_log: log, mismatch_attempts: 1 }, v), p, s, NOW);
    expect(d.alt).toBe('Story: Garçom, R$ 150, Sáb 31/10, 18h às 23h, Campinas');
    expect(d.attempts_log).toEqual(log);
    expect(d.attempts).toBe(2);
    expect(d.checks).toEqual([
      { key: 'funcao', label: 'função', ok: true, read: null, expected: 'Garçom' },
      { key: 'valor', label: 'valor', ok: true, read: null, expected: 'R$ 150' },
      { key: 'data', label: 'data', ok: true, read: null, expected: 'Sáb, 31/10' },
      { key: 'inicio', label: 'horário de início', ok: true, read: null, expected: '18h' },
      { key: 'fim', label: 'horário de fim', ok: true, read: null, expected: '23h' },
      { key: 'cidade', label: 'cidade', ok: true, read: null, expected: 'Campinas' },
    ]);
    // Reserva: textos escritos pelo sistema, todos conferem. Antes da entrega: sem conferência.
    const fb = post({ status: 'pending_approval', creative_brief: { vacancy: { checked_fields: [], used_fallback: true } } });
    expect(storyDetail(delivered(fb, { used_fallback: true }, vac()), fb, s, NOW).checks.every((c) => c.ok)).toBe(true);
    expect(storyDetail(row(), null, s, NOW).checks).toEqual([]);
    expect(d.own_art).toBe(false);
  });

  it('R29: arte trocada por "Enviar minha própria" → sem conferência (checks vazio) e own_art', () => {
    const p = post({
      status: 'pending_approval',
      ai_generation_log: [{ at: NOW.toISOString(), step: 'vacancy_art', attempt: 1, ok: true }, { at: NOW.toISOString(), step: 'upload', file: 'minha.jpg' }],
    });
    const d = storyDetail(delivered(p), p, s, NOW);
    expect(d).toMatchObject({ checks: [], own_art: true, display: 'to_approve' });
    expect(storyView(delivered(p), p, s, NOW).own_art).toBe(true);
    // R35: arte escolhida na Biblioteca também é própria.
    const lib = post({ status: 'pending_approval', ai_generation_log: [{ step: 'vacancy_art', attempt: 1, ok: true }, { step: 'library', asset_id: 'a1' }] });
    expect(storyDetail(delivered(lib), lib, s, NOW)).toMatchObject({ own_art: true, checks: [] });
    // Gerada de novo depois do envio: o último passo volta a ser da arte.
    const again = post({ status: 'pending_approval', ai_generation_log: [{ step: 'upload' }, { step: 'vacancy_art', attempt: 1, ok: true }] });
    expect(storyDetail(delivered(again), again, s, NOW)).toMatchObject({ own_art: false, checks: expect.arrayContaining([expect.objectContaining({ ok: true })]) });
  });
});

describe('previewForView', () => {
  it('prévia "running" há mais de 10 min aparece como falha; o resto passa como está', () => {
    expect(previewForView({}, NOW)).toEqual({});
    const fresh = { status: 'running', step: 'art', attempt: 1, started_at: at(-5 * MIN).toISOString() };
    expect(previewForView(fresh, NOW)).toEqual(fresh);
    const stuck = { ...fresh, started_at: at(-11 * MIN).toISOString() };
    expect(previewForView(stuck, NOW)).toEqual({ ...stuck, status: 'failed', error: 'A prévia não terminou. Toque em Gerar prévia com uma vaga real para tentar de novo.' });
  });
});
