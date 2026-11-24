jest.setTimeout(240_000);

import { createHash } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import jsQR from 'jsqr';
import { ImageService } from '../../media/image.service';
import { loadBadges } from '../vacancy-art';
import { composeBaseArt, loadBaseFonts } from '../vacancy-base-art';
import { cltFields } from '../vacancy-clt';
import { cltCards, composeCltArt } from '../vacancy-clt-art';
import { VacancyFeedClient } from '../vacancy-feed';
import { planQr, verifyQrPixels } from '../vacancy-qr';
import type { CltFields } from '../vacancy-types';
import { fixedJob } from './world';

const images = new ImageService();
const badges = loadBadges();
const fonts = loadBaseFonts();
const sha = (b: Uint8Array) => createHash('sha256').update(b).digest('hex');
const ID = '3f2a9c1e-7b4d-4e8a-9c2f-1a2b3c4d5e6f';
const fields: CltFields = cltFields(fixedJob({ id: ID, benefits: ['Vale-transporte', 'Refeição no local', 'Plano de saúde'] }));

async function readQr(bytes: Uint8Array, width?: number): Promise<string | null> {
  const img = await images.read(bytes);
  if (width) img.resize({ w: width, h: Math.round((img.bitmap.height * width) / img.bitmap.width) });
  const { data, width: w, height: h } = img.bitmap;
  return jsQR(new Uint8ClampedArray(data.buffer, data.byteOffset, data.length), w, h)?.data ?? null;
}

describe('arte das diárias depois da extração das peças (M15): bytes iguais aos de antes', () => {
  // Hashes tirados em 25/11 com o código de 72101c2 (antes da extração), foto e logo sintéticas.
  const diaria = { funcao: 'Auxiliar de cozinha noturno', estabelecimento: 'Coco Bambu', data: 'Sáb, 29/10', horario: '18h às 23h', valor: 'R$ 150', cidade: 'Campinas', regiao: null, descricao: null, expected: { cents: 15000, day: 29, month: 10, weekday: 4, startMin: 1080, endMin: 1380 } };
  it('com foto, logo e QR; sem foto e sem QR', async () => {
    const photo = await images.encode(images.blank(256, 384, 0x2b6cb0ff), true);
    const logo = await images.encode(images.blank(300, 120, 0xff0000ff), true);
    const qr = planQr('https://freelaservicos.com.br/vagas/3f2a9c1e-7b4d-4e8a-9c2f-1a2b3c4d5e6f?o=ig');
    expect(sha(await composeBaseArt(images, { fields: diaria, photo, logo, badges, fonts, qr }))).toBe('ef4598581f129ad82d1e02857acfab92dd7f6bdc4a66e21afbf69740f8377d90');
    expect(sha(await composeBaseArt(images, { fields: diaria, photo: null, logo, badges, fonts }))).toBe('dbdb6e4f37217c0c99e75d7aa076347ea97bf0670195bd65346edb83e7abfd21');
  });
});

describe('arte "Vaga fixa CLT" (M15; UI §3)', () => {
  it('cartões da UI §3.4: Empresa, Escala, Cidade, Salário por mês (cheio) e Benefícios; sem o cartão Cargo', () => {
    const cards = cltCards(fields);
    expect(cards.map((c) => c.cols[0]!.label)).toEqual(['Empresa:', 'Escala:', 'Cidade:', 'Salário por mês:', 'Benefícios:']);
    expect(cards[0]!.cols[0]!.value).toBe('SPOLETO SHOPPING ANÁLIA FRANCO');
    expect(cards[3]).toMatchObject({ dark: true, filled: true, cols: [{ value: 'R$ 1.874,32', big: true }] });
  });

  it('campo que falta tira o cartão (empresa, escala, cidade e benefícios); mínimo = salário', () => {
    const min: CltFields = { cargo: 'Cumim', empresa: null, salario: 'R$ 2.550', escala: null, cidade: null, beneficios: null };
    expect(cltCards(min).map((c) => c.cols[0]!.label)).toEqual(['Salário por mês:']);
    expect(cltCards({ ...fields, empresa: null }).map((c) => c.icon)).not.toContain('store');
    expect(cltCards({ ...fields, cidade: null }).map((c) => c.icon)).not.toContain('pin');
  });

  it('1080 × 1920; o jsqr lê /vagas-fixas/<id>?o=ig na arte inteira e a 720 px, e a conferência do sistema concorda', async () => {
    const feed = new VacancyFeedClient({ NODE_ENV: 'test', FREELA_PUBLIC_API_URL: undefined, FREELA_FIXED_JOB_PAGE_URL: 'https://freelaservicos.com.br/vagas-fixas/' }, fetch);
    const url = feed.fixedJobQrLink(ID)!;
    expect(url).toBe(`https://freelaservicos.com.br/vagas-fixas/${ID}?o=ig`);
    const plan = planQr(url)!;
    expect(plan).toMatchObject({ count: 37, module: 4 });
    const photo = await images.encode(images.blank(256, 384, 0x2b6cb0ff), true);
    const bytes = await composeCltArt(images, { fields, photo, logo: null, badges, fonts, qr: plan });
    const img = await images.read(bytes);
    expect([img.bitmap.width, img.bitmap.height]).toEqual([1080, 1920]);
    expect(await readQr(bytes)).toBe(url);
    expect(await readQr(bytes, 720)).toBe(url);
    expect(await verifyQrPixels(images, bytes, plan)).toBe(true);
    if (process.env.MF_CLT_ART_OUT) writeFileSync(process.env.MF_CLT_ART_OUT, bytes);
  });

  it('sem a página no ar (variável vazia) não há link; sem QR, sem empresa e sem cidade a arte sai', async () => {
    const feed = new VacancyFeedClient({ NODE_ENV: 'test', FREELA_PUBLIC_API_URL: undefined }, fetch);
    expect(feed.fixedJobQrLink(ID)).toBeNull();
    expect(feed.fixedJobPage(ID)).toBeNull();
    const bytes = await composeCltArt(images, { fields: { ...fields, empresa: null, cidade: null, cargo: 'Auxiliar de cozinha para o turno' }, photo: null, logo: null, badges, fonts });
    const img = await images.read(bytes);
    expect([img.bitmap.width, img.bitmap.height]).toEqual([1080, 1920]);
    expect(await readQr(bytes)).toBeNull();
    if (process.env.MF_CLT_ART_OUT) writeFileSync(`${process.env.MF_CLT_ART_OUT}.min.jpg`, bytes);
  });
});
