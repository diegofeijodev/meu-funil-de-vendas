import { contextForPrompt, contextProhibitions, firstFrameRef, orderRefsForProduct, PostCreativeContext, seasonOf } from '../creative-context';

const CTX: PostCreativeContext = {
  product: { name: 'Chope Pilsen', description: 'claro e gelado', price: 12.9 },
  pillar: 'Bastidores',
  persona: { name: 'Ana', pains: 'sem tempo', desires: 'relaxar' },
  funnelStage: 'conversao',
  objective: 'Lotar o happy hour de sexta',
  strategy: { mensagem_central: 'O melhor chope da cidade', publico_foco: 'adultos de Valinhos', proibicoes: ['falar de preço baixo', '', 'concorrentes'] },
  campaign: { offer: 'Chope em dobro', promise: 'até as 20h', brief: { big_idea: 'Dobradinha' } },
  scheduledAt: '2099-01-02T21:00:00.000Z',
};

describe('creative-context (contexto do post para a direção de arte e o roteiro de vídeo)', () => {
  it('estação do Brasil (hemisfério sul) pelo mês em São Paulo', () => {
    expect(['2099-01-15T12:00:00Z', '2099-04-15T12:00:00Z', '2099-07-15T12:00:00Z', '2099-10-15T12:00:00Z', '2099-12-01T12:00:00Z'].map(seasonOf)).toEqual(['verão', 'outono', 'inverno', 'primavera', 'verão']);
    expect(seasonOf('2099-03-01T02:00:00Z')).toBe('verão'); // 28/02, 23:00 em São Paulo
  });

  it('JSON para os prompts: produto, persona, funil por extenso, objetivo, estratégia, campanha e data com estação; nulo sem contexto', () => {
    expect(contextForPrompt(null)).toBeNull();
    expect(contextForPrompt(CTX)).toEqual({
      produto: { nome: 'Chope Pilsen', descricao: 'claro e gelado', preco: 12.9 },
      pilar: 'Bastidores',
      persona: { nome: 'Ana', dores: 'sem tempo', desejos: 'relaxar' },
      etapa_do_funil: 'conversão — produto em destaque e convite claro',
      objetivo_do_periodo: 'Lotar o happy hour de sexta',
      mensagem_central: 'O melhor chope da cidade',
      publico: 'adultos de Valinhos',
      campanha: { oferta: 'Chope em dobro', promessa: 'até as 20h', estrategia: { big_idea: 'Dobradinha' } },
      data: 'sexta-feira, 02/01/2099 (verão)',
    });
  });

  it('proibições da estratégia sem vazios (até 12)', () => {
    expect(contextProhibitions(CTX)).toEqual(['falar de preço baixo', 'concorrentes']);
    expect(contextProhibitions(null)).toEqual([]);
    expect(contextProhibitions({ ...CTX, strategy: { ...CTX.strategy!, proibicoes: Array.from({ length: 20 }, (_, i) => `p${i}`) } })).toHaveLength(12);
  });

  it('foto do primeiro quadro: a do produto do post (nome do arquivo, sem acento nem caixa), senão outra de produto, senão a primeira', () => {
    const ref = (id: string, tag: string | null, name: string) => ({ id, tag, name });
    const refs = [ref('a', 'ambiente', 'bar.jpg'), ref('b', 'produto', 'outro.jpg'), ref('c', 'produto', 'Chope-Pilsén.PNG')];
    expect(firstFrameRef(refs, 'Chope Pilsen')?.id).toBe('c');
    expect(firstFrameRef(refs, 'Inexistente')?.id).toBe('b');
    expect(firstFrameRef(refs, null)?.id).toBe('a');
    expect(firstFrameRef([ref('a', 'ambiente', 'x.jpg')], 'Chope')?.id).toBe('a');
    expect(firstFrameRef([], 'Chope')).toBeNull();
    expect(orderRefsForProduct(refs, 'Chope Pilsen').map((r) => r.id)).toEqual(['c', 'a', 'b']);
    expect(orderRefsForProduct(refs, null).map((r) => r.id)).toEqual(['a', 'b', 'c']);
  });
});
