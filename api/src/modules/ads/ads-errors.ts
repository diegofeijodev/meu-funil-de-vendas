import { HttpException } from '@nestjs/common';
import { MetaError } from '../instagram/meta-graph';

/** Erro dos provedores de anúncios (Google/TikTok): mensagem pt-BR pronta para a tela, HTTP 502. */
export class AdsProviderError extends Error {}

/** Erro de configuração/credencial do usuário (faltou salvar algo): 400, mensagem pronta. */
export class AdsSetupError extends Error {}

/**
 * Converte os erros dos provedores em respostas HTTP com a mensagem do protótipo: a Meta/Google/TikTok recusou = 502
 * (`META_ERROR`/`ADS_PROVIDER_ERROR`); falta de credencial = 400. Erros HTTP de domínio e bugs passam sem mudar.
 */
export async function guarded<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (e) {
    if (e instanceof HttpException) throw e;
    if (e instanceof MetaError) throw new HttpException({ code: 'META_ERROR', message: e.message }, 502);
    if (e instanceof AdsProviderError) throw new HttpException({ code: 'ADS_PROVIDER_ERROR', message: e.message }, 502);
    if (e instanceof AdsSetupError) throw new HttpException({ code: 'BAD_REQUEST', message: e.message }, 400);
    throw e;
  }
}

export const errMsg = (e: unknown, fb = 'falhou') => (e instanceof Error ? e.message : fb);
