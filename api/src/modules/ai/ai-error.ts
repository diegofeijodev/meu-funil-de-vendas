import { HttpException } from '@nestjs/common';

/**
 * Erro de IA com mensagem pt-BR pronta para a tela (as mesmas do protótipo).
 * HTTP 502; quem devolvia `{ ok:false, error }` no protótipo captura e usa `.message`.
 */
export class AiError extends HttpException {
  constructor(message: string, code = 'AI_ERROR') {
    super({ code, message }, 502);
  }
}
