/**
 * Conferências antes de mandar uma campanha para um canal pago (Meta, Google, TikTok) ou de ligar a veiculação.
 * Antes: verba vazia virava R$ 20/dia sem aviso, e o fim do período não valia para nada.
 */
import { BadRequestException } from '@nestjs/common';
import { dateToString, todaySp } from '../../common/time/dates';

/** Último dia da campanha ("YYYY-MM-DD"). A coluna é DATE: o Prisma devolve meia-noite UTC desse dia. */
export function campaignEndDay(endDate: Date | string | null | undefined): string | null {
  if (!endDate) return null;
  return typeof endDate === 'string' ? endDate.slice(0, 10) : dateToString(endDate);
}

/** Verba por dia em reais; vazia ou ≤ 0 recusa com `BUDGET_MISSING` (a tela mostra onde preencher). */
export function requireDailyBudget(budgetDaily: unknown): number {
  const value = Number(budgetDaily ?? 0);
  if (!Number.isFinite(value) || value <= 0) {
    throw new BadRequestException({ code: 'BUDGET_MISSING', message: 'Defina quanto quer gastar por dia antes de publicar.' });
  }
  return value;
}

/**
 * Publicar na Meta: além do período encerrado, recusa a campanha que termina HOJE — com verba diária a Meta exige
 * `end_time` pelo menos 24 h depois do início, e o conjunto seria recusado depois de a campanha já existir lá (órfã).
 */
export function assertCanPublishUntil(endDay: string | null): void {
  assertPeriodOpen(endDay);
  if (endDay && endDay === todaySp()) {
    throw new BadRequestException({
      code: 'PERIOD_TOO_SHORT',
      message: 'Esta campanha termina hoje: a Meta pede pelo menos 24 horas de anúncio. Crie uma campanha nova com mais dias.',
    });
  }
}

/** Período encerrado (fim antes de hoje, em Brasília) recusa publicar e ligar com `PERIOD_ENDED`. */
export function assertPeriodOpen(endDay: string | null): void {
  if (!endDay || endDay >= todaySp()) return;
  const shown = endDay.split('-').reverse().join('/');
  throw new BadRequestException({
    code: 'PERIOD_ENDED',
    message: `O período desta campanha terminou em ${shown}. Crie uma campanha nova para anunciar de novo.`,
  });
}
