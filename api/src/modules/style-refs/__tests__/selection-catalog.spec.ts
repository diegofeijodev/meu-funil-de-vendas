import { STYLE_CATEGORY_IDS, STYLE_CATEGORY_LABEL } from '../categories';
import { parsePinterestLink } from '../pinterest';
import { SEGMENT_ALIASES, SELECTION_BRANCHES, SELECTION_CATALOG, SELECTION_OPTIONS, isSelectionBranch, selectionBranchFor, selectionLabel } from '../selection-catalog';

describe('catálogo de pastas da Seleção', () => {
  it('todo ramo é categoria válida e está no catálogo (e vice-versa), com 2 ou 3 pastas', () => {
    for (const b of SELECTION_BRANCHES) {
      expect(STYLE_CATEGORY_IDS).toContain(b);
      const urls = SELECTION_CATALOG[b]!;
      expect(urls.length).toBeGreaterThanOrEqual(2);
      expect(urls.length).toBeLessThanOrEqual(3);
    }
    expect(Object.keys(SELECTION_CATALOG).sort()).toEqual([...SELECTION_BRANCHES].sort());
    expect([...SELECTION_BRANCHES]).toEqual(['equipe_vagas', 'acai_sorvete', 'comida_hamburguer', 'comida_churrasco', 'bebida_bar', 'ambiente']);
  });

  it('nenhuma URL repetida e toda URL é uma pasta (board) do Pinterest na forma canônica', () => {
    const all = Object.values(SELECTION_CATALOG).flat() as string[];
    expect(new Set(all).size).toBe(all.length);
    expect(all).toHaveLength(17);
    for (const url of all) {
      const p = parsePinterestLink(url);
      expect(p?.kind).toBe('board');
      expect(p?.url).toBe(url);
      expect(url).toMatch(/^https:\/\/www\.pinterest\.com\/[^/]+\/[^/]+\/$/);
      expect((p as { rssUrl: string }).rssUrl).toBe(`${url.slice(0, -1)}.rss`);
    }
  });

  it('as pastas são exatamente as do plano (P16)', () => {
    const u = (...p: string[]) => p.map((x) => `https://www.pinterest.com/${x}/`);
    expect(SELECTION_CATALOG.equipe_vagas).toEqual(u('dickylesmana/chef-group-photos', 'sarahnathan2710/chef-photoshoot', 'denmar_85/bartender'));
    expect(SELECTION_CATALOG.acai_sorvete).toEqual(u('stellarfooddiary/acai-bowls-photography', 'amyrosehancock/smoothie-bowl-food-photography'));
    expect(SELECTION_CATALOG.comida_hamburguer).toEqual(u('abedelkarem/burger-photography', 'tsscreative/burger-mood-board', 'danneville338/burger-photography'));
    expect(SELECTION_CATALOG.comida_churrasco).toEqual(u('kosherburrito/grilling-photos', 'setarehahmadi137122/kebab-photo', 'illiquid1/food-photography-steak'));
    expect(SELECTION_CATALOG.bebida_bar).toEqual(u('jswordie/public-houses', 'hixfarmbrewery/beer-photography', 'hb834311/cocktail-bar-photo-shoot'));
    expect(SELECTION_CATALOG.ambiente).toEqual(u('kcarter1927/menu-photoshoot', 'emmacarava/restaurant-ambiance', 'thegalleryau/fresh-food-interiors'));
  });

  it('apelidos de reconhecimento', () => {
    expect(SEGMENT_ALIASES).toEqual([['gastronomia', 'ambiente'], ['gastronomica', 'ambiente'], ['gastronomico', 'ambiente'], ['restaurantes', 'ambiente']]);
  });
});

describe('selectionBranchFor', () => {
  it.each([
    ['Açaiteria Frutá', 'acai_sorvete'],
    ['Hamburgueria do Zé', 'comida_hamburguer'],
    ['Espetinho e chopp', 'comida_churrasco'],
    ['Vagas para bares e restaurantes', 'equipe_vagas'],
    ['Gastronomia contemporânea', 'ambiente'],
    ['Restaurante', 'ambiente'],
    ['Restaurantes do centro', 'ambiente'],
    ['Floricultura', null],
    ['', null],
    [null, null],
    [undefined, null],
    ['Barbearia do Zé', null],
  ])('%s -> %s', (seg, expected) => {
    expect(selectionBranchFor(seg as string | null | undefined)).toBe(expected);
  });
});

describe('opções de tela e ramo', () => {
  it('SELECTION_OPTIONS: 6 ramos, ordem e rótulos da P35', () => {
    expect(SELECTION_OPTIONS).toEqual([
      { id: 'acai_sorvete', label: 'Açaí e sorvete' },
      { id: 'comida_hamburguer', label: 'Hamburgueria e lanches' },
      { id: 'comida_churrasco', label: 'Churrasco e espetinho' },
      { id: 'bebida_bar', label: 'Bar e bebidas' },
      { id: 'ambiente', label: 'Restaurante' },
      { id: 'equipe_vagas', label: 'Vagas e equipe' },
    ]);
    expect(SELECTION_OPTIONS.map((o) => o.id).sort()).toEqual([...SELECTION_BRANCHES].sort());
  });

  it('selectionLabel usa o rótulo de tela e, fora do catálogo, o rótulo geral', () => {
    expect(selectionLabel('ambiente')).toBe('Restaurante');
    expect(selectionLabel('beleza')).toBe(STYLE_CATEGORY_LABEL.beleza);
  });

  it('isSelectionBranch', () => {
    expect(isSelectionBranch('acai_sorvete')).toBe(true);
    expect(isSelectionBranch('beleza')).toBe(false);
    expect(isSelectionBranch('none')).toBe(false);
    expect(isSelectionBranch(null)).toBe(false);
  });
});
