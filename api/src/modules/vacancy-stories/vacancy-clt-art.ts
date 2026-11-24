/**
 * Arte "Vaga fixa CLT" (UI 24/11 §3; desenho §2.4.3), desenhada pelo SISTEMA como a das diárias e com as mesmas peças (fundo, foto, logo,
 * cargo, cartões, rodapé com ou sem QR). O que muda e diz "é emprego fixo" sem depender da cor: "VAGA FIXA" em pincelada azul-carteira,
 * a pílula "CARTEIRA ASSINADA" e "Salário por mês:". Sem o cartão "Cargo" (o cargo já está no título, em letra grande — D8).
 */
import type { RGB } from '../creative/compose';
import type { ImageService } from '../media/image.service';
import type { Badges } from './vacancy-art';
import { fitWrapped } from './vacancy-art';
import {
  artFonts, type BaseFonts, brush, type Card, drawBackdrop, drawCards, drawFooter, drawPill, drawRole, icon, PILL_H, text, TITLE_DEG, TITLE_PIVOT,
  WHITE,
} from './vacancy-base-art';
import type { QrPlan } from './vacancy-qr';
import type { CltFields } from './vacancy-types';

/** Azul da Carteira de Trabalho (#1E3A8A): branco sobre ele 10,4:1, amarelo da marca 6,6:1 (UI §3.2). */
export const CARTEIRA: RGB = [30, 58, 138];
export const CLT_TITLE = 'VAGA FIXA';
export const CLT_PILL = 'CARTEIRA ASSINADA';
const CARDS_TOP = 742;

/** Cartões da UI §3.4, na ordem da diária (o dinheiro no penúltimo, amarelo cheio). Campo nulo = o cartão sai. */
export function cltCards(f: CltFields): Card[] {
  const cards: Card[] = [];
  if (f.empresa) cards.push({ icon: 'store', cols: [{ label: 'Empresa:', value: f.empresa.toUpperCase(), lines: 2 }] });
  if (f.escala) cards.push({ icon: 'clock', cols: [{ label: 'Escala:', value: f.escala }] });
  if (f.cidade) cards.push({ icon: 'pin', cols: [{ label: 'Cidade:', value: f.cidade, lines: 2 }] });
  cards.push({ icon: 'money', dark: true, filled: true, cols: [{ label: 'Salário por mês:', value: f.salario, big: true }] });
  if (f.beneficios) cards.push({ icon: 'check', dark: true, cols: [{ label: 'Benefícios:', value: f.beneficios, lines: 2, bold: true, start: 34 }] });
  return cards;
}

/** Story 1080×1920 da vaga fixa. JPEG q92. */
export async function composeCltArt(
  images: ImageService,
  i: { fields: CltFields; photo: Uint8Array | null; logo: Uint8Array | null; badges: Badges; fonts: BaseFonts; qr?: QrPlan | null },
): Promise<Uint8Array> {
  const { fTitle, fBold, fExtra } = artFonts(i.fonts);
  const cv = await drawBackdrop(images, i.photo, i.logo);

  // "VAGA FIXA" em 88 px (até 700 px de largura, para a foto aparecer), pincelada azul-carteira.
  const head = fitWrapped(fTitle, CLT_TITLE, 700, { start: 88, floor: 64, maxLines: 1 });
  const headW = fTitle.getAdvanceWidth(CLT_TITLE, head.size);
  brush(cv, 70, 392, headW + 110, 122, CARTEIRA, TITLE_PIVOT[0], TITLE_PIVOT[1], TITLE_DEG);
  text(cv, fTitle, CLT_TITLE, head.size, 70 + 55, 392 + 92, WHITE, { rot: TITLE_PIVOT });

  const { pillTop } = drawRole(cv, fTitle, i.fields.cargo);
  // Pílula "CARTEIRA ASSINADA": 1 linha, de 58 px até o piso de 40, texto até 600 px (a pílula termina antes de x 780).
  const pill = fitWrapped(fTitle, CLT_PILL, 600, { start: 58, floor: 40, maxLines: 1 });
  const pillW = fTitle.getAdvanceWidth(CLT_PILL, pill.size);
  drawPill(cv, pillTop, pillW, CARTEIRA, (icx, icy) => icon(cv, 'wallet', icx, icy, 26, CARTEIRA, WHITE, fTitle));
  text(cv, fTitle, CLT_PILL, pill.size, 70 + 86, pillTop + PILL_H / 2 + pill.size * 0.36, WHITE, { rot: TITLE_PIVOT });

  drawCards(cv, cltCards(i.fields), Math.max(CARDS_TOP, pillTop + PILL_H + 40), fBold, fExtra);
  await drawFooter(images, cv, i.qr ?? null, i.badges, fBold, fExtra);
  return images.encode(cv, false, 92);
}
