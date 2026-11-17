/**
 * Notas de estilo (Fatias 5/6 + leitura v2): a IA de visão olha a referência e descreve SÓ o estilo, em texto. É esse texto — nunca a imagem — que
 * orienta o diretor de arte e o de vídeo. Decisão de direitos autorais da spec §2.3.
 */
import { cleanFree } from '../../common/text/clean-free';
import { isStyleCategory, STYLE_CATEGORY_IDS, STYLE_CATEGORY_LABEL, StyleCategoryId } from './categories';

export type StyleNotes = {
  v?: 2;
  paleta: string[];
  composicao: string;
  luz: string;
  enquadramento: string;
  clima: string;
  evitar: string[];
  categorias: StyleCategoryId[];
  assunto: string;
  acabamento: string;
};

/** Quais referências entraram no bloco de uma peça (ids de `style_references`). */
export type StyleRefsUsed = { own: string[]; library: string[] };
export type StylePick = { text: string; used: StyleRefsUsed };
/** Itens de estilo para a foto das vagas (Fatia 5): só paleta, luz e clima, ainda sem o filtro da P14. */
export type PhotoStyle = { paleta: string[]; luz: string[]; clima: string[] };
/** Registro gravado na peça (`creatives.style_refs` / `ig_posts.style_refs`). */
export type StyleRefsRecord = StyleRefsUsed & { brand_id: string | null };

export const NOTE_MAX = 600;
export const BLOCK_MAX = 2500;
export const MAX_NOTES = 4;
export const STYLE_NOTES_HEADER =
  'INSPIRAÇÃO DE ESTILO (referências da marca; não copie composição, pessoas, marcas nem textos; use cores, luz, clima e acabamento só das que combinam com o briefing):';

export const STYLE_NOTES_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['paleta', 'composicao', 'luz', 'enquadramento', 'clima', 'evitar', 'categorias', 'assunto', 'acabamento'],
  properties: {
    paleta: { type: 'array', items: { type: 'string' } },
    composicao: { type: 'string' },
    luz: { type: 'string' },
    enquadramento: { type: 'string' },
    clima: { type: 'string' },
    evitar: { type: 'array', items: { type: 'string' } },
    categorias: { type: 'array', items: { type: 'string', enum: [...STYLE_CATEGORY_IDS] } },
    assunto: { type: 'string' },
    acabamento: { type: 'string' },
  },
} as const;

const CATEGORY_LIST = STYLE_CATEGORY_IDS.map((id) => `${id} (${STYLE_CATEGORY_LABEL[id]})`).join(', ');

export const STYLE_NOTES_PROMPT = [
  'Você é diretor de arte. Olhe esta imagem de REFERÊNCIA e descreva só o ESTILO visual, para inspirar uma arte NOVA de outra marca.',
  'Não descreva pessoas identificáveis, marcas, logotipos, produtos de terceiros nem textos da imagem.',
  'Responda em português do Brasil, frases curtas:',
  '- paleta: até 4 cores em palavras (ex.: "laranja queimado");',
  '- composicao: como os elementos se organizam;',
  '- luz: tipo e direção da luz, em até 10 palavras;',
  '- enquadramento: distância e ângulo da câmera;',
  '- clima: a sensação que passa;',
  `- categorias: de 1 a 3 destes códigos, os que dizem o assunto da imagem: ${CATEGORY_LIST};`,
  '- assunto: o que a imagem mostra, em até 6 palavras, sem marca nem nome;',
  '- acabamento: até 300 letras sobre superfície, tipo de fundo, profundidade de campo e textura (não descreva onde ficam os elementos nem as pessoas; sem texto, letreiro, marca, nome nem logotipo);',
  '- evitar: até 3 coisas que destoariam desse estilo.',
].join('\n');

const list = (v: unknown, n: number, max: number) => (Array.isArray(v) ? v.map((x) => cleanFree(x, max)).filter(Boolean).slice(0, n) : []);

/** Até 6 palavras e 50 letras (P3). */
function subject(v: unknown): string {
  return cleanFree(v, 400).split(' ').filter(Boolean).slice(0, 6).join(' ').slice(0, 50).trim();
}

/** Resposta da IA → notas (forma conferida: chave própria responde sem schema estrito). Sem nada útil = null. */
export function normalizeStyleNotes(raw: unknown): StyleNotes | null {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const cats = Array.isArray(r['categorias']) ? r['categorias'].filter(isStyleCategory) : [];
  const n: StyleNotes = {
    paleta: list(r['paleta'], 4, 20),
    composicao: cleanFree(r['composicao'], 80),
    luz: cleanFree(r['luz'], 70),
    enquadramento: cleanFree(r['enquadramento'], 80),
    clima: cleanFree(r['clima'], 80),
    evitar: list(r['evitar'], 3, 30),
    categorias: [...new Set(cats)].slice(0, 3),
    assunto: subject(r['assunto']),
    acabamento: cleanFree(r['acabamento'], 300),
  };
  return n.paleta.length || n.composicao || n.luz || n.enquadramento || n.clima || n.assunto || n.acabamento ? n : null;
}

/** "O que eu peguei" na tela: "cores laranja, creme; luz de fim de tarde; bem de perto; clima aconchegante". */
export function notesSummary(n: StyleNotes | null): string | null {
  if (!n) return null;
  const parts = [n.paleta.length ? `cores ${n.paleta.join(', ')}` : '', n.luz && `luz ${n.luz}`, n.enquadramento, n.clima && `clima ${n.clima}`].filter(Boolean);
  return parts.length ? parts.join('; ') : null;
}

/** Partes candidatas de uma nota, em ordem de prioridade (nota reduzida = só paleta e luz). */
function noteParts(n: StyleNotes, full: boolean): string[] {
  return [
    full && n.assunto ? `assunto ${n.assunto}` : '',
    n.paleta.length ? `paleta ${n.paleta.join(', ')}` : '',
    n.luz ? `luz ${n.luz}` : '',
    full && n.acabamento ? `acabamento ${n.acabamento}` : '',
    full && n.clima ? `clima ${n.clima}` : '',
    full && n.enquadramento ? `enquadramento ${n.enquadramento}` : '',
    full && n.composicao ? `composição ${n.composicao}` : '',
    full && n.evitar.length ? `evitar ${n.evitar.join(', ')}` : '',
  ].filter(Boolean);
}

/**
 * Linha de uma nota (P4): `"{i}) [{rótulos}] «{partes}»"`. Partes em ordem de prioridade; a que não cabe nos 600 é pulada e as seguintes
 * ainda são tentadas. Nota reduzida (`full: false`) = só paleta e luz.
 */
export function noteLine(index: number, n: StyleNotes, opts: { full?: boolean; labels?: string[] } = {}): string {
  const labels = (opts.labels ?? []).slice(0, 2);
  const prefix = `${index}) ${labels.length ? `[${labels.join(', ')}] ` : ''}«`;
  const parts: string[] = [];
  for (const c of noteParts(n, opts.full !== false)) {
    const body = [...parts, c].join('; ');
    if (prefix.length + body.length + 1 <= NOTE_MAX) parts.push(c);
  }
  return `${prefix}${parts.join('; ')}»`;
}

/** Bloco para o gerador (P5): cabeçalho + até 4 linhas, ≤ 2500 contando o cabeçalho; a primeira que não cabe encerra. */
export function styleNotesText(
  items: { id: string; notes: StyleNotes; full?: boolean; labels?: string[] }[],
): { text: string; ids: string[] } | null {
  let text = STYLE_NOTES_HEADER;
  const ids: string[] = [];
  for (const it of items.slice(0, MAX_NOTES)) {
    if (noteParts(it.notes, it.full !== false).length === 0) continue; // nota reduzida sem paleta nem luz: nada a dizer
    const line = noteLine(ids.length + 1, it.notes, { full: it.full, labels: it.labels });
    if (text.length + 1 + line.length > BLOCK_MAX) break;
    text += ` ${line}`;
    ids.push(it.id);
  }
  return ids.length ? { text, ids } : null;
}

export function styleRecord(pick: StylePick | null, brandId: string | null | undefined): StyleRefsRecord {
  return { own: pick?.used.own ?? [], library: pick?.used.library ?? [], brand_id: brandId ?? null };
}

const strs = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []);

/** Lê o registro de uma peça (jsonb) com cuidado: qualquer coisa fora do formato = null. */
export function asStyleRefsRecord(v: unknown): StyleRefsRecord | null {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return null;
  const o = v as Record<string, unknown>;
  return { own: strs(o['own']), library: strs(o['library']), brand_id: typeof o['brand_id'] === 'string' ? o['brand_id'] : null };
}
