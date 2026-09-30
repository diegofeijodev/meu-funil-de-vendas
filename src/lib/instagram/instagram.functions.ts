import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

const ws = z.string().uuid();
const engine = z.enum(["auto", "chatgpt", "gemini"]).default("auto");
const provider = z.enum(["auto", "higgsfield", "chatgpt", "gemini"]).default("auto");

async function requireMember(
  ctx: { supabase: any; userId: string },
  workspaceId: string,
  roles?: string[],
) {
  const { data } = await ctx.supabase
    .from("workspace_members")
    .select("role")
    .eq("workspace_id", workspaceId)
    .eq("user_id", ctx.userId)
    .maybeSingle();
  if (!data) throw new Error("Você não tem acesso a esta área de trabalho.");
  if (roles && !roles.includes(data.role)) throw new Error("Seu papel não permite esta ação.");
}

/** Confere pelo RLS do usuário que o post pertence à área de trabalho. */
async function requirePost(ctx: { supabase: any }, workspaceId: string, postId: string) {
  const { data } = await ctx.supabase
    .from("ig_posts")
    .select("id")
    .eq("id", postId)
    .eq("workspace_id", workspaceId)
    .maybeSingle();
  if (!data) throw new Error("Post não encontrado.");
}

const lib = () => import("./instagram.server");

export const connectInstagramAccount = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z.object({ workspaceId: ws, pageId: z.string().max(64).optional() }).parse(d),
  )
  .handler(async ({ data, context }) => {
    await requireMember(context, data.workspaceId, ["owner", "admin"]);
    return (await lib()).connectInstagramAccount(data.workspaceId, data.pageId);
  });

export const listInstagramOptions = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ workspaceId: ws }).parse(d))
  .handler(async ({ data, context }) => {
    await requireMember(context, data.workspaceId, ["owner", "admin"]);
    return (await lib()).listInstagramOptions(data.workspaceId);
  });

export const syncInstagramHistory = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ workspaceId: ws }).parse(d))
  .handler(async ({ data, context }) => {
    await requireMember(context, data.workspaceId, ["owner", "admin", "marketing"]);
    return (await lib()).syncInstagramHistory(data.workspaceId);
  });

export const disconnectInstagramAccount = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ workspaceId: ws }).parse(d))
  .handler(async ({ data, context }) => {
    await requireMember(context, data.workspaceId, ["owner", "admin"]);
    return (await lib()).disconnectInstagramAccount(data.workspaceId);
  });

export const generateContentCalendar = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        workspaceId: ws,
        planId: z.string().uuid(),
        weeks: z.number().int().min(1).max(8).default(1),
        engine,
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    await requireMember(context, data.workspaceId);
    return (await lib()).generateContentCalendar(
      data.workspaceId,
      data.planId,
      data.weeks,
      data.engine,
    );
  });

export const generatePostAssets = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({ workspaceId: ws, postId: z.string().uuid(), provider, adjust: z.string().max(300).optional() })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    await requireMember(context, data.workspaceId);
    await requirePost(context, data.workspaceId, data.postId);
    return (await lib()).generatePostAssets(data.workspaceId, data.postId, data.provider, data.adjust || undefined);
  });

export const regenerateCaption = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        workspaceId: ws,
        postId: z.string().uuid(),
        instructions: z.string().max(1000).optional(),
        engine,
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    await requireMember(context, data.workspaceId);
    await requirePost(context, data.workspaceId, data.postId);
    return (await lib()).regenerateCaption(
      data.workspaceId,
      data.postId,
      data.instructions,
      data.engine,
    );
  });

export const regenerateMedia = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        workspaceId: ws,
        postId: z.string().uuid(),
        instructions: z.string().max(1000).optional(),
        provider,
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    await requireMember(context, data.workspaceId);
    await requirePost(context, data.workspaceId, data.postId);
    return (await lib()).generatePostAssets(
      data.workspaceId,
      data.postId,
      data.provider,
      data.instructions,
    );
  });

export const approvePost = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ workspaceId: ws, postId: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    await requireMember(context, data.workspaceId, ["owner", "admin", "marketing"]);
    await requirePost(context, data.workspaceId, data.postId);
    return (await lib()).approvePost(data.workspaceId, data.postId);
  });

export const rejectPost = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({ workspaceId: ws, postId: z.string().uuid(), reason: z.string().min(1).max(1000) })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    await requireMember(context, data.workspaceId, ["owner", "admin", "marketing"]);
    await requirePost(context, data.workspaceId, data.postId);
    return (await lib()).rejectPost(data.workspaceId, data.postId, data.reason);
  });

export const schedulePost = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        workspaceId: ws,
        postId: z.string().uuid(),
        scheduledAt: z.string().datetime({ offset: true }),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    await requireMember(context, data.workspaceId);
    await requirePost(context, data.workspaceId, data.postId);
    return (await lib()).schedulePost(data.workspaceId, data.postId, data.scheduledAt);
  });

export const publishInstagramPost = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ workspaceId: ws, postId: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    await requireMember(context, data.workspaceId, ["owner", "admin", "marketing"]);
    await requirePost(context, data.workspaceId, data.postId);
    const { publishInstagramPost: run } = await lib();
    try {
      return await run(data.postId);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "erro desconhecido";
      const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
      await supabaseAdmin
        .from("ig_posts")
        .update({ status: "failed", last_error: msg })
        .eq("id", data.postId);
      return { ok: false, sandbox: false, error: msg };
    }
  });

export const collectPostMetrics = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ workspaceId: ws, postId: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    await requireMember(context, data.workspaceId);
    await requirePost(context, data.workspaceId, data.postId);
    return (await lib()).collectPostMetrics(data.postId);
  });

export const suggestPillars = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        workspaceId: ws,
        brandId: z.string().uuid().nullable().optional(),
        objective: z.string().max(500).optional(),
        tone: z.string().max(500).optional(),
        audience: z.string().max(500).optional(),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    await requireMember(context, data.workspaceId);
    return (await lib()).suggestPillars(data.workspaceId, data);
  });

export const uploadPostMedia = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => {
    if (!(d instanceof FormData)) throw new Error("Envio inválido.");
    const file = d.get("file");
    if (!(file instanceof File)) throw new Error("Arquivo ausente.");
    return {
      workspaceId: ws.parse(d.get("workspaceId")),
      postId: z.string().uuid().parse(d.get("postId")),
      file,
    };
  })
  .handler(async ({ data, context }) => {
    await requireMember(context, data.workspaceId);
    await requirePost(context, data.workspaceId, data.postId);
    return (await lib()).uploadOwnMedia(data.workspaceId, data.postId, data.file);
  });
