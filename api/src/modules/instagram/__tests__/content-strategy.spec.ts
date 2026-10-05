import { ContentStrategyService } from '../content-strategy.service';
import { brandContext, DATE_RULES, dateIssues, fullDate, isCreditFailure, normalizeStrategy, periodDays, spParts } from '../content-strategy';
import { normalizeHashtags } from '../normalize';

/** ISO de um horário de São Paulo (UTC-3 fixo). 28/09/2026 = segunda; 02/10 = sexta; 03/10 = sábado; 04/10 = domingo. */
const sp = (date: string, time: string) => new Date(`${date}T${time}:00-03:00`).toISOString();
const MON = '2026-09-28', TUE = '2026-09-29', WED = '2026-09-30', THU = '2026-10-01', FRI = '2026-10-02', SAT = '2026-10-03', SUN = '2026-10-04';

describe('spParts / fullDate (fuso de São Paulo, UTC-3 fixo)', () => {
  it('dia da semana e hora em São Paulo, inclusive na virada do dia em UTC', () => {
    expect(spParts(sp(FRI, '09:00'))).toEqual({ wd: 5, hour: 9 });
    // 23:30 de sexta em SP já é sábado em UTC: o dia é o de São Paulo
    expect(new Date(sp(FRI, '23:30')).toISOString().slice(0, 10)).toBe(SAT);
    expect(spParts(sp(FRI, '23:30'))).toEqual({ wd: 5, hour: 23 });
    expect(spParts(sp(SUN, '00:10'))).toEqual({ wd: 0, hour: 0 });
  });
  it('fullDate: "dia da semana, dd/mm/aaaa, hh:mm"', () => {
    expect(fullDate(sp(FRI, '20:10'))).toMatch(/^sexta-feira, 02\/10\/2026, 20:10$/);
    expect(fullDate(sp(SAT, '00:05'))).toMatch(/^sábado, 03\/10\/2026, 00:05$/);
  });
  it('periodDays: um item por dia, na ordem', () => {
    const days = periodDays([{ at: sp(FRI, '09:00') }, { at: sp(FRI, '18:00') }, { at: sp(SAT, '09:00') }]);
    expect(days).toEqual(['sexta-feira, 02/10/2026', 'sábado, 03/10/2026']);
  });
});

describe('dateIssues — regras de data só por código (tabela)', () => {
  // [texto, dia, hora, problemas esperados]
  const table: [string, string, string, string[]][] = [
    // "sextou" só na sexta
    ['Sextou! Vem pro happy hour', FRI, '18:00', []],
    ['Sextou! Vem pro happy hour', THU, '18:00', ['"sextou" fora de sexta-feira']],
    ['A sexta chegou e o chopp também', MON, '12:00', ['"sextou" fora de sexta-feira']],
    ['Sexta chegou!', FRI, '12:00', []],
    ['hoje é sexta, bora?', SAT, '12:00', ['"sextou" fora de sexta-feira']],
    ['hoje é sexta, bora?', FRI, '12:00', []],
    // "sabadou" só no sábado
    ['Sabadou com feijoada', SAT, '12:00', []],
    ['Sabadou com feijoada', SUN, '12:00', ['"sabadou" fora de sábado']],
    // "bom dia" só antes das 12h
    ['Bom dia, Valinhos!', MON, '08:00', []],
    ['Bom dia, Valinhos!', MON, '11:59', []],
    ['Bom dia, Valinhos!', MON, '12:00', ['"bom dia" depois das 12h']],
    ['Bom dia, Valinhos!', MON, '18:30', ['"bom dia" depois das 12h']],
    // "boa noite" só a partir das 17h
    ['Boa noite! Hoje tem música ao vivo', MON, '17:00', []],
    ['Boa noite! Hoje tem música ao vivo', MON, '16:59', ['"boa noite" antes das 17h']],
    ['Boa noite! Hoje tem música ao vivo', MON, '09:00', ['"boa noite" antes das 17h']],
    // "fim de semana chegou" / "bom fim de semana" não de segunda a quarta
    ['O fim de semana chegou', FRI, '18:00', []],
    ['O fim de semana começou', SAT, '10:00', []],
    ['O fim de semana chegou', MON, '18:00', ['"fim de semana" de segunda a quarta']],
    ['Bom fim de semana a todos', TUE, '18:00', ['"fim de semana" de segunda a quarta']],
    ['Bom fim de semana a todos', WED, '18:00', ['"fim de semana" de segunda a quarta']],
    ['Bom fim de semana a todos', THU, '18:00', []],
    // "segundou" só na segunda
    ['Segundou com desconto', MON, '09:00', []],
    ['Segundou com desconto', TUE, '09:00', ['"segundou" fora de segunda']],
    // sem acento e caixa: a normalização cobre
    ['SEXTOU', SUN, '09:00', ['"sextou" fora de sexta-feira']],
    ['fim de semana começou', MON, '09:00', ['"fim de semana" de segunda a quarta']],
    // vários problemas ao mesmo tempo
    ['Bom dia! Sextou, boa noite', MON, '15:00', ['"sextou" fora de sexta-feira', '"bom dia" depois das 12h', '"boa noite" antes das 17h']],
    // texto limpo
    ['Almoço executivo por R$ 29,90 de segunda a quinta', MON, '10:00', []],
    ['', MON, '10:00', []],
  ];
  it.each(table)('%j em %s %s', (text, date, time, expected) => {
    expect(dateIssues(text, sp(date, time))).toEqual(expected);
  });

  it('a hora e o dia são os de São Paulo, não os de UTC (sexta 22:00 SP = sábado 01:00 UTC)', () => {
    const iso = sp(FRI, '22:00');
    expect(iso.startsWith(`${SAT}T01:00`)).toBe(true);
    expect(dateIssues('Sextou!', iso)).toEqual([]);
    expect(dateIssues('Boa noite', iso)).toEqual([]);
    expect(dateIssues('Bom dia', iso)).toEqual(['"bom dia" depois das 12h']);
  });
  it('as regras estão descritas no prompt (DATE_RULES)', () => {
    expect(DATE_RULES).toMatch(/sextou/);
    expect(DATE_RULES).toMatch(/bom dia/);
  });
});

describe('helpers puros', () => {
  it('isCreditFailure reconhece falta de crédito/cota', () => {
    for (const m of ['Créditos de IA esgotados.', 'HTTP 402', 'quota exceeded', 'insufficient funds', 'billing problem']) expect(isCreditFailure(m)).toBe(true);
    for (const m of ['IA fora do ar', 'timeout', '']) expect(isCreditFailure(m)).toBe(false);
  });
  it('brandContext só leva o DNA relevante', () => {
    expect(brandContext({ name: 'Zé', segment: 'bar', description: 'd', differentials: 'x', target_audience: 'a', tone_of_voice: 't', preferred_words: ['p'], banned_words: ['b'], region: 'Valinhos', logo_url: 'secreto' })).toEqual({
      nome: 'Zé', segmento: 'bar', descricao: 'd', diferenciais: 'x', publico: 'a', tom: 't', palavras_usar: ['p'], palavras_proibidas: ['b'], regiao: 'Valinhos',
    });
  });
  it('normalizeStrategy: listas ausentes viram vazias, pesos viram número, pilar sem nome sai', () => {
    const s = normalizeStrategy({ pilares: [{ nome: 'A', peso_percentual: '60' }, { nome: '' }, { nome: 'B' }], ctas: ['Reserve', '', null, 7] }, 'Meu objetivo');
    expect(s.objetivo_resumido).toBe('Meu objetivo');
    expect(s.pilares).toEqual([{ nome: 'A', peso_percentual: 60, por_que_serve_ao_objetivo: '' }, { nome: 'B', peso_percentual: 0, por_que_serve_ao_objetivo: '' }]);
    expect(s.ctas).toEqual(['Reserve', '7']);
    expect(s.proibicoes).toEqual([]);
    expect(s.distribuicao_por_dia).toEqual([]);
  });
  it('hashtags: só letras latinas (com acento), números e _ (sem #, hífen, emoji)', () => {
    expect(normalizeHashtags(['#Valinhos', 'chopp-gelado', 'café_com_leite', 'ação🔥', '2026', 'x y'])).toEqual(['Valinhos', 'choppgelado', 'café_com_leite', 'ação', '2026', 'x', 'y']);
    expect(normalizeHashtags('#a, #b #c')).toEqual(['a', 'b', 'c']);
  });
});

describe('ContentStrategyService (IA falsa, sem rede)', () => {
  const brand = { id: 'b1', name: 'Bar do Zé', segment: 'bar', banned_words: ['barato'], region: 'Valinhos' };
  const make = (answers: Record<string, (req: any) => any>) => {
    const calls: { name: string; prompt: string }[] = [];
    const content = {
      aiJson: jest.fn(async (_ws: string, _engine: string, prompt: string, _schema: unknown, name: string) => {
        calls.push({ name, prompt });
        const fn = answers[name];
        if (!fn) throw new Error(`sem resposta para ${name}`);
        return { json: fn({ prompt }), provider: 'lovable_ai' };
      }),
    };
    return { svc: new ContentStrategyService(content as any), calls, content };
  };
  const SLOTS = [{ at: sp(THU, '19:00'), format: 'feed_image' }, { at: sp(FRI, '19:00'), format: 'reel' }];
  const STRATEGY = {
    objetivo_resumido: 'Lotar o happy hour de sexta', kpi_principal: 'Reservas', publico_foco: 'Adultos de Valinhos', mensagem_central: 'Chopp gelado todo fim de semana',
    pilares: [{ nome: 'Happy hour', peso_percentual: 60, por_que_serve_ao_objetivo: 'enche a casa' }, { nome: 'Bastidores', peso_percentual: 40, por_que_serve_ao_objetivo: 'conexão' }],
    distribuicao_por_dia: [{ data: '01/10/2026', dia_da_semana: 'quinta-feira', tema_do_dia: 'esquenta', momento_do_funil: 'atração' }],
    ctas: ['Reserve pelo WhatsApp', 'Chame a turma'], proibicoes: ['barato'],
  };

  it('buildRunStrategy: prompt parte do objetivo digitado (prioridade 1), marca, produtos, dias reais e regras de data; devolve a estratégia normalizada', async () => {
    const { svc, calls } = make({ ig_run_strategy: () => STRATEGY });
    const r = await svc.buildRunStrategy({
      workspaceId: 'ws', objective: 'Levar o público de Valinhos para almoçar durante a semana e lotar o happy hour', brand,
      products: [{ name: 'Prato executivo', description: 'almoço', price: 29.9 }], personas: [{ name: 'Ana', pains: 'sem tempo', desires: 'almoço rápido' }],
      plan: { content_pillars: ['A'], cta_default: 'Peça já' }, slots: SLOTS,
    });
    expect(r.provider).toBe('lovable_ai');
    expect(r.strategy).toMatchObject({ kpi_principal: 'Reservas', ctas: ['Reserve pelo WhatsApp', 'Chame a turma'] });
    expect(r.strategy.pilares).toHaveLength(2);
    const p = calls[0]!.prompt;
    expect(p).toMatch(/1\. OBJETIVO DIGITADO PELO CLIENTE \(fonte principal, nunca ignore\): Levar o público de Valinhos/);
    expect(p).toMatch(/2\. DNA DA MARCA: .*"nome":"Bar do Zé"/);
    expect(p).toMatch(/"nome":"Prato executivo".*"preco":29.9/);
    expect(p).toContain('- quinta-feira, 01/10/2026');
    expect(p).toContain('- sexta-feira, 02/10/2026');
    expect(p).toContain(DATE_RULES);
    expect(calls[0]!.name).toBe('ig_run_strategy');
  });

  it('buildRunStrategy: sem pilares na resposta é erro (a programação tenta de novo no próximo ciclo)', async () => {
    const { svc } = make({ ig_run_strategy: () => ({ ...STRATEGY, pilares: [] }) });
    await expect(svc.buildRunStrategy({ workspaceId: 'ws', objective: 'x'.repeat(40), brand, products: [], personas: [], plan: null, slots: SLOTS })).rejects.toThrow('A IA não devolveu a estratégia completa');
  });

  describe('validatePosts', () => {
    const post = (index: number, over: Record<string, unknown> = {}) => ({ index, at: sp(THU, '19:00'), theme: 'Happy hour', hook: 'Gancho', caption: 'Legenda', headline: 'Manchete', cta: 'Reserve pelo WhatsApp', ...over });
    const args = (posts: any[]) => ({ workspaceId: 'ws', brand, objective: 'objetivo', strategy: STRATEGY as any, products: [{ name: 'Prato', preco: 29.9 }], posts });

    it('regras de data reprovam por código SEM chamar a IA (nota 0, motivo com o problema)', async () => {
      const { svc, content } = make({});
      const v = await svc.validatePosts(args([post(0, { caption: 'Sextou!' }), post(1, { hook: 'Bom dia!', at: sp(MON, '18:00') })]));
      expect(content.aiJson).not.toHaveBeenCalled();
      expect(v.get(0)).toEqual({ aprovado: false, nota: 0, motivo: 'Incoerência de data: "sextou" fora de sexta-feira.' });
      expect(v.get(1)).toEqual({ aprovado: false, nota: 0, motivo: 'Incoerência de data: "bom dia" depois das 12h.' });
    });

    it('a IA revisora só vê os posts que passaram nas regras de data; aprova só com aprovado:true E nota ≥ 6; limita a nota a 0–10', async () => {
      const { svc, calls } = make({
        ig_post_review: () => ({ results: [
          { index: 1, aprovado: true, nota_0_10: 8, motivo: 'ok' },
          { index: 2, aprovado: true, nota_0_10: 5.9, motivo: 'fraco' },
          { index: 3, aprovado: false, nota_0_10: 9, motivo: 'fala de outro negócio' },
          { index: 4, aprovado: true, nota_0_10: 42, motivo: '' },
          { index: 99, aprovado: true, nota_0_10: 9, motivo: 'índice que não existe' },
        ] }),
      });
      const v = await svc.validatePosts(args([post(0, { caption: 'Sextou!' }), post(1), post(2), post(3), post(4)]));
      expect(calls).toHaveLength(1);
      expect(calls[0]!.prompt).not.toMatch(/index 0 ·/); // o 0 já reprovou por data
      expect(calls[0]!.prompt).toMatch(/index 1 · quinta-feira, 01\/10\/2026, 19:00:/);
      expect(v.get(0)!.aprovado).toBe(false);
      expect(v.get(1)).toEqual({ aprovado: true, nota: 8, motivo: 'ok' });
      expect(v.get(2)).toEqual({ aprovado: false, nota: 5.9, motivo: 'fraco' });
      expect(v.get(3)).toEqual({ aprovado: false, nota: 9, motivo: 'fala de outro negócio' });
      expect(v.get(4)).toEqual({ aprovado: true, nota: 10, motivo: '' });
      expect(v.has(99)).toBe(false);
    });

    it('revisor indisponível não bloqueia: sem veredito (o post segue para a aprovação normal); as regras de data continuam valendo', async () => {
      const { svc } = make({ ig_post_review: () => { throw new Error('IA fora do ar'); } });
      const v = await svc.validatePosts(args([post(0), post(1, { caption: 'Sextou' })]));
      expect(v.has(0)).toBe(false);
      expect(v.get(1)!.aprovado).toBe(false);
    });
  });
});
