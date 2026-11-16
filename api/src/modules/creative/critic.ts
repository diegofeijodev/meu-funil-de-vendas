/** Crítico visual: dá nota a cada variação com um modelo de visão. */
import { AiService } from '../ai/ai.service';
import { AiImageInput } from '../ai/ai.types';
import { ImageService } from '../media/image.service';
import type { AiScore } from './visual-style';

export const CRITIC_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['problemas', 'produto', 'fidelidade', 'composicao', 'defeitos', 'paleta', 'motivo'],
  properties: {
    problemas: { type: 'array', items: { type: 'string' } },
    produto: { type: 'number' },
    fidelidade: { type: 'number' },
    composicao: { type: 'number' },
    defeitos: { type: 'number' },
    paleta: { type: 'number' },
    motivo: { type: 'string' },
  },
};

export const MIN_SCORE = 28;
/**
 * Abaixo disto em `defeitos` a arte reprova mesmo com total alto. Em 16/11/2026 um garçom com tampas flutuando e três pratos
 * nas mãos passou com 39/50: o defeito físico de IA se diluía na média das cinco notas.
 */
export const MIN_DEFECTS = 7;
/** Com qualquer problema listado na inspeção, `defeitos` não passa disto (fica abaixo de MIN_DEFECTS → uma nova tentativa). */
const DEFECTS_CAP_WITH_PROBLEMS = 6;

const clamp = (n: unknown) => Math.max(0, Math.min(10, Math.round(Number(n) || 0)));
const hasNumber = (v: unknown) => v !== null && v !== undefined && v !== '' && Number.isFinite(Number(v));

/** Aprovada = total suficiente E sem defeito físico. Sem nota (crítico fora do ar ou resposta sem números) não é aprovada. */
export const passes = (s: AiScore | null | undefined): boolean => !!s && s.total >= MIN_SCORE && s.defeitos >= MIN_DEFECTS;

/** Ordena candidatas, melhor primeiro: aprovada antes de reprovada, depois menos defeitos, depois o total; sem nota por último. */
export function compareScores(a: AiScore | null | undefined, b: AiScore | null | undefined): number {
  if (!a || !b) return Number(!a) - Number(!b);
  return Number(passes(b)) - Number(passes(a)) || b.defeitos - a.defeitos || b.total - a.total;
}

/** Recado do crítico para o diretor de arte refazer: o motivo e, quando houver, os problemas vistos na imagem. */
export function rebuildNote(s: AiScore): string {
  const problems = (s.problemas ?? []).filter(Boolean);
  return problems.length ? `${s.motivo} Problemas vistos na imagem: ${problems.join('; ')}.`.trim() : s.motivo;
}

/**
 * Resposta → nota. Com chave própria a visão responde sem schema estrito: as notas podem vir aninhadas (`notas: {...}`). Sem
 * `defeitos` numérico a resposta não vale como nota (antes virava 0/50 e disparava uma nova geração à toa).
 */
function parseScore(raw: unknown): AiScore | null {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const nested = Object.values(r).filter((v): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v));
  const flat: Record<string, unknown> = Object.assign({}, ...nested, r);
  // Sem `defeitos` numérico a nota é incompleta: não pode virar 0 (reprovaria à toa) nem passar sem a inspeção física.
  if (!hasNumber(flat['defeitos'])) return null;
  const rawProblems = flat['problemas'];
  const problemas = (Array.isArray(rawProblems) ? rawProblems : typeof rawProblems === 'string' ? [rawProblems] : [])
    .map((p) => (typeof p === 'string' ? p.replace(/\s+/g, ' ').trim().slice(0, 120) : ''))
    .filter(Boolean)
    .slice(0, 8);
  const defeitos = problemas.length ? Math.min(clamp(flat['defeitos']), DEFECTS_CAP_WITH_PROBLEMS) : clamp(flat['defeitos']);
  const s = {
    produto: clamp(flat['produto']),
    fidelidade: clamp(flat['fidelidade']),
    composicao: clamp(flat['composicao']),
    defeitos,
    paleta: clamp(flat['paleta']),
    motivo: (typeof flat['motivo'] === 'string' ? flat['motivo'] : '').slice(0, 240),
    problemas,
  };
  return { ...s, total: s.produto + s.fidelidade + s.composicao + s.defeitos + s.paleta };
}

export async function scoreCreative(
  ai: AiService,
  images: ImageService,
  opts: { workspaceId: string; image: Uint8Array; refs: AiImageInput[]; palette: string[]; aspectRatio: string; subject: string },
): Promise<AiScore | null> {
  const candidate = await images.shrink(opts.image, 768);
  const refs = opts.refs.slice(0, 2);
  const prompt = [
    'Você é um crítico de direção de arte publicitária e revisor de fotografia. Avalie a PRIMEIRA imagem (candidata).',
    refs.length ? `As ${refs.length} imagens seguintes são as referências reais da marca.` : 'Não há referências.',
    `Assunto esperado: ${opts.subject}. Proporção: ${opts.aspectRatio}. Paleta da marca: ${opts.palette.join(', ') || 'livre'}.`,
    '',
    'PASSO 1 — INSPEÇÃO FÍSICA. Antes de dar nota, examine a candidata como quem procura erro de imagem gerada por IA e liste em "problemas" cada erro que você VÊ (frases curtas; lista vazia se não houver nenhum):',
    '- mãos e braços: conte os dedos de cada mão visível e conte os objetos que cada mão segura — uma mão segura no máximo um objeto, e prato, bandeja ou tampa precisa de apoio ou de uma mão segurando;',
    '- gravidade: objeto flutuando ou sem apoio (tampa, prato, copo, talher), líquido que não cai, uma coisa atravessando outra;',
    '- corpo: dedos ou membros a mais ou a menos, braço saindo do lugar errado, rosto ou olhos deformados, pessoas fundidas;',
    '- objetos: repetidos sem sentido, derretidos, com alça ou encaixe impossível, sombra ou reflexo incoerente;',
    '- texto: letras ilegíveis, palavras sem sentido, marca de terceiros;',
    '- aparência: pele de plástico, brilho de render, saturação exagerada, cara de banco de imagem.',
    '',
    'PASSO 2 — NOTAS de 0 a 10:',
    'produto = produto reconhecível e apetitoso/atraente;',
    'fidelidade = fidelidade às referências (se não houver, avalie coerência com o assunto);',
    'composicao = composição e espaço livre legível para texto;',
    'defeitos = ausência de defeitos, coerente com a sua lista: 10 só com "problemas" vazia; erro físico (objeto flutuando, mão segurando mais do que pode, dedos ou membros errados, rosto deformado) = no máximo 4; só aparência artificial ou detalhe pequeno = 5 ou 6;',
    'paleta = aderência à paleta da marca.',
    'motivo = 1 frase em português com o principal problema (ou o ponto forte, se estiver ótima).',
    '',
    'Responda com UM objeto JSON plano, exatamente com estas chaves: "problemas" (lista de textos), "produto", "fidelidade", "composicao", "defeitos", "paleta" (números) e "motivo" (texto).',
  ].join('\n');
  // Resposta sem número nenhum (acontece com chave própria, sem schema estrito): pergunta de novo uma vez.
  for (let attempt = 0; attempt < 2; attempt++) {
    const r = await ai.vision<Record<string, unknown>>(opts.workspaceId, { prompt, schema: CRITIC_SCHEMA, name: 'creative_score', images: [candidate, ...refs] });
    const score = parseScore(r);
    if (score) return score;
  }
  return null;
}
