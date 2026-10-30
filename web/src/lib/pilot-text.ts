/**
 * Textos e decisões do painel do estrategista (doc de UI, B e C; revisão do designer de 30/10). Puros e testados: a tela só mostra; o
 * servidor decide e conta (contrato §29). O ícone vem separado do texto: a tela o marca `aria-hidden` (o leitor de tela lê só o texto).
 */
export type PilotStepName = "strategy" | "copies" | "instagram" | "creatives" | "meta";
export type PilotStepLike = { status: string; attempts?: number; note?: string | null; error_code?: string | null; error?: string | null };
export type PilotSummary = {
  status: string; current_step: string | null; first_block_code: string | null; counts: { done: number; total: number }; plan_ready?: boolean;
};
export type BlockerActionKind = "retry" | "proceed_partial" | "raise_cap" | "integrations" | "approvals" | "fix" | "creatives";
export type BlockerAction = { kind: BlockerActionKind; label: string };
export type IconText = { icon: string; text: string };

/** Falhas comuns seguidas até a etapa parar (o servidor espera 5, 15 e 60 min e para na 4ª). */
export const MAX_TRIES = 4;

export const STEP_LABEL: Record<PilotStepName, string> = {
  strategy: "Plano",
  copies: "Textos do anúncio",
  instagram: "Posts do Instagram",
  creatives: "Artes e vídeo",
  meta: "Anúncio na Meta",
};

const STEP_VERB: Record<PilotStepName, string> = {
  strategy: "montar o plano",
  copies: "fazer os textos",
  instagram: "programar o Instagram",
  creatives: "fazer as artes",
  meta: "montar o anúncio",
};

/** Bloqueios que não param o estrategista (o resto segue): aparecem na linha da etapa, não em "Precisa de você". */
export const SOFT_BLOCKS = new Set(["NO_IG_PLAN", "IG_NOT_SCHEDULED"]);

const br = (n: number) => String(Math.round(n * 100) / 100).replace(".", ",");

export function stepStatus(step: PilotStepLike, ctx: { cancelled?: boolean } = {}): IconText {
  if (ctx.cancelled && step.status !== "done" && step.status !== "skipped") return { icon: "–", text: "Não feito (estrategista parado)" };
  switch (step.status) {
    case "pending":
      return step.attempts
        ? { icon: "○", text: `Não deu certo; tentando de novo em alguns minutos (tentativa ${step.attempts + 1} de ${MAX_TRIES})` }
        : { icon: "○", text: "Na fila" };
    case "running":
      return { icon: "◐", text: "Fazendo agora" };
    case "waiting":
      return { icon: "◐", text: "Gerando o vídeo, leva alguns minutos" };
    case "done":
      return { icon: "✓", text: step.note ? `Pronto · ${step.note}` : "Pronto" };
    case "skipped":
      return { icon: "–", text: `Pulado: ${step.note ?? "sem motivo registrado"}` };
    case "blocked":
      return SOFT_BLOCKS.has(step.error_code ?? "") ? { icon: "–", text: `Não programado: ${step.error ?? ""}`.trim() } : { icon: "!", text: "Esperando você" };
    case "failed":
      return { icon: "✕", text: "Não deu certo" };
    default:
      return { icon: "", text: step.status };
  }
}

/** Teto novo oferecido no `COST_CAP`: o que já foi gasto + o custo máximo do que falta (arredondado para cima), até 500. */
export function raiseCapTo(spent: number, remaining: number): number {
  return Math.min(500, Math.ceil(spent + remaining));
}

/** O que mostrar num bloqueio: a frase e só as ações que fazem sentido para aquele código (nem todo bloqueio tem "Continuar"). */
export function blockerView(
  code: string | null | undefined,
  message: string,
  ctx: { canEdit: boolean; canManage?: boolean; step: PilotStepName; spent: number; remaining: number; done: number; roundCost?: number },
): { message: string; detail?: string; actions: BlockerAction[] } {
  const actions = (a: BlockerAction[]) => (ctx.canEdit ? a : []);
  switch (code) {
    case "WAITING_APPROVAL":
      return ctx.canManage
        ? { message: "O anúncio está esperando a sua aprovação.", actions: actions([{ kind: "approvals", label: "Abrir aprovação" }, { kind: "retry", label: "Já aprovei: conferir agora" }]) }
        : { message: "O anúncio está esperando o dono ou um admin aprovar. Avise quem aprova.", actions: [] };
    case "META_NOT_CONNECTED":
      return ctx.canManage
        ? { message, actions: actions([{ kind: "integrations", label: "Conectar a Meta" }, { kind: "retry", label: "Já conectei: conferir agora" }]) }
        : { message: "Conecte a Meta para montar o anúncio. Só o dono ou um admin conecta. Avise quem aprova.", actions: [] };
    case "BUDGET_MISSING":
    case "GEO_UNRESOLVED":
      // Depois da aprovação, verba e cidade só mudam por dono/admin (o formulário não aparece para marketing).
      if (!ctx.canManage) return { message: `${message} Só o dono ou um admin muda a verba e a cidade depois da aprovação. Avise quem aprova.`, actions: [] };
      return { message, actions: actions([{ kind: "fix", label: "Corrigir agora" }, { kind: "retry", label: "Já corrigi: continuar" }]) };
    case "LANDING_MISSING":
    case "NOT_APPROVED":
      return { message, actions: actions([{ kind: "fix", label: "Corrigir agora" }, { kind: "retry", label: "Já corrigi: continuar" }]) };
    case "PERIOD_ENDED":
    case "PERIOD_TOO_SHORT":
      return { message, actions: [] };
    case "META_REFUSED":
      return {
        message: "A Meta não aceitou montar o anúncio. Nada foi gasto: o que ficou lá está desligado.",
        detail: message,
        actions: actions([{ kind: "integrations", label: "Abrir integrações" }, { kind: "retry", label: "Tentar de novo" }]),
      };
    case "NO_CREATIVE_PASSED":
      return {
        message: "Nenhuma arte passou na revisão automática (nota mínima 28 de 50). Aprove à mão as que servem na aba Criativos.",
        actions: actions([{ kind: "creatives", label: "Ver as artes e escolher à mão" }, { kind: "retry", label: "Já aprovei: continuar" }]),
      };
    case "WAITING_CREATIVE_REVIEW":
      return { message, actions: actions([{ kind: "creatives", label: "Escolher artes" }, { kind: "retry", label: "Já escolhi: conferir agora" }]) };
    case "COST_CAP":
      return {
        message,
        actions: actions([
          { kind: "raise_cap", label: `Aumentar o teto para ${raiseCapTo(ctx.spent, ctx.remaining)} créditos (o que falta custa até ${br(ctx.remaining)})` },
          ...(ctx.done > 0 ? [{ kind: "proceed_partial" as const, label: `Seguir com as ${ctx.done} peças prontas` }] : []),
        ]),
      };
    case "AI_NOT_CONFIGURED":
    case "AI_NO_CREDITS":
      return { message, actions: actions([{ kind: "integrations", label: "Abrir integrações" }, { kind: "retry", label: "Já resolvi: continuar" }]) };
    case "NO_CREATIVE_MADE":
      return {
        message: "Nenhuma arte ficou pronta. Faça mais uma rodada ou veja as tentativas na aba Criativos.",
        actions: actions([{ kind: "retry", label: `Fazer mais uma rodada (até ${br(ctx.roundCost ?? ctx.remaining)} créditos)` }]),
      };
    case "NO_IG_PLAN":
    case "IG_NOT_SCHEDULED":
      return { message, actions: [] };
    default:
      return {
        message: `Não conseguimos ${STEP_VERB[ctx.step]} depois de ${MAX_TRIES} tentativas. Nada do que ficou pronto se perdeu. Motivo: ${message}`,
        actions: actions([{ kind: "retry", label: "Tentar de novo" }]),
      };
  }
}

/** Para quem só vê: quem resolve aquele bloqueio. */
export function viewerNote(code: string | null | undefined): string {
  return ["WAITING_APPROVAL", "META_NOT_CONNECTED", "BUDGET_MISSING", "GEO_UNRESOLVED"].includes(code ?? "")
    ? "Só o dono ou um admin resolve isso."
    : "Quem edita a campanha resolve isso.";
}

export function creditsLine(spent: number, max: number): string {
  return `Créditos usados: ${br(spent)} de até ${br(max)} (teto). Soma do custo registrado de cada geração feita até agora.`;
}

const RUNNING_LINE: Record<string, string> = {
  strategy: "Montando o plano",
  copies: "Fazendo os textos do anúncio",
  instagram: "Programando o Instagram",
  meta: "Montando o anúncio",
};
const NEEDS_LINE: Record<string, string> = {
  COST_CAP: "aumentar o teto de créditos",
  WAITING_APPROVAL: "aprovar o anúncio",
  META_NOT_CONNECTED: "conectar a Meta",
  LANDING_MISSING: "dizer o destino do anúncio",
  BUDGET_MISSING: "dizer a verba por dia",
  GEO_UNRESOLVED: "escolher a cidade de novo",
  NO_CREATIVE_PASSED: "escolher as artes do anúncio",
  WAITING_CREATIVE_REVIEW: "escolher as artes do anúncio",
  AI_NOT_CONFIGURED: "configurar a IA",
  AI_NO_CREDITS: "configurar a IA",
  NO_CREATIVE_MADE: "nenhuma arte ficou pronta",
};

/** Linha do estrategista no cartão da lista. Sem piloto = nada (cartão igual ao de hoje). */
export function pilotListLine(
  s: PilotSummary | null | undefined,
  meta: { metaCampaignId?: string | null; delivery?: string | null } = {},
): (IconText & { tone: "needs" | "work" | "done" | "idle" }) | null {
  if (!s) return null;
  if (s.status === "planning") {
    return s.plan_ready
      ? { icon: "!", text: "Precisa de você: conferir e aprovar o plano", tone: "needs" }
      : { icon: "◐", text: "Montando o plano", tone: "work" };
  }
  if (s.status === "blocked" || s.status === "failed") {
    return { icon: "!", text: `Precisa de você: ${NEEDS_LINE[s.first_block_code ?? ""] ?? "tentar de novo"}`, tone: "needs" };
  }
  // Etapa esperando a pessoa numa execução que segue (aprovar o anúncio, conectar a Meta): também é "Precisa de você".
  if (s.status === "running" && s.first_block_code && NEEDS_LINE[s.first_block_code]) {
    return { icon: "!", text: `Precisa de você: ${NEEDS_LINE[s.first_block_code]}`, tone: "needs" };
  }
  if (s.status === "done") {
    // Anúncio montado e desligado: o que falta é o dono ligar (de manhã, "Tudo pronto" pareceria "já está no ar").
    if (meta.metaCampaignId) return meta.delivery === "ACTIVE" ? { icon: "●", text: "No ar", tone: "done" } : { icon: "!", text: "Pronto para ligar", tone: "needs" };
    return { icon: "✓", text: "Tudo pronto", tone: "done" };
  }
  if (s.status === "cancelled") return { icon: "–", text: "Estrategista parado", tone: "idle" };
  if (s.current_step === "creatives") return { icon: "◐", text: `Fazendo artes (${s.counts.done} de ${s.counts.total})`, tone: "work" };
  return { icon: "◐", text: RUNNING_LINE[s.current_step ?? ""] ?? "Trabalhando", tone: "work" };
}

/** Chave de idempotência do "Criar e montar o plano"/"Começar": a mesma chave em nova tentativa = a mesma execução. */
export function nextIdempotencyKey(): string {
  return crypto.randomUUID();
}
