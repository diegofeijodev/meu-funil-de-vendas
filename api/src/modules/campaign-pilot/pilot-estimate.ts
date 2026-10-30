/**
 * Conta dos créditos do pacote do piloto (pura). Cada número sai com a fórmula e a fonte (regra do dono: todo número com a conta e de
 * onde veio); a tela só mostra, não refaz a conta. Créditos do app (`AI_COST`), nunca R$: com chave própria quem cobra é a OpenAI/Google.
 */
import { AI_COST } from '../ai/ai.service';
import type { IgFormat } from '../instagram/ig-types';
import type { FullStrategy } from '../strategist/strategy-types';
import type { PilotOptions } from './pilot.types';

export type EstimateItem = { label: string; formula: string; value: number; source: string };

const IMG = AI_COST.chatgptImage; // pior caso entre as IAs de imagem
const VID = AI_COST.video;
const SOURCE = `tabela de custo do Meu Funil (imagem ${br(IMG)} · vídeo ${br(VID)})`;
/** Carrossel: o estrategista do Instagram pede 4 a 7 slides (`auto-calendar.service.ts`); a conta usa a média, 5. */
const CAROUSEL_SLIDES = 5;
const IG_ORDER: IgFormat[] = ['feed_image', 'feed_carousel', 'reel', 'story_image', 'story_video'];

function br(n: number): string {
  return String(Math.round(n * 100) / 100).replace('.', ',');
}
const round2 = (n: number) => Math.round(n * 100) / 100;

/** Custo máximo de UMA peça antes de gerá-la (o teto é conferido com isto): imagem = versões + 1 refação; vídeo = 2 tentativas. */
export function slotCost(kind: 'image' | 'video', variations: number): number {
  return kind === 'video' ? 2 * VID : round2(variations * IMG + IMG);
}

function instagramItem(slots: { format: IgFormat }[]): EstimateItem | null {
  if (!slots.length) return null;
  const count = new Map<IgFormat, number>();
  for (const s of slots) count.set(s.format, (count.get(s.format) ?? 0) + 1);
  const parts: string[] = [];
  let value = 0;
  for (const f of IG_ORDER) {
    const q = count.get(f);
    if (!q) continue;
    if (f === 'feed_carousel') {
      parts.push(`${q} carrossel × ${CAROUSEL_SLIDES} slides × ${br(IMG)}`);
      value += q * CAROUSEL_SLIDES * IMG;
    } else if (f === 'reel' || f === 'story_video') {
      parts.push(`${q} ${f === 'reel' ? 'reels' : 'stories em vídeo'} × ${br(VID)}`);
      value += q * VID;
    } else {
      parts.push(`${q} ${f === 'feed_image' ? 'post' : 'stories'} × ${br(IMG)}`);
      value += q * IMG;
    }
  }
  return { label: 'Posts do Instagram (fora do teto)', formula: parts.join(' + '), value: round2(value), source: SOURCE };
}

export function estimatePilot(o: PilotOptions, instagram: { slots: { format: IgFormat }[] } | null) {
  const a = o.max_angles;
  const i = o.images_per_angle;
  const v = o.variations;
  const items: EstimateItem[] = [
    { label: 'Artes', formula: `${a} jeitos × ${i} artes × ${v} versões × ${br(IMG)}`, value: round2(a * i * v * IMG), source: SOURCE },
    { label: 'Refações', formula: `até ${a * i} × ${br(IMG)}`, value: round2(a * i * IMG), source: SOURCE },
  ];
  if (o.videos > 0) items.push({ label: 'Vídeo', formula: `${o.videos} × 2 tentativas × ${br(VID)}`, value: round2(o.videos * 2 * VID), source: SOURCE });
  return { items, total: round2(items.reduce((s, x) => s + x.value, 0)), instagram: instagram ? instagramItem(instagram.slots) : null };
}

/** Pacote sugerido ao terminar o plano (decisão da consolidação; o dono troca no "Ajustar"). */
export function suggestedOptions(strategy: FullStrategy | null, maxCreatives: number): PilotOptions {
  const angles = (strategy?.angulos_detalhados ?? []).filter((x) => x?.nome).length;
  const o: PilotOptions = {
    max_angles: Math.max(1, Math.min(3, angles)),
    images_per_angle: 2,
    variations: 3,
    videos: 1,
    instagram: { enabled: true, mode: 'approval', weekdays: [1, 3, 5], times: ['11:00', '18:00'], story_times: ['12:00'], formats: ['feed_image', 'reel', 'story_image'] },
    meta: { enabled: true, review_creatives: false },
    max_credits: 0,
  };
  const pieces = () => o.max_angles * o.images_per_angle + o.videos;
  while (pieces() > maxCreatives && o.images_per_angle > 1) o.images_per_angle--;
  while (pieces() > maxCreatives && o.videos > 0) o.videos--;
  while (pieces() > maxCreatives && o.max_angles > 1) o.max_angles--;
  o.max_credits = estimatePilot(o, null).total;
  return o;
}
