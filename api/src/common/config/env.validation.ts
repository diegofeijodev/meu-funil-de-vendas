import { z } from 'zod';

/** Variável vazia (`FOO=` ou `${FOO:-}` do compose) vale como ausente. */
const opt = () => z.string().optional();

const bool = (def: 'true' | 'false') =>
  z
    .enum(['true', 'false'])
    .default(def)
    .transform((v) => v === 'true');

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
    TRUST_PROXY: bool('false'),

    /** Arquivos em disco: UPLOADS_DIR/<bucket>/<chave>. */
    UPLOADS_DIR: z.string().default('./uploads'),
    /** Segredo das URLs assinadas; sem ele deriva de JWT_SECRET. */
    FILES_SIGNING_SECRET: opt(),

    /** Cofre (AES-256-GCM). Obrigatória em produção; em dev vale uma chave fixa de desenvolvimento. */
    CREDENTIALS_ENCRYPTION_KEY: opt(),

    /** Gateway de IA compatível com OpenAI (era o Lovable AI gateway). */
    AI_GATEWAY_URL: opt(),
    AI_GATEWAY_API_KEY: opt(),
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

    // --- Variáveis que tarefas posteriores leem (todas opcionais) ---
    CRM_CRON_SECRET: opt(),
    META_APP_ID: opt(),
    META_APP_SECRET: opt(),
    META_SYSTEM_USER_TOKEN: opt(),
    META_GRAPH_TOKEN: opt(),
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
  })
  .superRefine((env, ctx) => {
    if (env.NODE_ENV !== 'development' && env.NODE_ENV !== 'test' && !env.CREDENTIALS_ENCRYPTION_KEY) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['CREDENTIALS_ENCRYPTION_KEY'],
        message: 'obrigatória fora de NODE_ENV=development/test (cofre de credenciais); defina NODE_ENV explicitamente',
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
