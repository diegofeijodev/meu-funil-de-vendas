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

export type AutopilotEventKind = 'generation' | 'media' | 'schedule' | 'publish' | 'failure' | 'approval' | 'reschedule' | 'optimize' | 'guardrail';

export const fmtDate = (iso: string | Date) =>
  new Date(iso).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo', dateStyle: 'short', timeStyle: 'short' });
