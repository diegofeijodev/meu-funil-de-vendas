import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

export const generateCopyWithAI = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        workspaceId: z.string().uuid(),
        engine: z.enum(["auto", "chatgpt", "gemini"]).default("auto"),
        brand: z.record(z.string(), z.unknown()),
        brief: z.record(z.string(), z.unknown()),
        seed: z.number().int().default(0),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    const { data: m } = await context.supabase
      .from("workspace_members")
      .select("role")
      .eq("workspace_id", data.workspaceId)
      .eq("user_id", context.userId)
      .maybeSingle();
    if (!m) throw new Error("Você não tem acesso a esta área de trabalho.");
    const { generateCopyAI } = await import("./copy-ai.server");
    return generateCopyAI(data.workspaceId, data.engine, data.brand, data.brief, data.seed);
  });
