/** Funções puras da aba "Vagas" do Instagram (stories automáticos das vagas do Freela). Horários sempre em Brasília. */

const TZ = 'America/Sao_Paulo';
const VENDORS: Record<string, string> = { openai: 'OpenAI', gemini: 'Gemini' };

const partsOf = (iso: string, opts: Intl.DateTimeFormatOptions) =>
  Object.fromEntries(
    new Intl.DateTimeFormat('pt-BR', { timeZone: TZ, hourCycle: 'h23', ...opts })
      .formatToParts(new Date(iso))
      .map((p) => [p.type, p.value]),
  );

/** "08:00" → "8h", "14:40" → "14h40"; também aceita ISO (convertido para Brasília). */
export function hhLabel(value: string): string {
  let h: number;
  let m: number;
  const hhmm = /^(\d{1,2}):(\d{2})/.exec(value);
  if (hhmm && !value.includes('T')) {
    h = Number(hhmm[1]);
    m = Number(hhmm[2]);
  } else {
    const p = partsOf(value, { hour: '2-digit', minute: '2-digit' });
    h = Number(p.hour);
    m = Number(p.minute);
  }
  return m === 0 ? `${h}h` : `${h}h${String(m).padStart(2, '0')}`;
}

/** "28/10" (dia de Brasília) a partir de um ISO. */
export function dmLabel(iso: string): string {
  const p = partsOf(iso, { day: '2-digit', month: '2-digit' });
  return `${p.day}/${p.month}`;
}

export type SummaryInput = { cities: string[]; window_start: string; window_end: string; daily_cap: number; vendor: string };

/** Resumo de 1 linha dos Ajustes: "Todas as cidades · 8h às 21h · até 10/dia · OpenAI". */
export function settingsSummary(s: SummaryInput): string {
  const cidades = s.cities.length === 0 ? 'Todas as cidades' : s.cities.length === 1 ? '1 cidade' : `${s.cities.length} cidades`;
  return [cidades, `${hhLabel(s.window_start)} às ${hhLabel(s.window_end)}`, `até ${s.daily_cap}/dia`, VENDORS[s.vendor] ?? s.vendor].join(' · ');
}

/** "Hoje: 4 postados de 10 (o máximo por dia que você definiu)". */
export function dayLine(s: { today: { posted: number; cap: number } }): string {
  const { posted, cap } = s.today;
  return `Hoje: ${posted} ${posted === 1 ? 'postado' : 'postados'} de ${cap} (o máximo por dia que você definiu)`;
}

const STALE_MS = 30 * 60 * 1000;

/** Vitrine do Freela sem consulta bem-sucedida há mais de 30 min (só faz sentido com a função ligada). */
export function pollStale(s: { last_poll_ok_at: string | null; enabled: boolean }, now: Date): boolean {
  if (!s.enabled) return false;
  if (!s.last_poll_ok_at) return true;
  return now.getTime() - new Date(s.last_poll_ok_at).getTime() > STALE_MS;
}

export type VagasTabState = 'hidden' | 'loading' | 'error' | 'ready';

/**
 * Estado da aba "Vagas" a partir da consulta das configurações: 404 (`data === null`) esconde a aba; erro SEM dados (1ª carga)
 * mostra o painel de erro; erro de um refetch com dados continua `ready` (o usuário não perde a tela por um soluço).
 */
export function vagasTabState(q: { data: unknown; isLoading: boolean; isError: boolean }): VagasTabState {
  if (q.data === null) return 'hidden';
  if (q.data !== undefined) return 'ready';
  if (q.isError) return 'error';
  return 'loading';
}
