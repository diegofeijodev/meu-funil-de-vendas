/**
 * Autenticação das rotas de cron (/api/public/cron/*).
 * Aceita CRM_CRON_SECRET do ambiente ou o token do banco em cron_tokens (usado pelo pg_cron).
 */
import { timingSafeEqual } from "crypto";

function safeEqual(a: string, b: string) {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

export async function isCronAuthorized(request: Request, tokenNames: string[]): Promise<boolean> {
  const provided = request.headers.get("x-cron-secret");
  if (!provided) return false;
  const envSecret = process.env["CRM_CRON_SECRET"];
  if (envSecret && safeEqual(provided, envSecret)) return true;
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data } = await supabaseAdmin.from("cron_tokens").select("token").in("name", tokenNames);
  return ((data ?? []) as { token: string }[]).some((r) => !!r.token && safeEqual(provided, r.token));
}
