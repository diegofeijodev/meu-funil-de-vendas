/**
 * Vagas fixas (CLT) na aba "Vagas" (UI 24/11 §4; contrato §26 "Vagas fixas (CLT)"). Funções puras; horários em Brasília. Decisão do dono
 * (24/11): vaga fixa sem cidade sai sem o cartão Cidade — por isso os textos dizem só "Sem salário … não".
 */
import { dmLabel, hhLabel, sinceLabel } from './vacancy-stories';

export type CltView = {
  enabled: boolean;
  enabled_at: string | null;
  daily_cap: number;
  backlog_days: number;
  since: string | null;
  promo_days: number;
  last_poll_at: string | null;
  last_poll_ok_at: string | null;
  last_poll_error: string | null;
  today: { posted: number; scheduled: number; cap: number };
  counts: { ready: number; to_approve: number };
  has_brand: boolean;
  qr_available: boolean;
  /** Aviso vermelho da IA só das vagas fixas (revisão 24/11); API antiga = ausente. */
  ai_error?: string | null;
  ai_error_at?: string | null;
};

export type StoryKind = 'diaria' | 'clt';
export const CLT_BACKLOG_OPTIONS = [
  { value: 0, label: 'Só as novas' },
  { value: 7, label: 'Também as dos últimos 7 dias' },
  { value: 14, label: 'Também as dos últimos 14 dias' },
  { value: 30, label: 'Também as dos últimos 30 dias' },
] as const;

export const CLT_TEXT = {
  switchLabel: 'Postar as vagas fixas (CLT) nos stories',
  off: 'Desligado. Nenhuma vaga fixa vira story agora.',
  noBrand: 'Para ligar, cadastre uma marca: a logo da arte vem dela.',
  noPermission: 'Só o dono ou um administrador pode ligar ou desligar.',
  enabledToast: 'Stories das vagas fixas ligados.',
  disabledToast: 'Stories das vagas fixas desligados.',
  enableError: 'Não conseguimos ligar agora. Tente de novo.',
  disableError: 'Não conseguimos desligar agora. Tente de novo.',
  enableTitle: 'Ligar os stories das vagas fixas?',
  disableTitle: 'Desligar os stories das vagas fixas?',
  capTitle: 'Máximo de stories de vagas fixas por dia',
  backlogTitle: 'Vagas fixas já abertas quando você ligar',
  groupBoth: 'Para diárias e vagas fixas',
  groupDaily: 'Só diárias',
  groupClt: 'Só vagas fixas (CLT)',
  badgeClt: 'Fixa · CLT',
  badgeDaily: 'Diária',
  previewButton: 'Gerar prévia da vaga fixa',
  emptyOff: 'Ligue as vagas fixas no cartão acima para elas aparecerem aqui.',
};

/** "Ligado · você aprova cada story antes" / "Ligado · posta sozinho depois da conferência" / desligado. */
export function cltStatusLine(c: Pick<CltView, 'enabled'>, autoPublish: boolean): string {
  if (!c.enabled) return CLT_TEXT.off;
  return autoPublish ? 'Ligado · posta sozinho depois da conferência' : 'Ligado · você aprova cada story antes';
}

/** "Hoje: 1 postado de 2 (o máximo por dia das vagas fixas)". */
export function cltTodayLine(c: Pick<CltView, 'today'>): string {
  const n = c.today.posted;
  return `Hoje: ${n === 1 ? '1 postado' : `${n} postados`} de ${c.today.cap} (o máximo por dia das vagas fixas)`;
}

/** Antes da 1ª consulta depois de ligar: "Primeira consulta ao Freela em até 10 minutos.". */
export function cltPollLine(c: Pick<CltView, 'enabled_at' | 'last_poll_at'>): string {
  if (!c.last_poll_at || (c.enabled_at && Date.parse(c.last_poll_at) < Date.parse(c.enabled_at))) return 'Primeira consulta ao Freela em até 10 minutos.';
  return `Última consulta: ${hhLabel(c.last_poll_at)} (a cada 10 minutos)`;
}

/** "Ligado desde 25/11 às 10h. Entram as vagas fixas publicadas desde 11/11." (sem retroativo: "…publicadas antes disso não entram."). */
export function cltSinceLine(c: Pick<CltView, 'enabled_at' | 'since' | 'backlog_days'>): string | null {
  if (!c.enabled_at) return null;
  const on = `Ligado desde ${dmLabel(c.enabled_at)} às ${hhLabel(c.enabled_at)}.`;
  if (!c.backlog_days || !c.since) return `${on} Vagas fixas publicadas antes disso não entram.`;
  return `${on} Entram as vagas fixas publicadas desde ${dmLabel(c.since)}.`;
}

/** Bloco "O que vai entrar" sem números (a API não manda as contagens; UI §4.2). */
export function cltWhatEnters(c: Pick<CltView, 'backlog_days' | 'daily_cap' | 'promo_days'>): string {
  const backlog = c.backlog_days ? ` e as dos últimos ${c.backlog_days} dias` : '';
  return `Entram as vagas fixas novas${backlog}, até ${c.daily_cap} por dia. Vaga fixa publicada há mais de ${c.promo_days} dias não vira story. Sem salário também não.`;
}

/** Aviso amarelo: consulta das vagas fixas com erro há mais de 30 min (ou nunca deu certo depois de ligar). */
export function cltPollNotice(c: Pick<CltView, 'enabled' | 'enabled_at' | 'last_poll_error' | 'last_poll_ok_at'>, now: Date): string | null {
  if (!c.enabled || !c.last_poll_error) return null;
  const ok = c.last_poll_ok_at && !(c.enabled_at && Date.parse(c.last_poll_ok_at) < Date.parse(c.enabled_at)) ? c.last_poll_ok_at : null;
  const base = Date.parse(ok ?? c.enabled_at ?? '');
  if (Number.isFinite(base) && now.getTime() - base <= 30 * 60_000) return null;
  return `Não conseguimos consultar as vagas fixas do Freela ${ok ? sinceLabel(ok, now) : 'ainda'}. Tentamos de novo sozinhos a cada 10 minutos. As diárias seguem normais.`;
}

/** Diálogo "Ligar os stories das vagas fixas?" (UI §4.2, sem a cidade: decisão de 24/11). */
export function cltEnableText(c: Pick<CltView, 'daily_cap' | 'backlog_days'>, username: string | null, autoPublish: boolean): string {
  const where = username ? `@${username.replace(/^@/, '')}` : 'Instagram da empresa';
  const backlog = c.backlog_days ? ` Também entram, aos poucos, as abertas publicadas nos últimos ${c.backlog_days} dias.` : '';
  const mode = autoPublish
    ? 'Os stories vão ao ar sozinhos, depois que o sistema confere cargo e salário.'
    : 'Cada story espera sua aprovação antes de ir ao ar.';
  return `A partir de agora, cada vaga fixa (CLT) nova do Freela vira um story no ${where}, até ${c.daily_cap} por dia.${backlog} Vagas sem salário não entram. ${mode} As diárias não mudam.`;
}

/** Diálogo "Desligar os stories das vagas fixas?". */
export function cltDisableText(c: { ready: number; to_approve: number }): string {
  const rest = 'Os que já foram postados continuam no Instagram até sumirem sozinhos (24 h). As diárias continuam como estão.';
  const parts = [
    ...(c.ready > 0 ? [c.ready === 1 ? '1 story pronto' : `${c.ready} stories prontos`] : []),
    ...(c.to_approve > 0 ? [`${c.to_approve} esperando aprovação`] : []),
  ];
  if (!parts.length) return rest;
  return `${parts.join(' e ')} de vagas fixas não ${c.ready + c.to_approve === 1 ? 'vai' : 'vão'} ao ar. ${rest}`;
}

/** Ajuda do máximo das vagas fixas (UI §4.3), com o limite da Meta. */
export function cltCapHint(quota = 25): string {
  return `Vagas fixas ficam abertas por semanas, então 2 por dia costuma bastar. Elas dividem com as diárias o limite de ${quota} publicações do Instagram e o horário para postar; quando as duas disputam o mesmo horário, a diária vai antes, porque o prazo dela é mais curto.`;
}

/** Ajuda do retroativo; com a CLT ligada a opção fica travada (vale no momento de ligar; a API recusa a mudança com 422). */
export function cltBacklogHint(promoDays = 30, enabled = false): string {
  const base = `Entram aos poucos, das mais novas para as mais velhas, dentro do máximo por dia. Vaga fixa publicada há mais de ${promoDays} dias não vira story.`;
  return enabled ? `${base} Vale para o momento em que você liga: para mudar, desligue as vagas fixas.` : base;
}

/** Aviso vermelho da IA só das vagas fixas (revisão 24/11; o das diárias fica no cartão de situação). Desligada ou sem aviso = null. */
export function cltAiErrorLine(c: Pick<CltView, 'enabled' | 'ai_error' | 'ai_error_at'>, now: Date): string | null {
  if (!c.enabled || !c.ai_error) return null;
  return c.ai_error_at ? `${c.ai_error} Nenhum story novo de vaga fixa está sendo criado ${sinceLabel(c.ai_error_at, now)}.` : c.ai_error;
}

/** Linha de dados do story na lista e no detalhe: diária "R$ 150 · Sáb 29/11 · 18h às 23h · Campinas"; CLT "R$ 1.874,32/mês · São Paulo – SP · divulgar até 24/12". */
export function storyDataLine(s: { kind?: StoryKind | null; valor: string | null; quando: string; cidade: string | null }): string {
  if (s.kind === 'clt') return [s.valor ? `${s.valor}/mês` : null, s.cidade, s.quando].filter(Boolean).join(' · ');
  return [s.valor, s.quando, s.cidade].filter(Boolean).join(' · ');
}

/** Vazio da lista com o filtro "Fixas (CLT)". */
export function cltArrivedEmpty(c: Pick<CltView, 'enabled' | 'enabled_at' | 'last_poll_at'>): string {
  if (!c.enabled || !c.enabled_at) return CLT_TEXT.emptyOff;
  const last = c.last_poll_at && Date.parse(c.last_poll_at) >= Date.parse(c.enabled_at) ? `; a última foi às ${hhLabel(c.last_poll_at)}` : '';
  return `Nenhuma vaga fixa nova desde que você ligou (${dmLabel(c.enabled_at)} às ${hhLabel(c.enabled_at)}). Consultamos o Freela a cada 10 minutos${last}. Vagas fixas são poucas: conte em dias, não em horas.`;
}

/** Resumo dos Ajustes com as vagas fixas ligadas: "Todas as cidades · 8h às 21h · diárias até 15/dia · fixas até 2/dia · OpenAI". */
export function summaryWithClt(summary: string, dailyCap: number, c: Pick<CltView, 'enabled' | 'daily_cap'> | null | undefined): string {
  if (!c?.enabled) return summary;
  return summary.replace(`até ${dailyCap}/dia`, `diárias até ${dailyCap}/dia · fixas até ${c.daily_cap}/dia`);
}

const CLT_FIELD_LABELS: Record<string, string> = { funcao: 'cargo', valor: 'salário', cidade: 'cidade', estabelecimento: 'empresa' };

/** É post de vaga fixa (`creative_brief.vacancy.kind = 'clt'`). */
export function isCltPost(post: { creative_brief?: unknown }): boolean {
  return (post.creative_brief as { vacancy?: { kind?: unknown } } | null | undefined)?.vacancy?.kind === 'clt';
}

/** Aba Aprovações (UI §4.4): "Conferido: cargo, salário, cidade" na vaga fixa. */
export function cltCheckedLine(fields: string[]): string | null {
  const labels = [...new Set(fields.map((f) => CLT_FIELD_LABELS[f]).filter(Boolean))];
  return labels.length ? `Conferido: ${labels.join(', ')}` : null;
}
