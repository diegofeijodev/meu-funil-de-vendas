import { Env } from '../../common/config/env.validation';

/** Ids de modelo do protótipo (aliases do Lovable AI gateway) → modelos reais configuráveis por env. */
export function resolveModel(env: Pick<Env, 'AI_MODEL_TEXT' | 'AI_MODEL_TEXT_FAST' | 'AI_MODEL_IMAGE_OPENAI' | 'AI_MODEL_IMAGE_GEMINI' | 'AI_MODEL_VIDEO' | 'AI_MODEL_GEMINI_FLASH' | 'AI_MODEL_GEMINI_PRO'>, id: string | undefined): string {
  switch (id) {
    case undefined:
    case 'openai/gpt-6-astra':
      return env.AI_MODEL_TEXT;
    case 'openai/gpt-image-2.5-sunburst':
      return env.AI_MODEL_IMAGE_OPENAI;
    case 'google/gemini-3.1-flash-image':
      return env.AI_MODEL_IMAGE_GEMINI;
    case 'google/veo-3.1-fast':
      return env.AI_MODEL_VIDEO;
    case 'google/gemini-3.1-flash':
      return env.AI_MODEL_GEMINI_FLASH;
    case 'google/gemini-3.1-pro':
      return env.AI_MODEL_GEMINI_PRO;
    default:
      // Id desconhecido: assume que já é um nome real de modelo.
      return id;
  }
}
