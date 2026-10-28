import { artPrompt, readPrompt } from '../vacancy-prompts';
import { compareArt, parseCents, parseDayMonth, parseMinutes } from '../vacancy-verify';
import type { ArtRead } from '../vacancy-types';

const TEMPLATE = ['freeLa serviços', 'VAGA', 'AUXILIAR DE LIMPEZA', 'FREELANCER', 'Estabelecimento:', 'Frutá Frozen Outlet Premium Itupeva',
  'Função:', 'Auxiliar de Limpeza', 'Data:', '28/10/2026', 'Horário:', '10:00 às 16:00', 'Região:', 'Rio abaixo, Itupeva', 'Endereço:',
  'Estrada Joaquim Bueno Neto, 9999, Rio abaixo, Itupeva/SP, 13299600', 'Valor para o freela:', 'R$ 95,95', 'Descrição:', 'Limpeza',
  'Ver vaga:', 'https://www.freelaservicosapp.com.br//freelancer/vagas/fdfa4ef5-d856-4be4-943c-6c0988c3e106', 'Frutá', 'FROZEN',
  'Baixe nosso app', 'Google Play', 'App Store'];
const F = { funcao: 'Garçom', estabelecimento: 'Coco Bambu', data: 'Sáb, 31/10', horario: '18h às 23h', valor: 'R$ 150', cidade: 'Campinas',
  expected: { cents: 15000, day: 31, month: 10, startMin: 1080, endMin: 1380 } };
const good: ArtRead = { textos: ['VAGA FREELA', 'GARÇOM', 'Coco Bambu', 'Sáb, 31/10', '18:00 às 23:00', 'Campinas', 'Valor para o freela', 'R$ 150,00'],
  funcao: 'GARÇOM', estabelecimento: 'Coco Bambu', data: '31/10', inicio: '18:00', fim: '23h', valor: 'R$ 150,00', cidade: 'CAMPINAS' };

describe('conferência da arte', () => {
  it('aprova por valor interpretado (18:00 = 18h, R$ 150,00 = R$ 150, caixa alta)', () => expect(compareArt(good, F, TEMPLATE).ok).toBe(true));
  it('aceita rótulo genérico junto da função', () =>
    expect(compareArt({ ...good, funcao: 'VAGA FREELA GARÇOM' }, F, TEMPLATE).fields.find((x) => x.key === 'funcao')!.ok).toBe(true));
  it('reprova horário errado e diz o campo', () => {
    const r = compareArt({ ...good, inicio: '10:00' }, F, TEMPLATE);
    expect(r.ok).toBe(false);
    expect(r.fields.find((x) => x.key === 'inicio')).toMatchObject({ ok: false, read: '10:00', expected: '18h' });
    expect(r.hint).toMatch(/horário/);
  });
  it('barra texto copiado do modelo (endereço, região, link, Frutá)', () => {
    for (const t of ['Estrada Joaquim Bueno Neto, 9999', 'Rio abaixo, Itupeva', 'Frutá', 'R$ 95,95'])
      expect(compareArt({ ...good, textos: [...good.textos, t] }, F, TEMPLATE).forbidden.length).toBeGreaterThan(0);
  });
  it('barra rótulo do modelo que não é genérico (ver vaga)', () => {
    const r = compareArt({ ...good, textos: [...good.textos, 'ver vaga'] }, F, TEMPLATE);
    expect(r.forbidden).toEqual(['ver vaga']);
    expect(r.hint).toMatch(/ver vaga/);
  });
  it('barra rótulos e selos proibidos mesmo fora do modelo', () => {
    for (const t of ['Endereço:', 'www.freela.com', 'Disponível no Google Play', 'Descrição'])
      expect(compareArt({ ...good, textos: [...good.textos, t] }, F, []).ok).toBe(false);
  });
  it('"comida" não é confundida com link', () =>
    expect(compareArt({ ...good, textos: [...good.textos, 'Boa comida'] }, F, []).ok).toBe(true));
  it('texto do modelo igual a um valor da vaga é permitido', () => {
    const f = { ...F, funcao: 'Auxiliar de Limpeza' };
    expect(compareArt({ ...good, funcao: 'AUXILIAR DE LIMPEZA', textos: ['AUXILIAR DE LIMPEZA', ...good.textos.slice(2)] }, f, TEMPLATE).forbidden).toEqual([]);
  });
  it('estabelecimento: reprova se aparece quando devia ter saído', () =>
    expect(compareArt(good, { ...F, estabelecimento: null }, TEMPLATE).fields.find((x) => x.key === 'estabelecimento')!.ok).toBe(false));
  it('reserva: só texto proibido conta', () => expect(compareArt({ ...good, inicio: null, valor: null }, F, TEMPLATE, { forbiddenOnly: true }).ok).toBe(true));
  it('parsers', () => {
    expect(parseCents('R$ 1.500,00')).toBe(150000); expect(parseCents('R$150')).toBe(15000); expect(parseCents('cento e cinquenta')).toBeNull();
    expect(parseMinutes('11h30')).toBe(690); expect(parseMinutes('11:30')).toBe(690); expect(parseMinutes('18h')).toBe(1080);
    expect(parseDayMonth('Sáb, 31/10/2026')).toEqual({ day: 31, month: 10 });
  });
  it('o prompt de leitura NÃO contém os valores esperados (leitura às cegas)', () => {
    const p = readPrompt();
    for (const v of ['Garçom', 'R$ 150', '31/10', 'Campinas']) expect(p).not.toContain(v);
  });
  it('o prompt da arte leva só os campos limpos e as proibições', () => {
    const p = artPrompt({ ...F, estabelecimento: null }, null);
    expect(p).toContain('GARÇOM'); expect(p).toContain('R$ 150'); expect(p).toContain('Sáb, 31/10'); expect(p).not.toContain('Coco Bambu');
    expect(p).toMatch(/sem fachada/i); expect(p).toMatch(/Endereço/); expect(p).toMatch(/faixa de baixo/i);
  });
});
