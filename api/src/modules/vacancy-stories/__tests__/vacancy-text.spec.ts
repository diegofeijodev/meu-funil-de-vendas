import {
  norm, isTestText, cleanFunction, cleanEstablishment, formatWhen, formatMoney,
  fingerprint, cityMatches, vacancyFields, hourLabel, leadLabel, shortDay, spParts,
} from '../vacancy-text';
import type { FreelaVacancy } from '../vacancy-types';

function vac(over: Partial<FreelaVacancy> = {}): FreelaVacancy {
  return {
    id: '11111111-1111-1111-1111-111111111111',
    title: 'Garçom',
    serviceType: 'garcom',
    city: 'Campinas',
    date: '2026-10-31',
    startTime: '2026-10-31T21:00:00Z',
    endTime: '2026-11-01T02:00:00Z',
    amountInCents: 15000,
    contractorName: 'Coco Bambu',
    publishedAt: '2026-10-28T12:00:00Z',
    ...over,
  };
}

describe('vacancy-text', () => {
  it('norm tira acento, maiúscula e pontuação', () => expect(norm('  Garçom/Bar-Man! ')).toBe('garcom bar man'));
  it('teste no nome ou título', () => {
    expect(isTestText('Enzo teste fernandes ltda')).toBe(true);
    expect(isTestText('TESTES')).toBe(true);
    expect(isTestText('Contestado Bar')).toBe(false);
  });
  it('função: título limpo; vazio/longo cai no serviceType', () => {
    expect(cleanFunction('Garçom', 'garcom')).toBe('Garçom');
    expect(cleanFunction('Garçom (11) 99999-8888 a@b.com http://x.co', null)).toBe('Garçom');
    expect(cleanFunction('', 'lavagem-de-loucas')).toBe('Lavagem de louças');
    expect(cleanFunction('x'.repeat(41), 'auxiliar-de-cozinha')).toBe('Auxiliar de cozinha');
    expect(cleanFunction(null, 'monitor-infantil')).toBe('Monitor infantil');
  });
  it('estabelecimento: sai com CPF/CNPJ, razão social, teste, nulo; caixa alta vira título com siglas', () => {
    expect(cleanEstablishment('GENILSON FERREIRA DA SILVA 26385530850')).toBeNull();
    expect(cleanEstablishment('Bar 12.345.678/0001-90')).toBeNull();
    expect(cleanEstablishment('KNK ALIMENTACAO LTDA')).toBeNull();
    expect(cleanEstablishment('Padaria S/A')).toBeNull();
    expect(cleanEstablishment('Enzo teste fernandes')).toBeNull();
    expect(cleanEstablishment(null)).toBeNull();
    expect(cleanEstablishment('COCO BAMBU CAMPINAS SHOPPING')).toBe('Coco Bambu Campinas Shopping');
    expect(cleanEstablishment('BAR DO ZE BBQ')).toBe('Bar do Ze BBQ');
  });
  it('datas em Brasília, sem ano, horas cheias sem minutos', () => {
    expect(formatWhen('2026-10-29T14:30:00Z', '2026-10-30T00:00:00Z')).toEqual({ data: 'Qui, 29/10', horario: '11h30 às 21h' });
    expect(formatWhen('2026-10-31T21:00:00Z', '2026-11-01T02:00:00Z')).toEqual({ data: 'Sáb, 31/10', horario: '18h às 23h' });
  });
  it('Review Focus #1 — turno que cruza a meia-noite usa a data de Brasília', () =>
    expect(formatWhen('2026-10-30T01:00:00Z', '2026-10-30T06:00:00Z')).toEqual({ data: 'Qui, 29/10', horario: '22h às 3h' }));
  it('valor', () => {
    expect(formatMoney(15000)).toBe('R$ 150');
    expect(formatMoney(15250)).toBe('R$ 152,50');
    expect(formatMoney(150000)).toBe('R$ 1.500');
  });
  it('assinatura muda com valor/horário e não com publishedAt', () => {
    const v = vac({ amountInCents: 10000 });
    expect(fingerprint(v)).toBe(fingerprint({ ...v, publishedAt: '2030-01-01T00:00:00Z' }));
    expect(fingerprint(v)).not.toBe(fingerprint({ ...v, amountInCents: 12000 }));
  });
  it('cidade sem acento/maiúscula; lista vazia = todas', () => {
    expect(cityMatches('Jundiaí', ['jundiai'])).toBe(true);
    expect(cityMatches('Campinas', [])).toBe(true);
    expect(cityMatches('Campinas', ['Jundiaí'])).toBe(false);
  });
  it('vacancyFields junta tudo e os valores esperados', () =>
    expect(vacancyFields(vac({ title: 'Garçom', amountInCents: 15000, startTime: '2026-10-31T21:00:00Z', endTime: '2026-11-01T02:00:00Z', city: 'Campinas', contractorName: 'COCO BAMBU' })))
      .toEqual({ funcao: 'Garçom', estabelecimento: 'Coco Bambu', data: 'Sáb, 31/10', horario: '18h às 23h', valor: 'R$ 150', cidade: 'Campinas',
        expected: { cents: 15000, day: 31, month: 10, startMin: 1080, endMin: 1380 } }));
  it('auxiliares: hourLabel, leadLabel, shortDay, spParts', () => {
    expect(hourLabel(690)).toBe('11h30');
    expect(hourLabel(1080)).toBe('18h');
    expect([60, 120, 240, 360].map(leadLabel)).toEqual(['1 h', '2 h', '4 h', '6 h']);
    expect(shortDay('2026-10-29T14:30:00Z')).toBe('Qui 29/10');
    expect(spParts('2026-10-30T01:00:00Z')).toEqual({ weekday: 4, day: 29, month: 10, minutes: 1320 });
  });
});
