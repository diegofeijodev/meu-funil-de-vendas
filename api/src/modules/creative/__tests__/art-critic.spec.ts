jest.setTimeout(60_000);

import { ImageService } from '../../media/image.service';
import { BASE_NEGATIVE, buildVisualPrompt, PHYSICS_RULE, providerPrompt, threadOf, withVisualThread } from '../art-director';
import { compareScores, MIN_DEFECTS, MIN_SCORE, passes, rebuildNote, scoreCreative } from '../critic';
import { ART } from './world';

const brief = (over: Record<string, unknown> = {}) => ({
  workspaceId: 'ws', brand: { name: 'Bar do Zé', segment: 'Bar', primary_color: '#c0392b', secondary_color: '#222', visual_style: { elementos_proibidos: ['logos de concorrentes', 'texto'], exemplos_prompt: ['a', 'b', 'c', 'd'] } },
  aspectRatio: '9:16', kind: 'image' as const, provider: 'gemini', ...over,
});

describe('diretor de arte', () => {
  it('monta o prompt com regras, guia visual, briefing e composição do formato; pede schema estrito com todas as chaves', async () => {
    const ai = { json: jest.fn(async () => ({ ...ART, negative: '', prompt_final: ' A cold beer on wood ', color_palette: 'não-lista' as any, video_shots: undefined as any })) };
    const ad = await buildVisualPrompt(ai as any, brief({ theme: 'Chopp', hook: 'Leve 2', products: [{ name: 'Chopp', description: 'gelado' }], hasProductRef: true }));
    const [ws, req] = ai.json.mock.calls[0] as any;
    expect(ws).toBe('ws');
    expect(req.name).toBe('art_direction');
    expect(req.schema.required).toHaveLength(13);
    expect(req.prompt).toContain('Composição para 9:16: enquadramento vertical');
    expect(req.prompt).toContain('"Use o produto exatamente como nas imagens de referência"');
    expect(req.prompt).toContain('PROMPTS QUE FUNCIONARAM PARA ESTA MARCA');
    expect(req.prompt).toContain('\n- b\n- c\n- d'); // só os 3 últimos
    expect(req.prompt).not.toContain('\n- a\n');
    // negative vazio cai no padrão + proibidos da marca; produto de referência garantido; listas normalizadas
    expect(ad.negative).toBe(`${BASE_NEGATIVE}, logos de concorrentes, texto`);
    expect(ad.prompt_final).toBe('A cold beer on wood Use o produto exatamente como nas imagens de referência.');
    expect(ad.color_palette).toEqual([]);
    expect(ad.video_shots).toEqual([]);
    expect(ad.aspect_ratio).toBe('9:16');
  });

  it('direção de arte em pt-BR: o prompt manda escrever TUDO em português e não manda mais o prompt_final em inglês', async () => {
    const ai = { json: jest.fn(async () => ART) };
    await buildVisualPrompt(ai as any, brief({ aspectRatio: '4:5' }));
    const prompt = (ai.json.mock.calls[0] as any)[1].prompt as string;
    expect(prompt).toContain('somente em português do Brasil');
    expect(prompt).toContain('prompt_final em português do Brasil, 60 a 120 palavras');
    expect(prompt).toContain('Composição para 4:5: assunto nos dois terços inferiores');
    expect(prompt).not.toMatch(/em inglês|in English|exactly as in/i);
    expect(BASE_NEGATIVE).toContain('anatomia deformada');
    expect(BASE_NEGATIVE).not.toMatch(/deformed|blurry/);
  });

  it('vídeo pede tomadas; proporção desconhecida usa a composição 1:1; prompt vazio é erro', async () => {
    const ai = { json: jest.fn(async () => ART) };
    await buildVisualPrompt(ai as any, brief({ kind: 'video', aspectRatio: '3:2' }));
    expect((ai.json.mock.calls[0] as any)[1].prompt).toContain('É vídeo: preencha video_shots');
    expect((ai.json.mock.calls[0] as any)[1].prompt).toContain('Composição para 1:1');
    const empty = { json: jest.fn(async () => ({ ...ART, prompt_final: '   ' })) };
    await expect(buildVisualPrompt(empty as any, brief())).rejects.toThrow('O diretor de arte não devolveu o prompt.');
  });

  it('providerPrompt: sem texto na imagem por padrão; texto curto permitido quando pedido; regra de física em frase afirmativa; sempre "Evite"', () => {
    expect(PHYSICS_RULE).toBe('Cena fisicamente plausível: cada mão segura no máximo um objeto, todo objeto está apoiado ou firme na mão, nada flutua, anatomia e proporções naturais.');
    expect(providerPrompt({ prompt_final: 'X.', negative: 'blurry', text_in_image: 'none' })).toBe(`X. Não inclua texto, letras nem logotipos na imagem. ${PHYSICS_RULE} Evite: blurry.`);
    expect(providerPrompt({ prompt_final: 'X.', negative: 'n', text_in_image: '' })).toContain('Não inclua texto, letras nem logotipos');
    expect(providerPrompt({ prompt_final: 'X.', negative: 'n', text_in_image: 'Promo' })).toBe(`X. O único texto permitido é "Promo". ${PHYSICS_RULE} Evite: n.`);
  });

  it('cena com gente: o diretor recebe regras de ação possível e de foto real; marca de serviço tem a pessoa como protagonista; o negativo padrão cobre os erros de IA', async () => {
    const ai = { json: jest.fn(async () => ART) };
    await buildVisualPrompt(ai as any, brief({ aspectRatio: '4:5' }));
    const prompt = (ai.json.mock.calls[0] as any)[1].prompt as string;
    expect(prompt).toContain('Com pessoas na cena: descreva UMA ação simples e fisicamente possível.');
    expect(prompt).toContain('Cada mão segura no máximo um objeto');
    expect(prompt).toContain('nada flutua');
    expect(prompt).toContain('Quando o guia visual não pedir outro estilo, a imagem deve parecer fotografia real');
    expect(prompt).toContain('Marca de serviço (sem produto físico): o protagonista é a pessoa trabalhando ou sendo atendida');
    for (const term of ['objetos flutuando', 'mãos segurando mais de um objeto', 'pegada impossível', 'pele de plástico', 'aparência de banco de imagem']) expect(BASE_NEGATIVE).toContain(term);
  });

  it('contexto do post entra no briefing (sem virar texto na imagem); as proibições da estratégia vão para o prompt e para o negativo', async () => {
    const ai = { json: jest.fn(async () => ART) };
    const context = {
      product: { name: 'Chope Pilsen', description: 'gelado', price: 12.9 }, pillar: 'Bastidores', persona: null, funnelStage: 'atracao', objective: 'Lotar',
      strategy: { mensagem_central: 'M', publico_foco: 'P', proibicoes: ['preço baixo', 'concorrente'] }, campaign: { offer: 'Chope em dobro', promise: null, brief: null }, scheduledAt: null,
    };
    const ad = await buildVisualPrompt(ai as any, brief({ context }));
    const prompt = (ai.json.mock.calls[0] as any)[1].prompt as string;
    expect(prompt).toContain('CONTEXTO DO POST (traduza em cena visual concreta — produto, público, momento do funil, data e estação; nunca escreva estes textos na imagem):');
    expect(prompt).toContain('"oferta":"Chope em dobro"');
    expect(prompt).toContain('"produtos":[{"nome":"Chope Pilsen","descricao":"gelado"}]');
    expect(prompt).toContain('PROIBIDO NA CENA (estratégia do período): preço baixo; concorrente.');
    expect(ad.negative).toBe('blurry, logos de concorrentes, texto, preço baixo, concorrente');
  });

  it('carrossel: o fio visual (do 1º slide) entra no briefing dos demais e é repetido, uma vez só, no texto final', async () => {
    const ai = { json: jest.fn(async () => ART) };
    const thread = threadOf({ ...ART, color_palette: ['#c0392b', '#f5deb3'], style: 'foto realista', lighting: 'luz quente' } as any);
    expect(thread).toEqual({ paleta: ['#c0392b', '#f5deb3'], estilo_fotografico: 'foto realista', luz: 'luz quente' });
    await buildVisualPrompt(ai as any, brief({ slide: { index: 1, total: 4 }, visualThread: thread }));
    expect((ai.json.mock.calls[0] as any)[1].prompt).toContain(
      'FIO VISUAL DO CARROSSEL (obrigatório neste slide: mesma paleta, mesmo estilo fotográfico e mesma luz dos outros slides): {"paleta":["#c0392b","#f5deb3"],"estilo_fotografico":"foto realista","luz":"luz quente"}',
    );
    const ad = withVisualThread({ ...ART, prompt_final: 'Copo na mesa.' } as any, thread);
    expect(ad.prompt_final).toBe('Copo na mesa. Fio visual do carrossel (igual em todos os slides): paleta #c0392b, #f5deb3; estilo fotográfico foto realista; luz luz quente.');
    expect(withVisualThread(ad, thread).prompt_final).toBe(ad.prompt_final);
  });
});

describe('crítico visual', () => {
  const images = new ImageService();
  it('nota 5 critérios 0–10 (arredonda, limita), soma o total e reduz a candidata a 768 px', async () => {
    const big = Buffer.from(await images.encode(images.blank(1500, 800, 0x6699ccff), false));
    const ref = { bytes: new Uint8Array(await images.encode(images.blank(50, 50, 0xff0000ff), false)), mime: 'image/jpeg' };
    const ai = { vision: jest.fn(async () => ({ produto: 8.6, fidelidade: 15, composicao: -3, defeitos: '7', paleta: 'x', motivo: 'm'.repeat(300) })) };
    const s = await scoreCreative(ai as any, images, { workspaceId: 'ws', image: big, refs: [ref, ref, ref], palette: ['#fff'], aspectRatio: '1:1', subject: 'chopp' });
    expect(s).toMatchObject({ produto: 9, fidelidade: 10, composicao: 0, defeitos: 7, paleta: 0, total: 26 });
    expect(s!.motivo).toHaveLength(240);
    const req = (ai.vision.mock.calls[0] as any)[1];
    expect(req.name).toBe('creative_score');
    expect(req.images).toHaveLength(3); // candidata + 2 referências (máx.)
    const cand = await images.read(req.images[0].bytes);
    expect(Math.max(cand.bitmap.width, cand.bitmap.height)).toBe(768);
    expect(req.prompt).toContain('As 2 imagens seguintes são as referências reais da marca.');
    expect(MIN_SCORE).toBe(28);
  });
});

describe('crítico visual — defeito físico de IA não passa na média (16/11/2026)', () => {
  const images = new ImageService();
  const run = async (vision: jest.Mock) => {
    const image = Buffer.from(await images.encode(images.blank(400, 500, 0x6699ccff), false));
    return scoreCreative({ vision } as any, images, { workspaceId: 'ws', image, refs: [], palette: ['#f5a623'], aspectRatio: '4:5', subject: 'garçom servindo' });
  };
  const GOOD = { produto: 9, fidelidade: 8, composicao: 7, defeitos: 9, paleta: 6, motivo: 'ok' };

  it('manda inspecionar a física ANTES da nota e lista as chaves do JSON no texto (a visão com chave própria não recebe o schema)', async () => {
    const vision = jest.fn(async () => ({ ...GOOD, problemas: [] }));
    await run(vision);
    const req = (vision.mock.calls[0] as any)[1];
    expect(req.prompt).toContain('INSPEÇÃO FÍSICA');
    expect(req.prompt).toContain('uma mão segura no máximo um objeto');
    expect(req.prompt).toContain('flutuando');
    expect(req.prompt).toContain('cara de banco de imagem');
    expect(req.prompt).toContain('"problemas"');
    expect(req.prompt).toMatch(/JSON plano/);
    expect(req.schema.required).toContain('problemas');
    expect(req.prompt).toContain('Não há referências.');
  });

  it('problema listado segura a nota de defeitos em 6, mesmo que o crítico dê 9 (caso real: garçom com tampas flutuando, nota 9)', async () => {
    const s = await run(jest.fn(async () => ({ ...GOOD, problemas: ['tampas de prata flutuando', '  ', 'mão segurando três pratos'], motivo: 'bonita' })));
    expect(s).toMatchObject({ produto: 9, defeitos: 6, total: 36, problemas: ['tampas de prata flutuando', 'mão segurando três pratos'] });
    expect(passes(s)).toBe(false);
  });

  it('sem problema listado a nota fica como veio; aprovar exige total ≥ 28 E defeitos ≥ 7', async () => {
    const s = await run(jest.fn(async () => ({ ...GOOD, problemas: [] })));
    expect(s).toMatchObject({ defeitos: 9, total: 39, problemas: [] });
    expect(passes(s)).toBe(true);
    expect(MIN_DEFECTS).toBe(7);
    expect(passes({ ...s!, defeitos: 6 })).toBe(false);
    expect(passes({ ...s!, total: 27 })).toBe(false);
    expect(passes(null)).toBe(false);
  });

  it('notas aninhadas (resposta sem schema) são lidas; resposta antiga, sem a lista de problemas, continua valendo', async () => {
    const nested = await run(jest.fn(async () => ({ notas: { produto: 8, fidelidade: 8, composicao: 8, defeitos: 8, paleta: 8 }, motivo: 'm' })));
    expect(nested).toMatchObject({ produto: 8, defeitos: 8, total: 40, problemas: [] });
    const old = await run(jest.fn(async () => GOOD));
    expect(old).toMatchObject({ total: 39, problemas: [] });
  });

  it('resposta sem nenhum número: pergunta de novo UMA vez; se continuar, devolve null em vez de nota zero', async () => {
    const twice = jest.fn(async () => ({ motivo: 'A imagem capta bem a atmosfera' }));
    expect(await run(twice)).toBeNull();
    expect(twice).toHaveBeenCalledTimes(2);
    const answers: any[] = [{ motivo: 'sem notas' }, { ...GOOD, problemas: [] }];
    const recovers = jest.fn(async () => answers.shift());
    expect(await run(recovers)).toMatchObject({ total: 39 });
    expect(recovers).toHaveBeenCalledTimes(2);
  });

  it('nota incompleta não vira zero: sem `defeitos` numérico a resposta não vale (pergunta de novo; depois null)', async () => {
    const noDefects = jest.fn(async () => ({ produto: 9, fidelidade: 8, composicao: 7, paleta: 6, defeitos: { nota: 9 }, motivo: 'm' }));
    expect(await run(noDefects)).toBeNull();
    expect(noDefects).toHaveBeenCalledTimes(2);
  });

  it('`problemas` em texto corrido vale como um problema (segura defeitos em 6); `motivo` que não é texto vira vazio', async () => {
    const s = await run(jest.fn(async () => ({ ...GOOD, problemas: 'tampa flutuando sobre a mesa', motivo: { texto: 'x' } })));
    expect(s).toMatchObject({ defeitos: 6, problemas: ['tampa flutuando sobre a mesa'], motivo: '' });
  });

  it('ordem das candidatas: aprovada antes de reprovada, depois menos defeitos, depois total; sem nota por último', () => {
    const mk = (defeitos: number, total: number) => ({ produto: 0, fidelidade: 0, composicao: 0, paleta: 0, defeitos, total, motivo: '', problemas: [] });
    const reprovadaAlta = mk(6, 45);
    const aprovadaBaixa = mk(7, 30);
    const aprovadaLimpa = mk(10, 38);
    const semNota = null;
    const sorted = [semNota, reprovadaAlta, aprovadaBaixa, aprovadaLimpa].sort(compareScores);
    expect(sorted).toEqual([aprovadaLimpa, aprovadaBaixa, reprovadaAlta, semNota]);
    expect([mk(8, 30), mk(8, 41)].sort(compareScores)[0]!.total).toBe(41);
  });

  it('recado para o diretor de arte: o motivo e os problemas vistos', () => {
    const base = { produto: 9, fidelidade: 8, composicao: 7, paleta: 6, defeitos: 6, total: 36 };
    expect(rebuildNote({ ...base, motivo: 'bonita', problemas: ['tampas flutuando', 'três pratos numa mão'] })).toBe('bonita Problemas vistos na imagem: tampas flutuando; três pratos numa mão.');
    expect(rebuildNote({ ...base, motivo: 'produto sumiu', problemas: [] })).toBe('produto sumiu');
    expect(rebuildNote({ ...base, motivo: 'sem lista' } as any)).toBe('sem lista');
  });
});
