/**
 * Linha do estrategista em cada cartão da lista de campanhas ("◐ Fazendo artes (4 de 7)", "! Precisa de você", "✓ Pronto para ligar").
 * Pura e derivada da execução mais recente; mora em `campaigns/` porque a lista a usa e ninguém importa o módulo do piloto.
 */
type StepLike = { status?: string; error_code?: string | null; slots?: { status?: string }[] };
type RunLike = { status: string; current_step: string | null; steps: unknown };

export type PilotSummary = {
  status: string; current_step: string | null; first_block_code: string | null; counts: { done: number; total: number };
  /** Plano pronto esperando o "Aprovar e começar": a lista mostra "Precisa de você", não "Montando o plano". */
  plan_ready: boolean;
};

const ORDER = ['strategy', 'copies', 'instagram', 'creatives', 'meta'] as const;

export function pilotSummary(run: RunLike | null): PilotSummary | null {
  if (!run) return null;
  const steps = (run.steps && typeof run.steps === 'object' ? run.steps : {}) as Record<string, StepLike | undefined>;
  const firstBlock = ORDER.map((k) => steps[k]).find((s) => s && (s.status === 'blocked' || s.status === 'failed'));
  const slots = steps['creatives']?.slots ?? [];
  return {
    status: run.status,
    current_step: run.current_step,
    first_block_code: firstBlock?.error_code ?? null,
    counts: { done: slots.filter((s) => s.status === 'done').length, total: slots.length },
    plan_ready: run.status === 'planning' && steps['strategy']?.status === 'done',
  };
}
