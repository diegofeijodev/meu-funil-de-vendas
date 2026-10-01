import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";
import { requireRole } from "@/lib/membership";

type Check = { name: string; ok: boolean | null; detail: string };

/**
 * 4.5 Diagnóstico das IAs da empresa: confere chaves, modelos e conexões de verdade.
 * withImage = também gera 1 imagem de teste com os créditos do app (consome crédito).
 */
export const diagnoseAi = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ workspaceId: z.string().uuid(), withImage: z.boolean().default(false) }).parse(d))
  .handler(async ({ data, context }) => {
    await requireRole(context, data.workspaceId);
    const checks: Check[] = [];
    const msg = (e: unknown) => (e instanceof Error ? e.message : String(e)).slice(0, 300);

    // IA do app (texto) — usada pelo estrategista, copy, diretor de arte e SDR.
    if (!process.env["LOVABLE_API_KEY"]) checks.push({ name: "IA do app (texto)", ok: false, detail: "LOVABLE_API_KEY não configurada no servidor." });
    else {
      try {
        const { viaGateway } = await import("./copy-ai.server");
        const r = (await viaGateway("Responda exatamente com o JSON {\"ok\": true}.", {
          type: "object",
          additionalProperties: false,
          required: ["ok"],
          properties: { ok: { type: "boolean" } },
        }, "ping")) as { ok?: boolean };
        checks.push({ name: "IA do app (texto · openai/gpt-6-astra)", ok: r.ok === true, detail: r.ok ? "Respondendo." : "Resposta inesperada." });
      } catch (e) {
        checks.push({ name: "IA do app (texto · openai/gpt-6-astra)", ok: false, detail: msg(e) });
      }
    }

    const { getWorkspaceAiKey } = await import("./ai-keys.server");
    const [openai, gemini] = await Promise.all([getWorkspaceAiKey(data.workspaceId, "openai"), getWorkspaceAiKey(data.workspaceId, "gemini")]);

    if (!openai) checks.push({ name: "Chave OpenAI", ok: null, detail: "Não conectada (opcional)." });
    else {
      try {
        const r = await fetch("https://api.openai.com/v1/models", { headers: { Authorization: `Bearer ${openai}` } });
        if (!r.ok) throw new Error(`OpenAI respondeu ${r.status}: ${(await r.text()).slice(0, 150)}`);
        const ids = new Set(((await r.json()) as { data?: { id: string }[] }).data?.map((m) => m.id) ?? []);
        const need = ["gpt-image-1", "gpt-4o-mini", "whisper-1"];
        const missing = need.filter((m) => !ids.has(m));
        checks.push({
          name: "Chave OpenAI",
          ok: missing.length === 0,
          detail: missing.length ? `Válida, mas sem acesso a: ${missing.join(", ")} (gpt-image-1 exige organização verificada).` : "Válida, com gpt-image-1, gpt-4o-mini e whisper-1.",
        });
      } catch (e) {
        checks.push({ name: "Chave OpenAI", ok: false, detail: msg(e) });
      }
    }

    if (!gemini) checks.push({ name: "Chave Gemini", ok: null, detail: "Não conectada (opcional)." });
    else {
      try {
        const r = await fetch("https://generativelanguage.googleapis.com/v1beta/models?pageSize=1000", { headers: { "x-goog-api-key": gemini } });
        if (!r.ok) throw new Error(`Gemini respondeu ${r.status}: ${(await r.text()).slice(0, 150)}`);
        const names = ((await r.json()) as { models?: { name: string }[] }).models?.map((m) => m.name.replace("models/", "")) ?? [];
        const has = (p: string) => names.some((n) => n.startsWith(p));
        const want: [string, string][] = [
          ["gemini-3.1-flash-image", "imagem"],
          ["veo-3.1-fast-generate-preview", "vídeo Veo 3.1"],
          ["veo-3.0-fast-generate-preview", "vídeo Veo 3.0"],
          ["gemini-flash-latest", "texto/visão/áudio"],
        ];
        const missing = want.filter(([m]) => !has(m)).map(([m, d]) => `${m} (${d})`);
        checks.push({
          name: "Chave Gemini",
          ok: missing.length < want.length,
          detail: missing.length ? `Válida. Indisponíveis nesta chave: ${missing.join(", ")}.` : "Válida, com imagem, vídeo Veo e texto.",
        });
      } catch (e) {
        checks.push({ name: "Chave Gemini", ok: false, detail: msg(e) });
      }
    }

    try {
      const { canvaStatus, testCanva } = await import("./creative/canva.server");
      const cs = await canvaStatus(data.workspaceId);
      if (!cs.connected) checks.push({ name: "Canva", ok: null, detail: "Não conectado (opcional)." });
      else {
        await testCanva(data.workspaceId);
        checks.push({ name: "Canva", ok: true, detail: `Conectado${cs.name ? ` como ${cs.name}` : ""}.` });
      }
    } catch (e) {
      checks.push({ name: "Canva", ok: false, detail: msg(e) });
    }
    const { getLiveConnection } = await import("./mcp-auth.server");
    for (const [provider, label, tools] of [
      ["higgsfield", "Higgsfield", ["generate_image", "generate_video", "job_status"]],
    ] as const) {
      const c = await getLiveConnection(context.supabase, data.workspaceId, provider).catch(() => null);
      if (!c) {
        checks.push({ name: label, ok: null, detail: "Não conectado (opcional)." });
        continue;
      }
      const names = ((c.tools ?? []) as { name: string }[]).map((t) => t.name);
      const missing = tools.filter((t) => !names.includes(t));
      checks.push({
        name: label,
        ok: c.status === "connected" && missing.length === 0,
        detail: c.status !== "connected" ? `Status: ${c.status}. Reconecte em Integrações.` : missing.length ? `Conectado, mas sem as ferramentas: ${missing.join(", ")}.` : `Conectado (${names.length} ferramentas).`,
      });
    }

    if (data.withImage) {
      try {
        const { createGeminiProvider } = await import("./providers/lovable-ai.server");
        const r = await createGeminiProvider(null).generateImage({ finalPrompt: "A simple red apple on a white table, studio photo.", aspectRatio: "1:1", kind: "image" });
        checks.push({ name: "Imagem com créditos do app (google/gemini-3.1-flash-image)", ok: !!r.assetUrl, detail: r.assetUrl ? "Imagem gerada." : "Sem imagem." });
      } catch (e) {
        checks.push({ name: "Imagem com créditos do app (google/gemini-3.1-flash-image)", ok: false, detail: msg(e) });
      }
    }
    return { checks, at: new Date().toISOString() };
  });
