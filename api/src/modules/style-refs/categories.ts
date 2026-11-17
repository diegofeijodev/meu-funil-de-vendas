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

/** Sinônimos (P7), já normalizados. Casam por palavra inteira; os de duas palavras casam pela sequência. */
export const CATEGORY_SYNONYMS: Record<StyleCategoryId, readonly string[]> = {
  comida_hamburguer: ['hamburguer', 'hamburgueres', 'hamburgueria', 'burger', 'burgers', 'cheeseburger', 'smash', 'lanche', 'lanches', 'lanchonete', 'sanduiche', 'sanduiches', 'hot dog', 'cachorro quente'],
  comida_pizza: ['pizza', 'pizzas', 'pizzaria', 'massa', 'massas', 'macarrao', 'lasanha', 'italiana', 'italiano', 'calzone'],
  comida_japonesa: ['sushi', 'sashimi', 'temaki', 'japonesa', 'japones', 'oriental', 'poke', 'yakisoba', 'uramaki', 'hot roll'],
  comida_churrasco: ['churrasco', 'churrascaria', 'espeto', 'espetos', 'espetinho', 'espetinhos', 'picanha', 'costela', 'carne', 'carnes', 'parrilla', 'grelhado', 'grelhados'],
  comida_caseira: ['marmita', 'marmitas', 'marmitex', 'feijoada', 'prato feito', 'caseira', 'caseiro', 'almoco', 'executivo', 'self service', 'buffet'],
  frutos_do_mar: ['peixe', 'peixes', 'camarao', 'camaroes', 'frutos do mar', 'moqueca', 'marisco', 'mariscos', 'polvo'],
  doces: ['doce', 'doces', 'bolo', 'bolos', 'confeitaria', 'brigadeiro', 'brigadeiros', 'sobremesa', 'sobremesas', 'torta', 'tortas', 'chocolate', 'brownie', 'cupcake', 'docinho', 'docinhos'],
  acai_sorvete: ['acai', 'acaiteria', 'sorvete', 'sorvetes', 'sorveteria', 'gelato', 'picole', 'picoles', 'frozen', 'milkshake', 'milk shake'],
  cafe_padaria: ['cafe', 'cafes', 'cafeteria', 'padaria', 'pao', 'paes', 'croissant', 'cappuccino', 'expresso', 'espresso', 'cafe da manha', 'salgado', 'salgados', 'coxinha'],
  comida_saudavel: ['salada', 'saladas', 'saudavel', 'saudaveis', 'fit', 'vegano', 'vegana', 'vegetariano', 'vegetariana', 'natural', 'bowl', 'suco', 'sucos', 'detox'],
  bebida_bar: ['bar', 'bares', 'boteco', 'botequim', 'chope', 'chopp', 'chopes', 'chopps', 'choperia', 'cerveja', 'cervejas', 'cervejaria', 'drink', 'drinks', 'drinque', 'drinques', 'coquetel', 'coqueteis', 'caipirinha', 'caipirinhas', 'happy hour', 'vinho', 'vinhos', 'adega', 'pub', 'bebida', 'bebidas', 'gin', 'whisky'],
  ambiente: ['ambiente', 'salao', 'mesa', 'mesas', 'decoracao', 'espaco', 'interior', 'restaurante', 'lounge', 'varanda', 'area externa'],
  pessoas_trabalhando: ['garcom', 'garcons', 'garconete', 'garconetes', 'cozinheiro', 'cozinheira', 'cozinheiros', 'chef', 'barista', 'bartender', 'bartenders', 'barman', 'atendente', 'atendimento', 'entregador', 'entregadores', 'motoboy', 'delivery', 'cumim', 'copeiro', 'copeira', 'auxiliar', 'recepcionista', 'servindo'],
  equipe_vagas: ['vaga', 'vagas', 'equipe', 'contratando', 'contratacao', 'freela', 'freelas', 'freelancer', 'freelancers', 'emprego', 'empregos', 'trabalhe', 'recrutamento', 'oportunidade', 'oportunidades'],
  produto_destaque: ['promocao', 'promocoes', 'promo', 'oferta', 'ofertas', 'combo', 'combos', 'lancamento', 'novidade', 'novidades', 'desconto', 'descontos', 'produto', 'produtos', 'cardapio', 'black friday'],
  beleza: ['barbearia', 'barbeiro', 'barba', 'cabelo', 'cabelos', 'cabeleireiro', 'cabeleireira', 'salao de beleza', 'manicure', 'unha', 'unhas', 'estetica', 'maquiagem', 'sobrancelha', 'sobrancelhas', 'spa', 'depilacao'],
};

/** Minúsculas, sem acento, só [a-z0-9 ], espaços simples. */
export function normalizeText(t: string): string {
  return t.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

/** Categorias reconhecidas no texto (palavra inteira ou sequência de palavras), na ordem da lista. */
export function subjectCategories(text: string | null | undefined): StyleCategoryId[] {
  const padded = ` ${normalizeText(text ?? '')} `;
  if (padded.trim() === '') return [];
  return STYLE_CATEGORY_IDS.filter((id) => CATEGORY_SYNONYMS[id].some((s) => padded.includes(` ${s} `)));
}

const STOP_WORDS = new Set(['para', 'como', 'mais', 'essa', 'esse', 'este', 'esta', 'pela', 'pelo', 'numa', 'sobre', 'entre', 'muito', 'muita', 'todo', 'toda', 'seus', 'suas', 'voce']);

/** Palavras normalizadas com 4 letras ou mais, sem as vazias. */
export function subjectWords(text: string | null | undefined): string[] {
  return normalizeText(text ?? '').split(' ').filter((w) => w.length >= 4 && !STOP_WORDS.has(w));
}

/** Junta as partes não vazias com espaço, até 500 letras (P10). */
export function styleSubject(...parts: (string | null | undefined)[]): string {
  return parts.map((p) => (p ?? '').trim()).filter(Boolean).join(' ').slice(0, 500);
}
