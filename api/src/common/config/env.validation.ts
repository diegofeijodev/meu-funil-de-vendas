import { isIP } from 'node:net';
import { z } from 'zod';

/** Variável vazia (`FOO=` ou `${FOO:-}` do compose) vale como ausente. */
const opt = () => z.string().optional();

const bool = (def: 'true' | 'false') =>
  z
    .enum(['true', 'false'])
    .default(def)
    .transform((v) => v === 'true');

/**
 * `TRUST_PROXY` do Fastify: número de saltos de proxy confiáveis (`1` em produção), lista de IPs/CIDRs separados por vírgula
 * (`10.0.0.0/8,172.16.0.0/12`) ou os atalhos `true`/`false`. ATENÇÃO: `true` confia no X-Forwarded-For INTEIRO (o cliente
 * forja o primeiro item e burla qualquer limite por IP); em produção use o número de saltos.
 */
export function parseTrustProxy(raw: string | undefined): boolean | number | string[] {
  const v = (raw ?? '').trim();
  if (!v || v.toLowerCase() === 'false') return false;
  if (v.toLowerCase() === 'true') return true;
  if (/^\d+$/.test(v)) {
    const n = Number(v);
    return n === 0 ? false : n;
  }
  const list = v.split(',').map((x) => x.trim()).filter(Boolean);
  const ok = list.length > 0 && list.every((x) => /^[0-9a-fA-F:.]+(\/\d{1,3})?$/.test(x) && (isIP(x.split('/')[0]!) !== 0) && (!x.includes('/') || Number(x.split('/')[1]) <= (x.includes(':') ? 128 : 32)));
  if (!ok) throw new Error(`TRUST_PROXY inválido: "${v}". Use true, false, um número de saltos ou uma lista de IPs/CIDRs.`);
  return list;
}

/**
 * Valor para a opção `trustProxy` do Fastify. O Fastify 5 recente trata um NÚMERO como "não confiar em ninguém"
 * (fail-closed), então o número de saltos vira uma função `(addr, i) => i < saltos`: confia no vizinho direto e nos
 * saltos seguintes da cadeia, e o IP do cliente é o primeiro endereço fora dessa janela. Só é seguro se a API NÃO
 * for alcançável sem passar pelos proxies (um cliente direto poderia mandar o X-Forwarded-For que quisesse).
 */
export function toFastifyTrustProxy(v: boolean | number | string[]): boolean | string[] | ((addr: string, i: number) => boolean) {
  return typeof v === 'number' ? (_addr: string, i: number) => i < v : v;
}

const trustProxy = () =>
  z
    .string()
    .default('false')
    .transform((v, ctx) => {
      try {
        return parseTrustProxy(v);
      } catch (e) {
        ctx.addIssue({ code: 'custom', message: e instanceof Error ? e.message : 'TRUST_PROXY inválido' });
        return z.NEVER;
      }
    });

const envSchema = z
  .object({
    /** Sem default de propósito: só 'development'/'test' liberam a chave de dev do cofre e o Swagger. */
    NODE_ENV: z.enum(['development', 'test', 'production']).optional(),
    PORT: z.coerce.number().default(3015),
    DATABASE_URL: z.string().min(1),
    JWT_SECRET: z.string().min(16),
    /** Vida do access token (formato do `jsonwebtoken`: "1h", "15m"). */
    ACCESS_TOKEN_TTL: z.string().default('1h'),
    /** Vida do refresh token. */
    REFRESH_TOKEN_TTL: z.string().default('30d'),
    CORS_ORIGINS: z.string().default(''),
    /** URL pública da API (usada em links de arquivos e callback do OAuth). */
    PUBLIC_URL: z.string().default('http://localhost:3015'),
    /** URL do web (era https://www.meufunildevendas.com.br). Base de links de descadastro, SQL, Canva. */
    APP_URL: z.string().default('http://localhost:3025'),
    SWAGGER_ENABLED: opt(),
    TRUST_PROXY: trustProxy(),

    /** Arquivos em disco: UPLOADS_DIR/<bucket>/<chave>. */
    UPLOADS_DIR: z.string().default('./uploads'),
    /** Segredo das URLs assinadas; sem ele deriva de JWT_SECRET. */
    FILES_SIGNING_SECRET: opt(),

    /** Cofre (AES-256-GCM). Obrigatória em produção; em dev vale uma chave fixa de desenvolvimento. */
    CREDENTIALS_ENCRYPTION_KEY: opt(),

    /** Segredo do HMAC dos links de descadastro dos e-mails do CRM. Obrigatório fora de development/test (dev usa uma chave fixa). */
    UNSUBSCRIBE_SECRET: opt(),

    /** Gateway de IA compatível com OpenAI (era o Lovable AI gateway). */
    AI_GATEWAY_URL: opt(),
    AI_GATEWAY_API_KEY: opt(),
    /** Bases das chaves BYO (só para smoke/browser-check com um provedor falso; ignoradas em produção). */
    AI_OPENAI_BASE_URL: opt(),
    AI_GEMINI_BASE_URL: opt(),
    /** Mapa dos ids de modelo do protótipo para modelos reais. */
    AI_MODEL_TEXT: z.string().default('gpt-4o'),
    AI_MODEL_TEXT_FAST: z.string().default('gpt-4o-mini'),
    AI_MODEL_IMAGE_OPENAI: z.string().default('gpt-image-1'),
    AI_MODEL_IMAGE_GEMINI: z.string().default('gemini-2.5-flash-image'),
    AI_MODEL_VIDEO: z.string().default('veo-3.0-fast-generate-preview'),
    AI_MODEL_GEMINI_FLASH: z.string().default('gemini-2.5-flash'),
    AI_MODEL_GEMINI_PRO: z.string().default('gemini-2.5-pro'),
    /** Modelos usados com as chaves BYO (OpenAI/Gemini direto). */
    AI_BYO_OPENAI_TEXT_MODEL: z.string().default('gpt-4o-mini'),
    AI_BYO_GEMINI_TEXT_MODEL: z.string().default('gemini-flash-latest'),

    /** Login com Google (opcional): sem eles /v1/auth/google responde 503 GOOGLE_NOT_CONFIGURED. */
    GOOGLE_CLIENT_ID: opt(),
    GOOGLE_CLIENT_SECRET: opt(),

    /** Agendador (substitui pg_cron + pg_net). Ligue em UMA instância só. */
    SCHEDULER_ENABLED: bool('false'),
    /** Horas até a limpeza apagar os arquivos de `exports/<workspace>/` (o link de download vale 10 min). */
    EXPORTS_TTL_HOURS: z.coerce.number().positive().default(24),

    // --- Variáveis que tarefas posteriores leem (todas opcionais) ---
    CRM_CRON_SECRET: opt(),
    META_APP_ID: opt(),
    META_APP_SECRET: opt(),
    META_SYSTEM_USER_TOKEN: opt(),
    META_GRAPH_TOKEN: opt(),
    /** Só testes (smoke/browser-check): Graph falsa. Ignorada em NODE_ENV=production. */
    META_GRAPH_BASE_URL: opt(),
    META_AD_ACCOUNT_ID: opt(),
    META_PAGE_ID: opt(),
    META_INSTAGRAM_ACCOUNT_ID: opt(),
    GOOGLE_ADS_API_VERSION: z.string().default('v21'),
    GOOGLE_ADS_CLIENT_ID: opt(),
    GOOGLE_ADS_CLIENT_SECRET: opt(),
    GOOGLE_ADS_DEVELOPER_TOKEN: opt(),
    TIKTOK_APP_ID: opt(),
    TIKTOK_APP_SECRET: opt(),
    WHATSAPP_CLOUD_TOKEN: opt(),
    ZAPI_TOKEN: opt(),
    EVOLUTION_API_KEY: opt(),
    RESEND_API_KEY: opt(),
    CALCOM_API_KEY: opt(),
    /** Só testes (smoke/browser-check): Resend e Cal.com falsos. Ignoradas em NODE_ENV=production. */
    RESEND_API_URL: opt(),
    CALCOM_API_URL: opt(),
  })
  .superRefine((env, ctx) => {
    if (env.NODE_ENV !== 'development' && env.NODE_ENV !== 'test' && !env.CREDENTIALS_ENCRYPTION_KEY) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['CREDENTIALS_ENCRYPTION_KEY'],
        message: 'obrigatória fora de NODE_ENV=development/test (cofre de credenciais); defina NODE_ENV explicitamente',
      });
    }
    if (env.NODE_ENV !== 'development' && env.NODE_ENV !== 'test' && !env.UNSUBSCRIBE_SECRET) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['UNSUBSCRIBE_SECRET'],
        message: 'obrigatória fora de NODE_ENV=development/test (HMAC dos links de descadastro)',
      });
    }
  });

export type Env = z.infer<typeof envSchema>;

export function validateEnv(config: Record<string, unknown>): Env {
  const clean: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(config)) if (v !== '' && v !== undefined) clean[k] = v;
  const parsed = envSchema.safeParse(clean);
  if (!parsed.success) {
    throw new Error(`Configuração de ambiente inválida: ${parsed.error.message}`);
  }
  return parsed.data;
}
