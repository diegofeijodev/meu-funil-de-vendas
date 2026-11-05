/**
 * Classificação da falha de uma chave própria (OpenAI/Gemini) pelo status HTTP e pelo corpo de erro do provedor.
 * Pura e sem framework: usada pelo `AiService` (frases da tela) e pelo teste da chave (`AiKeysService.test`).
 */

import { AiVendor } from './ai.types';

/** Nome do provedor nos textos: "ChatGPT (OpenAI)" / "Gemini (Google)". */
export const AI_VENDOR_LABEL: Record<AiVendor, string> = { openai: 'ChatGPT (OpenAI)', gemini: 'Gemini (Google)' };
const VENDOR_LABEL = AI_VENDOR_LABEL;

/**
 * Por que a chave própria falhou. `noCredit` = falta de saldo DEFINITIVA (a conta inteira parou); `dailyLimit` = cota DIÁRIA, que no
 * Google e na OpenAI é POR MODELO (outro modelo ainda pode sair; volta sozinha no dia seguinte); `rateLimited` = pedidos demais agora
 * (limite por minuto). Só `noCredit` e `dailyLimit` são gravados no aviso de créditos (ver `AiCreditAlertsService`).
 */
export type VendorFailureKind = 'refused' | 'noCredit' | 'dailyLimit' | 'rateLimited' | 'model' | 'rejected' | 'down';

/** Prova de falta de saldo, valha o que valer o resto do corpo (OpenAI `insufficient_quota`, Google "prepayment credits are depleted"). */
const DEFINITE_CREDIT = /insufficient_quota|billing_hard_limit|prepay|depleted|insufficient[ _](?:funds|balance|credits?)|credit balance|out of credits?|no credits? (?:left|remaining)/i;
/** Cota DIÁRIA (Google `GenerateRequestsPerDayPerProjectPerModel…`, OpenAI "requests per day (RPD)"): por modelo; volta amanhã ou com saldo. */
const PER_DAY = /PerDay|per[ _]day|\bRPD\b|daily (?:limit|quota)/i;
/** Limite por minuto, dito com todas as letras. */
const PER_MINUTE = /PerMinute|per[ _]min(?:ute)?\b|\bRPM\b|\bTPM\b/i;
/** Sinal genérico de limite de velocidade: o 429 do Google cita ".../docs/rate-limits" (e "billing details") até no limite por minuto. */
const RATE_LIMIT = /rate[-_ ]limit|try again in \d/i;
/** Indícios mais fracos, usados só quando nada aponta para limite. "billing" sozinho NÃO conta (aparece no limite por minuto do Google e da OpenAI). */
const PROBABLE_CREDIT = /\bcredits?\b|BILLING_DISABLED|billing (?:is )?(?:not )?(?:enabled|active)|enable billing|billing to be enabled|billing account/i;

/**
 * A falha é FALTA DE SALDO definitiva? 402 sempre; 429/403/400 só quando o corpo prova (crédito, pré-pago esgotado, billing desligado).
 * Cota diária (`isDailyLimit`), limite por minuto ou corpo que não diz nada NÃO são falta de saldo (na dúvida, não).
 */
export function isCreditExhausted(status: number, body: string): boolean {
  if (status === 402) return true;
  if (status !== 429 && status !== 403 && status !== 400) return false;
  if (DEFINITE_CREDIT.test(body)) return true;
  if (PER_DAY.test(body) || PER_MINUTE.test(body) || RATE_LIMIT.test(body)) return false;
  return PROBABLE_CREDIT.test(body);
}

/** 429 de cota DIÁRIA (e não por minuto nem de saldo): o modelo só volta amanhã ou com saldo; outro modelo da mesma chave pode sair. */
export function isDailyLimit(status: number, body: string): boolean {
  return status === 429 && PER_DAY.test(body) && !PER_MINUTE.test(body) && !DEFINITE_CREDIT.test(body);
}

const KEY_INVALID = /API_KEY_INVALID|API key not valid|Incorrect API key|invalid_api_key/i;
const MODEL_MISSING = /model_not_found|does not exist|not found|\bmodel\b/i;

/**
 * Caso da falha: 401 → recusada · falta de saldo (`isCreditExhausted`) → sem crédito · cota diária (`isDailyLimit`) → limite de hoje ·
 * 403 → recusada · 429 sem prova de saldo → pedidos demais · 400 de chave inválida → recusada · 404 ou 400 de modelo → modelo
 * indisponível · outro 4xx → recusou o pedido · resto → não respondeu.
 * A checagem de saldo vem antes da de modelo (o corpo de saldo pode citar o modelo).
 */
export function classifyVendorFailure(status: number, body: string): VendorFailureKind {
  if (status === 401) return 'refused';
  if (isCreditExhausted(status, body)) return 'noCredit';
  if (isDailyLimit(status, body)) return 'dailyLimit';
  if (status === 403) return 'refused';
  if (status === 429) return 'rateLimited';
  if (status === 400 && KEY_INVALID.test(body)) return 'refused';
  if (status === 404 || (status === 400 && MODEL_MISSING.test(body))) return 'model';
  if (status >= 400 && status < 500) return 'rejected';
  return 'down';
}

/** Recusa de conteúdo (moderação): vale para qualquer modelo. */
const CONTENT_BLOCKED = /moderation|content[_ ]policy|safety[_ ]system|safety_violation/i;

/**
 * A falha de geração de IMAGEM é do modelo (e outro modelo da mesma chave pode sair)? Sim para modelo indisponível, cota do dia
 * (é por modelo), pedido recusado por parâmetro, provedor fora do ar e 403 que cita o modelo/verificação. Não para chave recusada,
 * falta de saldo, pedidos demais por minuto e recusa de conteúdo: esses valem para qualquer modelo.
 */
export function canTryOtherImageModel(status: number, body: string): boolean {
  if (CONTENT_BLOCKED.test(body)) return false;
  const kind = classifyVendorFailure(status, body);
  if (kind === 'model' || kind === 'dailyLimit' || kind === 'rejected' || kind === 'down') return true;
  return kind === 'refused' && status === 403 && /\bmodel\b|verif/i.test(body);
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
    case 'dailyLimit':
      return `O ${VENDOR_LABEL[vendor]} chegou ao limite de uso de hoje. Volta sozinho amanhã, ou antes se você colocar créditos.`;
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
