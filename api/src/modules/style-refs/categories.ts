/** Lista fechada de categorias de assunto das referências de estilo (P7). Ids gravados nas notas; rótulos (≤ 20 letras) aparecem nas telas e no bloco. */
export const STYLE_CATEGORY_IDS = [
  'comida_hamburguer', 'comida_pizza', 'comida_japonesa', 'comida_churrasco', 'comida_caseira', 'frutos_do_mar', 'doces', 'acai_sorvete',
  'cafe_padaria', 'comida_saudavel', 'bebida_bar', 'ambiente', 'pessoas_trabalhando', 'equipe_vagas', 'produto_destaque', 'beleza',
] as const;

export type StyleCategoryId = (typeof STYLE_CATEGORY_IDS)[number];

export const STYLE_CATEGORY_LABEL: Record<StyleCategoryId, string> = {
  comida_hamburguer: 'hambúrguer e lanches',
  comida_pizza: 'pizza e massas',
  comida_japonesa: 'comida japonesa',
  comida_churrasco: 'churrasco e espeto',
  comida_caseira: 'comida caseira',
  frutos_do_mar: 'frutos do mar',
  doces: 'doces e bolos',
  acai_sorvete: 'açaí e sorvete',
  cafe_padaria: 'café e padaria',
  comida_saudavel: 'comida saudável',
  bebida_bar: 'bebida e bar',
  ambiente: 'ambiente e salão',
  pessoas_trabalhando: 'pessoas trabalhando',
  equipe_vagas: 'equipe e vagas',
  produto_destaque: 'produto em destaque',
  beleza: 'beleza e estética',
};

export function isStyleCategory(v: unknown): v is StyleCategoryId {
  return typeof v === 'string' && (STYLE_CATEGORY_IDS as readonly string[]).includes(v);
}
