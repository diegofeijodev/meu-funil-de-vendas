/**
 * Modelos de imagem da OpenAI usados no Creative Studio (geração e edição) e no Diagnóstico das IAs.
 * Único lugar para trocar o modelo: o gpt-image-1 foi desligado pela OpenAI em 23/10/2026.
 * Ordem = preferência: o primeiro é o principal; os seguintes são alternativas se ele falhar.
 */
export const OPENAI_IMAGE_MODEL = "gpt-image-2.5-sunburst";
export const OPENAI_IMAGE_MODEL_FALLBACK = "gpt-image-2.5-flare";
export const OPENAI_IMAGE_MODELS: readonly string[] = Object.freeze([OPENAI_IMAGE_MODEL, OPENAI_IMAGE_MODEL_FALLBACK]);

/** Mesmo modelo pelo gateway da Lovable AI (prefixo do provedor). */
export const gatewayImageModel = (model: string) => `openai/${model}`;
