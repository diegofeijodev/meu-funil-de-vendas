/**
 * Cliente da Graph API / Marketing API da Meta (somente servidor).
 * Todas as chamadas levam access_token + appsecret_proof. Credenciais vêm só dos Secrets.
 */
import { createHmac } from "crypto";
import { AsyncLocalStorage } from "node:async_hooks";

/** Empresa (workspace) atual das chamadas à Meta — definida por runWithMetaWorkspace. */
const wsStore = new AsyncLocalStorage<string | null>();
export function runWithMetaWorkspace<T>(workspaceId: string | null | undefined, fn: () => Promise<T>): Promise<T> {
  return wsStore.run(workspaceId ?? null, fn);
}

export const GRAPH_VERSION = "v24.0";
const BASE = `https://graph.facebook.com/${GRAPH_VERSION}`;

function env(name: string) {
  const v = process.env[name];
  return v && v.trim() ? v.trim() : null;
}

export type MetaConfig = {
  appId: string | null;
  appSecret: string | null;
  token: string | null;
  adAccountId: string | null;
  pageId: string | null;
  instagramId: string | null;
};

const KEYS = ["META_APP_ID", "META_APP_SECRET", "META_SYSTEM_USER_TOKEN", "META_AD_ACCOUNT_ID", "META_PAGE_ID", "META_INSTAGRAM_ACCOUNT_ID"] as const;

/** Lê as credenciais salvas pelo formulário de Integrações (tabela app_credentials, só service_role). */
async function vaultRead(workspaceId: string | null): Promise<Record<string, string>> {
  try {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    let q = supabaseAdmin.from("app_credentials").select("key, value, workspace_id").in("key", KEYS as unknown as string[]);
    q = workspaceId ? q.or(`workspace_id.is.null,workspace_id.eq.${workspaceId}`) : q.is("workspace_id", null);
    const { data } = await q;
    const out: Record<string, string> = {};
    // Globais primeiro; as da empresa sobrescrevem.
    const rows = ((data ?? []) as any[]).sort((a, b) => (a.workspace_id ? 1 : 0) - (b.workspace_id ? 1 : 0));
    const { decryptValue } = await import("@/lib/credentials.server");
    for (const row of rows) {
      const v = await decryptValue(row.value);
      if (v) out[row.key as string] = v;
    }
    return out;
  } catch {
    return {};
  }
}

/** Credenciais efetivas: cofre do banco primeiro, Secrets do ambiente como fallback. */
export async function metaConfig(workspaceId?: string | null): Promise<MetaConfig> {
  const vault = await vaultRead(workspaceId ?? wsStore.getStore() ?? null);
  const pick = (k: (typeof KEYS)[number]) => vault[k] ?? env(k);
  const rawAccount = pick("META_AD_ACCOUNT_ID");
  return {
    appId: pick("META_APP_ID"),
    appSecret: pick("META_APP_SECRET"),
    token: pick("META_SYSTEM_USER_TOKEN") ?? env("META_GRAPH_TOKEN"),
    adAccountId: rawAccount ? (rawAccount.startsWith("act_") ? rawAccount : `act_${rawAccount}`) : null,
    pageId: pick("META_PAGE_ID"),
    instagramId: pick("META_INSTAGRAM_ACCOUNT_ID"),
  };
}

export async function missingSecrets(workspaceId?: string | null) {
  const c = await metaConfig(workspaceId);
  const missing: string[] = [];
  if (!c.appId) missing.push("META_APP_ID");
  if (!c.appSecret) missing.push("META_APP_SECRET");
  if (!c.token) missing.push("META_SYSTEM_USER_TOKEN");
  if (!c.adAccountId) missing.push("META_AD_ACCOUNT_ID");
  if (!c.pageId) missing.push("META_PAGE_ID");
  return missing;
}

export class MetaError extends Error {
  code: number | undefined;
  subcode: number | undefined;
  constructor(message: string, code?: number, subcode?: number) {
    super(message);
    this.code = code;
    this.subcode = subcode;
  }
}

/** Traduz os erros mais comuns da Meta para português claro. */
function translate(err: { message?: string; code?: number; error_subcode?: number; error_user_msg?: string }) {
  const code = err.code;
  const base = err.error_user_msg || err.message || "erro desconhecido";
  if (code === 190) return "O token da Meta é inválido ou expirou. Gere um novo token do usuário do sistema e atualize no cofre.";
  if (code === 10 || code === 200 || (code && code >= 200 && code < 300))
    return `Permissão insuficiente na Meta. Confira se o usuário do sistema tem acesso à conta de anúncios/página e as permissões necessárias. (${base})`;
  if (code === 4 || code === 17 || code === 32 || code === 613)
    return "Limite de chamadas da Meta atingido. Aguarde alguns minutos e tente de novo.";
  if (code === 100) return `A Meta recusou um dos dados enviados: ${base}`;
  if (code === 2635) return "Versão da API da Meta não suportada. Atualize a versão configurada.";
  if (code === 1487390 || /payment/i.test(base)) return "A conta de anúncios está sem forma de pagamento válida.";
  return `A Meta respondeu com erro: ${base}`;
}

export async function graph<T = any>(
  path: string,
  opts: { method?: "GET" | "POST" | "DELETE"; params?: Record<string, unknown>; token?: string; workspaceId?: string | null } = {},
): Promise<T> {
  const cfg = await metaConfig(opts.workspaceId);
  const token = opts.token ?? cfg.token;
  if (!token) throw new MetaError("Token da Meta não configurado no cofre (META_SYSTEM_USER_TOKEN).");
  if (!cfg.appSecret) throw new MetaError("META_APP_SECRET não configurado no cofre.");
  const proof = createHmac("sha256", cfg.appSecret).update(token).digest("hex");

  const method = opts.method ?? "GET";
  const form = new URLSearchParams();
  form.set("access_token", token);
  form.set("appsecret_proof", proof);
  for (const [k, v] of Object.entries(opts.params ?? {})) {
    if (v === undefined || v === null) continue;
    form.set(k, typeof v === "string" ? v : JSON.stringify(v));
  }

  const url = `${BASE}${path.startsWith("/") ? path : `/${path}`}`;
  const res =
    method === "GET"
      ? await fetch(`${url}${url.includes("?") ? "&" : "?"}${form.toString()}`, { redirect: "follow" })
      : await fetch(url, {
          method,
          redirect: "follow",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: form.toString(),
        });
  const text = await res.text();
  let json: any = {};
  try {
    json = text ? JSON.parse(text) : {};
  } catch {
    json = { raw: text };
  }
  if (!res.ok || json.error) {
    const e = json.error ?? { message: `HTTP ${res.status}` };
    console.error("[meta-graph]", method, path, res.status, JSON.stringify(e));
    throw new MetaError(translate(e), e.code, e.error_subcode);
  }
  return json as T;
}
