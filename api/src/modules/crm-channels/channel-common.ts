/** Tipos e funções puras de cadência (porte de `crm/cadence-types.ts` e de `crm/cadence.server.ts`). */
export type CadenceChannel = 'wa_text' | 'wa_template' | 'email' | 'call_task';

export type CadenceStep = {
  channel: CadenceChannel;
  delay_minutes: number;
  window?: { days: number[]; start: string; end: string };
  message?: string;
  subject?: string;
  template_name?: string;
  template_language?: string;
  template_params?: string[];
  fallback_template?: string;
};

export type ExitRules = {
  on_reply?: boolean;
  on_stage_change?: boolean;
  on_won_lost?: boolean;
  on_opt_out?: boolean;
  on_human_takeover?: boolean;
};

export const TZ = 'America/Sao_Paulo';
export const DEFAULT_WINDOW = { days: [1, 2, 3, 4, 5], start: '08:00', end: '20:00' };
export const WINDOW_MS = 24 * 60 * 60 * 1000;

export function renderVariables(text: string, vars: { nome?: string | null; cidade?: string | null; empresa?: string | null; responsavel?: string | null }): string {
  return text.replace(/\{\{\s*(nome|cidade|empresa|responsavel)\s*\}\}/gi, (_m, key: string) => {
    const value = vars[key.toLowerCase() as keyof typeof vars];
    return value ? String(value) : '';
  });
}

const DAY_MAP: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

export function localParts(date: Date, timeZone = TZ): { day: number; minutes: number } {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', { timeZone, weekday: 'short', hour: '2-digit', minute: '2-digit', hour12: false }).formatToParts(date).map((p) => [p.type, p.value]),
  );
  // `hour12:false` pode devolver "24" à meia-noite.
  return { day: DAY_MAP[String(parts['weekday'])] ?? 0, minutes: (Number(parts['hour']) % 24) * 60 + Number(parts['minute']) };
}

export const toMinutes = (hhmm: string): number => {
  const [h, m] = hhmm.split(':');
  return Number(h) * 60 + Number(m ?? 0);
};

export function inWindow(step: Pick<CadenceStep, 'window'>, at: Date): boolean {
  const w = step.window ?? DEFAULT_WINDOW;
  if (!w.days?.length) return true;
  const { day, minutes } = localParts(at);
  if (!w.days.includes(day)) return false;
  return minutes >= toMinutes(w.start) && minutes <= toMinutes(w.end);
}

/** Próximo instante dentro da janela do passo, em saltos de 15 min (no máximo 7 dias). */
export function nextWindowSlot(step: Pick<CadenceStep, 'window'>, from: Date): Date {
  let cursor = from.getTime();
  for (let i = 0; i < 4 * 24 * 7; i += 1) {
    cursor += 15 * 60_000;
    if (inWindow(step, new Date(cursor))) return new Date(cursor);
  }
  return new Date(from.getTime() + 60 * 60_000);
}

export type BusinessHours = { timezone?: string; days?: number[]; start?: string; end?: string };

/** "Agora" cai dentro do horário de atendimento do agente SDR (`withinBusinessHours`). */
export function withinBusinessHours(hours: BusinessHours | null | undefined, now = new Date()): boolean {
  const h = hours ?? {};
  const { day, minutes } = localParts(now, h.timezone || TZ);
  const days = h.days?.length ? h.days : [1, 2, 3, 4, 5];
  if (!days.includes(day)) return false;
  const toMin = (value: string | undefined, fallback: number) => {
    const [hh, mm] = (value ?? '').split(':');
    const total = Number(hh) * 60 + Number(mm);
    return Number.isFinite(total) ? total : fallback;
  };
  return minutes >= toMin(h.start, 540) && minutes < toMin(h.end, 1080);
}

const OPT_OUT_WORDS = ['sair', 'parar', 'descadastrar', 'stop'];
export const isOptOut = (text: string | null | undefined): boolean => !!text && OPT_OUT_WORDS.includes(text.trim().toLowerCase().replace(/[.!]/g, ''));

export const errText = (e: unknown): string => (e instanceof Error ? e.message : typeof e === 'string' ? e : 'erro desconhecido');
