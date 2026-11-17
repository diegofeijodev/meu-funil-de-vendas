import { styleSubject, subjectCategories, subjectWords } from '../categories';

describe('categorias do pedido', () => {
  it.each([
    ['Hambúrguer artesanal com cheddar', ['comida_hamburguer']],
    ['X-Burger da casa', ['comida_hamburguer']],
    ['cachorro-quente na chapa', ['comida_hamburguer']],
    ['Chope gelado', ['bebida_bar']], ['chopp', ['bebida_bar']],
    ['Barbearia do Zé', ['beleza']], // "bar" não casa com "barbearia"
    ['Açaí na tigela', ['acai_sorvete']],
    ['Vaga de Garçom', ['pessoas_trabalhando', 'equipe_vagas']],
    ['', []],
  ])('subjectCategories(%s)', (t, out) => expect(subjectCategories(t)).toEqual(out));
  it('subjectWords e styleSubject', () => {
    expect(subjectWords('Hambúrguer artesanal para você')).toEqual(['hamburguer', 'artesanal']);
    expect(styleSubject('  Tema ', null, 'pedido', undefined)).toBe('Tema pedido');
    expect(styleSubject('x'.repeat(600))).toHaveLength(500);
  });
});
