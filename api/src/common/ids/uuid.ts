const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Rotas públicas recebem id direto da URL. Sem esta checagem, um id malformado
 * chega ao Prisma e vira 500 ("Erro interno") em vez de 404 — foi o que o smoke
 * pegou na primeira rodada.
 */
export const isUuid = (value: string | undefined | null): boolean => !!value && UUID_RE.test(value);

import { NotFoundException, PipeTransform } from '@nestjs/common';

/** `@Param('id', ParseUuidPipe)` — id malformado vira 404 (e não 500 do Prisma). */
export class ParseUuidPipeImpl implements PipeTransform<string, string> {
  transform(value: string): string {
    if (!isUuid(value)) throw new NotFoundException({ code: 'NOT_FOUND', message: 'Não encontrado.' });
    return value;
  }
}
export const ParseUuidPipe = new ParseUuidPipeImpl();
