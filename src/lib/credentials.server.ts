/**
 * Cofre de credenciais (somente servidor): tabela app_credentials, legível só pelo service_role.
 * 7.2 Valores novos são criptografados com AES-GCM quando CREDENTIALS_ENCRYPTION_KEY existe
 * no servidor ("enc:v1:iv:dados"). Valores antigos em texto continuam sendo lidos normalmente.
 */
const PREFIX = "enc:v1:";
let keyPromise: Promise<CryptoKey | null> | null = null;

function b64(bytes: Uint8Array) {
  return Buffer.from(bytes).toString("base64");
}

async function key(): Promise<CryptoKey | null> {
  if (!keyPromise) {
    keyPromise = (async () => {
      const secret = process.env["CREDENTIALS_ENCRYPTION_KEY"];
      if (!secret) return null;
      const raw = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(secret));
      return crypto.subtle.importKey("raw", raw, { name: "AES-GCM" }, false, ["encrypt", "decrypt"]);
    })();
  }
  return keyPromise;
}

export async function encryptValue(value: string): Promise<string> {
  const k = await key();
  if (!k) return value;
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, k, new TextEncoder().encode(value)));
  return `${PREFIX}${b64(iv)}:${b64(ct)}`;
}

export async function decryptValue(value: string | null | undefined): Promise<string | null> {
  if (!value) return null;
  if (!value.startsWith(PREFIX)) return value.trim() || null;
  const k = await key();
  if (!k) {
    console.error("[cofre] valor criptografado, mas CREDENTIALS_ENCRYPTION_KEY não está configurada.");
    return null;
  }
  const [ivB64, ctB64] = value.slice(PREFIX.length).split(":");
  try {
    const pt = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: new Uint8Array(Buffer.from(ivB64 ?? "", "base64")) },
      k,
      new Uint8Array(Buffer.from(ctB64 ?? "", "base64")),
    );
    return new TextDecoder().decode(pt).trim() || null;
  } catch {
    console.error("[cofre] não foi possível descriptografar (chave trocada?).");
    return null;
  }
}

async function admin() {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return supabaseAdmin;
}

/** Lê uma credencial (workspaceId null = global do app). */
export async function readCredential(workspaceId: string | null, name: string): Promise<string | null> {
  const s = await admin();
  let q = s.from("app_credentials").select("value").eq("key", name);
  q = workspaceId ? q.eq("workspace_id", workspaceId) : q.is("workspace_id", null);
  const { data } = await q.maybeSingle();
  return decryptValue((data?.value as string | undefined) ?? null);
}

/** Grava várias credenciais de uma vez (criptografadas quando a chave do cofre existe). */
export async function writeCredentials(workspaceId: string | null, rows: Record<string, string>) {
  const s = await admin();
  const now = new Date().toISOString();
  const payload = await Promise.all(
    Object.entries(rows).map(async ([k, v]) => ({ workspace_id: workspaceId, key: k, value: await encryptValue(v), updated_at: now })),
  );
  const { error } = await s.from("app_credentials").upsert(payload as never, { onConflict: "workspace_id,key" });
  if (error) throw new Error(error.message);
}

export async function deleteCredential(workspaceId: string | null, name: string) {
  const s = await admin();
  let q = s.from("app_credentials").delete().eq("key", name);
  q = workspaceId ? q.eq("workspace_id", workspaceId) : q.is("workspace_id", null);
  const { error } = await q;
  if (error) throw new Error(error.message);
}
