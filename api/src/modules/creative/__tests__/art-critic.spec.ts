jest.setTimeout(60_000);

import { ImageService } from '../../media/image.service';
import { BASE_NEGATIVE, buildVisualPrompt, providerPrompt } from '../art-director';
import { MIN_SCORE, scoreCreative } from '../critic';
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

  it('providerPrompt: sem texto na imagem por padrão; texto curto permitido quando pedido; sempre "Evite"', () => {
    expect(providerPrompt({ prompt_final: 'X.', negative: 'blurry', text_in_image: 'none' })).toBe('X. Não inclua texto, letras nem logotipos na imagem. Evite: blurry.');
    expect(providerPrompt({ prompt_final: 'X.', negative: 'n', text_in_image: '' })).toContain('Não inclua texto, letras nem logotipos');
    expect(providerPrompt({ prompt_final: 'X.', negative: 'n', text_in_image: 'Promo' })).toBe('X. O único texto permitido é "Promo". Evite: n.');
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
    expect(s.motivo).toHaveLength(240);
    const req = (ai.vision.mock.calls[0] as any)[1];
    expect(req.name).toBe('creative_score');
    expect(req.images).toHaveLength(3); // candidata + 2 referências (máx.)
    const cand = await images.read(req.images[0].bytes);
    expect(Math.max(cand.bitmap.width, cand.bitmap.height)).toBe(768);
    expect(req.prompt).toContain('As 2 imagens seguintes são as referências reais da marca.');
    expect(MIN_SCORE).toBe(28);
  });
});
