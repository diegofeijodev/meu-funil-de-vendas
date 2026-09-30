/** Crítico visual: dá nota a cada variação com um modelo de visão (somente servidor). */
import { visionJSON, type Img } from "./llm.server";
import { shrink } from "./refs.server";
import type { AiScore } from "./visual-style";

const SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["produto", "fidelidade", "composicao", "defeitos", "paleta", "motivo"],
  properties: {
    produto: { type: "number" },
    fidelidade: { type: "number" },
    composicao: { type: "number" },
    defeitos: { type: "number" },
    paleta: { type: "number" },
    motivo: { type: "string" },
  },
};

export const MIN_SCORE = 28;
const clamp = (n: unknown) => Math.max(0, Math.min(10, Math.round(Number(n) || 0)));

export async function scoreCreative(opts: {
  workspaceId: string;
  image: Uint8Array;
  refs: Img[];
  palette: string[];
  aspectRatio: string;
  subject: string;
}): Promise<AiScore> {
  const candidate = await shrink(opts.image, 768);
  const refs = opts.refs.slice(0, 2);
  const prompt = [
    "Você é um crítico de direção de arte publicitária. Avalie a PRIMEIRA imagem (candidata).",
    refs.length ? `As ${refs.length} imagens seguintes são as referências reais da marca.` : "Não há referências.",
    `Assunto esperado: ${opts.subject}. Proporção: ${opts.aspectRatio}. Paleta da marca: ${opts.palette.join(", ") || "livre"}.`,
    "Notas de 0 a 10:",
    "produto = produto reconhecível e apetitoso/atraente;",
    "fidelidade = fidelidade às referências (se não houver, avalie coerência com o assunto);",
    "composicao = composição e espaço livre legível para texto;",
    "defeitos = ausência de defeitos (10 = nenhum; mãos/dedos errados, texto ilegível, artefatos reduzem);",
    "paleta = aderência à paleta da marca.",
    "motivo = 1 frase em português com o principal problema (ou o ponto forte, se estiver ótima).",
  ].join("\n");
  const r = await visionJSON(opts.workspaceId, prompt, [candidate, ...refs], SCHEMA, "creative_score");
  const s = {
    produto: clamp(r.produto),
    fidelidade: clamp(r.fidelidade),
    composicao: clamp(r.composicao),
    defeitos: clamp(r.defeitos),
    paleta: clamp(r.paleta),
    motivo: String(r.motivo ?? "").slice(0, 240),
  };
  return { ...s, total: s.produto + s.fidelidade + s.composicao + s.defeitos + s.paleta };
}
