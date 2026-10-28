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

  const withText = (t: string, f = F, tpl = TEMPLATE, o?: { forbiddenOnly?: boolean }) =>
    compareArt({ ...good, textos: [...good.textos, t] }, f, tpl, o);

  it('R9: rótulo dentro do nome do estabelecimento da vaga é permitido', () => {
    const f = { ...F, estabelecimento: 'Bar do Bairro' };
    expect(withText('Bar do Bairro', f).forbidden).toEqual([]);
    expect(withText('Bar do Bairro', f, TEMPLATE, { forbiddenOnly: true }).ok).toBe(true);
    expect(withText('Sabores da Região', { ...F, estabelecimento: 'Sabores da Região' }).forbidden).toEqual([]);
    expect(withText('Endereço: Rua X', f).ok).toBe(false);
    const r = compareArt({ ...good, estabelecimento: 'Bar do Bairro', textos: [...good.textos, 'Bar do Bairro', 'Bairro: Centro'] }, f, TEMPLATE);
    expect(r.forbidden).toEqual(['Bairro: Centro']);
  });
  it('cópia editada do endereço do modelo é barrada', () => {
    for (const t of ['Onde: Estrada Joaquim Bueno Neto, 9999', 'Local: Estrada Joaquim Bueno Neto, 9999',
      'Estrada Joaquim Bueno Neto, 9999 - Itupeva', 'Estrada Joaquim Bueno Neto, 999, Rio abaxo', 'Estr. Joaquim Bueno Neto, 9999'])
      expect(withText(t).forbidden).toEqual([t]);
  });
  it('palavras comuns e valores iguais aos da vaga não são cópia', () => {
    expect(withText('VAGAS').forbidden).toEqual([]);
    expect(withText('Sábado').forbidden).toEqual([]);
    const f10 = { ...F, horario: '10h às 16h', expected: { ...F.expected, startMin: 600, endMin: 960 } };
    expect(withText('10:00', f10).forbidden).toEqual([]);
    expect(withText('10:00 às 16:00', f10).forbidden).toEqual([]);
    const fi = { ...F, cidade: 'Itupeva' };
    expect(withText('Itupeva/SP', fi).forbidden).toEqual([]);
    expect(withText('Sábado, 25/10', F, [...TEMPLATE, 'Sábado, 25/10']).forbidden).toEqual(['Sábado, 25/10']);
  });
  it('R10: o prompt de leitura pede textos pequenos e da foto', () => expect(readPrompt()).toMatch(/pequenos e os da foto/));
  it('R11: cidade com UF, fim pelo último horário, 24h = meia-noite', () => {
    for (const c of ['Campinas/SP', 'Campinas - SP', 'Campinas, SP', 'CAMPINAS (SP)'])
      expect(compareArt({ ...good, cidade: c }, F, TEMPLATE).fields.find((x) => x.key === 'cidade')!.ok).toBe(true);
    expect(compareArt({ ...good, fim: '18h às 23h' }, F, TEMPLATE).fields.find((x) => x.key === 'fim')!.ok).toBe(true);
    expect(parseMinutes('18h às 23h', 'last')).toBe(1380);
    expect(parseMinutes('24:00')).toBe(0);
    expect(parseMinutes('24h')).toBe(0);
  });

  it('R2: fragmento do modelo é barrado mesmo sem item separado', () => {
    const tpl = ['Frutá Frozen Outlet Premium Itupeva', 'Rio abaixo, Itupeva',
      'Estrada Joaquim Bueno Neto, 9999, Rio abaixo, Itupeva/SP, 13299600'];
    for (const t of ['Frutá', 'FRUTÁ', 'FROZEN', 'Rio abaixo', 'Itupeva', 'Itupeva/SP', '13299600', '9999'])
      expect(withText(t, F, tpl).forbidden).toEqual([t]);
    expect(withText('Itupeva/SP', F, tpl, { forbiddenOnly: true }).ok).toBe(false);
    expect(withText('Rio abaixo', F, tpl, { forbiddenOnly: true }).ok).toBe(false);
    expect(withText('Itupeva/SP', F).forbidden).toEqual(['Itupeva/SP']);
    expect(withText('13299600', F).forbidden).toEqual(['13299600']);
    expect(withText('Itupeva/SP', { ...F, cidade: 'Itupeva' }, tpl).forbidden).toEqual([]);
    const f10 = { ...F, horario: '10h às 16h', expected: { ...F.expected, startMin: 600, endMin: 960 } };
    for (const t of ['VAGAS', 'Sábado', '10:00', '10:00 às 16:00']) expect(withText(t, f10, [...TEMPLATE, 'Sábado, 25/10']).forbidden).toEqual([]);
  });
});
