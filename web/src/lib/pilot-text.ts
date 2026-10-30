/**
 * Textos e decisões do painel do estrategista (doc de UI, B e C). Puros e testados: a tela só mostra; o servidor decide e conta
 * (contrato §29).
 */
export type PilotStepName = "strategy" | "copies" | "instagram" | "creatives" | "meta";
export type PilotStepLike = { status: string; note?: string | null };
export type PilotSummary = { status: string; current_step: string | null; first_block_code: string | null; counts: { done: number; total: number } };
export type BlockerActionKind = "retry" | "proceed_partial" | "raise_cap" | "integrations";
export type BlockerAction = { kind: BlockerActionKind; label: string };

export const STEP_LABEL: Record<PilotStepName, string> = {
  strategy: "Plano",
  copies: "Textos do anúncio",
  instagram: "Instagram programado",
  creatives: "Artes e vídeo",
  meta: "Anúncio na Meta",
};

const br = (n: number) => String(Math.round(n * 100) / 100).replace(".", ",");

export function stepStatusText(step: PilotStepLike): string {
  switch (step.status) {
    case "pending":
      return "○ Na fila";
    case "running":
      return "◐ Fazendo agora";
    case "waiting":
      return "◐ Gerando o vídeo, leva alguns minutos";
    case "done":
      return step.note ? `✓ Pronto · ${step.note}` : "✓ Pronto";
    case "skipped":
      return `– Pulado: ${step.note ?? "sem motivo registrado"}`;
    case "blocked":
      return "! Esperando você";
    case "failed":
      return "✕ Não deu certo";
    default:
      return step.status;
  }
}

/** Teto novo oferecido no `COST_CAP`: o custo de um vídeo a mais (12 créditos), até 500. Ex.: 48 → 60. */
export function raiseCapTo(max: number): number {
  return Math.min(500, max + 12);
}

/** O que mostrar num bloqueio: a frase do servidor e só as ações que fazem sentido para aquele código (nem todo bloqueio tem "Continuar"). */
export function blockerView(
  code: string | null | undefined,
  message: string,
  ctx: { canEdit: boolean; maxCredits: number; done: number; total: number },
): { message: string; actions: BlockerAction[] } {
  if (!ctx.canEdit) return { message, actions: [] };
  switch (code) {
    case "COST_CAP":
      return {
        message,
        actions: [
          { kind: "raise_cap", label: `Aumentar o teto para ${br(raiseCapTo(ctx.maxCredits))}` },
          ...(ctx.done > 0 ? [{ kind: "proceed_partial" as const, label: `Seguir com as ${ctx.done} artes` }] : []),
        ],
      };
    case "AI_NOT_CONFIGURED":
    case "AI_NO_CREDITS":
      return { message, actions: [{ kind: "integrations", label: "Abrir integrações" }, { kind: "retry", label: "Já resolvi: continuar" }] };
    case "NO_CREATIVE_MADE":
      return { message, actions: [{ kind: "retry", label: "Fazer mais uma rodada" }] };
    case "NO_IG_PLAN":
    case "IG_NOT_SCHEDULED":
      return { message, actions: [] };
    default:
      return { message, actions: [{ kind: "retry", label: "Tentar de novo" }] };
  }
}

export function creditsLine(spent: number, max: number, done: number): string {
  const pieces = done === 1 ? "da 1 peça já feita" : `das ${done} peças já feitas`;
  return `Créditos: ${br(spent)} de até ${br(max)} usados (soma do custo ${pieces})`;
}

const RUNNING_LINE: Record<string, string> = {
  strategy: "Montando o plano",
  copies: "Fazendo os textos do anúncio",
  instagram: "Programando o Instagram",
  meta: "Montando o anúncio",
};

/** Linha do estrategista no cartão da lista ("◐ Fazendo artes (4 de 7)"). Sem piloto = nada (cartão igual ao de hoje). */
export function pilotListLine(s: PilotSummary | null | undefined): string | null {
  if (!s) return null;
  if (s.status === "planning") return "◐ Montando o plano";
  if (s.status === "blocked" || s.status === "failed") return "! Precisa de você";
  if (s.status === "done") return "✓ Tudo pronto";
  if (s.status === "cancelled") return "– Estrategista parado";
  if (s.current_step === "creatives") return `◐ Fazendo artes (${s.counts.done} de ${s.counts.total})`;
  return `◐ ${RUNNING_LINE[s.current_step ?? ""] ?? "Trabalhando"}`;
}

/** Chave de idempotência do "Criar e montar o plano"/"Começar": a mesma chave em nova tentativa = a mesma execução. */
export function nextIdempotencyKey(): string {
  return crypto.randomUUID();
}
