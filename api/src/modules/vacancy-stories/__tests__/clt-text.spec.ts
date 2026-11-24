import {
  CLT_SKIP, cltBenefits, cltCityLabel, cltDeadline, cltFields, cltFingerprint, cltForcedTriage, cltRole, cltSalary, cltSchedule, cltTriage, stripClt,
} from '../vacancy-clt';
import {
  CLT_CLOSED_REASON, CLT_DISABLED_REASON, CLT_STARTED_REASON, cltBlockedExpireReason, cltCapWaitReason, cltDeadlineReason, cltIgLimitReason,
  cltNoApprovalReason, cltSpacingReason, cltWindowReason,
} from '../vacancy-reasons';
import { SKIP } from '../vacancy-triage';
import { fixedJob } from './world';

const NOW = new Date('2026-11-25T15:00:00Z'); // 12h em Brasília
const all = { cities: [] as string[] };

describe('vagas fixas — prazo para divulgar (M14)', () => {
  it('publicada + 30 dias, ou o vencimento se vier antes', () => {
    expect(cltDeadline(fixedJob({ publishedAt: '2026-11-20T14:00:00Z', expiresAt: null }))).toEqual(new Date('2026-12-20T14:00:00Z'));
    expect(cltDeadline(fixedJob({ publishedAt: '2026-11-20T14:00:00Z', expiresAt: '2026-12-01T03:00:00Z' }))).toEqual(new Date('2026-12-01T03:00:00Z'));
    expect(cltDeadline(fixedJob({ publishedAt: '2026-11-20T14:00:00Z', expiresAt: '2027-03-01T03:00:00Z' }))).toEqual(new Date('2026-12-20T14:00:00Z'));
  });
});

describe('vagas fixas — triagem (M14; decisões do dono de 24/11)', () => {
  it('teste na empresa, no título ou no cargo', () => {
    expect(cltTriage(fixedJob({ companyName: 'Empresa Teste' }), all, NOW)).toEqual({ status: 'skipped', reason: SKIP.test });
    expect(cltTriage(fixedJob({ title: 'Vaga teste' }), all, NOW)).toEqual({ status: 'skipped', reason: SKIP.testTitle });
    expect(cltTriage(fixedJob({ title: 'Atendente', role: 'teste' }), all, NOW)).toEqual({ status: 'skipped', reason: CLT_SKIP.testRole });
  });

  it('sem salário: pula com o motivo; a forçada também exige salário', () => {
    expect(cltTriage(fixedJob({ salary: null }), all, NOW)).toEqual({ status: 'skipped', reason: 'A vaga fixa não tem salário informado.' });
    expect(cltForcedTriage(fixedJob({ salary: null }), NOW)).toEqual({ status: 'skipped', reason: CLT_SKIP.noSalary });
  });

  it('sem cidade: sai (sem o cartão) com a lista vazia; com a lista preenchida não dá para conferir e pula', () => {
    expect(cltTriage(fixedJob({ city: null, uf: null }), all, NOW)).toEqual({ status: 'new' });
    expect(cltTriage(fixedJob({ city: null, uf: null }), { cities: ['Campinas'] }, NOW)).toEqual({ status: 'skipped', reason: CLT_SKIP.noCityForList });
  });

  it('cidade fora da lista (sem acento e sem maiúsculas); dentro passa', () => {
    expect(cltTriage(fixedJob({ city: 'Jundiaí' }), { cities: ['Campinas'] }, NOW)).toEqual({ status: 'skipped', reason: 'Cidade fora da sua lista: Jundiaí.' });
    expect(cltTriage(fixedJob({ city: 'Jundiaí' }), { cities: ['jundiai'] }, NOW)).toEqual({ status: 'new' });
  });

  it('prazo para divulgar passado: pula com o dia; a forçada também; teste e cidade fora não barram a forçada', () => {
    const old = fixedJob({ publishedAt: '2026-10-20T14:00:00Z' }); // + 30 dias = 19/11
    expect(cltTriage(old, all, NOW)).toEqual({ status: 'skipped', reason: 'O prazo para divulgar esta vaga fixa terminou em 19/11.' });
    expect(cltForcedTriage(old, NOW)).toEqual({ status: 'skipped', reason: cltDeadlineReason(new Date('2026-11-19T14:00:00Z')) });
    expect(cltForcedTriage(fixedJob({ companyName: 'teste', city: 'Recife' }), NOW)).toEqual({ status: 'new' });
  });
});

describe('vagas fixas — campos da arte (M14; UI §3.4, P13)', () => {
  it('cargo: título limpo sem "CLT" no fim; título comprido ou vazio → o cargo do Freela com a 1ª maiúscula', () => {
    expect(cltRole({ title: 'Atendente CLT', role: 'atendente' })).toBe('Atendente');
    expect(cltRole({ title: 'Cumim (CLT)', role: 'cumim' })).toBe('Cumim');
    expect(cltRole({ title: 'Garçom - CLT', role: 'garcom' })).toBe('Garçom');
    expect(cltRole({ title: 'Auxiliar de cozinha para o turno da noite com experiência', role: 'auxiliar de cozinha' })).toBe('Auxiliar de cozinha');
    expect(cltRole({ title: '', role: 'atendente' })).toBe('Atendente');
    expect(stripClt('Recepcionista Clt')).toBe('Recepcionista');
    expect(stripClt('Cltista')).toBe('Cltista');
  });

  it('salário: centavos só quando não são zero; faixa "a"', () => {
    expect(cltSalary({ minInCents: 187432, maxInCents: 187432 })).toBe('R$ 1.874,32');
    expect(cltSalary({ minInCents: 255000, maxInCents: 255000 })).toBe('R$ 2.550');
    expect(cltSalary({ minInCents: 200000, maxInCents: 250000 })).toBe('R$ 2.000 a R$ 2.500');
    expect(cltSalary(null)).toBeNull();
  });

  it('escala: dos horários (mesmo horário → dias e horas; diferentes → dias por semana), senão o texto cortado; nada → null', () => {
    const days = (names: string[], start = '08:00', end = '17:00') => names.map((day) => ({ day, start, end }));
    expect(cltSchedule({ workSchedule: 'Segunda 08:00-17:00 • …', workScheduleSlots: days(['Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta']) })).toBe('Seg a Sex, 8h às 17h');
    expect(cltSchedule({ workSchedule: null, workScheduleSlots: days(['Sábado', 'Domingo'], '10:00', '18:20') })).toBe('Sáb e Dom, 10h às 18h20');
    expect(cltSchedule({ workSchedule: null, workScheduleSlots: days(['segunda', 'quarta', 'sexta']) })).toBe('Seg, Qua e Sex, 8h às 17h');
    expect(cltSchedule({ workSchedule: null, workScheduleSlots: [...days(['Segunda', 'Terça']), { day: 'Sábado', start: '10:00', end: '14:00' }] })).toBe('3 dias por semana');
    expect(cltSchedule({ workSchedule: '6x1, 10h às 18h20', workScheduleSlots: [] })).toBe('6x1, 10h às 18h20');
    expect(cltSchedule({ workSchedule: '6x1, 10h às 18h20', workScheduleSlots: days(['Dia útil']) })).toBe('6x1, 10h às 18h20');
    expect(cltSchedule({ workSchedule: null, workScheduleSlots: [] })).toBeNull();
    expect((cltSchedule({ workSchedule: 'Escala 6x1 com folga rotativa aos domingos e feriados nacionais', workScheduleSlots: [] }) ?? '').length).toBeLessThanOrEqual(45);
  });

  it('benefícios: até 4, " · ", no máximo 80 caracteres; nenhum → null', () => {
    expect(cltBenefits(['Vale-transporte', 'Refeição no local', 'Plano de saúde'])).toBe('Vale-transporte · Refeição no local · Plano de saúde');
    expect(cltBenefits(['VT', 'VR', 'Plano', 'Odonto', 'Bônus'])).toBe('VT · VR · Plano · Odonto');
    const long = cltBenefits(['Vale-refeição R$ 1.200,00', 'Vale-transporte integral', 'Plano de saúde Bradesco', 'Seguro de vida']);
    expect(long!.length).toBeLessThanOrEqual(80);
    expect(long).toBe('Vale-refeição R$ 1.200,00 · Vale-transporte integral · Plano de saúde Bradesco');
    expect(cltBenefits([])).toBeNull();
  });

  it('dados reais de 24/11: cabeçalho, salário repetido e "PJ" não são benefício; cargo em minúsculas ganha a 1ª maiúscula', () => {
    expect(cltBenefits(['Benefícios da empresa', 'Salário', 'rateio de gorjeta', 'VT'])).toBe('rateio de gorjeta · VT');
    expect(cltBenefits(['Benefícios & Diferenciais:*', 'Salário: R$ 2.300,00'])).toBeNull();
    expect(cltBenefits(['Salário + comissão(média R$4.000,00)', 'VT'])).toBe('VT');
    expect(cltBenefits(['PJ'])).toBeNull();
    expect(cltBenefits(['Cesta básica', 'Vale-transporte'])).toBe('Cesta básica · Vale-transporte');
    expect(cltRole({ title: 'cozinheiro escala 12x36', role: 'cozinheiro' })).toBe('Cozinheiro escala 12x36');
  });

  it('cidade "Jundiaí – SP"; sem UF só a cidade; sem cidade null; empresa limpa como nas diárias', () => {
    expect(cltCityLabel({ city: 'Jundiaí', uf: 'sp' })).toBe('Jundiaí – SP');
    expect(cltCityLabel({ city: 'Jundiaí', uf: null })).toBe('Jundiaí');
    expect(cltCityLabel({ city: null, uf: 'SP' })).toBeNull();
    expect(cltFields(fixedJob({ companyName: 'COCO BAMBU CAMPINAS SHOPPING' })).empresa).toBe('Coco Bambu Campinas Shopping');
    expect(cltFields(fixedJob({ companyName: '66.699.088 DENNER LTDA' })).empresa).toBeNull();
    expect(cltFields(fixedJob())).toEqual({
      cargo: 'Atendente', empresa: 'Spoleto Shopping Anália Franco', salario: 'R$ 1.874,32', escala: '6x1, 10h às 18h20', cidade: 'São Paulo – SP',
      beneficios: 'Vale-transporte · Refeição no local',
    });
  });

  it('assinatura muda com o que vai na arte e não muda com o prazo', () => {
    const v = fixedJob();
    expect(cltFingerprint(v)).toMatch(/^[0-9a-f]{40}$/);
    expect(cltFingerprint({ ...v, expiresAt: '2026-12-31T00:00:00Z' })).toBe(cltFingerprint(v));
    expect(cltFingerprint({ ...v, salary: { minInCents: 190000, maxInCents: 190000 } })).not.toBe(cltFingerprint(v));
    expect(cltFingerprint({ ...v, benefits: ['VT'] })).not.toBe(cltFingerprint(v));
  });
});

describe('vagas fixas — textos dos motivos (M14; UI §4.4)', () => {
  const deadline = new Date('2026-12-24T17:00:00Z'); // 14h de 24/12 em Brasília
  it('cada texto CLT', () => {
    expect(CLT_DISABLED_REASON).toBe('Os stories das vagas fixas foram desligados.');
    expect(CLT_CLOSED_REASON).toBe('A vaga fixa foi fechada ou venceu no Freela.');
    expect(CLT_STARTED_REASON).toBe('O prazo para divulgar esta vaga fixa terminou antes de ir ao ar.');
    expect(cltDeadlineReason(deadline)).toBe('O prazo para divulgar esta vaga fixa terminou em 24/12.');
    expect(cltCapWaitReason(2, deadline)).toBe('Não coube no máximo de 2 stories de vagas fixas por dia até 24/12.');
    expect(cltCapWaitReason(1, deadline)).toBe('Não coube no máximo de 1 story de vaga fixa por dia até 24/12.');
    expect(cltNoApprovalReason(deadline)).toBe('Ninguém aprovou a tempo. O prazo era 24/12.');
    expect(cltBlockedExpireReason(deadline, new Date('2026-12-20T11:30:00Z'))).toBe(
      'Não foi ao ar: o Instagram recusava as publicações desta empresa desde Dom, 20/12 às 8h30, e o prazo para divulgar esta vaga fixa terminou em 24/12.',
    );
    expect(cltWindowReason(deadline, '08:00', '21:00')).toBe('O prazo para divulgar esta vaga fixa vai até Qui, 24/12 às 14h, e o seu horário para postar (8h às 21h) só abre depois.');
    expect(cltIgLimitReason(deadline, new Date('2026-12-24T18:00:00Z'))).toBe('O prazo para divulgar esta vaga fixa vai até Qui, 24/12 às 14h, mas a conta só tem espaço no Instagram a partir das 15h.');
    expect(cltSpacingReason(deadline)).toBe('O prazo para divulgar esta vaga fixa vai até Qui, 24/12 às 14h, e os horários até lá já têm outros stories de vagas.');
  });
});
