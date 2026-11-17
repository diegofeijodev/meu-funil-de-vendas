import { chooseNotes, PickRow } from '../style-pick';
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
