/**
 * Diretor de vídeo. A IA devolve um ROTEIRO ESTRUTURADO (JSON, `VIDEO_SCHEMA`) e um montador DETERMINÍSTICO transforma o roteiro no
 * texto final em pt-BR enviado ao modelo de vídeo (Veo/Kling): marcas de tempo por tomada, câmera/lente/luz/paleta/estilo, direção de
 * áudio e "Evite: …", com 250–450 palavras e no máximo 3000 caracteres. A IA decide O QUE acontece; o código decide COMO o texto sai.
 */
import { AiService } from '../ai/ai.service';
import { UserError } from '../media/user-error';
import { contextForPrompt, contextProhibitions, PostCreativeContext } from './creative-context';
import { listField, VisualStyle } from './visual-style';

export const AUDIO_MODES = ['ambiente_trilha', 'narracao', 'sem_audio'] as const;
export type AudioMode = (typeof AUDIO_MODES)[number];
export type VideoAudio = { modo: AudioMode; instrucoes: string };
export const DEFAULT_VIDEO_AUDIO: VideoAudio = { modo: 'ambiente_trilha', instrucoes: '' };
export const MAX_AUDIO_INSTRUCTIONS = 500;
export const VIDEO_SECONDS = 8;
export const MAX_SHOTS = 3;
export const VIDEO_PROMPT_MIN_WORDS = 250;
export const VIDEO_PROMPT_MAX_WORDS = 450;
export const VIDEO_PROMPT_MAX_CHARS = 3000;

export type VideoShot = { inicio_s: number; fim_s: number; enquadramento: string; acao: string; movimento_camera: string; lente: string };
export type VideoDirection = {
  gancho_visual: string;
  sujeito: string;
  cenario: string;
  tomadas: VideoShot[];
  iluminacao: string;
  paleta_hex: string[];
  estilo: string;
  ritmo: string;
  cta_visual: string;
  audio: { modo: AudioMode; descricao: string; fala: string };
  evitar: string[];
};

export type VideoBrief = {
  workspaceId: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  brand: any | null;
  context: PostCreativeContext | null;
  format: 'reel' | 'story_video';
  theme: string | null;
  hook: string | null;
  cta: string | null;
  /** Briefing visual do post (`creative_brief.prompt`). */
  userPrompt: string | null;
  audio: VideoAudio;
  /** Há foto de produto/marca como primeiro quadro? */
  hasFirstFrame: boolean;
  provider: string;
  /** Ajuste pedido pelo cliente no editor. */
  adjust?: string | null;
  /** Roteiro anterior (refação ou ajuste). */
  previousPrompt?: string | null;
  /** Motivo do crítico que reprovou o vídeo anterior. */
  criticNote?: string | null;
};

const str = { type: 'string' };
const num = { type: 'number' };
export const VIDEO_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['gancho_visual', 'sujeito', 'cenario', 'tomadas', 'iluminacao', 'paleta_hex', 'estilo', 'ritmo', 'cta_visual', 'audio', 'evitar'],
  properties: {
    gancho_visual: str,
    sujeito: str,
    cenario: str,
    tomadas: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['inicio_s', 'fim_s', 'enquadramento', 'acao', 'movimento_camera', 'lente'],
        properties: { inicio_s: num, fim_s: num, enquadramento: str, acao: str, movimento_camera: str, lente: str },
      },
    },
    iluminacao: str,
    paleta_hex: { type: 'array', items: str },
    estilo: str,
    ritmo: str,
    cta_visual: str,
    audio: {
      type: 'object',
      additionalProperties: false,
      required: ['modo', 'descricao', 'fala'],
      properties: { modo: { type: 'string', enum: [...AUDIO_MODES] }, descricao: str, fala: str },
    },
    evitar: { type: 'array', items: str },
  },
};

const HEX = /^#[0-9a-f]{6}$/i;

/** Texto livre (usuário ou IA) para dentro de um prompt: sem « » (o delimitador), sem quebras nem controle, com teto. */
export function cleanFree(v: unknown, max: number): string {
  return typeof v === 'string'
    ? v.replace(/[«»]/g, '').replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max)
    : '';
}

/** Áudio efetivo: camadas da mais geral para a mais específica (execução → post); camada inválida é ignorada. */
export function resolveAudio(...layers: unknown[]): VideoAudio {
  let out: VideoAudio = { ...DEFAULT_VIDEO_AUDIO };
  for (const layer of layers) {
    if (!layer || typeof layer !== 'object') continue;
    const o = layer as Record<string, unknown>;
    if (typeof o['modo'] !== 'string' || !(AUDIO_MODES as readonly string[]).includes(o['modo'])) continue;
    out = { modo: o['modo'] as AudioMode, instrucoes: cleanFree(o['instrucoes'], MAX_AUDIO_INSTRUCTIONS) };
  }
  return out;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const brandPalette = (brand: any): string[] => {
  const vs = (brand?.visual_style ?? {}) as VisualStyle;
  const list = listField(vs.paleta_hex).length ? listField(vs.paleta_hex) : [brand?.primary_color, brand?.secondary_color].filter(Boolean).map(String);
  return list.map((c) => c.trim()).filter((c) => HEX.test(c));
};

/** Regras de áudio por modo, para a IA. */
const AUDIO_GUIDE: Record<AudioMode, string> = {
  ambiente_trilha:
    'Som da própria cena (ambiente, objetos, pessoas sem diálogo) + trilha instrumental leve no tom da marca. SEM vozes, SEM fala, SEM canto, SEM locução. Preencha "fala" com "".',
  narracao:
    'Voz em português do Brasil, natural e próxima, sobre o som ambiente da cena. A voz diz NO MÁXIMO 2 frases curtas (gancho e chamada), escritas por você no campo "fala" (até 25 palavras no total, sem preço inventado, sem nome de concorrente). Nada de música alta por cima da voz.',
  sem_audio: 'Vídeo sem áudio: descreva só a imagem. Em "audio.descricao" escreva "sem áudio" e deixe "fala" vazia.',
};

/** Prompt (pt-BR) que pede o roteiro estruturado à IA. */
export function videoDirectorPrompt(b: VideoBrief): string {
  const vs = (b.brand?.visual_style ?? {}) as VisualStyle;
  const examples = listField(vs.exemplos_prompt).slice(-3);
  const palette = brandPalette(b.brand);
  const banned = [...listField(vs.elementos_proibidos), ...listField(b.brand?.banned_words), ...contextProhibitions(b.context)];
  const instr = cleanFree(b.audio.instrucoes, MAX_AUDIO_INSTRUCTIONS);
  return [
    'Você é diretor de cena sênior de uma agência de publicidade no Brasil e escreve roteiros de vídeos curtos para Instagram. Escreva TUDO em português do Brasil.',
    `Crie o roteiro de UM vídeo vertical 9:16 de ${VIDEO_SECONDS} segundos para ${b.format === 'reel' ? 'Reels' : 'story em vídeo'}, que será gerado por IA (${b.provider}).`,
    'REGRAS DO ROTEIRO (todas obrigatórias):',
    `- tomadas: de 1 a ${MAX_SHOTS}, em ordem, cobrindo de 0 a ${VIDEO_SECONDS} s SEM buracos nem sobreposição (a 1ª começa em 0, cada uma começa onde a anterior termina, a última termina em ${VIDEO_SECONDS}).`,
    '- Cada tomada tem UMA ação física clara e visível (ex.: "a mão desliza o copo até a frente", "o chope é servido até a borda"), com enquadramento, movimento de câmera e lente.',
    '- gancho_visual: o que prende o olhar nos 2 primeiros segundos (movimento, close, contraste) — é o que acontece na 1ª tomada.',
    '- cta_visual: o que se vê no último segundo para convidar à ação (sem texto na tela).',
    '- NADA de texto, letras, números, legendas, placas legíveis ou logotipos gerados na cena: título, preço, chamada e logo entram depois, na capa e nas legendas.',
    '- Pessoas (se houver) com anatomia natural: mãos com cinco dedos, rostos naturais, movimentos fisicamente plausíveis; nada de transformações estranhas.',
    b.hasFirstFrame
      ? '- O vídeo COMEÇA a partir da foto real enviada (primeiro quadro): mantenha o produto e o ambiente exatamente como na foto (forma, cor, rótulo, embalagem) e anime a partir dela.'
      : '- Não há foto de referência: descreva o produto e o ambiente de forma concreta e fiel à descrição da marca.',
    '- O produto real é o protagonista e precisa ficar reconhecível; comida e bebida em ângulo apetitoso (textura, vapor, gotas, frescor).',
    '- Coerência com a data e a estação informadas (luz, roupas, clima, decoração) e com o segmento da marca.',
    `- paleta_hex: 3 a 6 cores em #RRGGBB coerentes com a marca${palette.length ? ` (base: ${palette.join(', ')})` : ''}.`,
    '- ritmo: como a edição flui (ex.: "abre rápido, desacelera no produto, fecha firme").',
    '- evitar: 4 a 8 itens concretos do que NÃO pode aparecer.',
    banned.length ? `- PROIBIDO (marca e estratégia): ${banned.join('; ')}.` : '',
    `- ÁUDIO (modo "${b.audio.modo}"): ${AUDIO_GUIDE[b.audio.modo]}`,
    instr ? `- Instruções de áudio do cliente (siga se não violarem as regras acima): «${instr}»` : '',
    '',
    'GUIA VISUAL DA MARCA:',
    JSON.stringify({
      marca: b.brand?.name ?? null,
      segmento: b.brand?.segment ?? null,
      estilo_fotografico: vs.estilo_fotografico ?? null,
      iluminacao: vs.iluminacao ?? null,
      paleta_hex: palette,
      ambientes: vs.ambientes ?? [],
      elementos_obrigatorios: vs.elementos_obrigatorios ?? [],
      elementos_proibidos: vs.elementos_proibidos ?? [],
    }),
    examples.length ? `PROMPTS QUE FUNCIONARAM PARA ESTA MARCA (referência de estilo):\n- ${examples.join('\n- ')}` : '',
    '',
    'BRIEFING DO POST:',
    JSON.stringify({ tema: b.theme, gancho_da_legenda: b.hook, cta: b.cta, pedido_visual: b.userPrompt }),
    b.context ? `CONTEXTO (traduza em cena; nunca escreva estes textos no vídeo): ${JSON.stringify(contextForPrompt(b.context))}` : '',
    b.previousPrompt ? `ROTEIRO ANTERIOR (refaça melhorando): ${cleanFree(b.previousPrompt, VIDEO_PROMPT_MAX_CHARS)}` : '',
    b.criticNote ? `O CRÍTICO REPROVOU O VÍDEO ANTERIOR (corrija isto com prioridade): «${cleanFree(b.criticNote, 300)}»` : '',
    b.adjust ? `AJUSTE PEDIDO PELO CLIENTE (aplique com prioridade): «${cleanFree(b.adjust, 300)}»` : '',
    'Devolva SOMENTE o JSON do roteiro.',
  ]
    .filter(Boolean)
    .join('\n');
}

const shortSpeech = (t: string) => t.split(/(?<=[.!?])\s+/).filter(Boolean).slice(0, 2).join(' ').slice(0, 180).trim();

/** Normaliza o JSON da IA: 1–3 tomadas contíguas de 0 a 8 s (≥ 1 s cada), cores #RRGGBB, áudio no modo configurado, listas curtas. */
export function normalizeDirection(json: unknown, audio: VideoAudio, fallbackPalette: string[] = []): VideoDirection {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const j = (json && typeof json === 'object' ? json : {}) as any;
  const txt = (v: unknown, max = 400) => cleanFree(v, max);
  const toNum = (v: unknown) => (v === null || v === undefined || v === '' ? NaN : Number(v));
  const raw = Array.isArray(j.tomadas) ? (j.tomadas as unknown[]) : [];
  let shots: VideoShot[] = raw
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .map((t: any) => ({ inicio_s: toNum(t?.inicio_s), fim_s: toNum(t?.fim_s), enquadramento: txt(t?.enquadramento, 160), acao: txt(t?.acao), movimento_camera: txt(t?.movimento_camera, 160), lente: txt(t?.lente, 80) }))
    .filter((t) => t.acao)
    .sort((a, b) => (Number.isFinite(a.inicio_s) ? a.inicio_s : 99) - (Number.isFinite(b.inicio_s) ? b.inicio_s : 99))
    .slice(0, MAX_SHOTS);
  if (!shots.length) {
    shots = [{ inicio_s: 0, fim_s: VIDEO_SECONDS, enquadramento: 'plano médio', acao: txt(j.gancho_visual) || txt(j.sujeito) || 'o produto em destaque', movimento_camera: 'aproximação lenta', lente: '35 mm' }];
  }
  // Cobertura 0–8 s sem buracos: cada tomada começa onde a anterior termina; ≥ 1 s cada; a última termina em 8 s.
  const k = shots.length;
  let start = 0;
  shots = shots.map((t, i) => {
    const last = i === k - 1;
    const proposed = Number.isFinite(t.fim_s) ? t.fim_s : start + (VIDEO_SECONDS - start) / (k - i);
    const end = last ? VIDEO_SECONDS : Math.min(VIDEO_SECONDS - (k - 1 - i), Math.max(start + 1, Math.round(proposed * 2) / 2));
    const shot = { ...t, inicio_s: start, fim_s: end };
    start = end;
    return shot;
  });
  const palette = listField(j.paleta_hex).map((c) => c.trim()).filter((c) => HEX.test(c)).slice(0, 6);
  return {
    gancho_visual: txt(j.gancho_visual) || shots[0]!.acao,
    sujeito: txt(j.sujeito),
    cenario: txt(j.cenario),
    tomadas: shots,
    iluminacao: txt(j.iluminacao, 200),
    paleta_hex: palette.length ? palette : fallbackPalette.map((c) => c.trim()).filter((c) => HEX.test(c)).slice(0, 6),
    estilo: txt(j.estilo, 200),
    ritmo: txt(j.ritmo, 160),
    cta_visual: txt(j.cta_visual, 240),
    audio: {
      modo: audio.modo,
      descricao: audio.modo === 'sem_audio' ? 'sem áudio' : txt(j.audio?.descricao, 300),
      fala: audio.modo === 'narracao' ? shortSpeech(txt(j.audio?.fala, 400)) : '',
    },
    evitar: listField(j.evitar).map((x) => txt(x, 80)).filter(Boolean).slice(0, 8),
  };
}

type AssembleOpts = { audio: VideoAudio; hasFirstFrame: boolean; extraAvoid?: string[] };
const words = (t: string) => t.split(/\s+/).filter(Boolean).length;
const clip = (t: string, max: number) => (t.length <= max ? t : `${t.slice(0, max).replace(/\s+\S*$/, '')}…`);
const sec = (n: number) => `${String(Math.round(n * 10) / 10).replace('.', ',')}s`;
const BASE_VIDEO_AVOID = ['texto, letras ou números na cena', 'logotipos de terceiros', 'mãos ou dedos deformados', 'rostos distorcidos', 'objetos que mudam de forma', 'cortes bruscos', 'imagem tremida', "marca-d'água"];

/** Padrões de qualidade (fixos) que completam o roteiro curto até 250 palavras. */
const QUALITY_PAD = [
  'Qualidade de comercial de cinema: imagem nítida em alta resolução, foco preciso no assunto principal, cores fiéis e contraste natural, sem granulação exagerada.',
  'Movimentos de câmera suaves e estáveis, sem tremores nem saltos; cada tomada termina com o assunto bem enquadrado para o corte seguinte.',
  'Física realista: líquidos, vapor, fumaça, tecidos e cabelos se movem de forma natural, e os objetos mantêm forma, cor e tamanho do começo ao fim.',
  'A mesma luz, a mesma paleta e o mesmo ambiente em todas as tomadas, para que o vídeo pareça gravado de uma vez só.',
  'Terço superior e terço inferior do quadro vertical livres de elementos importantes: ali entram depois a interface do Instagram, o título e a chamada.',
  'Composição limpa, sem poluição visual: poucos objetos de apoio, fundo coerente com a marca e o produto sempre como protagonista da cena.',
  'Gestos e expressões naturais e espontâneos, como numa gravação real; ninguém encara a câmera sem motivo e não há movimentos robóticos.',
  'Ritmo pensado para quem rola o feed: algo interessante acontece já no primeiro segundo e o último quadro é claro, estável e convidativo.',
  'Profundidade de campo de lente real: assunto em foco, fundo levemente desfocado, sem aparência de colagem nem de imagem gerada por computador.',
  'Nada de transformações estranhas: o produto não muda de formato, de rótulo nem de cor durante o vídeo, e não surgem objetos do nada.',
];

function audioLine(d: VideoDirection, a: VideoAudio, cap: number): string {
  if (a.modo === 'sem_audio') return 'Áudio: nenhum (vídeo sem som).';
  const instr = a.instrucoes ? ` Orientação do cliente para o áudio: ${clip(a.instrucoes, Math.min(cap, MAX_AUDIO_INSTRUCTIONS))}.` : '';
  const desc = d.audio.descricao ? ` (${clip(d.audio.descricao, cap)})` : '';
  if (a.modo === 'narracao') {
    const fala = d.audio.fala ? `A voz diz: "${d.audio.fala}"` : 'A voz diz uma frase curta de convite.';
    return `Áudio: narração em português do Brasil, voz natural e próxima, sobre o som ambiente da cena${desc}. ${fala}${instr}`;
  }
  return `Áudio: som ambiente da cena e trilha instrumental leve no tom da marca${desc}; sem vozes, sem fala e sem canto.${instr}`;
}

function render(d: VideoDirection, o: AssembleOpts, cap: number): string {
  const c = (t: string) => clip(t, cap);
  const lines: string[] = [`Vídeo vertical 9:16 de ${VIDEO_SECONDS} segundos para Instagram, filmagem realista com aparência de comercial profissional.`];
  if (o.hasFirstFrame) lines.push('Comece exatamente a partir da imagem de referência enviada (primeiro quadro) e mantenha o produto idêntico a ela: mesma forma, cor, rótulo e embalagem.');
  lines.push(`Gancho (0–2s): ${c(d.gancho_visual)}.`);
  if (d.sujeito) lines.push(`Sujeito: ${c(d.sujeito)}.`);
  if (d.cenario) lines.push(`Cenário: ${c(d.cenario)}.`);
  lines.push('Roteiro por tomada:');
  for (const t of d.tomadas) {
    const parts = [t.enquadramento && `${c(t.enquadramento)};`, `${c(t.acao)};`, t.movimento_camera && `câmera: ${c(t.movimento_camera)};`, t.lente && `lente ${c(t.lente)}`].filter(Boolean).join(' ');
    lines.push(`[${sec(t.inicio_s)}–${sec(t.fim_s)}] ${parts.replace(/;$/, '')}.`);
  }
  const look = [d.iluminacao && `Luz: ${c(d.iluminacao)}.`, d.paleta_hex.length ? `Paleta: ${d.paleta_hex.join(', ')}.` : '', d.estilo && `Estilo: ${c(d.estilo)}.`, d.ritmo && `Ritmo: ${c(d.ritmo)}.`]
    .filter(Boolean)
    .join(' ');
  if (look) lines.push(look);
  if (d.cta_visual) lines.push(`Último segundo: ${c(d.cta_visual)}.`);
  lines.push(audioLine(d, o.audio, cap));
  lines.push('Sem texto, letras, números, legendas ou logotipos gerados na cena. Pessoas com anatomia natural e movimentos fisicamente plausíveis.');
  const avoid = [...new Set([...d.evitar, ...(o.extraAvoid ?? []), ...BASE_VIDEO_AVOID].map((x) => clip(String(x).trim(), Math.min(cap, 60))).filter(Boolean))].slice(0, 10);
  lines.push(`Evite: ${avoid.join('; ')}.`);
  return lines.join('\n');
}

function pad(text: string): string {
  let out = text;
  for (const p of QUALITY_PAD) {
    if (words(out) >= VIDEO_PROMPT_MIN_WORDS) break;
    const next = `${out}\n${p}`;
    if (words(next) > VIDEO_PROMPT_MAX_WORDS || next.length > VIDEO_PROMPT_MAX_CHARS) break;
    out = next;
  }
  return out;
}

function clipWords(t: string, max: number): string {
  let n = 0;
  let out = '';
  for (const tok of t.split(/(\s+)/)) {
    if (!tok) continue;
    if (/^\s+$/.test(tok)) {
      out += tok;
      continue;
    }
    if (++n > max) break;
    out += tok;
  }
  return out.trim();
}

/** Texto final para o modelo de vídeo: determinístico, 250–450 palavras, ≤ 3000 caracteres (corta descrições antes de cortar seções). */
export function assembleVideoPrompt(d: VideoDirection, o: AssembleOpts): string {
  for (const cap of [400, 260, 180, 120, 80]) {
    const text = render(d, o, cap);
    if (words(text) <= VIDEO_PROMPT_MAX_WORDS && text.length <= VIDEO_PROMPT_MAX_CHARS) return pad(text);
  }
  // Último recurso (campos absurdamente longos): corta por palavras e por caracteres.
  return clipWords(render(d, o, 60), VIDEO_PROMPT_MAX_WORDS).slice(0, VIDEO_PROMPT_MAX_CHARS);
}

/** Roteiro completo: IA (JSON estruturado) → normalização → texto final. */
export async function directVideo(ai: AiService, b: VideoBrief): Promise<{ direction: VideoDirection; prompt: string }> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const json = await ai.json<any>(b.workspaceId, { prompt: videoDirectorPrompt(b), schema: VIDEO_SCHEMA, name: 'video_direction' });
  const hasShots = Array.isArray(json?.tomadas) && json.tomadas.some((t: { acao?: unknown }) => cleanFree(t?.acao, 400));
  if (!cleanFree(json?.sujeito, 400) && !cleanFree(json?.gancho_visual, 400) && !hasShots) throw new UserError('O diretor de vídeo não devolveu o roteiro.');
  const direction = normalizeDirection(json, b.audio, brandPalette(b.brand));
  const vs = (b.brand?.visual_style ?? {}) as VisualStyle;
  const extraAvoid = [...listField(vs.elementos_proibidos), ...contextProhibitions(b.context)];
  return { direction, prompt: assembleVideoPrompt(direction, { audio: b.audio, hasFirstFrame: b.hasFirstFrame, extraAvoid }) };
}

/** Descrição parada (capa do vídeo): sujeito, cenário, luz, estilo e paleta — sem marcas de tempo. */
export function stillPrompt(d: VideoDirection): string {
  return [d.sujeito, d.cenario, d.iluminacao && `Luz: ${d.iluminacao}`, d.estilo && `Estilo: ${d.estilo}`, d.paleta_hex.length ? `Paleta: ${d.paleta_hex.join(', ')}` : '']
    .filter(Boolean)
    .join('. ');
}
