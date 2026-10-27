import { aiText, asList, joinList, normalizeAngle, normalizeStoredStrategy, toList } from '../strategy-normalize';

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
    expect(s.publicos_meta![0]).toMatchObject({ nome: 'Frio', tipo: '', interesses: [], descricao: '' });
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

  it('lixo (texto não-JSON, array, objeto sem big_idea nem ângulos) → null; só o ângulo basta', () => {
    expect(normalizeStoredStrategy('isto não é json')).toBeNull();
    expect(normalizeStoredStrategy([1, 2])).toBeNull();
    expect(normalizeStoredStrategy({ big_idea: '  ', angulos_detalhados: [] })).toBeNull();
    expect(normalizeStoredStrategy({ angulos_detalhados: [{ nome: 'A' }] })).not.toBeNull();
  });

  it('não inventa defaults de exibição: duração/quantidade ausentes ficam undefined; número válido é mantido; tipo desconhecido fica como veio', () => {
    const s = normalizeStoredStrategy({
      big_idea: 'x', briefing_video: { roteiro: 'r' }, briefing_criativo: { quantidade_por_angulo: '3' },
      publicos_meta: [{ nome: 'A', tipo: 'custom' }, { nome: 'B' }],
    })!;
    expect(s.briefing_video!.duracao_segundos).toBeUndefined();
    expect(s.briefing_criativo!.quantidade_por_angulo).toBe(3);
    expect(s.publicos_meta!.map((a) => a.tipo)).toEqual(['custom', '']);
  });

  it('aiText: texto/número/bool/lista/objeto viram texto legível, sem "[object Object]" em nenhum nível', () => {
    expect(aiText('  oi  ')).toBe('oi');
    expect(aiText(null)).toBe('');
    expect(aiText(undefined)).toBe('');
    expect(aiText(12)).toBe('12');
    expect(aiText(true)).toBe('Sim');
    expect(aiText({ relevante: false })).toBe('Relevante: Não');
    expect(aiText(['a', ' ', 'b'])).toBe('a\nb');
    expect(aiText({ especifico: 'Gerar 200 leads', mensuravel: 'CPL até R$ 10', prazo_final: 30 })).toBe('Específico: Gerar 200 leads\nMensurável: CPL até R$ 10\nPrazo final: 30');
    const icp = aiText({ perfil: 'Mulheres 25-40', dores: ['falta de tempo', 'preço'], extra: { canal: 'Instagram', ok: null }, vazio: '' });
    expect(icp).toBe('Perfil: Mulheres 25-40\nDores: falta de tempo, preço\nExtra: Canal: Instagram');
    expect(aiText([{ a: { b: { c: 'fundo' } } }])).toBe('A: B: C: fundo');
    expect(aiText('[object Object]')).toBe('');
    expect(aiText({ x: '[object Object]' })).toBe('');
    for (const v of [{ a: { b: {} } }, [{}], [[{ x: 1 }]]]) expect(aiText(v)).not.toContain('[object Object]');
  });

  it('campos de texto que vieram como objeto viram linhas; "[object Object]" gravado por versões antigas vira vazio', () => {
    const s = normalizeStoredStrategy({
      big_idea: 'x',
      objetivo_smart: { especifico: 'Gerar 200 leads', temporal: '30 dias' },
      icp: { perfil: 'Donos de bar', dores: ['pouco movimento'] },
      resumo_executivo: '[object Object]',
      problema: ['p1', 'p2'],
      hipoteses: [{ hipotese: 'h1', teste: 't1' }, '[object Object]'],
      kpis: [{ nome: 'CPL', meta: { valor: 10, moeda: 'R$' } }],
    })!;
    expect(s.objetivo_smart).toBe('Específico: Gerar 200 leads\nTemporal: 30 dias');
    expect(s.icp).toBe('Perfil: Donos de bar\nDores: pouco movimento');
    expect(s.resumo_executivo).toBe('');
    expect(s.problema).toBe('p1\np2');
    expect(s.hipoteses).toEqual(['Hipotese: h1; Teste: t1']);
    expect(aiText({ atingivel: 'sim', publico_alvo: 'x', faixa_etaria: '25-40', descricao: 'd' })).toBe('Atingível: sim\nPúblico alvo: x\nFaixa etária: 25-40\nDescrição: d');
    expect(s.kpis).toEqual({ CPL: 'Valor: 10\nMoeda: R$' });
    expect(JSON.stringify(s)).not.toContain('[object Object]');
  });

  it('ângulos: sinônimos de nome/gancho/mensagem (qualquer caixa); sem nome continua vazio', () => {
    const s = normalizeStoredStrategy({
      big_idea: 'x',
      angulos_detalhados: [
        { titulo: 'Promo', hook: 'Dobrou', message: 'Chopp em dobro' },
        { Título: 'Família', headline: 'Traga todos', descrição: 'Mesa grande' },
        { name: 'N', angulo: 'ignorado', gancho: 'G', texto: 'T' },
        { nome: '', nome_angulo: 'Pelo sinônimo' },
        { hook: 'Só o gancho' },
      ],
    })!;
    expect(s.angulos_detalhados!.map((a) => [a.nome, a.gancho, a.mensagem])).toEqual([
      ['Promo', 'Dobrou', 'Chopp em dobro'],
      ['Família', 'Traga todos', 'Mesa grande'],
      ['N', 'G', 'T'],
      ['Pelo sinônimo', '', ''],
      ['', 'Só o gancho', ''],
    ]);
    expect(normalizeAngle('Só texto')).toMatchObject({ nome: 'Só texto', gancho: '' });
    expect(normalizeAngle({ angulo: { foco: 'preço' } }).nome).toBe('Foco: preço');
  });

  it('ângulo sem nome, mensagem e gancho some (e não conta como ângulo); objeção sem a chave usa a 1ª string útil', () => {
    expect(normalizeStoredStrategy({ big_idea: '', angulos_detalhados: [{ formato_sugerido: 'reels' }, {}] })).toBeNull();
    const s = normalizeStoredStrategy({
      big_idea: 'x',
      angulos_detalhados: [{ etapa_funil: 'topo' }, { hook: 'G' }],
      objecoes: [{ duvida: 'É caro?', resposta: 'Vale' }, { resposta: 'r', detalhe: { a: 1 } }],
    })!;
    expect(s.angulos_detalhados!.map((a) => a.gancho)).toEqual(['G']);
    expect(s.objecoes).toEqual([{ objecao: 'É caro?', resposta: 'Vale' }, { objecao: '', resposta: 'r' }]);
  });
});
