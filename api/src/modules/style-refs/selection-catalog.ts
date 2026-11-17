import { STYLE_CATEGORY_LABEL, normalizeText, subjectCategories, type StyleCategoryId } from './categories';

/**
 * Catálogo de pastas da Seleção do Meu Funil por ramo (P16). Montado em 17/11/2026 por busca na web (domínio pinterest.com) e conferido
 * pelo RSS oficial (200, >= 16 Pins com imagem) e por miniaturas (foto de verdade do ramo). Nenhuma busca nem raspagem do Pinterest no
 * produto: só estas pastas, lidas pelo RSS. Trocar uma pasta = editar esta lista (a reconciliação tira a velha e põe a nova).
 */

/** Ordem = prioridade do reconhecimento do ramo da marca ("vagas para bares" cai em equipe_vagas, não em bebida_bar). */
export const SELECTION_BRANCHES: readonly StyleCategoryId[] = ['equipe_vagas', 'acai_sorvete', 'comida_hamburguer', 'comida_churrasco', 'bebida_bar', 'ambiente'];

const pin = (path: string) => `https://www.pinterest.com/${path}/`;

export const SELECTION_CATALOG: Readonly<Partial<Record<StyleCategoryId, readonly string[]>>> = {
  equipe_vagas: [pin('dickylesmana/chef-group-photos'), pin('sarahnathan2710/chef-photoshoot'), pin('denmar_85/bartender')],
  acai_sorvete: [pin('stellarfooddiary/acai-bowls-photography'), pin('amyrosehancock/smoothie-bowl-food-photography')],
  comida_hamburguer: [pin('abedelkarem/burger-photography'), pin('tsscreative/burger-mood-board'), pin('danneville338/burger-photography')],
  comida_churrasco: [pin('kosherburrito/grilling-photos'), pin('setarehahmadi137122/kebab-photo'), pin('illiquid1/food-photography-steak')],
  bebida_bar: [pin('jswordie/public-houses'), pin('hixfarmbrewery/beer-photography'), pin('hb834311/cocktail-bar-photo-shoot')],
  ambiente: [pin('kcarter1927/menu-photoshoot'), pin('emmacarava/restaurant-ambiance'), pin('thegalleryau/fresh-food-interiors')],
};

/** Apelidos só do reconhecimento do ramo da marca (já normalizados; palavra inteira). Não mexem em CATEGORY_SYNONYMS. */
export const SEGMENT_ALIASES: readonly (readonly [string, StyleCategoryId])[] = [
  ['gastronomia', 'ambiente'], ['gastronomica', 'ambiente'], ['gastronomico', 'ambiente'], ['restaurantes', 'ambiente'],
];

export function isSelectionBranch(v: unknown): v is StyleCategoryId {
  return typeof v === 'string' && Object.prototype.hasOwnProperty.call(SELECTION_CATALOG, v);
}

/** Rótulos e ordem de TELA (P35). */
export const SELECTION_OPTIONS: readonly { id: StyleCategoryId; label: string }[] = [
  { id: 'acai_sorvete', label: 'Açaí e sorvete' },
  { id: 'comida_hamburguer', label: 'Hamburgueria e lanches' },
  { id: 'comida_churrasco', label: 'Churrasco e espetinho' },
  { id: 'bebida_bar', label: 'Bar e bebidas' },
  { id: 'ambiente', label: 'Restaurante' },
  { id: 'equipe_vagas', label: 'Vagas e equipe' },
];

export function selectionLabel(id: StyleCategoryId): string {
  return SELECTION_OPTIONS.find((o) => o.id === id)?.label ?? STYLE_CATEGORY_LABEL[id];
}

/** Ramo da Seleção para o segmento da marca: primeiro de SELECTION_BRANCHES entre as categorias reconhecidas e os apelidos; nenhum = null. */
export function selectionBranchFor(segment: string | null | undefined): StyleCategoryId | null {
  const padded = ` ${normalizeText(segment ?? '')} `;
  if (padded.trim() === '') return null;
  const found = new Set<StyleCategoryId>(subjectCategories(segment));
  for (const [alias, id] of SEGMENT_ALIASES) if (padded.includes(` ${alias} `)) found.add(id);
  return SELECTION_BRANCHES.find((b) => found.has(b)) ?? null;
}
