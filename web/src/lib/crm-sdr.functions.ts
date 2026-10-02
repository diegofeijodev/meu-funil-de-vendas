import { serverFnPost } from "@/lib/server-fn";

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

/** Modelos do gateway de IA do app oferecidos para o SDR. */
export const SDR_MODELS = ["openai/gpt-6-astra", "google/gemini-3.1-flash", "google/gemini-3.1-pro"] as const;

export type SdrAgentRow = {
  id: string; is_active: boolean; name: string; persona: string; tone: string; goal: string; knowledge_text: string;
  questions: { key: string; question: string; weight: number }[]; min_score: number; scheduling_link: string | null; available_slots: string[];
  business_hours: { timezone: string; days: number[]; start: string; end: string }; offhours_message: string; max_messages: number; handoff_triggers: string[]; model: string;
};
export type SdrRunRow = {
  id: string; mode: string; inbound_text: string | null; reply_text: string | null; score: number | null; handoff: boolean; status: string;
  error_message: string | null; model: string | null; input_tokens: number | null; output_tokens: number | null; duration_ms: number | null; created_at: string;
};

export const getSdrAgent = serverFnPost<
  { workspaceId: string },
  { agent: SdrAgentRow | null; documents: { id: string; file_name: string; size_bytes: number; created_at: string }[]; runs: SdrRunRow[] }
>("/v1/crm-sdr/get-sdr-agent");

export const saveSdrAgent = serverFnPost<SdrAgentInput, SdrAgentRow>("/v1/crm-sdr/save-sdr-agent");

export const uploadSdrDocument = serverFnPost<{ workspaceId: string; fileName: string; mimeType: string; contentBase64: string }, { ok: boolean; characters: number }>("/v1/crm-sdr/upload-sdr-document");

export const deleteSdrDocument = serverFnPost<{ workspaceId: string; documentId: string }, { ok: true }>("/v1/crm-sdr/delete-sdr-document");

export const testSdrAgent = serverFnPost<
  { workspaceId: string; history: { role: "user" | "assistant"; content: string }[] },
  { reply: string; decision: Record<string, unknown>; durationMs: number; inputTokens: number | null; outputTokens: number | null }
>("/v1/crm-sdr/test-sdr-agent");
