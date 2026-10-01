import { createServerFn } from "@tanstack/react-start";
import type { SupabaseClient } from "@supabase/supabase-js";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { Database } from "@/integrations/supabase/types";

type Authed = SupabaseClient<Database>;

async function assertAdmin(supabase: Authed, workspaceId: string) {
  const { data } = await supabase.rpc("has_workspace_role", {
    _ws: workspaceId,
    _roles: ["owner", "admin"],
  });
  if (!data) throw new Error("Sem permissão para configurar o agente deste workspace.");
}

async function assertMember(supabase: Authed, workspaceId: string) {
  const { data } = await supabase.rpc("is_workspace_member", { _ws: workspaceId });
  if (!data) throw new Error("Workspace inválido.");
}

export type SdrAgentInput = {
  workspaceId: string;
  isActive: boolean;
  name: string;
  persona: string;
  tone: string;
  goal: string;
  knowledgeText: string;
  questions: { key: string; question: string; weight: number }[];
  minScore: number;
  schedulingLink: string | null;
  availableSlots: string[];
  businessHours: { timezone: string; days: number[]; start: string; end: string };
  offhoursMessage: string;
  maxMessages: number;
  handoffTriggers: string[];
  model?: string;
};

/** Modelos do gateway de IA do app oferecidos para o SDR (3.7). */
export const SDR_MODELS = ["openai/gpt-6-astra", "google/gemini-3.1-flash", "google/gemini-3.1-pro"] as const;

/** Loads the workspace agent, its documents and the latest execution logs. */
export const getSdrAgent = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { workspaceId: string }) => input)
  .handler(async ({ data, context }) => {
    await assertMember(context.supabase, data.workspaceId);
    const [agent, runs] = await Promise.all([
      context.supabase.from("crm_sdr_agents").select("*").eq("workspace_id", data.workspaceId).maybeSingle(),
      context.supabase
        .from("crm_sdr_runs")
        .select("id, mode, inbound_text, reply_text, score, handoff, status, error_message, model, input_tokens, output_tokens, duration_ms, created_at")
        .eq("workspace_id", data.workspaceId)
        .order("created_at", { ascending: false })
        .limit(25),
    ]);
    let documents: { id: string; file_name: string; size_bytes: number; created_at: string }[] = [];
    if (agent.data) {
      const { data: docs } = await context.supabase
        .from("crm_sdr_documents")
        .select("id, file_name, size_bytes, created_at")
        .eq("agent_id", agent.data.id)
        .order("created_at", { ascending: false });
      documents = docs ?? [];
    }
    return { agent: agent.data ?? null, documents, runs: runs.data ?? [] };
  });

/** Creates or updates the workspace agent configuration. */
export const saveSdrAgent = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: SdrAgentInput) => input)
  .handler(async ({ data, context }) => {
    await assertAdmin(context.supabase, data.workspaceId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: row, error } = await supabaseAdmin
      .from("crm_sdr_agents")
      .upsert(
        {
          workspace_id: data.workspaceId,
          is_active: data.isActive,
          name: data.name,
          persona: data.persona,
          tone: data.tone,
          goal: data.goal,
          knowledge_text: data.knowledgeText,
          questions: data.questions as never,
          min_score: data.minScore,
          scheduling_link: data.schedulingLink,
          available_slots: data.availableSlots as never,
          business_hours: data.businessHours as never,
          offhours_message: data.offhoursMessage,
          max_messages: data.maxMessages,
          handoff_triggers: data.handoffTriggers as never,
          ...(data.model && (SDR_MODELS as readonly string[]).includes(data.model) ? { model: data.model } : {}),
        },
        { onConflict: "workspace_id" },
      )
      .select("*")
      .single();
    if (error) {
      console.error("[sdr] falha ao salvar agente:", error);
      throw new Error("Não foi possível salvar o agente. Tente novamente.");
    }
    return row;
  });

/** Stores a knowledge file (PDF or text) with its extracted content. */
export const uploadSdrDocument = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { workspaceId: string; fileName: string; mimeType: string; contentBase64: string }) => input)
  .handler(async ({ data, context }) => {
    await assertAdmin(context.supabase, data.workspaceId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: agent } = await supabaseAdmin
      .from("crm_sdr_agents")
      .select("id")
      .eq("workspace_id", data.workspaceId)
      .maybeSingle();
    if (!agent) throw new Error("Salve a configuração do agente antes de enviar arquivos.");

    const binary = Uint8Array.from(atob(data.contentBase64), (c) => c.charCodeAt(0));
    if (binary.byteLength > 5 * 1024 * 1024) throw new Error("Arquivo muito grande (limite de 5 MB).");

    let text = "";
    try {
      if (data.mimeType === "application/pdf" || data.fileName.toLowerCase().endsWith(".pdf")) {
        const { extractText, getDocumentProxy } = await import("unpdf");
        const pdf = await getDocumentProxy(binary);
        const extracted = await extractText(pdf, { mergePages: true });
        text = String(extracted.text ?? "");
      } else {
        text = new TextDecoder().decode(binary);
      }
    } catch (err) {
      console.error("[sdr] falha ao ler arquivo:", err);
      throw new Error("Não foi possível ler este arquivo. Envie um PDF com texto ou um arquivo .txt.");
    }
    if (!text.trim()) throw new Error("O arquivo não contém texto legível.");

    const { error } = await supabaseAdmin.from("crm_sdr_documents").insert({
      workspace_id: data.workspaceId,
      agent_id: agent.id,
      file_name: data.fileName,
      mime_type: data.mimeType || "application/octet-stream",
      size_bytes: binary.byteLength,
      extracted_text: text.slice(0, 200000),
    });
    if (error) {
      console.error("[sdr] falha ao salvar arquivo:", error);
      throw new Error("Não foi possível salvar o arquivo.");
    }
    return { ok: true, characters: text.length };
  });

export const deleteSdrDocument = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { workspaceId: string; documentId: string }) => input)
  .handler(async ({ data, context }) => {
    await assertAdmin(context.supabase, data.workspaceId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    await supabaseAdmin
      .from("crm_sdr_documents")
      .delete()
      .eq("id", data.documentId)
      .eq("workspace_id", data.workspaceId);
    return { ok: true };
  });

/** Simulated conversation used before activating the agent. */
export const testSdrAgent = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { workspaceId: string; history: { role: "user" | "assistant"; content: string }[] }) => input)
  .handler(async ({ data, context }) => {
    await assertMember(context.supabase, data.workspaceId);
    const { simulateSdrAgent } = await import("@/lib/crm/sdr.server");
    try {
      const result = await simulateSdrAgent({ workspaceId: data.workspaceId, history: data.history });
      return {
        reply: result.decision.resposta,
        decision: result.decision,
        durationMs: result.durationMs,
        inputTokens: result.inputTokens,
        outputTokens: result.outputTokens,
      };
    } catch (err) {
      console.error("[sdr] teste falhou:", err);
      throw new Error("Não foi possível executar o agente agora. Tente novamente.");
    }
  });
