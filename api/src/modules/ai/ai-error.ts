import { HttpException } from '@nestjs/common';
import type { AiVendor } from './ai.types';
import type { VendorFailureKind } from './vendor-failure';

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

/** Caso de uma chave própria que falhou: o do vendor-failure, `format` (resposta fora do formato) ou `other` (outro erro da IA). */
export type KeyFailureKind = VendorFailureKind | 'format' | 'other';

/**
 * Sem gateway, as chaves próprias falharam: mesma mensagem de sempre (HTTP 502), mais o caso de cada chave
 * (quem decide se vale tentar de novo, como a leitura de estilo do Pinterest, olha `failures`).
 */
export class AiKeysFailedError extends AiError {
  constructor(message: string, readonly failures: { vendor: AiVendor; kind: KeyFailureKind }[]) {
    super(message);
  }
}
