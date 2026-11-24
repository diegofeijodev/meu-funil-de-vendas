jest.setTimeout(240_000);

import { createHash } from 'node:crypto';
import jsQR from 'jsqr';
import { igServices, uuid } from '../../instagram/__tests__/harness';
import { RefsService } from '../../creative/refs.service';
import { ImageService } from '../../media/image.service';
import { MARKETING, OWNER, VIEWER, WS_A, WS_B, status } from '../../media/__tests__/mem';
import { loadBadges } from '../vacancy-art';
import { composeBaseArt, loadBaseFonts } from '../vacancy-base-art';
import { VacancyGeneratorService } from '../vacancy-generator.service';
import { VacancyPreviewService } from '../vacancy-preview.service';
import { drawQr, planQr, QR_BOX, QR_CHECK_WIDTH, vacancyLink, verifyQrPixels } from '../vacancy-qr';
import { randomUUID } from 'node:crypto';
import type { FreelaVacancy, VacancyFields } from '../vacancy-types';
import { vacancyWorld, type VacancyWorld } from './world';

const images = new ImageService();
const badges = loadBadges();
const fonts = loadBaseFonts();
const sha = (b: Uint8Array) => createHash('sha256').update(b).digest('hex');
/** Arte destes campos, sem foto e sem logo, gerada pelo código de ANTES do QR (commit eb3eba2, hash tirado em 24/11 antes da mudança). */
const REFERENCE_SHA = '33a7cec2805c9cc45f91c30c1c5f9b7544a46043efa84dc7ce4529a26bfea750';

const fields: VacancyFields = {
  funcao: 'Garçom',
  estabelecimento: 'Coco Bambu',
  data: 'Sáb, 29/10',
  horario: '18h às 23h',
  valor: 'R$ 150',
  cidade: 'Campinas',
  regiao: 'Cambuí',
  descricao: 'Atendimento no salão, servir mesas e ajudar no fechamento.',
  expected: { cents: 15000, day: 29, month: 10, weekday: 4, startMin: 1080, endMin: 1380 },
};
const ID = '3f2a9c1e-7b4d-4e8a-9c2f-1a2b3c4d5e6f';
const URL = `https://freelaservicos.com.br/vagas/${ID}?o=ig`;

/** Lê a arte com o jsqr (só em dev/test), na largura dada. */
async function readQr(bytes: Uint8Array, width?: number): Promise<string | null> {
  const img = await images.read(bytes);
  if (width) img.resize({ w: width, h: Math.round((img.bitmap.height * width) / img.bitmap.width) });
  const { data, width: w, height: h } = img.bitmap;
  return jsQR(new Uint8ClampedArray(data.buffer, data.byteOffset, data.length), w, h)?.data ?? null;
}

describe('rodapé SEM QR: byte a byte igual ao de antes (V5)', () => {
  it('qr ausente ou null = arte de referência', async () => {
    expect(sha(await composeBaseArt(images, { fields, photo: null, logo: null, badges, fonts }))).toBe(REFERENCE_SHA);
    expect(sha(await composeBaseArt(images, { fields, photo: null, logo: null, badges, fonts, qr: null }))).toBe(REFERENCE_SHA);
  });
});

describe('link e matriz do QR (P3)', () => {
  it('link da diária: sem www, ?o=ig, 77 caracteres → versão 5 (37 módulos) com correção M, módulo de 4 px e zona clara de 4', () => {
    expect(vacancyLink(ID)).toBe(URL);
    expect(URL).toHaveLength(77);
    expect(planQr(URL)).toMatchObject({ url: URL, count: 37, ecl: 'M', module: 4 });
    expect((37 + 8) * 4).toBe(QR_BOX.size);
  });

  it('id que não é UUID (texto livre, vaga de exemplo) não vira link; link longo demais não cabe → sem QR', () => {
    expect(vacancyLink('exemplo')).toBeNull();
    expect(vacancyLink('123')).toBeNull();
    expect(planQr(`https://freelaservicos.com.br/vagas/${'x'.repeat(200)}`)).toBeNull();
  });
});

describe('arte COM QR: lida pelo jsqr e pela conferência do sistema (JPEG q92 e 720 px)', () => {
  let bytes: Uint8Array;
  const plan = planQr(URL)!;
  beforeAll(async () => {
    bytes = await composeBaseArt(images, { fields, photo: null, logo: null, badges, fonts, qr: plan });
  });

  it('jsqr lê a URL na arte inteira e reduzida a 720 px; a conferência por módulo concorda', async () => {
    expect(await readQr(bytes)).toBe(URL);
    expect(await readQr(bytes, QR_CHECK_WIDTH)).toBe(URL);
    expect(await verifyQrPixels(images, bytes, plan)).toBe(true);
    expect(sha(bytes)).not.toBe(REFERENCE_SHA);
  });

  it('QR estragado (canto de localização apagado): o jsqr não lê e a conferência também falha', async () => {
    const img = await images.read(bytes);
    const d = img.bitmap.data;
    const W = img.bitmap.width;
    // apaga (branco) o quadrado de localização de cima à esquerda: 7 módulos de 4 px a partir da origem do código
    const ox = QR_BOX.x + 16;
    const oy = QR_BOX.y + 16;
    for (let y = oy; y < oy + 28; y++) for (let x = ox; x < ox + 28; x++) d.fill(255, (y * W + x) * 4, (y * W + x) * 4 + 3);
    const broken = await images.encode(img, false, 92);
    expect(await readQr(broken, QR_CHECK_WIDTH)).toBeNull();
    expect(await verifyQrPixels(images, broken, plan)).toBe(false);
  });

  it('a conferência compara com a matriz da URL certa: outra URL no mesmo lugar não passa', async () => {
    const other = planQr(`https://freelaservicos.com.br/vagas/${uuid()}?o=ig`)!;
    expect(await verifyQrPixels(images, bytes, other)).toBe(false);
  });
});

describe('conferência sem falso negativo (8 links aleatórios)', () => {
  it('sempre que o jsqr lê a 720 px, a conferência do sistema também aprova (e todos são lidos)', async () => {
    let read = 0;
    for (let i = 0; i < 8; i++) {
      const url = vacancyLink(randomUUID())!;
      const p = planQr(url)!;
      expect(p).toMatchObject({ count: 37, ecl: 'M', module: 4 });
      const cv = images.blank(1080, 1920, 0x111111ff);
      drawQr(cv, p);
      const jpg = await images.encode(cv, false, 92);
      const got = await readQr(jpg, QR_CHECK_WIDTH);
      if (got === url) read++;
      if (got === url) expect(await verifyQrPixels(images, jpg, p)).toBe(true);
    }
    expect(read).toBe(8);
  });
});

// ---------------------------------------------------------------------------------------------------------------------
// Prévia com QR (P2) e a trava no servidor (P4)
// ---------------------------------------------------------------------------------------------------------------------

const NOW = new Date('2026-11-24T13:00:00Z');
const vac = (o: Partial<FreelaVacancy> = {}): FreelaVacancy => ({
  id: ID, title: 'Garçom', serviceType: 'garcom', city: 'Campinas', date: '2026-11-28', startTime: '2026-11-28T21:00:00Z', endTime: '2026-11-29T02:00:00Z',
  amountInCents: 15000, contractorName: 'COCO BAMBU', publishedAt: '2026-11-24T10:00:00Z', isUpcoming: true, ...o,
});

let w: VacancyWorld;
afterEach(() => w?.cleanup());

async function previewSetup() {
  w = vacancyWorld({ list: `${WS_A},${WS_B}` });
  const s = igServices(w);
  const refs = new RefsService(w.prisma, w.files, s.assets as never, w.images);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const gen = new VacancyGeneratorService(w.prisma, w.ai as any, w.images, w.files, s.assets as never, refs, w.store, w.feedClient, w.gate);
  const preview = new VacancyPreviewService(w.prisma, w.access, w.gate, w.feedClient, w.settings, gen, s.assets);
  preview.now = () => NOW.getTime();
  for (const ws of [WS_A, WS_B]) await w.prisma.vacancy_story_settings.create({ data: { workspace_id: ws, template_asset_id: uuid(), vendor: 'openai' } });
  // IA sem foto (erro): a arte sai sem foto — serve para testar o QR (UI §2.5).
  w.ai.image.mockRejectedValue(new Error('sem créditos'));
  const row = (ws = WS_A) => w.t['vacancy_story_settings']!.rows.find((r) => r.workspace_id === ws)!;
  return { preview, gen, row };
}

describe('prévia com QR e o interruptor (P2, P4)', () => {
  it('prévia com { qr: true } e o QR desligado: sai com o QR conferido; aí o dono liga (e A não libera B)', async () => {
    const t = await previewSetup();
    w.feed.state.vacancies = [vac()];
    expect(await status(w.settings.setQr(OWNER, WS_A, true))).toBe('422:Gere uma prévia com o QR para poder ligar.');
    await t.preview.start(OWNER, WS_A, { qr: true });
    await t.preview.wait(WS_A);
    expect(t.row().preview).toMatchObject({ status: 'done', qr: { url: URL, read_ok: true } });
    expect(t.row().qr_enabled).toBe(false);
    const on = await w.settings.setQr(OWNER, WS_A, true);
    expect(on).toMatchObject({ qr_enabled: true });
    expect(on.qr_enabled_at).toBeInstanceOf(Date);
    expect(w.t['activity_logs']!.rows.find((r) => r.action === 'vacancy_stories.qr')!.metadata).toEqual({ qr_enabled: true });
    // A prévia de A não destrava B (mesmo dono nas duas)
    w.member(WS_B, OWNER, 'owner');
    expect(await status(w.settings.setQr(OWNER, WS_B, true))).toBe('422:Gere uma prévia com o QR para poder ligar.');
    // desligar sempre pode
    expect(await w.settings.setQr(OWNER, WS_A, false)).toMatchObject({ qr_enabled: false, qr_enabled_at: null });
  });

  it('prévia sem pedir QR e com ele desligado: sem QR (como antes); com a vaga de exemplo: QR pedido sai sem link', async () => {
    const t = await previewSetup();
    w.feed.state.vacancies = [vac()];
    await t.preview.start(OWNER, WS_A);
    await t.preview.wait(WS_A);
    expect(t.row().preview.qr).toBeNull();
    w.feed.state.vacancies = [];
    await t.preview.start(OWNER, WS_A, { qr: true });
    await t.preview.wait(WS_A);
    expect(t.row().preview).toMatchObject({ status: 'done', sample: true, qr: { url: null, read_ok: false } });
    expect(await status(w.settings.setQr(OWNER, WS_A, true))).toBe('422:Gere uma prévia com o QR para poder ligar.');
  });

  it('só dono/admin liga ou desliga (marketing e viewer 403)', async () => {
    await previewSetup();
    expect(await status(w.settings.setQr(MARKETING, WS_A, false))).toBe('403:Seu perfil não tem permissão para esta ação.');
    expect(await status(w.settings.setQr(VIEWER, WS_A, false))).toBe('403:Seu perfil não tem permissão para esta ação.');
  });
});
