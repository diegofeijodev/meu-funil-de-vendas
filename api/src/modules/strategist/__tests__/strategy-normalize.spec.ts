import { asList, joinList, normalizeStoredStrategy, strategyResponseSchema, toList } from '../strategy-normalize';

describe('strategy-normalize', () => {
  it('toList/joinList/asList: ausente/null → [], string → [string], não-array nunca quebra o join', () => {
    expect(toList(undefined)).toEqual([]);
    expect(toList(null)).toEqual([]);
    expect(toList('a')).toEqual(['a']);
    expect(toList('  ')).toEqual([]);
    expect(toList(['a'])).toEqual(['a']);
    expect(joinList(undefined)).toBe('');
    expect(joinList('x')).toBe('');
    expect(joinList(['a', 'b'], ' · ')).toBe('a · b');
    expect(asList('x' as never)).toEqual([]);
  });

  it('normalizeStoredStrategy: null/vazio → null; estratégia sem listas ganha arrays e nunca lança', () => {
    expect(normalizeStoredStrategy(null)).toBeNull();
    expect(normalizeStoredStrategy('')).toBeNull();
    const s = normalizeStoredStrategy({
      big_idea: 'x', hipoteses: 'só uma', recomendacoes: null, publicos_meta: [{ nome: 'Frio' }],
      briefing_criativo: { cta: 'Venha' }, briefing_video: { roteiro: 'r' }, plano_instagram: { temas: 'um tema' },
    })!;
    expect(s.big_idea).toBe('x');
    expect(s.hipoteses).toEqual(['só uma']);
    expect(s.recomendacoes).toEqual([]);
    expect(s.angulos).toEqual([]);
    expect(s.objecoes).toEqual([]);
    expect(s.angulos_detalhados).toEqual([]);
    expect(s.publicos_meta![0]).toMatchObject({ nome: 'Frio', tipo: 'interesses', interesses: [], descricao: '' });
    expect(s.briefing_criativo).toMatchObject({ cta: 'Venha', formatos: [] });
    expect(s.briefing_video).toMatchObject({ roteiro: 'r', cenas: [] });
    expect(s.plano_instagram).toMatchObject({ pilares: [], temas: ['um tema'], frequencia: { feed: 3, reels: 2, stories: 7 } });
    expect(s.distribuicao_verba).toEqual({});
    expect(s.kpis).toEqual({});
  });

  it('blocos opcionais ausentes continuam ausentes; JSON gravado como string é lido', () => {
    const s = normalizeStoredStrategy({ big_idea: 'x' })!;
    expect(s.briefing_criativo).toBeUndefined();
    expect(s.plano_instagram).toBeUndefined();
    expect(normalizeStoredStrategy(JSON.stringify({ big_idea: 'y' }))!.big_idea).toBe('y');
  });

  it('strategyResponseSchema: exige todos os campos; formatos/interesses são string[]', () => {
    expect(strategyResponseSchema.safeParse({ big_idea: 'x' }).success).toBe(false);
    expect(strategyResponseSchema.safeParse({}).success).toBe(false);
  });
});
