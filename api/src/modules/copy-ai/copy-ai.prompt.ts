const FIELDS = [
  'headline', 'texto_curto', 'texto_longo', 'cta', 'meta_ad', 'instagram_feed',
  'reels', 'stories', 'script_ugc', 'script_institucional',
] as const;

/** Schema estrito `copy` (igual ao de `copy-ai.server.ts`). */
export const COPY_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: [...FIELDS, 'headline_variacoes', 'carrossel', 'quiz'],
  properties: {
    ...Object.fromEntries(FIELDS.map((f) => [f, { type: 'string' }])),
    headline_variacoes: { type: 'array', items: { type: 'string' } },
    carrossel: { type: 'array', items: { type: 'string' } },
    quiz: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['pergunta', 'opcoes'],
        properties: { pergunta: { type: 'string' }, opcoes: { type: 'array', items: { type: 'string' } } },
      },
    },
  },
};

/** Prompt do Copy Engine — texto idêntico ao protótipo. */
export function buildCopyPrompt(brand: unknown, brief: unknown, seed: number, strategy: unknown = null): string {
  return [
    'Você é um copywriter sênior de performance no Brasil. Escreva em português do Brasil.',
    'Respeite o tom de voz, use as palavras preferidas e NUNCA use as palavras proibidas da marca.',
    strategy
      ? 'Siga a ESTRATÉGIA aprovada: a big idea e a mensagem principal guiam tudo; cada variação de headline explora um ângulo; responda as objeções no texto longo.'
      : '',
    'Devolva SOMENTE um JSON com: headline, headline_variacoes (5), texto_curto, texto_longo, cta, meta_ad,',
    'instagram_feed, reels (roteiro com tempos), stories (4 stories), script_ugc, script_institucional,',
    'carrossel (7 slides), quiz (3 perguntas com 3-4 opções).',
    `Versão ${seed + 1}: traga ângulos diferentes das versões anteriores.`,
    `MARCA: ${JSON.stringify(brand)}`,
    `CAMPANHA: ${JSON.stringify(brief)}`,
    strategy ? `ESTRATÉGIA: ${JSON.stringify(strategy)}` : '',
  ]
    .filter(Boolean)
    .join('\n');
}
