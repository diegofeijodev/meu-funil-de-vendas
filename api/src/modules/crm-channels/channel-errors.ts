import { BadRequestException, HttpException } from '@nestjs/common';

/** Erro cuja mensagem (pt-BR) é mostrada ao usuário como está (as telas exibem `e.message`). Vira 400. */
export class UserFacingError extends BadRequestException {
  constructor(message: string) {
    super({ code: 'BAD_REQUEST', message });
  }
}

/** Falha de provedor externo com mensagem amigável (o protótipo registrava o detalhe e devolvia um texto genérico). 502. */
export class ProviderError extends HttpException {
  constructor(message: string) {
    super({ code: 'PROVIDER_ERROR', message }, 502);
  }
}

/** `friendly(err, fallback)` do protótipo: registra o detalhe e devolve só a mensagem genérica. */
export function friendly(err: unknown, fallback: string, logger?: { error(msg: string): void }): ProviderError {
  logger?.error(`${fallback} — ${err instanceof Error ? err.message : String(err)}`);
  return new ProviderError(fallback);
}
