import { STYLE_CATEGORY_IDS } from '../categories';
import {
  asStyleRefsRecord, noteLine, normalizeStyleNotes, STYLE_NOTES_HEADER, STYLE_NOTES_PROMPT, STYLE_NOTES_SCHEMA, StyleNotes, styleNotesText, styleRecord,
} from '../style-notes';

const cap = (n: number) => 'x'.repeat(n);
const FULL: StyleNotes = { v: 2, paleta: ['a'.repeat(20), 'b'.repeat(20), 'c'.repeat(20), 'd'.repeat(20)], composicao: cap(80), luz: cap(70), enquadramento: cap(80), clima: cap(80), evitar: [cap(30), cap(30), cap(30)], categorias: ['comida_hamburguer', 'bebida_bar', 'ambiente'], assunto: cap(50), acabamento: cap(300) };

describe('notas de estilo v2', () => {
  it('normaliza v2: categorias só da lista (até 3), assunto até 6 palavras/50 letras, acabamento até 300, paleta até 4 × 20, sem « » nem controle', () => {
    const n = normalizeStyleNotes({ paleta: ['laranja «queimado»', 'creme', 'preto', 'branco', 'azul'], luz: 'quente\nde lado', clima: 'aconchegante', categorias: ['comida_hamburguer', 'xyz', 'bebida_bar', 'ambiente', 'doces'], assunto: 'hambúrguer artesanal no balcão de madeira escura agora', acabamento: cap(400) })!;
    expect(n.paleta).toEqual(['laranja queimado', 'creme', 'preto', 'branco']);
    expect(n.luz).toBe('quente de lado');
    expect(n.categorias).toEqual(['comida_hamburguer', 'bebida_bar', 'ambiente']);
    expect(n.assunto).toBe('hambúrguer artesanal no balcão de madeira');
    expect(n.acabamento).toHaveLength(300);
  });
  it('assunto de uma palavra gigante fica em 50 letras', () => {
    expect(normalizeStyleNotes({ assunto: cap(80), luz: 'x' })!.assunto).toHaveLength(50);
  });
  it('nota v1 (sem v nem campos novos) continua válida', () => {
    expect(normalizeStyleNotes({ paleta: ['laranja'], luz: 'quente' })).toMatchObject({ categorias: [], assunto: '', acabamento: '' });
  });
  it('o prompt pede os campos novos no TEXTO (a chave própria não recebe o schema) e lista os ids', () => {
    for (const w of ['categorias', 'assunto', 'acabamento', ...STYLE_CATEGORY_IDS]) expect(STYLE_NOTES_PROMPT).toContain(w);
    expect(STYLE_NOTES_SCHEMA.required).toEqual(expect.arrayContaining(['categorias', 'assunto', 'acabamento']));
  });
  it('linha no teto: ≤ 600, mantém assunto e acabamento; só as partes de menor prioridade saem', () => {
    const l = noteLine(1, FULL, { labels: ['hambúrguer e lanches', 'bebida e bar'] });
    expect(l.length).toBeLessThanOrEqual(600);
    expect(l).toMatch(/^1\) \[hambúrguer e lanches, bebida e bar\] «assunto x+; paleta /);
    expect(l).toContain(`acabamento ${cap(300)}`);
    expect(l).not.toContain('evitar');
  });
  it('nota reduzida = só paleta e luz', () => {
    expect(noteLine(2, FULL, { full: false })).toBe(`2) «paleta ${FULL.paleta.join(', ')}; luz ${cap(70)}»`);
  });
  it('Review Focus #3: 4 notas no teto → bloco ≤ 2500 com o cabeçalho, entram 3, corte na fronteira', () => {
    const r = styleNotesText(['r1', 'r2', 'r3', 'r4'].map((id) => ({ id, notes: FULL, labels: ['hambúrguer e lanches', 'bebida e bar'] })))!;
    expect(r.text.startsWith(`${STYLE_NOTES_HEADER} 1) `)).toBe(true);
    expect(r.text.length).toBeLessThanOrEqual(2500);
    expect(r.ids).toEqual(['r1', 'r2', 'r3']);
    expect(r.text).not.toContain(' 4) ');
  });
  it('registro: styleRecord e asStyleRefsRecord', () => {
    expect(styleRecord(null, 'b1')).toEqual({ own: [], library: [], brand_id: 'b1' });
    expect(asStyleRefsRecord({ own: ['a'], library: [], brand_id: null })).toEqual({ own: ['a'], library: [], brand_id: null });
    expect(asStyleRefsRecord('x')).toBeNull();
  });
});
