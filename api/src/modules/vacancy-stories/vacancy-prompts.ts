import { normalizeText } from '../style-refs/categories';
import type { PhotoStyle } from '../style-refs/style-notes';
import type { VacancyFields } from './vacancy-types';

/** Proporção pedida à IA para a arte: 4:5 ocupa quase toda a largura da área livre do story (1080 × 1100). */
export const ART_ASPECT = '4:5';

/**
 * Arte com os MESMOS cartões da arte modelo (um cartão por informação, com o ícone e o rótulo), só com os campos limpos da vaga.
 * Endereço, região, descrição e link continuam fora: a vitrine pública do Freela não os envia.
 */
export function artPrompt(f: VacancyFields, hint: string | null): string {
  const cards = [
    ...(f.estabelecimento ? [`Estabelecimento: ${f.estabelecimento}`] : []),
    `Função: ${f.funcao}`,
    `Data: ${f.data}`,
    `Horário: ${f.horario}`,
    `Cidade: ${f.cidade}`,
    `Valor para o freela: ${f.valor}`,
  ];
  const base =
    'Crie um story vertical seguindo fielmente o ESTILO e o LAYOUT da imagem de referência: mesmas cores, mesmas letras, o título em faixas ' +
    'e os cartões empilhados, cada um com o seu ícone redondo, o rótulo pequeno em cima e o valor grande embaixo. ' +
    `No título escreva: VAGA / ${f.funcao.toUpperCase()} / FREELANCER. ` +
    `Faça exatamente ${cards.length} cartões, nesta ordem, com estes textos escritos exatamente assim: ` +
    `${cards.map((c, i) => `(${i + 1}) ${c}`).join(' ')}. ` +
    'Os cartões devem ser grandes e fáceis de ler no celular, ocupando a largura da arte. ' +
    'Troque TODOS os textos da referência pelos acima. Não escreva nenhum outro texto. ' +
    'PROIBIDO: cartões de Endereço, Região, Bairro, Descrição ou "Ver vaga"; qualquer link, site ou QR; selos do Google Play ou da App Store; ' +
    'nomes ou logos de empresas na cena. ' +
    `A foto mostra uma pessoa fazendo o trabalho de ${f.funcao} num bar ou restaurante, sem fachada, sem nome e sem logo de empresa. ` +
    'Mantenha a logo do Freela da referência uma única vez, no topo. ' +
    'Não desenhe o rodapé preto da referência: deixe a faixa de baixo da arte lisa, sem texto (o rodapé é colocado depois).';
  return hint ? `${base}\n${hint}` : base;
}

/** Palavras inteiras de negação (P14): "sem sombras duras" diria à IA o que não fazer e ela costuma fazer. */
const NEGATION = new Set(['sem', 'nao', 'nada', 'nenhum', 'nenhuma', 'nunca', 'evite', 'evitar', 'exceto']);
/** Radicais de objeto com escrita (P14): pegam plural e derivados ("garrafas", "letreiros", "rotulos", "cartazes"). */
const WRITING = [
  'cardapi', 'letreir', 'placa', 'garraf', 'rotul', 'texto', 'letra', 'logo', 'marca', 'neon', 'menu', 'quadro', 'lousa', 'embalag', 'etiquet',
  'palavra', 'numero', 'fachad', 'cartaz',
];
/** O item só chega ao gerador se não tiver negação nem objeto com escrita (compara depois de `normalizeText`). */
function safeStyleItem(item: string): boolean {
  const words = normalizeText(item).split(' ').filter(Boolean);
  return words.length > 0 && !words.some((w) => NEGATION.has(w) || WRITING.some((r) => w.startsWith(r)));
}
const STYLE_LINES_MAX = 300;

/**
 * Até 3 frases afirmativas com o estilo das referências (Fatia 5, P14): "Cores da cena: a, b.", "Luz x; y." e "Clima z; w.". FILTRA primeiro
 * (negação e objeto com escrita saem) e só então corta em 4 cores, 2 luzes e 2 climas; frase sem item não entra e, passando de 300 letras
 * no total, saem as últimas frases. Nada sobrando = lista vazia (a foto sai sem estilo).
 */
export function photoStyleLines(style: PhotoStyle): string[] {
  const keep = (list: string[], n: number) =>
    list.map((x) => String(x ?? '').replace(/\s+/g, ' ').trim().replace(/[.;,\s]+$/, '')).filter((x) => x && safeStyleItem(x)).slice(0, n);
  const cores = keep(style.paleta ?? [], 4);
  const luz = keep(style.luz ?? [], 2);
  const clima = keep(style.clima ?? [], 2);
  const lines = [
    cores.length ? `Cores da cena: ${cores.join(', ')}.` : '',
    luz.length ? `Luz ${luz.join('; ')}.` : '',
    clima.length ? `Clima ${clima.join('; ')}.` : '',
  ].filter(Boolean);
  while (lines.length && lines.join(' ').length > STYLE_LINES_MAX) lines.pop();
  return lines;
}

/** Pedido da foto. Com `styleLines` (já filtradas por `photoStyleLines`) elas entram antes da frase final, que continua por último. */
export function photoPrompt(funcao: string, styleLines: string[] = []): string {
  return (
    `Foto realista, vertical, de uma pessoa trabalhando como ${funcao} num bar ou restaurante brasileiro, numa ação simples e possível: ` +
    'cada mão segura no máximo um objeto, tudo está apoiado ou firme na mão, nada flutua. ' +
    'Luz do próprio ambiente, pele com textura natural, sem cara de banco de imagem. ' +
    (styleLines.length ? `${styleLines.join(' ')} ` : '') +
    'Sem nenhum texto, letra, número, placa, fachada, nome ou logo.'
  );
}

/** Leitura às cegas: nunca inclui os valores esperados. */
export function readPrompt(): string {
  return (
    'Leia esta arte de story. Liste em `textos` TODOS os textos visíveis, inclusive os pequenos e os da foto (placas, fachadas, uniformes), exatamente como aparecem, um item por bloco. ' +
    'Depois preencha: `funcao` (a função/cargo da vaga), `estabelecimento`, `data`, `inicio`, `fim`, `valor` (o valor em reais), `cidade`. ' +
    'Use null quando o campo não aparecer. Não invente nem corrija nada.'
  );
}

/** Leitura às cegas da FOTO da IA: só os textos que estiverem de fato escritos na imagem. */
export function photoReadPrompt(): string {
  return (
    'Esta imagem é uma foto, sem arte por cima. Liste em `textos` somente o que estiver ESCRITO de forma legível na foto: placas, fachadas, ' +
    'letreiros, cardápios, embalagens, logos e uniformes, exatamente como aparece, um item por bloco. ' +
    'Se não houver nada escrito, devolva `textos` como lista vazia (não escreva frases como "nenhum texto"). ' +
    'Preencha todos os outros campos com null.'
  );
}

export function templateReadPrompt(): string {
  return (
    'Liste em `textos` todos os textos visíveis nesta arte, inclusive os pequenos, os da foto (placas, fachadas) e os do rodapé, ' +
    'um item por bloco, exatamente como aparecem.'
  );
}
