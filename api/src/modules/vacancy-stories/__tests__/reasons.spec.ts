import { capWaitReason, igLimitReason, leadDeadline, noApprovalReason, spacingReason, tooCloseReason, windowReason } from '../vacancy-reasons';
import { approveUntil } from '../vacancy-slots';

const SAT_18H = new Date('2026-10-31T21:00:00Z');
const FRI_9H = new Date('2026-10-30T12:00:00Z');
const INTRO_FRI_9H = 'A vaga começa Sex, 30/10 às 9h. Para dar tempo de divulgar, o story teria de ir ao ar até as 6h45';

describe('motivos gravados (A5): dia e hora absolutos, nunca "hoje"/"amanhã"', () => {
  it('antecedência: prazo no mesmo dia do início só com a hora; com a folga da fila, 15 min antes', () => {
    expect(tooCloseReason(SAT_18H, leadDeadline(SAT_18H, 120))).toBe(
      'A vaga começa Sáb, 31/10 às 18h. Para dar tempo de divulgar, o story teria de ir ao ar até as 16h.',
    );
    expect(tooCloseReason(SAT_18H, leadDeadline(SAT_18H, 120, true))).toBe(
      'A vaga começa Sáb, 31/10 às 18h. Para dar tempo de divulgar, o story teria de ir ao ar até as 15h45.',
    );
  });

  it('prazo em outro dia que o início leva o dia', () => {
    const start = new Date('2026-10-30T03:30:00Z'); // sexta 0h30
    expect(tooCloseReason(start, leadDeadline(start, 120, true))).toBe(
      'A vaga começa Sex, 30/10 às 0h30. Para dar tempo de divulgar, o story teria de ir ao ar até Qui, 29/10 às 22h15.',
    );
  });

  it('R23: janela, espaço da Meta e 15 min entre stories', () => {
    const d = leadDeadline(FRI_9H, 120, true);
    expect(windowReason(FRI_9H, d, '08:00', '21:00')).toBe(`${INTRO_FRI_9H}, antes do seu horário para postar (8h às 21h).`);
    expect(windowReason(FRI_9H, d, '08:30', '20:00')).toBe(`${INTRO_FRI_9H}, antes do seu horário para postar (8h30 às 20h).`);
    expect(igLimitReason(FRI_9H, d, new Date('2026-10-30T10:00:00Z'))).toBe(`${INTRO_FRI_9H}, mas a conta só tem espaço no Instagram a partir das 7h.`);
    expect(igLimitReason(FRI_9H, d, new Date('2026-10-29T23:30:00Z'))).toBe(
      `${INTRO_FRI_9H}, mas a conta só tem espaço no Instagram a partir de Qui, 29/10 às 20h30.`,
    );
    const noon = new Date('2026-10-29T15:30:00Z'); // quinta 12h30
    expect(spacingReason(noon, leadDeadline(noon, 120, true))).toBe(
      'A vaga começa Qui, 29/10 às 12h30. Para dar tempo de divulgar, o story teria de ir ao ar até as 10h15, e os horários até lá já têm outros stories de vagas.',
    );
  });

  it('máximo do dia e ninguém aprovou (prazo puxado para o fim da janela da véspera leva os dois dias)', () => {
    expect(capWaitReason(10, new Date('2026-10-30T13:00:00Z'))).toBe(
      'Não coube no máximo de 10 stories de vagas por dia antes do início da vaga (Sex, 30/10 às 10h).',
    );
    const thu18 = new Date('2026-10-29T21:00:00Z');
    const s = { min_lead_minutes: 120, window_start: '08:00', window_end: '21:00' };
    expect(noApprovalReason(approveUntil(thu18, s), thu18)).toBe('Ninguém aprovou a tempo. O prazo era Qui, 29/10 às 15h45; a vaga começa às 18h.');
    expect(noApprovalReason(approveUntil(FRI_9H, s), FRI_9H)).toBe(
      'Ninguém aprovou a tempo. O prazo era Qui, 29/10 às 21h; a vaga começa Sex, 30/10 às 9h.',
    );
  });
});
