export type IgFormat = 'feed_image' | 'feed_carousel' | 'reel' | 'story_image' | 'story_video';
export const IG_FORMATS: IgFormat[] = ['feed_image', 'feed_carousel', 'reel', 'story_image', 'story_video'];
export type Engine = 'auto' | 'chatgpt' | 'gemini';

export const ASPECT: Record<IgFormat, string> = {
  feed_image: '1:1',
  feed_carousel: '4:5',
  reel: '9:16',
  story_image: '9:16',
  story_video: '9:16',
};
export const isVideoFormat = (f: IgFormat | string) => f === 'reel' || f === 'story_video';

/** Linha de `ig_posts` como o serviço a manipula (campos JSON soltos, como no protótipo). */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type PostRow = any;

export type AutopilotEventKind =
  | 'generation' | 'media' | 'schedule' | 'publish' | 'failure' | 'approval' | 'reschedule' | 'optimize' | 'guardrail'
  // Produção automática (05/10/2026): estratégia aprovada sozinha, post reescrito/pulado e vídeo refeito pelo crítico.
  | 'strategy_auto_approved' | 'post_rewritten' | 'post_skipped' | 'video_regenerated';

/** Evento da aprovação automática da estratégia (modo totalmente automático). */
export const STRATEGY_AUTO_APPROVED = 'Estratégia do período aprovada automaticamente (modo totalmente automático).';
/** Prefixo do `last_error` de um post pulado pelo modo totalmente automático (a tela lista os "Pulados" por ele). */
export const SKIP_PREFIX = 'Pulado automaticamente: ';
export const isSkipped = (p: { status: string; last_error?: string | null }) => p.status === 'cancelled' && !!p.last_error?.startsWith(SKIP_PREFIX);
/** Atraso máximo para publicar um post da programação; passou disso, o modo "publish" pula o horário. */
export const OVERDUE_MS = 12 * 3600e3;
/** Post da programação sem conta conectada: fica pronto com este aviso e é agendado sozinho quando a conta conectar. */
export const NO_ACCOUNT_MSG = 'Conecte o Instagram para publicar.';
/** Post da programação que estava na fila quando o token venceu: volta para "pronto" com este aviso. */
export const TOKEN_EXPIRED_POST_MSG = 'Token da Meta expirado: reconecte o Instagram para publicar.';

export const fmtDate = (iso: string | Date) =>
  new Date(iso).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo', dateStyle: 'short', timeStyle: 'short' });
