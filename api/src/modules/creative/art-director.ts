/**
 * Diretor de arte: transforma o briefing em prompt visual para modelos de imagem/vídeo.
 * Só descreve o que se vê — nunca tom de voz, público ou objetivo.
 */
import { AiService } from '../ai/ai.service';
import { UserError } from '../media/user-error';
import { ArtDirection, listField, VisualStyle } from './visual-style';
import { contextForPrompt, contextProhibitions, PostCreativeContext } from './creative-context';

export const ART_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['subject', 'scene', 'composition', 'lighting', 'camera', 'style', 'color_palette', 'mood', 'text_in_image', 'negative', 'aspect_ratio', 'prompt_final', 'video_shots'],
  properties: {
    subject: { type: 'string' },
    scene: { type: 'string' },
    composition: { type: 'string' },
    lighting: { type: 'string' },
    camera: { type: 'string' },
    style: { type: 'string' },
    color_palette: { type: 'array', items: { type: 'string' } },
    mood: { type: 'string' },
    text_in_image: { type: 'string' },
    negative: { type: 'string' },
    aspect_ratio: { type: 'string' },
    prompt_final: { type: 'string' },
    video_shots: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['duracao', 'descricao', 'movimento_camera'],
        properties: { duracao: { type: 'string' }, descricao: { type: 'string' }, movimento_camera: { type: 'string' } },
      },
    },
  },
};

export const BASE_NEGATIVE =
  "anatomia deformada, dedos ou mãos extras, rostos distorcidos, texto ilegível, letras sem sentido, marca-d'água, logotipos de terceiros, baixa resolução, desfoque, saturação excessiva, aparência artificial";

const COMPOSITION: Record<string, string> = {
  '1:1': 'assunto centralizado, composição quadrada equilibrada',
  '4:5': 'assunto nos dois terços inferiores, espaço livre na parte superior para o título',
  '9:16': 'enquadramento vertical, assunto no terço central, terços superior e inferior livres para texto e interface do Instagram',
  '16:9': 'enquadramento horizontal amplo, assunto em um dos terços e espaço livre no outro lado',
};

/** Carrossel: o "fio visual" único (paleta, estilo fotográfico, luz) definido pelo 1º slide e repetido em todos. */
export type VisualThread = { paleta: string[]; estilo_fotografico: string; luz: string };

export const threadOf = (ad: ArtDirection): VisualThread => ({
  paleta: listField(ad.color_palette).slice(0, 6),
  estilo_fotografico: String(ad.style ?? '').trim(),
  luz: String(ad.lighting ?? '').trim(),
});

/** Repete o fio visual no texto final do slide (o modelo de imagem não vê os outros slides). Idempotente. */
export function withVisualThread(ad: ArtDirection, t: VisualThread): ArtDirection {
  const parts = [t.paleta.length ? `paleta ${t.paleta.join(', ')}` : '', t.estilo_fotografico ? `estilo fotográfico ${t.estilo_fotografico}` : '', t.luz ? `luz ${t.luz}` : ''].filter(Boolean);
  if (!parts.length || ad.prompt_final.includes('Fio visual do carrossel')) return ad;
  return { ...ad, prompt_final: `${ad.prompt_final} Fio visual do carrossel (igual em todos os slides): ${parts.join('; ')}.` };
}

export type ArtBrief = {
  workspaceId: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  brand: any | null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  campaign?: any | null;
  products?: { name: string; description?: string | null }[];
  theme?: string | null;
  hook?: string | null;
  offer?: string | null;
  userPrompt?: string | null;
  aspectRatio: string;
  kind: 'image' | 'video';
  provider: string;
  hasProductRef?: boolean;
  adjust?: string | null;
  previousPrompt?: string | null;
  slide?: { index: number; total: number } | null;
  /** Resumo da estratégia aprovada (big idea, ângulo, direção visual, roteiro de vídeo). */
  strategy?: unknown;
  /** Contexto completo do post (produto, pilar, persona, funil, estratégia da execução, campanha, data) — nunca vira texto na imagem. */
  context?: PostCreativeContext | null;
  /** Carrossel: fio visual repetido em todos os slides. */
  visualThread?: VisualThread | null;
};

export async function buildVisualPrompt(ai: AiService, b: ArtBrief): Promise<ArtDirection> {
  const vs = (b.brand?.visual_style ?? {}) as VisualStyle;
  const examples = listField(vs.exemplos_prompt).slice(-3);
  const aspect = b.aspectRatio in COMPOSITION ? b.aspectRatio : '1:1';
  const prompt = [
    'Você é diretor de arte sênior de agência de publicidade. Transforme o briefing em um prompt para modelo de imagem/vídeo.',
    'REGRAS:',
    '- Descreva APENAS o que se vê. Nunca coloque tom de voz, público, objetivo, dores ou jargão de marketing no prompt.',
    '- O produto é sempre o protagonista; se for comida/bebida, em ângulo apetitoso (close, textura, frescor).',
    "- Nunca peça texto na imagem: todo título, preço e logotipo é aplicado depois pelo aplicativo. Preencha text_in_image com 'none' (valor técnico do formato JSON).",
    `- negative deve incluir sempre: ${BASE_NEGATIVE}, mais os elementos proibidos da marca.`,
    `- Composição para ${aspect}: ${COMPOSITION[aspect]}.`,
    '- Escreva TODOS os campos descritivos, inclusive prompt_final, negative, cenas e tomadas, somente em português do Brasil. Não traduza nomes próprios da marca ou dos produtos.',
    '- prompt_final em português do Brasil, 60 a 120 palavras, descritivo e concreto (sujeito, cena, luz, câmera/lente, estilo, paleta).',
    b.hasProductRef ? '- Há fotos de referência do produto: o prompt_final DEVE conter "Use o produto exatamente como nas imagens de referência".' : '',
    b.kind === 'video'
      ? '- É vídeo: preencha video_shots com 2 a 4 tomadas (duracao em segundos, descricao, movimento_camera) e descreva o movimento no prompt_final.'
      : '- É imagem: video_shots = [].',
    `- aspect_ratio = "${b.aspectRatio}". Provedor de destino: ${b.provider}.`,
    '',
    'GUIA VISUAL DA MARCA:',
    JSON.stringify({
      marca: b.brand?.name,
      segmento: b.brand?.segment,
      estilo_fotografico: vs.estilo_fotografico,
      iluminacao: vs.iluminacao,
      paleta_hex: vs.paleta_hex?.length ? vs.paleta_hex : [b.brand?.primary_color, b.brand?.secondary_color].filter(Boolean),
      ambientes: vs.ambientes,
      elementos_obrigatorios: vs.elementos_obrigatorios,
      elementos_proibidos: vs.elementos_proibidos,
    }),
    examples.length ? `PROMPTS QUE FUNCIONARAM PARA ESTA MARCA (use como referência de estilo):\n- ${examples.join('\n- ')}` : '',
    '',
    'BRIEFING:',
    JSON.stringify({
      tema: b.theme,
      hook: b.hook,
      oferta: b.offer ?? b.campaign?.offer_product ?? b.context?.campaign?.offer ?? null,
      pedido: b.userPrompt,
      produtos: (b.products ?? (b.context?.product ? [b.context.product] : [])).map((p) => ({ nome: p.name, descricao: p.description })).slice(0, 3),
      slide: b.slide ? `${b.slide.index + 1} de ${b.slide.total} de um carrossel (varie o enquadramento)` : null,
    }),
    b.strategy ? `CONCEITO DA ESTRATÉGIA (traduza em cena visual concreta; nunca escreva estes textos na imagem): ${JSON.stringify(b.strategy)}` : '',
    b.context
      ? `CONTEXTO DO POST (traduza em cena visual concreta — produto, público, momento do funil, data e estação; nunca escreva estes textos na imagem): ${JSON.stringify(contextForPrompt(b.context))}`
      : '',
    contextProhibitions(b.context).length ? `PROIBIDO NA CENA (estratégia do período): ${contextProhibitions(b.context).join('; ')}.` : '',
    b.visualThread
      ? `FIO VISUAL DO CARROSSEL (obrigatório neste slide: mesma paleta, mesmo estilo fotográfico e mesma luz dos outros slides): ${JSON.stringify(b.visualThread)}`
      : '',
    b.previousPrompt ? `PROMPT ANTERIOR: ${b.previousPrompt}` : '',
    b.adjust ? `AJUSTE PEDIDO (aplique com prioridade): ${b.adjust}` : '',
  ]
    .filter(Boolean)
    .join('\n');

  const json = await ai.json<ArtDirection>(b.workspaceId, { prompt, schema: ART_SCHEMA, name: 'art_direction' });
  const forb = [...listField(vs.elementos_proibidos), ...contextProhibitions(b.context)].join(', ');
  const negative = [json.negative || BASE_NEGATIVE, forb].filter(Boolean).join(', ');
  let final = String(json.prompt_final || '').trim();
  if (!final) throw new UserError('O diretor de arte não devolveu o prompt.');
  if (b.hasProductRef && !/produto exatamente como nas imagens de referência/i.test(final)) final += ' Use o produto exatamente como nas imagens de referência.';
  return {
    ...json,
    negative,
    aspect_ratio: b.aspectRatio,
    color_palette: listField(json.color_palette),
    video_shots: Array.isArray(json.video_shots) ? json.video_shots : [],
    prompt_final: final,
  };
}

/** Texto enviado ao modelo: prompt + o que evitar. */
export function providerPrompt(ad: Pick<ArtDirection, 'prompt_final' | 'negative' | 'text_in_image'>): string {
  const noText = !ad.text_in_image || ad.text_in_image === 'none' ? ' Não inclua texto, letras nem logotipos na imagem.' : ` O único texto permitido é "${ad.text_in_image}".`;
  return `${ad.prompt_final}${noText} Evite: ${ad.negative}.`;
}
