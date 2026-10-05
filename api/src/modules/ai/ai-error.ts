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

/**
 * Bloqueio de segurança/tamanho ao baixar uma URL devolvida pelo provedor (SSRF, vídeo acima do teto, redirecionamentos demais).
 * Não é "falha do provedor": NÃO deve cair em silêncio para o gateway pago — quem tem fallback precisa repassar este erro.
 */
export class AiDownloadBlockedError extends AiError {}
