/** Hoje em Brasília ("YYYY-MM-DD") — mesmo critério do servidor (`todaySp`). */
export function todaySp(now: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo", year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}

/**
 * Período da campanha para a tela: `ended` (fim antes de hoje) não publica nem liga; `last_day` liga, mas não publica
 * (a Meta pede 24 h com verba diária). Mesmas regras de PERIOD_ENDED / PERIOD_TOO_SHORT da API.
 */
export function campaignPeriod(endDate: string | null | undefined, today: string = todaySp()): "open" | "last_day" | "ended" {
  const end = endDate ? endDate.slice(0, 10) : null;
  if (!end) return "open";
  if (end < today) return "ended";
  return end === today ? "last_day" : "open";
}
