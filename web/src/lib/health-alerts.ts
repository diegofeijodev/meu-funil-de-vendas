/**
 * Textos da faixa de avisos do topo das telas (contrato §30): IA sem créditos e posts do Instagram que falharam.
 * Funções puras (sem React): o componente só desenha. Datas sempre no fuso de Brasília.
 */

export type AiVendor = "openai" | "gemini";
/** "no_credit" = falta de saldo (a conta parou) · "daily_limit" = cota de hoje do modelo de texto (volta sozinha amanhã). */
export type AiAlertReason = "no_credit" | "daily_limit";

export type AiCreditAlert = {
  level: "stopped" | "partial";
  vendors: { vendor: AiVendor; label: string; reason: AiAlertReason; since: string; last_at: string }[];
  fallback: AiVendor | "app" | null;
  inherited_from: { id: string; name: string } | null;
};

export type InstagramFailAlert = { failed_count: number; last_error: string | null; last_at: string; permission: boolean };

export type HealthAlerts = { ai: AiCreditAlert | null; instagram: InstagramFailAlert | null };

const TZ = "America/Sao_Paulo";
const LABEL: Record<AiVendor, string> = { openai: "ChatGPT (OpenAI)", gemini: "Gemini (Google)" };

/** Onde colocar créditos de cada provedor. */
export const CREDIT_LINKS: Record<AiVendor, { label: string; href: string }> = {
  openai: { label: "Colocar créditos na OpenAI", href: "https://platform.openai.com/settings/organization/billing/overview" },
  gemini: { label: "Colocar créditos no Google", href: "https://aistudio.google.com/" },
};

export const TEST_AGAIN_LABEL = "Já coloquei créditos — testar agora";
export const AI_BACK_MESSAGE = "Tudo certo: a IA voltou a funcionar.";

/**
 * O que para sem IA, tirado de quem chama o `AiService` na API: calendário e posts do Instagram (estrategista, legendas, revisão),
 * artes e vídeos (Studio e produção automática), Copy Engine, estrategista de campanha, piloto, gestor de tráfego, SDR do CRM e
 * os stories das vagas (só nas empresas com a aba Vagas). Publicar o que já está pronto NÃO usa IA (`PublishingService`).
 */
export function aiStopsList(opts: { vacancyStories?: boolean } = {}): string {
  const items = [
    "posts e calendário do Instagram",
    "artes e vídeos",
    "textos de anúncio",
    "estratégias de campanha",
    "o piloto de campanhas",
    "as sugestões do gestor de tráfego",
    "as respostas automáticas do SDR no CRM",
    ...(opts.vacancyStories ? ["os stories das vagas"] : []),
  ];
  return joinPt(items);
}

/** "a, b e c". */
export function joinPt(items: string[]): string {
  if (items.length <= 1) return items[0] ?? "";
  return `${items.slice(0, -1).join(", ")} e ${items[items.length - 1]}`;
}

const parts = (iso: string) =>
  Object.fromEntries(
    new Intl.DateTimeFormat("pt-BR", { timeZone: TZ, hourCycle: "h23", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })
      .formatToParts(new Date(iso))
      .map((p) => [p.type, p.value]),
  );

/** "01/11 às 21:00" (Brasília). */
export function dayTimeSp(iso: string): string {
  const p = parts(iso);
  return `${p.day}/${p.month} às ${p.hour}:${p.minute}`;
}

/** "01/11" (dia de Brasília). */
export function daySp(iso: string): string {
  const p = parts(iso);
  return `${p.day}/${p.month}`;
}

export type AiAlertText = {
  tone: "danger" | "warning";
  title: string;
  body: string;
  inherited: string | null;
  links: { vendor: AiVendor; label: string; href: string }[];
  /** Provedores a testar no "Já coloquei créditos". */
  testVendors: AiVendor[];
};

const latest = (isos: string[]) => isos.reduce((a, b) => (new Date(b).getTime() > new Date(a).getTime() ? b : a));
const earliest = (isos: string[]) => isos.reduce((a, b) => (new Date(b).getTime() < new Date(a).getTime() ? b : a));

const labelOf = (v: { vendor: AiVendor; label?: string }) => v.label || LABEL[v.vendor];
const DAILY_BACK = "Volta sozinho amanhã, ou antes se você colocar créditos.";

/** "o X recusou os pedidos por falta de saldo e o Y chegou ao limite de uso de hoje" — cada provedor com o seu motivo. */
function stoppedClauses(vendors: AiCreditAlert["vendors"]): string {
  const credit = vendors.filter((v) => v.reason !== "daily_limit").map((v) => `o ${labelOf(v)}`);
  const daily = vendors.filter((v) => v.reason === "daily_limit").map((v) => `o ${labelOf(v)}`);
  const parts = [
    credit.length ? `${joinPt(credit)} ${credit.length > 1 ? "recusaram" : "recusou"} os pedidos por falta de saldo` : "",
    daily.length ? `${joinPt(daily)} ${daily.length > 1 ? "chegaram" : "chegou"} ao limite de uso de hoje` : "",
  ].filter(Boolean);
  return parts.join(" e ");
}

/**
 * Faixa da IA. `stopped`: nada novo é criado — vermelho com falta de saldo; amarelo quando é só a cota de hoje (volta sozinha).
 * `partial` (amarelo): sobra um caminho (o outro provedor, ou o gateway do app — que não conferimos, então o texto não afirma).
 */
export function aiAlertText(ai: AiCreditAlert, opts: { vacancyStories?: boolean } = {}): AiAlertText {
  const vendors = ai.vendors;
  const onlyDaily = vendors.every((v) => v.reason === "daily_limit");
  const links = vendors.map((v) => ({ vendor: v.vendor, ...CREDIT_LINKS[v.vendor] }));
  const inherited = ai.inherited_from ? `A IA desta empresa vem da ${ai.inherited_from.name}.` : null;
  const testVendors = vendors.map((v) => v.vendor);
  if (ai.level === "stopped") {
    // A IA parou quando o ÚLTIMO provedor falhou.
    const since = dayTimeSp(latest(vendors.map((v) => v.since)));
    return {
      tone: onlyDaily ? "warning" : "danger",
      title: onlyDaily ? "Sua IA chegou ao limite de uso de hoje" : "Sua IA está sem créditos",
      body:
        `Desde ${since}, ${stoppedClauses(vendors)}.${onlyDaily ? ` ${DAILY_BACK}` : ""} ` +
        `Enquanto isso, nada novo é criado: ${aiStopsList(opts)}. O que já estava pronto e agendado continua sendo publicado.`,
      inherited,
      links,
      testVendors,
    };
  }
  const credit = vendors.filter((v) => v.reason !== "daily_limit");
  const daily = vendors.filter((v) => v.reason === "daily_limit");
  const sentences: string[] = [];
  if (credit.length) {
    const since = daySp(earliest(credit.map((v) => v.since)));
    sentences.push(
      credit.length > 1
        ? `As contas ${joinPt(credit.map((v) => `do ${labelOf(v)}`))} estão sem créditos desde ${since}.`
        : `A conta do ${labelOf(credit[0]!)} está sem créditos desde ${since}.`,
    );
  }
  if (daily.length) {
    const who = joinPt(daily.map((v) => `o ${labelOf(v)}`));
    sentences.push(`${who[0]!.toUpperCase()}${who.slice(1)} ${daily.length > 1 ? "chegaram" : "chegou"} ao limite de uso de hoje (volta sozinho amanhã).`);
  }
  sentences.push(
    ai.fallback === "app"
      ? "A IA pode seguir pelos créditos do app."
      : `Por enquanto a IA está usando ${ai.fallback ? `o ${LABEL[ai.fallback]}` : "outra IA"}.`,
  );
  const many = vendors.length > 1;
  return {
    tone: "warning",
    title: onlyDaily
      ? many ? "As IAs chegaram ao limite de uso de hoje" : "Uma das IAs chegou ao limite de uso de hoje"
      : many ? "As contas de IA estão sem créditos" : "Uma das IAs está sem créditos",
    body: sentences.join(" "),
    inherited,
    links,
    testVendors,
  };
}

/** Motivo curto: a primeira frase (até 160 caracteres). */
export function shortReason(text: string | null): string | null {
  const t = (text ?? "").trim();
  if (!t) return null;
  const first = /^(.+?[.!?])(\s|$)/.exec(t)?.[1] ?? t;
  return first.length > 160 ? `${first.slice(0, 157).trimEnd()}…` : first;
}

const PERMISSION_RE = /Permissão insuficiente na Meta|\(#(?:10|200)\)|does not have permission/i;

export const META_PERMISSION_HELP =
  "A Meta não deu permissão para publicar nesta conta. Quem administra o Meta Business precisa dar ao usuário do sistema acesso total à Página e ao Instagram desta empresa.";

export type InstagramAlertText = { title: string; reason: string | null; permission: string | null };

/** Faixa do Instagram (amarelo): quantos posts não saíram, o último motivo e, se for permissão da Meta, o que fazer. */
export function instagramAlertText(ig: InstagramFailAlert): InstagramAlertText {
  const n = ig.failed_count;
  const title = n === 1 ? "1 post do Instagram não foi publicado nos últimos 7 dias." : `${n} posts do Instagram não foram publicados nos últimos 7 dias.`;
  // Com o erro de permissão, a explicação abaixo já diz o motivo: não repete a frase técnica.
  const lastIsPermission = PERMISSION_RE.test(ig.last_error ?? "");
  const reason = ig.permission && lastIsPermission ? null : shortReason(ig.last_error);
  return { title, reason: reason ? `Último motivo: ${reason}` : null, permission: ig.permission ? META_PERMISSION_HELP : null };
}
