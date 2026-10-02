import { computeSlots, plusDays, todaySP } from '../slots';
import { asList, asText, normalizeHashtags } from '../normalize';

// Segunda-feira 05/10/2026, 09:00 em São Paulo (UTC-3 fixo).
const NOW = Date.parse('2026-10-05T12:00:00Z');
const base = { startDate: '2026-10-05', endDate: '2026-10-05', weekdays: [0, 1, 2, 3, 4, 5, 6], times: [] as string[], storyTimes: [] as string[], formats: ['feed_image'] as any[] };
const msg = (fn: () => unknown) => { try { fn(); return 'ok'; } catch (e: any) { return e.getResponse().message; } };

describe('computeSlots (horários exatos em UTC-3)', () => {
  it('data de hoje = agora - 3 h; plusDays avança o dia civil', () => {
    expect(todaySP(Date.parse('2026-10-05T02:00:00Z'))).toBe('2026-10-04');
    expect(plusDays('2026-10-31', 1)).toBe('2026-11-01');
  });

  it('converte o horário local para UTC e ordena', () => {
    const { slots, skipped } = computeSlots({ ...base, times: ['19:00', '12:00'] }, NOW);
    expect(skipped).toBe(0);
    expect(slots.map((s) => s.at)).toEqual(['2026-10-05T15:00:00.000Z', '2026-10-05T22:00:00.000Z']);
    expect(slots.map((s) => s.index)).toEqual([0, 1]);
  });

  it('pula horário com menos de 20 min de antecedência', () => {
    const { slots, skipped } = computeSlots({ ...base, times: ['09:10', '09:30'] }, NOW);
    expect(skipped).toBe(1);
    expect(slots).toHaveLength(1);
    expect(slots[0]!.at).toBe('2026-10-05T12:30:00.000Z');
  });

  it('vídeo a menos de 60 min vira imagem (reel → feed_image, story_video → story_image)', () => {
    const r = computeSlots({ ...base, times: ['09:45', '11:00'], storyTimes: ['09:50', '12:00'], formats: ['reel', 'story_video'] }, NOW);
    const by = Object.fromEntries(r.slots.map((s) => [s.at.slice(11, 16), s.format]));
    expect(by['12:45']).toBe('feed_image'); // 09:45 BRT
    expect(by['14:00']).toBe('reel'); // 11:00 BRT
    expect(by['12:50']).toBe('story_image');
    expect(by['15:00']).toBe('story_video');
  });

  it('gira os formatos por dia (o mesmo horário não repete o formato)', () => {
    const { slots } = computeSlots({ ...base, endDate: '2026-10-07', times: ['10:00'], formats: ['feed_image', 'reel'] }, NOW);
    expect(slots.map((s) => s.format)).toEqual(['feed_image', 'reel', 'feed_image']);
  });

  it('respeita os dias da semana (0 = domingo)', () => {
    const { slots } = computeSlots({ ...base, endDate: '2026-10-11', weekdays: [0], times: ['10:00'] }, NOW);
    expect(slots).toHaveLength(1);
    expect(slots[0]!.at).toBe('2026-10-11T13:00:00.000Z');
  });

  it('stories usam os formatos de story (padrão story_image) e marcam kind', () => {
    const { slots } = computeSlots({ ...base, storyTimes: ['10:00'], formats: ['feed_image'] }, NOW);
    expect(slots[0]).toMatchObject({ format: 'story_image', kind: 'story' });
  });

  it('"o quanto antes": daqui a ~25 min, arredondado para 5 min, em imagem', () => {
    const { slots } = computeSlots({ ...base, asap: true, formats: ['reel'] }, NOW);
    expect(slots).toHaveLength(1);
    expect(slots[0]).toMatchObject({ at: '2026-10-05T12:25:00.000Z', format: 'feed_image', kind: 'main' });
  });

  it('data inicial no passado vale hoje; erros com as mensagens do protótipo', () => {
    expect(computeSlots({ ...base, startDate: '2026-01-01', times: ['10:00'] }, NOW).slots).toHaveLength(1);
    expect(msg(() => computeSlots({ ...base, endDate: '2026-10-01', times: ['10:00'] }, NOW))).toBe('A data final precisa ser igual ou depois da inicial (e não pode estar no passado).');
    expect(msg(() => computeSlots({ ...base, endDate: '2027-03-01', times: ['10:00'] }, NOW))).toBe('O período pode ter no máximo 92 dias.');
    expect(msg(() => computeSlots({ ...base, endDate: '2026-12-15', times: ['08:00', '10:00', '12:00', '14:00', '16:00', '18:00'] }, NOW))).toMatch(/O limite por programação é 120/);
    expect(msg(() => computeSlots({ ...base, times: ['10:00'], formats: ['story_image'] }, NOW))).toBe('Escolha ao menos um formato de feed ou Reels para os horários principais.');
  });

  it('horários inválidos são descartados e repetidos viram um só', () => {
    const { slots } = computeSlots({ ...base, times: ['9:00', '09:00', '25:00', 'abc', '10:05'] }, NOW);
    expect(slots.map((s) => s.at)).toEqual(['2026-10-05T12:00:00.000Z', '2026-10-05T13:05:00.000Z'].filter((x) => Date.parse(x) - NOW >= 20 * 60e3));
  });
});

describe('normalize (saída defensiva da IA)', () => {
  it('hashtags: aceita lista ou texto, tira #, repetidas e vazias, limita', () => {
    expect(normalizeHashtags('#Valinhos, #choppgelado  valinhos')).toEqual(['Valinhos', 'choppgelado']);
    expect(normalizeHashtags(['#a b', 'c,d', null, { x: 1 }])).toEqual(['a', 'b', 'c', 'd']);
    expect(normalizeHashtags(Array.from({ length: 40 }, (_, i) => `t${i}`))).toHaveLength(15);
    expect(normalizeHashtags(undefined)).toEqual([]);
  });
  it('asText junta listas e devolve null para vazio/objeto; asList quebra por linha/;', () => {
    expect(asText(['a', 'b'])).toBe('a\nb');
    expect(asText('  ')).toBeNull();
    expect(asText({ a: 1 })).toBeNull();
    expect(asText(12)).toBe('12');
    expect(asList('a; b\nc')).toEqual(['a', 'b', 'c']);
    expect(asList(5)).toEqual([]);
  });
});
