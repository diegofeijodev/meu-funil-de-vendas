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

/** 8.4 Registra que o agendador rodou (aparece no painel "o que falta configurar"). */
export async function heartbeat(name: string, status: "ok" | "error" = "ok", detail: string | null = null) {
  try {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    await supabaseAdmin
      .from("cron_heartbeats")
      .upsert({ name, last_run_at: new Date().toISOString(), last_status: status, last_detail: detail?.slice(0, 300) ?? null });
  } catch {
    /* o painel é informativo: nunca derruba o agendador */
  }
}
