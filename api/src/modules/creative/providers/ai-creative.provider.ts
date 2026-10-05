import { Logger } from '@nestjs/common';
import { AiService } from '../../ai/ai.service';
import { AiError } from '../../ai/ai-error';
import { isValidVideoJobId } from '../../ai/video-job-id';
import { GenerationRequest, GenerationResult, ServerCreativeProvider } from '../creative.types';

/** O job de vídeo pertence a este workspace? (a linha em `creative_generation_jobs` é o vínculo) */
export type OwnsJob = (workspaceId: string, externalJobId: string) => Promise<boolean>;

const logger = new Logger('AiCreativeProvider');
const ready = (r: { bytes: Buffer; mime: string }, cost: number, jobId: string | null, note: string | null): GenerationResult => ({
  status: 'ready', assetUrl: null, bytes: r.bytes, mime: r.mime, thumbnailUrl: null, externalJobId: jobId, cost, note,
});

/**
 * ChatGPT (imagem) e Gemini (imagem + vídeo Veo) por `AiService`: chave própria do workspace primeiro,
 * senão gateway do app. `strict` = não cai para os créditos do app (a cadeia automática decide o próximo).
 */
export function createAiProvider(
  ai: AiService,
  workspaceId: string,
  vendor: 'openai' | 'gemini',
  opts: { hasOwnKey: boolean; strict?: boolean; appOnly?: boolean; label?: string; owns: OwnsJob },
): ServerCreativeProvider {
  const chat = vendor === 'openai';
  return {
    id: chat ? 'chatgpt' : 'gemini',
    label: opts.label ?? (chat ? (opts.hasOwnKey ? 'ChatGPT (sua conta OpenAI)' : 'ChatGPT (OpenAI)') : opts.hasOwnKey ? 'Gemini (sua conta Google)' : 'Gemini (Google)'),
    sandbox: false,
    async generateImage(req) {
      const r = await ai.image(workspaceId, {
        prompt: req.finalPrompt, aspectRatio: req.aspectRatio, referenceImages: req.referenceImages, vendor, strict: opts.strict, appOnly: opts.appOnly,
      });
      return ready(r, r.cost, null, r.note);
    },
    async generateVideo(req) {
      if (chat) throw new AiError('O ChatGPT não gera vídeos. Escolha Gemini ou Higgsfield para vídeo.');
      const r = await ai.video(workspaceId, {
        prompt: req.finalPrompt, aspectRatio: req.aspectRatio, referenceImages: req.referenceImages, maxWaitMs: req.maxWaitMs, strict: opts.strict, appOnly: opts.appOnly, audio: req.audio,
      });
      if (r.status === 'pending') {
        return { status: 'generating', assetUrl: null, thumbnailUrl: null, externalJobId: r.jobId, cost: r.cost, note: r.note };
      }
      return ready(r, r.cost, r.jobId, r.note);
    },
    // Vídeos que passaram do prazo da requisição: o poller consulta aqui até ficarem prontos.
    // NUNCA consulta um id arbitrário: formato válido (`veo:`/`gveo:`) E o id tem que estar gravado num job DESTE workspace.
    async getGenerationStatus(externalJobId) {
      const failed: GenerationResult = { status: 'failed', assetUrl: null, thumbnailUrl: null, externalJobId, cost: 0 };
      if (!isValidVideoJobId(externalJobId) || !(await opts.owns(workspaceId, externalJobId))) {
        logger.warn(`id de job de vídeo recusado (formato/vínculo): ${String(externalJobId).slice(0, 40)}`);
        return failed;
      }
      const r = await ai.videoStatus(workspaceId, externalJobId);
      if (r.status === 'failed') return failed;
      if (r.status === 'pending') return { status: 'generating', assetUrl: null, thumbnailUrl: null, externalJobId, cost: 0 };
      return ready(r, 0, externalJobId, null);
    },
    async getAsset() {
      return null;
    },
  };
}
