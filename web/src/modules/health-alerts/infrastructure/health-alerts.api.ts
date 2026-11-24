import axios from "axios";
import { useQuery } from "@tanstack/react-query";
import { z } from "zod";
import { api } from "@/modules/shared/infrastructure/http";
import type { HealthAlerts } from "@/lib/health-alerts";

const vendor = z.enum(["openai", "gemini"]);
const schema = z.object({
  ai: z
    .object({
      level: z.enum(["stopped", "partial"]),
      vendors: z.array(z.object({ vendor, label: z.string(), reason: z.enum(["no_credit", "daily_limit"]).catch("no_credit"), since: z.string(), last_at: z.string() })),
      fallback: z.enum(["openai", "gemini", "app"]).nullable(),
      inherited_from: z.object({ id: z.string(), name: z.string() }).nullable(),
    })
    .nullable(),
  instagram: z
    .object({ failed_count: z.number(), last_error: z.string().nullable(), last_at: z.string(), permission: z.boolean() })
    .nullable(),
  // API antiga sem o campo = sem bloqueio.
  publishing: z
    .object({
      reason: z.enum(["permission", "token"]),
      since: z.string(),
      last_at: z.string(),
      message: z.string().nullable(),
      next_check_at: z.string().nullable(),
      waiting: z.object({ posts: z.number(), vacancies: z.number() }),
      probe: z.enum(["active", "log_only"]).catch("log_only"),
      username: z.string().nullable(),
    })
    .nullable()
    .optional()
    .transform((v) => v ?? null),
});

const NONE: HealthAlerts = { ai: null, instagram: null, publishing: null };

/** `GET /v1/workspaces/:id/health-alerts` (contrato §30). API antiga sem a rota (404) = sem aviso; o resto do erro sobe para a tela. */
export async function getHealthAlerts(ws: string): Promise<HealthAlerts> {
  try {
    const { data } = await api.get(`/v1/workspaces/${ws}/health-alerts`);
    return schema.parse(data);
  } catch (e) {
    if (axios.isAxiosError(e) && e.response?.status === 404) return NONE;
    throw e;
  }
}

export const healthAlertsKey = (ws: string | null | undefined) => ["health-alerts", ws] as const;

/** A faixa do topo: confere a cada 5 min e ao voltar para a aba; some sozinha quando o problema acaba. */
export function useHealthAlerts(ws: string | null | undefined) {
  return useQuery({
    queryKey: healthAlertsKey(ws),
    enabled: !!ws,
    queryFn: () => getHealthAlerts(ws!),
    refetchInterval: 5 * 60_000,
    refetchOnWindowFocus: true,
    staleTime: 60_000,
    retry: 1,
  });
}

const checkSchema = z.object({ ok: z.literal(true), unblocked: z.boolean(), probe: z.enum(["active", "log_only"]).catch("log_only"), message: z.string() });
export type PublishCheckResult = z.infer<typeof checkSchema>;

/** "Já corrigi — testar agora" (contrato §22.1): 409 em menos de 60 s e 422 com token sobem como erro (mensagem da API). */
export async function publishCheck(ws: string): Promise<PublishCheckResult> {
  const { data } = await api.post(`/v1/workspaces/${ws}/instagram-account/publish-check`);
  return checkSchema.parse(data);
}
