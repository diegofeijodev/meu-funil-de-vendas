import type { TextLayout } from "@/lib/creative/visual-style";

/** Modos de áudio dos vídeos (Reels e stories em vídeo) — os mesmos da API (`AUDIO_MODES`). */
export type AudioMode = "ambiente_trilha" | "narracao" | "sem_audio";
export const AUDIO_MODES: Record<AudioMode, { label: string; hint: string }> = {
  ambiente_trilha: { label: "Ambiente + trilha", hint: "Som da cena e trilha instrumental leve, sem vozes." },
  narracao: { label: "Narração curta", hint: "Voz em português dizendo até 2 frases curtas (gancho e chamada)." },
  sem_audio: { label: "Sem áudio", hint: "Vídeo sem som." },
};
export const AUDIO_INSTRUCTIONS_MAX = 500;
export const VIDEO_SCRIPT_MAX = 3000;

export type RunCounts = {
  total: number;
  produced: number;
  producing: number;
  queued: number;
  scheduled: number;
  published: number;
  skipped: number;
  waiting: number;
  failed: number;
  review: number;
  rewriting: number;
};

/** Linha do cartão do período (produção automática). */
export function periodCounts(c: RunCounts): string {
  return `${c.total} conteúdos · ${c.produced} produzidos · ${c.producing} produzindo · ${c.queued} na fila · ${c.scheduled} agendados · ${c.published} publicados · ${c.skipped} pulados`;
}

/** Post que espera uma PESSOA (fila de Aprovações): aguardando aprovação, ou em revisão fora do modo totalmente automático. */
export const awaitsHuman = (p: { status: string; automation?: string | null }) =>
  p.status === "pending_approval" || (p.status === "needs_review" && p.automation !== "publish");

/** Layout efetivo da arte (o mesmo padrão da API): com headline, título no topo; sem headline, limpo. */
export const effectiveLayout = (brief: { layout?: string | null; headline?: string | null } | null | undefined): TextLayout =>
  ((brief?.layout as TextLayout | null | undefined) ?? (brief?.headline ? "titulo_topo" : "limpo")) as TextLayout;

/**
 * `creative_brief` salvo pelo painel de vídeo: o roteiro só vira `visual_prompt_override` se for diferente do gerado; o áudio do post
 * sobrepõe o da programação (`null` = volta ao padrão da programação).
 */
export function videoBriefPatch(
  brief: Record<string, unknown> | null | undefined,
  prompt: string,
  audio: { modo: AudioMode; instrucoes: string } | null,
): Record<string, unknown> {
  const rest: Record<string, unknown> = { ...(brief ?? {}) };
  delete rest.audio;
  const generated = String((brief?.video_direction as { prompt?: string } | undefined)?.prompt ?? "").trim();
  const text = prompt.trim().slice(0, VIDEO_SCRIPT_MAX);
  return {
    ...rest,
    visual_prompt_override: text && text !== generated ? text : null,
    ...(audio ? { audio: { modo: audio.modo, instrucoes: audio.instrucoes.trim().slice(0, AUDIO_INSTRUCTIONS_MAX) } } : {}),
  };
}
