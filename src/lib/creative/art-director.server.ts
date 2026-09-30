/**
 * Diretor de arte: transforma o briefing em prompt visual para modelos de imagem/vídeo.
 * Só descreve o que se vê — nunca tom de voz, público ou objetivo.
 */
import { jsonLLM } from "./llm.server";
import { listField, type ArtDirection, type VisualStyle } from "./visual-style";

const SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: [
    "subject",
    "scene",
    "composition",
    "lighting",
    "camera",
    "style",
    "color_palette",
    "mood",
    "text_in_image",
    "negative",
    "aspect_ratio",
    "prompt_final",
    "video_shots",
  ],
  properties: {
    subject: { type: "string" },
    scene: { type: "string" },
    composition: { type: "string" },
    lighting: { type: "string" },
    camera: { type: "string" },
    style: { type: "string" },
    color_palette: { type: "array", items: { type: "string" } },
    mood: { type: "string" },
    text_in_image: { type: "string" },
    negative: { type: "string" },
    aspect_ratio: { type: "string" },
    prompt_final: { type: "string" },
    video_shots: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["duracao", "descricao", "movimento_camera"],
        properties: {
          duracao: { type: "string" },
          descricao: { type: "string" },
          movimento_camera: { type: "string" },
        },
      },
    },
  },
};

const BASE_NEGATIVE =
  "deformed anatomy, extra fingers, extra hands, distorted faces, illegible text, gibberish letters, watermark, third-party logos, low resolution, blurry, oversaturated, plastic look";

const COMPOSITION: Record<string, string> = {
  "1:1": "centered subject, balanced square composition",
  "4:5": "subject in lower two thirds, clean breathing room in the top area for a headline",
  "9:16":
    "vertical frame, subject in the middle third, top third and bottom third kept clean and uncluttered for text and Instagram UI",
  "16:9": "wide landscape frame, subject on one third, negative space on the other side",
};

export type ArtBrief = {
  workspaceId: string;
  brand: any | null;
  campaign?: any | null;
  products?: any[];
  theme?: string | null;
  hook?: string | null;
  offer?: string | null;
  userPrompt?: string | null;
  aspectRatio: string;
  kind: "image" | "video";
  provider: string;
  hasProductRef?: boolean;
  adjust?: string | null;
  previousPrompt?: string | null;
  slide?: { index: number; total: number } | null;
};

export async function buildVisualPrompt(b: ArtBrief): Promise<ArtDirection> {
  const vs = (b.brand?.visual_style ?? {}) as VisualStyle;
  const examples = listField(vs.exemplos_prompt).slice(-3);
  const aspect = b.aspectRatio in COMPOSITION ? b.aspectRatio : "1:1";
  const prompt = [
    "Você é diretor de arte sênior de agência de publicidade. Transforme o briefing em um prompt para modelo de imagem/vídeo.",
    "REGRAS:",
    "- Descreva APENAS o que se vê. Nunca coloque tom de voz, público, objetivo, dores ou jargão de marketing no prompt.",
    "- O produto é sempre o protagonista; se for comida/bebida, em ângulo apetitoso (close, textura, frescor).",
    "- Nunca peça texto longo na imagem. text_in_image = \"none\" ou no máximo 4 palavras. Prefira \"none\" (o texto é aplicado depois pelo app).",
    `- negative deve incluir sempre: ${BASE_NEGATIVE}, mais os elementos proibidos da marca.`,
    `- Composição para ${aspect}: ${COMPOSITION[aspect]}.`,
    "- prompt_final em inglês, 60 a 120 palavras, descritivo e concreto (sujeito, cena, luz, câmera/lente, estilo, paleta).",
    b.hasProductRef
      ? '- Há fotos de referência do produto: o prompt_final DEVE conter "use the product exactly as in the reference images".'
      : "",
    b.kind === "video"
      ? "- É vídeo: preencha video_shots com 2 a 4 tomadas (duracao em segundos, descricao, movimento_camera) e descreva o movimento no prompt_final."
      : "- É imagem: video_shots = [].",
    `- aspect_ratio = "${b.aspectRatio}". Provedor de destino: ${b.provider}.`,
    "",
    "GUIA VISUAL DA MARCA:",
    JSON.stringify({
      marca: b.brand?.name,
      segmento: b.brand?.segment,
      estilo_fotografico: vs.estilo_fotografico,
      iluminacao: vs.iluminacao,
      paleta_hex: vs.paleta_hex?.length
        ? vs.paleta_hex
        : [b.brand?.primary_color, b.brand?.secondary_color].filter(Boolean),
      ambientes: vs.ambientes,
      elementos_obrigatorios: vs.elementos_obrigatorios,
      elementos_proibidos: vs.elementos_proibidos,
    }),
    examples.length ? `PROMPTS QUE FUNCIONARAM PARA ESTA MARCA (use como referência de estilo):\n- ${examples.join("\n- ")}` : "",
    "",
    "BRIEFING:",
    JSON.stringify({
      tema: b.theme,
      hook: b.hook,
      oferta: b.offer ?? b.campaign?.offer_product ?? null,
      pedido: b.userPrompt,
      produtos: (b.products ?? []).map((p) => ({ nome: p.name, descricao: p.description })).slice(0, 3),
      slide: b.slide ? `${b.slide.index + 1} de ${b.slide.total} de um carrossel (varie o enquadramento)` : null,
    }),
    b.previousPrompt ? `PROMPT ANTERIOR: ${b.previousPrompt}` : "",
    b.adjust ? `AJUSTE PEDIDO (aplique com prioridade): ${b.adjust}` : "",
  ]
    .filter(Boolean)
    .join("\n");

  const json = (await jsonLLM(b.workspaceId, prompt, SCHEMA, "art_direction")) as ArtDirection;
  const forb = listField(vs.elementos_proibidos).join(", ");
  const negative = [json.negative || BASE_NEGATIVE, forb].filter(Boolean).join(", ");
  let final = String(json.prompt_final || "").trim();
  if (!final) throw new Error("O diretor de arte não devolveu o prompt.");
  if (b.hasProductRef && !/exactly as in the reference/i.test(final))
    final += " Use the product exactly as in the reference images.";
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
export function providerPrompt(ad: Pick<ArtDirection, "prompt_final" | "negative" | "text_in_image">) {
  const noText =
    !ad.text_in_image || ad.text_in_image === "none"
      ? " No text, letters or logos anywhere in the image."
      : ` The only text allowed is "${ad.text_in_image}".`;
  return `${ad.prompt_final}${noText} Avoid: ${ad.negative}.`;
}
