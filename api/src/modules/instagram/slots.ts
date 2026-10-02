/**
 * Horários exatos da programação automática (puro, sem banco): fuso de São Paulo = UTC-3 fixo
 * (sem horário de verão desde 2019), como o protótipo. A data nunca fica a cargo da IA.
 */
import { UserError } from '../media/user-error';
import { IgFormat, isVideoFormat } from './ig-types';

export const TZ = '-03:00';
export const MIN = 60e3;
export const CHUNK = 8;
export const MAX_SLOTS = 120;
export const MAX_DAYS = 92;
/** Antecedência mínima para gerar a mídia a tempo. */
export const LEAD_IMAGE_MIN = 20;
export const LEAD_VIDEO_MIN = 60;

export type AutoMode = 'publish' | 'approval';
export type Slot = { index: number; at: string; format: IgFormat; kind: 'main' | 'story' };
export type AutoConfig = {
  startDate: string;
  endDate: string;
  weekdays: number[];
  times: string[];
  storyTimes: string[];
  formats: IgFormat[];
  asap?: boolean | undefined;
};

export function todaySP(now = Date.now()) {
  return new Date(now - 3 * 3600e3).toISOString().slice(0, 10);
}
export function plusDays(date: string, n: number) {
  const d = new Date(`${date}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
const weekday = (date: string) => new Date(`${date}T12:00:00Z`).getUTCDay();
const normTime = (t: string) => {
  const m = /^(\d{1,2}):(\d{2})$/.exec(t.trim());
  if (!m) return null;
  const h = Number(m[1]);
  const mi = Number(m[2]);
  return h < 24 && mi < 60 ? `${String(h).padStart(2, '0')}:${String(mi).padStart(2, '0')}` : null;
};
export const uniqTimes = (list: string[]) => [...new Set(list.map(normTime).filter((t): t is string => !!t))].sort();

/**
 * Horários exatos do período. Pula o que já passou ou está perto demais para gerar a mídia;
 * vídeo perto do horário vira imagem para dar tempo de ficar pronto.
 */
export function computeSlots(cfg: AutoConfig, now = Date.now()) {
  const times = uniqTimes(cfg.times);
  const storyTimes = uniqTimes(cfg.storyTimes);
  const main = cfg.formats.filter((f) => !f.startsWith('story_'));
  const stories = cfg.formats.filter((f) => f.startsWith('story_'));
  if (!main.length && times.length) throw new UserError('Escolha ao menos um formato de feed ou Reels para os horários principais.');
  const storyFormats: IgFormat[] = stories.length ? stories : ['story_image'];
  const start = cfg.startDate < todaySP(now) ? todaySP(now) : cfg.startDate;
  if (cfg.endDate < start) throw new UserError('A data final precisa ser igual ou depois da inicial (e não pode estar no passado).');
  const out: Omit<Slot, 'index'>[] = [];
  let skipped = 0;
  let dayIdx = 0;
  for (let d = start; d <= cfg.endDate; d = plusDays(d, 1), dayIdx++) {
    if (dayIdx >= MAX_DAYS) throw new UserError(`O período pode ter no máximo ${MAX_DAYS} dias.`);
    if (!cfg.weekdays.includes(weekday(d))) continue;
    const push = (t: string, format: IgFormat, kind: Slot['kind']) => {
      const at = new Date(`${d}T${t}:00${TZ}`).getTime();
      const lead = (at - now) / MIN;
      if (lead < LEAD_IMAGE_MIN) return void skipped++;
      let f = format;
      if (isVideoFormat(f) && lead < LEAD_VIDEO_MIN) f = f === 'reel' ? 'feed_image' : 'story_image';
      out.push({ at: new Date(at).toISOString(), format: f, kind });
    };
    // Gira os formatos por dia para o mesmo horário não ter sempre o mesmo formato.
    times.forEach((t, i) => push(t, main[(i + dayIdx) % main.length]!, 'main'));
    storyTimes.forEach((t, i) => push(t, storyFormats[(i + dayIdx) % storyFormats.length]!, 'story'));
  }
  if (cfg.asap && start === todaySP(now) && cfg.weekdays.includes(weekday(start))) {
    // "O quanto antes": daqui a ~25 min, arredondado para 5 min; imagem para ficar pronta a tempo.
    const at = Math.ceil((now + 25 * MIN) / (5 * MIN)) * 5 * MIN;
    const f: IgFormat = main.length ? (main.find((x) => !isVideoFormat(x)) ?? 'feed_image') : 'story_image';
    out.push({ at: new Date(at).toISOString(), format: f, kind: main.length ? 'main' : 'story' });
  }
  out.sort((a, b) => a.at.localeCompare(b.at));
  if (out.length > MAX_SLOTS) throw new UserError(`Isso daria ${out.length} posts. O limite por programação é ${MAX_SLOTS}: diminua o período ou os horários.`);
  return { slots: out.map((s, index) => ({ ...s, index })) as Slot[], skipped };
}
