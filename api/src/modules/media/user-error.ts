import { BadRequestException, HttpException, NotFoundException } from '@nestjs/common';

/**
 * Erro com mensagem pt-BR pronta para a tela (o `throw new Error("...")` do protótipo).
 * Quem DEVOLVE `{ error }` em vez de lançar (geração de criativo) usa `errMessage`.
 */
export class UserError extends BadRequestException {
  constructor(message: string) {
    super({ code: 'BAD_REQUEST', message });
  }
}

export const bad = (message: string) => new BadRequestException({ code: 'BAD_REQUEST', message });
export const notFound = (message: string) => new NotFoundException({ code: 'NOT_FOUND', message });

/** Mensagem segura para mostrar ao usuário: só erros "de domínio" passam; o resto vira texto genérico (e fica no log). */
export function errMessage(e: unknown, fallback = 'Erro inesperado. Tente novamente.'): string {
  if (e instanceof HttpException) {
    const body = e.getResponse() as { message?: unknown } | string;
    if (typeof body === 'string') return body;
    if (typeof body?.message === 'string') return body.message;
    if (Array.isArray(body?.message)) return (body.message as string[]).join(' | ');
  }
  return fallback;
}
