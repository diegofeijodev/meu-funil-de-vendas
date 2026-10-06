import { planColumns, quoteIdent, TargetColumn } from '../columns';

const col = (name: string, o: Partial<TargetColumn> = {}): TargetColumn => ({ name, nullable: true, hasDefault: false, generated: false, ...o });

describe('planColumns', () => {
  const target = [
    col('id', { nullable: false, hasDefault: true }),
    col('name', { nullable: false }),
    col('note'),
    col('total', { generated: true }),
    col('created_at', { nullable: false, hasDefault: true }),
  ];

  it('insere a interseção, sem as geradas, na ordem do destino', () => {
    expect(planColumns([{ name: 'a', id: '1', total: 3, note: null }], target).insert).toEqual(['id', 'name', 'note']);
  });

  it('coluna só da origem vira "dado não migrado"', () => {
    expect(planColumns([{ id: '1', name: 'a', legado: 1 }, { id: '2', name: 'b', outro: 2 }], target).sourceOnly).toEqual(['legado', 'outro']);
  });

  it('obrigatória sem default ausente na origem é apontada (só se houver linhas)', () => {
    expect(planColumns([{ id: '1' }], target).missingRequired).toEqual(['name']);
    expect(planColumns([], target).missingRequired).toEqual([]);
  });
});

describe('quoteIdent', () => {
  const ok = new Set(['brands', 'logo_url']);

  it('põe aspas só em nomes permitidos', () => {
    expect(quoteIdent('logo_url', ok)).toBe('"logo_url"');
  });

  it('recusa nome fora da lista ou com caracteres perigosos', () => {
    expect(() => quoteIdent('users', ok)).toThrow('não permitido');
    const evil = 'brands"; drop table x; --';
    expect(() => quoteIdent(evil, new Set([evil]))).toThrow('não permitido');
  });
});
