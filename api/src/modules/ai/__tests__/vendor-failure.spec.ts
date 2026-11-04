import { classifyVendorFailure, isCreditExhausted } from '../vendor-failure';

/** Corpos reais (resumidos) dos provedores. */
const OPENAI_NO_QUOTA = JSON.stringify({
  error: { message: 'You exceeded your current quota, please check your plan and billing details. For more information on this error, read the docs: https://platform.openai.com/docs/guides/error-codes/api-errors.', type: 'insufficient_quota', param: null, code: 'insufficient_quota' },
});
const OPENAI_RPM = JSON.stringify({
  error: {
    message: 'Rate limit reached for gpt-4o-mini in organization org-x on requests per min (RPM): Limit 3, Used 3, Requested 1. Please try again in 20s. You can increase your rate limit by adding a payment method to your account at https://platform.openai.com/account/billing.',
    type: 'requests', param: null, code: 'rate_limit_exceeded',
  },
});
const OPENAI_RPD = JSON.stringify({ error: { message: 'Rate limit reached for gpt-4o-mini in organization org-x on requests per day (RPD): Limit 200, Used 200, Requested 1.', code: 'rate_limit_exceeded' } });
const GEMINI_DEPLETED = '{"error":{"code":402,"message":"Your prepayment credits are depleted. Please go to AI Studio at https://ai.studio/projects to manage your project and billing.","status":"RESOURCE_EXHAUSTED"}}';
const geminiQuota = (quotaId: string) =>
  JSON.stringify({
    error: {
      code: 429,
      message: 'You exceeded your current quota, please check your plan and billing details. For more information on this error, head to: https://ai.google.dev/gemini-api/docs/rate-limits.',
      status: 'RESOURCE_EXHAUSTED',
      details: [{ '@type': 'type.googleapis.com/google.rpc.QuotaFailure', violations: [{ quotaMetric: 'generativelanguage.googleapis.com/generate_content_free_tier_requests', quotaId }] }, { '@type': 'type.googleapis.com/google.rpc.RetryInfo', retryDelay: '39s' }],
    },
  });
const GEMINI_RPM = geminiQuota('GenerateRequestsPerMinutePerProjectPerModel-FreeTier');
const GEMINI_DAY = geminiQuota('GenerateRequestsPerDayPerProjectPerModel-FreeTier');
const GEMINI_BARE_429 = '{"error":{"code":429,"message":"You exceeded your current quota, please check your plan and billing details. For more information on this error, head to: https://ai.google.dev/gemini-api/docs/rate-limits.","status":"RESOURCE_EXHAUSTED"}}';

describe('isCreditExhausted — só conta como falta de saldo o que o corpo prova', () => {
  it('402 é sempre falta de saldo (Gemini pré-pago esgotado), com ou sem corpo', () => {
    expect(isCreditExhausted(402, GEMINI_DEPLETED)).toBe(true);
    expect(isCreditExhausted(402, '')).toBe(true);
  });

  it('OpenAI 429 insufficient_quota = sem saldo; 429 de limite por minuto (mesmo citando billing) NÃO', () => {
    expect(isCreditExhausted(429, OPENAI_NO_QUOTA)).toBe(true);
    expect(isCreditExhausted(429, OPENAI_RPM)).toBe(false);
  });

  it('Google 429 RESOURCE_EXHAUSTED: cota diária conta; limite por minuto e corpo sem detalhe não (na dúvida, não)', () => {
    expect(isCreditExhausted(429, GEMINI_DAY)).toBe(true);
    expect(isCreditExhausted(429, GEMINI_RPM)).toBe(false);
    expect(isCreditExhausted(429, GEMINI_BARE_429)).toBe(false);
    expect(isCreditExhausted(429, OPENAI_RPD)).toBe(true);
  });

  it('403/400 só com prova (billing desligado, crédito); corpo vazio ou genérico não é saldo', () => {
    expect(isCreditExhausted(403, '{"error":{"status":"PERMISSION_DENIED","details":[{"reason":"BILLING_DISABLED"}]}}')).toBe(true);
    expect(isCreditExhausted(400, '{"error":{"message":"Your credit balance is too low to access the API."}}')).toBe(true);
    expect(isCreditExhausted(429, 'x')).toBe(false);
    expect(isCreditExhausted(403, 'forbidden')).toBe(false);
    expect(isCreditExhausted(400, '{"error":{"message":"API key not valid."}}')).toBe(false);
  });

  it('outros status nunca são falta de saldo (nem com a palavra no corpo)', () => {
    for (const st of [401, 404, 409, 422, 500, 503]) expect(isCreditExhausted(st, OPENAI_NO_QUOTA)).toBe(false);
  });
});

describe('classifyVendorFailure', () => {
  it('casos por status e corpo', () => {
    expect(classifyVendorFailure(401, '')).toBe('refused');
    expect(classifyVendorFailure(403, 'forbidden')).toBe('refused');
    expect(classifyVendorFailure(402, '')).toBe('noCredit');
    expect(classifyVendorFailure(429, OPENAI_NO_QUOTA)).toBe('noCredit');
    expect(classifyVendorFailure(429, GEMINI_RPM)).toBe('rateLimited');
    expect(classifyVendorFailure(429, 'x')).toBe('rateLimited');
    expect(classifyVendorFailure(400, '{"error":{"details":[{"reason":"API_KEY_INVALID"}]}}')).toBe('refused');
    expect(classifyVendorFailure(404, 'model_not_found')).toBe('model');
    expect(classifyVendorFailure(400, 'models/gemini-x is not found')).toBe('model');
    expect(classifyVendorFailure(422, 'bad')).toBe('rejected');
    expect(classifyVendorFailure(500, 'x')).toBe('down');
  });

  it('a falta de saldo vence a regra de modelo (o corpo de saldo pode citar o modelo)', () => {
    expect(classifyVendorFailure(400, '{"error":{"message":"No credits left for model gpt-4o-mini"}}')).toBe('noCredit');
  });
});
