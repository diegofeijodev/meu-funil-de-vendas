/**
 * Classificação da falha de uma chave própria (OpenAI/Gemini) pelo status HTTP e pelo corpo de erro do provedor.
 * Pura e sem framework: usada pelo `AiService` (frases da tela) e pelo teste da chave (`AiKeysService.test`).
 */

import { AiVendor } from './ai.types';

/** Nome do provedor nos textos: "ChatGPT (OpenAI)" / "Gemini (Google)". */
export const AI_VENDOR_LABEL: Record<AiVendor, string> = { openai: 'ChatGPT (OpenAI)', gemini: 'Gemini (Google)' };
const VENDOR_LABEL = AI_VENDOR_LABEL;

/** Por que a chave própria falhou. `rateLimited` = pedidos demais agora (limite por minuto), NÃO é falta de saldo. */
export type VendorFailureKind = 'refused' | 'noCredit' | 'rateLimited' | 'model' | 'rejected' | 'down';

/** Prova de falta de saldo, valha o que valer o resto do corpo (OpenAI `insufficient_quota`, Google "prepayment credits are depleted"). */
const DEFINITE_CREDIT = /insufficient_quota|billing_hard_limit|prepay|depleted|insufficient[ _](?:funds|balance|credits?)|credit balance|out of credits?|no credits? (?:left|remaining)/i;
/** Cota DIÁRIA (Google `GenerateRequestsPerDay…`, OpenAI "requests per day (RPD)"): só volta amanhã ou com saldo. */
const PER_DAY = /PerDay|per[ _]day|\bRPD\b|daily (?:limit|quota)/i;
/** Limite por minuto, dito com todas as letras. */
const PER_MINUTE = /PerMinute|per[ _]min(?:ute)?\b|\bRPM\b|\bTPM\b/i;
/** Sinal genérico de limite de velocidade: o 429 do Google cita ".../docs/rate-limits" (e "billing details") até no limite por minuto. */
const RATE_LIMIT = /rate[-_ ]limit|try again in \d/i;
/** Indícios mais fracos, usados só quando nada aponta para limite. "billing" sozinho NÃO conta (aparece no limite por minuto do Google e da OpenAI). */
const PROBABLE_CREDIT = /\bcredits?\b|BILLING_DISABLED|billing (?:is )?(?:not )?(?:enabled|active)|enable billing|billing to be enabled|billing account/i;

/**
 * A falha é FALTA DE SALDO de verdade? 402 sempre; 429/403/400 só quando o corpo prova (crédito, pré-pago esgotado, cota diária,
 * billing desligado). Limite por minuto, ou corpo que não diz nada, NÃO é falta de saldo (na dúvida, não).
 */
export function isCreditExhausted(status: number, body: string): boolean {
  if (status === 402) return true;
  if (status !== 429 && status !== 403 && status !== 400) return false;
  if (DEFINITE_CREDIT.test(body)) return true;
  const perMinute = PER_MINUTE.test(body);
  if (PER_DAY.test(body) && !perMinute) return true;
  if (perMinute || RATE_LIMIT.test(body)) return false;
  return PROBABLE_CREDIT.test(body);
}

const KEY_INVALID = /API_KEY_INVALID|API key not valid|Incorrect API key|invalid_api_key/i;
const MODEL_MISSING = /model_not_found|does not exist|not found|\bmodel\b/i;

/**
 * Caso da falha: 401 → recusada · falta de saldo (`isCreditExhausted`) → sem crédito · 403 → recusada · 429 sem prova de saldo → pedidos
 * demais · 400 de chave inválida → recusada · 404 ou 400 de modelo → modelo indisponível · outro 4xx → recusou o pedido · resto → não respondeu.
 * A checagem de saldo vem antes da de modelo (o corpo de saldo pode citar o modelo).
 */
export function classifyVendorFailure(status: number, body: string): VendorFailureKind {
  if (status === 401) return 'refused';
  if (isCreditExhausted(status, body)) return 'noCredit';
  if (status === 403) return 'refused';
  if (status === 429) return 'rateLimited';
  if (status === 400 && KEY_INVALID.test(body)) return 'refused';
  if (status === 404 || (status === 400 && MODEL_MISSING.test(body))) return 'model';
  if (status >= 400 && status < 500) return 'rejected';
  return 'down';
}

/** Frase completa (uma falha só) por caso — texto final do design, 27/10/2026. */
export function vendorMessage(vendor: AiVendor, kind: VendorFailureKind, d: { status?: number; model?: string } = {}): string {
  const openai = vendor === 'openai';
  switch (kind) {
    case 'refused':
      return `A chave do ${VENDOR_LABEL[vendor]} foi recusada. Cole uma chave nova em Integrações.`;
    case 'noCredit':
      return openai
        ? 'Sua conta OpenAI está sem créditos ou no limite de uso. Adicione créditos na OpenAI ou cadastre a chave do Gemini em Integrações.'
        : 'Sua conta do Gemini (Google) está sem créditos ou no limite de uso. Adicione créditos no Google ou cadastre a chave do ChatGPT (OpenAI) em Integrações.';
    case 'rateLimited':
      return `O ${VENDOR_LABEL[vendor]} recebeu pedidos demais agora. Tente de novo em alguns minutos.`;
    case 'model':
      return `O modelo ${d.model ?? 'pedido'} não está disponível na chave do ${VENDOR_LABEL[vendor]}. Confira o acesso da chave em Integrações.`;
    case 'rejected':
      return `${openai ? 'A OpenAI' : 'O Gemini (Google)'} recusou o pedido (erro ${d.status ?? '?'}).`;
    default:
      return `${openai ? 'A OpenAI' : 'O Gemini (Google)'} não respondeu agora. Tente de novo em alguns minutos.`;
  }
}
