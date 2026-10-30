/**
 * Notas de estilo (Fatias 5/6): a IA de visão olha a referência e descreve SÓ o estilo, em texto. É esse texto — nunca a imagem — que
 * orienta o diretor de arte e o de vídeo. Decisão de direitos autorais da spec §2.3.
 */

export type StyleNotes = { paleta: string[]; composicao: string; luz: string; enquadramento: string; clima: string; evitar: string[] };

export const STYLE_NOTES_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['paleta', 'composicao', 'luz', 'enquadramento', 'clima', 'evitar'],
  properties: {
    paleta: { type: 'array', items: { type: 'string' } },
    composicao: { type: 'string' },
    luz: { type: 'string' },
    enquadramento: { type: 'string' },
    clima: { type: 'string' },
    evitar: { type: 'array', items: { type: 'string' } },
  },
} as const;

export const STYLE_NOTES_PROMPT = [
  'Você é diretor de arte. Olhe esta imagem de REFERÊNCIA e descreva só o ESTILO visual, para inspirar uma arte NOVA de outra marca.',
  'Não descreva pessoas identificáveis, marcas, logotipos, produtos de terceiros nem textos da imagem.',
  'Responda em português do Brasil, frases curtas:',
  '- paleta: até 5 cores em palavras (ex.: "laranja queimado");',
  '- composicao: como os elementos se organizam;',
  '- luz: tipo e direção da luz;',
  '- enquadramento: distância e ângulo da câmera;',
  '- clima: a sensação que passa;',
  '- evitar: até 3 coisas que destoariam desse estilo.',
].join('\n');

const text = (v: unknown, max = 160) => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim().slice(0, max) : '');
const list = (v: unknown, n: number) => (Array.isArray(v) ? v.map((x) => text(x, 40)).filter(Boolean).slice(0, n) : []);

/** Resposta da IA → notas (forma conferida: chave própria responde sem schema estrito). Sem nada útil = null. */
export function normalizeStyleNotes(raw: unknown): StyleNotes | null {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const n: StyleNotes = {
    paleta: list(r['paleta'], 5),
    composicao: text(r['composicao']),
    luz: text(r['luz']),
    enquadramento: text(r['enquadramento']),
    clima: text(r['clima']),
    evitar: list(r['evitar'], 3),
  };
  return n.paleta.length || n.composicao || n.luz || n.enquadramento || n.clima ? n : null;
}

/** "O que eu peguei" na tela: "cores laranja, creme; luz de fim de tarde; bem de perto; clima aconchegante". */
export function notesSummary(n: StyleNotes | null): string | null {
  if (!n) return null;
  const parts = [n.paleta.length ? `cores ${n.paleta.join(', ')}` : '', n.luz && `luz ${n.luz}`, n.enquadramento, n.clima && `clima ${n.clima}`].filter(Boolean);
  return parts.length ? parts.join('; ') : null;
}

/** Bloco para o gerador (até 8 referências, ≤ 1500 letras), delimitado como inspiração. */
export function styleNotesText(all: StyleNotes[]): string | null {
  const lines = all.slice(0, 8).map((n, i) => {
    const bits = [
      n.paleta.length ? `paleta ${n.paleta.join(', ')}` : '',
      n.composicao && `composição ${n.composicao}`,
      n.luz && `luz ${n.luz}`,
      n.enquadramento && `enquadramento ${n.enquadramento}`,
      n.clima && `clima ${n.clima}`,
      n.evitar.length ? `evitar ${n.evitar.join(', ')}` : '',
    ].filter(Boolean);
    return `${i + 1}) ${bits.join('; ')}`.slice(0, 260);
  });
  if (!lines.length) return null;
  return `INSPIRAÇÃO DE ESTILO (não copie composição, pessoas, marcas nem textos; use só como clima): ${lines.join(' ')}`.slice(0, 1500);
}
