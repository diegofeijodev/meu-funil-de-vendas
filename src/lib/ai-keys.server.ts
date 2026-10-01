/**
 * Chaves de IA próprias do cliente (OpenAI / Google Gemini), por área de trabalho.
 * Ficam na tabela app_credentials (só service_role lê). Nunca chegam ao navegador.
 */
export type AiVendor = "openai" | "gemini";

const slot = (vendor: AiVendor, workspaceId: string) =>
  `AI_${vendor.toUpperCase()}_KEY:${workspaceId}`;

export async function getWorkspaceAiKey(workspaceId: string, vendor: AiVendor): Promise<string | null> {
  const { readCredential } = await import("./credentials.server");
  const own = await readCredential(null, slot(vendor, workspaceId));
  if (own) return own;
  // 7.1 Conexões da agência: empresa configurada para herdar as IAs de outra empresa.
  const source = await inheritSource(workspaceId);
  return source ? readCredential(null, slot(vendor, source)) : null;
}

/** Empresa de onde esta herda as conexões de IA (1 nível). */
export async function inheritSource(workspaceId: string): Promise<string | null> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data } = await supabaseAdmin.from("workspaces").select("ai_inherit_from").eq("id", workspaceId).maybeSingle();
  const src = (data as { ai_inherit_from?: string | null } | null)?.ai_inherit_from ?? null;
  return src && src !== workspaceId ? src : null;
}

export async function setWorkspaceAiKey(workspaceId: string, vendor: AiVendor, value: string | null) {
  const { writeCredentials, deleteCredential } = await import("./credentials.server");
  if (!value) return deleteCredential(null, slot(vendor, workspaceId));
  await writeCredentials(null, { [slot(vendor, workspaceId)]: value });
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
