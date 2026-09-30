/**
 * Chaves de IA próprias do cliente (OpenAI / Google Gemini), por área de trabalho.
 * Ficam na tabela app_credentials (só service_role lê). Nunca chegam ao navegador.
 */
export type AiVendor = "openai" | "gemini";

const slot = (vendor: AiVendor, workspaceId: string) =>
  `AI_${vendor.toUpperCase()}_KEY:${workspaceId}`;

export async function getWorkspaceAiKey(workspaceId: string, vendor: AiVendor): Promise<string | null> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data } = await supabaseAdmin
    .from("app_credentials")
    .select("value")
    .eq("key", slot(vendor, workspaceId))
    .is("workspace_id" as never, null)
    .maybeSingle();
  return data?.value?.trim() || null;
}

export async function setWorkspaceAiKey(workspaceId: string, vendor: AiVendor, value: string | null) {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  if (!value) {
    const { error } = await supabaseAdmin.from("app_credentials").delete().eq("key", slot(vendor, workspaceId)).is("workspace_id" as never, null);
    if (error) throw new Error(error.message);
    return;
  }
  const { error } = await supabaseAdmin
    .from("app_credentials")
    .upsert(
      { key: slot(vendor, workspaceId), value, updated_at: new Date().toISOString() } as never,
      { onConflict: "workspace_id,key" },
    );
  if (error) throw new Error(error.message);
}

export async function testAiKey(vendor: AiVendor, key: string): Promise<{ ok: boolean; error?: string }> {
  try {
    const res =
      vendor === "openai"
        ? await fetch("https://api.openai.com/v1/models", { headers: { Authorization: `Bearer ${key}` } })
        : await fetch("https://generativelanguage.googleapis.com/v1beta/models?pageSize=1", {
            headers: { "x-goog-api-key": key },
          });
    if (res.ok) return { ok: true };
    if (res.status === 401 || res.status === 403 || res.status === 400)
      return { ok: false, error: "Chave inválida ou sem permissão." };
    if (res.status === 429) return { ok: false, error: "Conta sem saldo/cota ou limite atingido." };
    return { ok: false, error: `O provedor respondeu ${res.status}.` };
  } catch {
    return { ok: false, error: "Não foi possível falar com o provedor agora." };
  }
}

/** Traduz erros das APIs diretas para mensagens claras. */
export async function vendorError(vendor: AiVendor, res: Response) {
  const body = await res.text().catch(() => "");
  const name = vendor === "openai" ? "OpenAI" : "Google Gemini";
  if (res.status === 401 || res.status === 403) return new Error(`Chave da ${name} inválida ou sem permissão.`);
  if (res.status === 429) return new Error(`Sua conta ${name} está sem créditos ou atingiu o limite.`);
  return new Error(`${name} respondeu ${res.status}: ${body.slice(0, 300)}`);
}
