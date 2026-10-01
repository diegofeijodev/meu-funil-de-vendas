import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

type Ctx = { supabase: any; userId: string };

async function requireMember(ctx: Ctx, workspaceId: string, admin = false) {
  const { data } = await ctx.supabase
    .from("workspace_members")
    .select("role")
    .eq("workspace_id", workspaceId)
    .eq("user_id", ctx.userId)
    .maybeSingle();
  if (!data) throw new Error("Você não tem acesso a esta área de trabalho.");
  // 7.3 Conectar contas é ação sensível: só dono ou administrador.
  if (admin && data.role !== "owner" && data.role !== "admin") throw new Error("Só o dono ou um administrador altera as chaves de IA.");
}

const vendor = z.enum(["openai", "gemini"]);

/** Diz quais chaves próprias estão salvas (só os 4 últimos dígitos). */
export const aiKeysStatus = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ workspaceId: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    await requireMember(context as Ctx, data.workspaceId);
    const { getWorkspaceAiKey } = await import("./ai-keys.server");
    const [o, g] = await Promise.all([
      getWorkspaceAiKey(data.workspaceId, "openai"),
      getWorkspaceAiKey(data.workspaceId, "gemini"),
    ]);
    return {
      openai: o ? { connected: true, hint: `••••${o.slice(-4)}` } : { connected: false, hint: null },
      gemini: g ? { connected: true, hint: `••••${g.slice(-4)}` } : { connected: false, hint: null },
    };
  });

/** Testa e salva a chave. Só grava se o provedor aceitar. */
export const aiKeysSave = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z.object({ workspaceId: z.string().uuid(), vendor, apiKey: z.string().trim().min(20, "Chave muito curta.") }).parse(d),
  )
  .handler(async ({ data, context }) => {
    await requireMember(context as Ctx, data.workspaceId, true);
    const { testAiKey, setWorkspaceAiKey } = await import("./ai-keys.server");
    const t = await testAiKey(data.vendor, data.apiKey);
    if (!t.ok) return { ok: false, error: t.error ?? "Chave recusada." };
    await setWorkspaceAiKey(data.workspaceId, data.vendor, data.apiKey);
    return { ok: true, error: null as string | null };
  });

export const aiKeysTest = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ workspaceId: z.string().uuid(), vendor }).parse(d))
  .handler(async ({ data, context }) => {
    await requireMember(context as Ctx, data.workspaceId);
    const { getWorkspaceAiKey, testAiKey } = await import("./ai-keys.server");
    const k = await getWorkspaceAiKey(data.workspaceId, data.vendor);
    if (!k) return { ok: false, error: "Nenhuma chave salva." };
    return testAiKey(data.vendor, k);
  });

export const aiKeysRemove = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ workspaceId: z.string().uuid(), vendor }).parse(d))
  .handler(async ({ data, context }) => {
    await requireMember(context as Ctx, data.workspaceId, true);
    const { setWorkspaceAiKey } = await import("./ai-keys.server");
    await setWorkspaceAiKey(data.workspaceId, data.vendor, null);
    return { ok: true };
  });

/** Testa as chaves salvas e diz quais estão sem crédito/limite (aviso no Studio). */
export const aiKeysHealth = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ workspaceId: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    await requireMember(context as Ctx, data.workspaceId);
    const { getWorkspaceAiKey, testAiKey } = await import("./ai-keys.server");
    const out: { vendor: "openai" | "gemini"; error: string }[] = [];
    for (const v of ["openai", "gemini"] as const) {
      const k = await getWorkspaceAiKey(data.workspaceId, v);
      if (!k) continue;
      const t = await testAiKey(v, k);
      if (!t.ok && /saldo|cota|limite|cr[ée]dito|quota/i.test(t.error ?? "")) out.push({ vendor: v, error: t.error ?? "" });
    }
    return { outOfCredit: out };
  });
