import type { AttemptLog, FieldCheck } from './vacancy-types';

/**
 * Estado da prévia em `vacancy_story_settings.preview` (D15). Arquivo leve: a configuração (Task 7) mostra o estado e a prévia o grava.
 * `step`: `art` (criando a arte, tentativa 1–3), `check` (conferindo os textos, 1–3) e `fallback` (versão de reserva — a tela mostra
 * "Conferindo os textos"; `attempt` fica em 3, nunca "Tentativa 4 de 3").
 */
export type PreviewState = {
  run_id: string;
  status: 'running' | 'done' | 'failed';
  step: 'art' | 'check' | 'fallback';
  attempt: number;
  started_at: string;
  finished_at: string | null;
  media_url: string | null;
  asset_id: string | null;
  checks: FieldCheck[];
  attempts: AttemptLog[];
  used_fallback: boolean;
  /** B1: reserva com foto (`photo`) ou sem foto (`plain`); `null` = arte da IA aprovada. */
  fallback_kind: 'photo' | 'plain' | null;
  sample: boolean;
  /** Campos da vaga usada (a tela escreve "Usamos uma vaga de exemplo: Garçom, R$ 150, Sáb 31/10, 18h às 23h, Campinas."). */
  vacancy: { funcao: string; estabelecimento: string | null; valor: string; dia: string; horario: string; cidade: string } | null;
  error: string | null;
};

/** Prévia `running` há mais que isso travou (a API reiniciou no meio): a tela mostra falha e um novo pedido sobrescreve (D15). */
export const PREVIEW_STALE_MS = 10 * 60_000;
export const PREVIEW_STUCK = 'A prévia não terminou. Toque em Gerar prévia com uma vaga real para tentar de novo.';

/** Estado da prévia para a tela: `running` há mais de 10 min aparece como falha (com `PREVIEW_STUCK`); o resto passa como está. */
export function previewForView(raw: unknown, now: Date): unknown {
  const p = raw as { status?: unknown; started_at?: unknown } | null;
  if (!p || p.status !== 'running' || typeof p.started_at !== 'string') return raw;
  const started = Date.parse(p.started_at);
  if (Number.isNaN(started) || now.getTime() - started <= PREVIEW_STALE_MS) return raw;
  return { ...(raw as object), status: 'failed', error: PREVIEW_STUCK };
}
