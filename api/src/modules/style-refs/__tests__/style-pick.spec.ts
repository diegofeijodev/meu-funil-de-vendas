import { chooseNotes, PickRow, resolveSelectionBranch } from '../style-pick';
import { StyleCategoryId } from '../categories';
import { StyleNotes } from '../style-notes';

const CAMP = 'camp-1';
const notes = (categorias: StyleNotes['categorias'], assunto = ''): StyleNotes => ({ v: 2, paleta: ['laranja'], composicao: '', luz: 'suave', enquadramento: '', clima: '', evitar: [], categorias, assunto, acabamento: '' });
const row = (id: string, campaign_id: string | null, t: number, categorias: StyleNotes['categorias'], assunto = ''): PickRow => ({
  id, campaign_id, created_at: new Date(2026, 10, t), notes: notes(categorias, assunto),
});
const rows = [
  row('c1', CAMP, 1, ['bebida_bar']),
  row('c2', CAMP, 2, ['comida_hamburguer']),
  row('c3', CAMP, 3, ['comida_hamburguer'], 'hambúrguer artesanal'),
  row('b1', null, 4, ['comida_hamburguer']),
  row('b2', null, 5, ['bebida_bar']),
  row('b3', null, 6, []),
];
const ids = (r: ReturnType<typeof chooseNotes>) => r.map((p) => p.row.id);

describe('chooseNotes', () => {
  it('campanha (≤ 2) → categoria em comum → assunto → mais novas', () => {
    const r = chooseNotes(rows, CAMP, 'Hambúrguer artesanal');
    expect(ids(r)).toEqual(['c3', 'c2', 'b1', 'b3']);
    expect(r.map((p) => p.full)).toEqual([true, true, true, false]);
  });
  it('pedido sem categoria: notas inteiras, mais novas', () => {
    const r = chooseNotes(rows, CAMP, '');
    expect(ids(r)).toEqual(['c3', 'c2', 'b3', 'b2']);
    expect(r.every((p) => p.full)).toBe(true);
  });
  it('sem nota da marca, a campanha ocupa as vagas', () => {
    expect(ids(chooseNotes(rows.slice(0, 3), CAMP, ''))).toEqual(['c3', 'c2', 'c1']);
  });
  it('campanha nula: notas de campanha ficam fora', () => {
    expect(ids(chooseNotes(rows, null, ''))).toEqual(['b3', 'b2', 'b1']);
  });
  it('biblioteca entra depois, marcada library, até 4 no total', () => {
    const lib = [row('l1', null, 7, ['comida_hamburguer'])];
    const r = chooseNotes(rows.slice(3, 4), CAMP, 'hambúrguer', lib);
    expect(r.map((p) => [p.row.id, p.library])).toEqual([['b1', false], ['l1', true]]);
  });
});

describe('resolveSelectionBranch', () => {
  it('reconhece o ramo pelo texto de brands.segment (automático)', () => {
    expect(resolveSelectionBranch({ segment: 'Açaiteria Frutá', style_library_segment: null })).toEqual({ segment: 'acai_sorvete', source: 'auto' });
  });
  it('o ramo escolhido (do catálogo) vale mais que o texto', () => {
    expect(resolveSelectionBranch({ segment: 'Açaiteria Frutá', style_library_segment: 'bebida_bar' })).toEqual({ segment: 'bebida_bar', source: 'chosen' });
  });
  it('"none" = nenhum desses', () => {
    expect(resolveSelectionBranch({ segment: 'Açaiteria Frutá', style_library_segment: 'none' })).toEqual({ segment: null, source: 'none' });
  });
  it('valor gravado que não é ramo do catálogo (beleza, xyz) vale como automático', () => {
    expect(resolveSelectionBranch({ segment: 'Açaiteria', style_library_segment: 'beleza' })).toEqual({ segment: 'acai_sorvete', source: 'auto' });
    expect(resolveSelectionBranch({ segment: 'Açaiteria', style_library_segment: 'xyz' })).toEqual({ segment: 'acai_sorvete', source: 'auto' });
  });
  it('segmento que não cai em nenhum ramo → sem ramo, ainda automático', () => {
    expect(resolveSelectionBranch({ segment: 'Floricultura', style_library_segment: null })).toEqual({ segment: null, source: 'auto' });
    expect(resolveSelectionBranch({ segment: null, style_library_segment: null })).toEqual({ segment: null, source: 'auto' });
  });
});

describe('chooseNotes com a seleção', () => {
  it('1 própria + 3 da seleção: a própria primeiro, as 3 com library: true', () => {
    const lib = [row('l1', null, 7, ['acai_sorvete']), row('l2', null, 8, ['acai_sorvete']), row('l3', null, 9, ['acai_sorvete']), row('l4', null, 10, ['acai_sorvete'])];
    const r = chooseNotes([row('p1', null, 1, ['acai_sorvete'])], null, 'açaí', lib);
    expect(r.map((p) => [p.row.id, p.library])).toEqual([['p1', false], ['l4', true], ['l3', true], ['l2', true]]);
  });
});
