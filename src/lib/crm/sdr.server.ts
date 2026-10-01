/**
 * SDR agent: builds the prompt from the workspace configuration, calls Lovable AI
 * and applies the returned decision to the lead. Server-only.
 */
import { admin, addInteraction } from "./integrations.server";

export type SdrQuestion = { key: string; question: string; weight: number };

export type SdrAgent = {
  id: string;
  workspace_id: string;
  is_active: boolean;
  name: string;
  persona: string;
  tone: string;
  goal: string;
  knowledge_text: string;
  questions: SdrQuestion[];
  min_score: number;
  scheduling_link: string | null;
  available_slots: string[];
  business_hours: { timezone?: string; days?: number[]; start?: string; end?: string };
  offhours_message: string;
  max_messages: number;
  handoff_triggers: string[];
  model: string;
};

export type SdrDecision = {
  resposta: string;
  campos_extraidos: Record<string, string>;
  score: number;
  temperatura: "frio" | "morno" | "quente";
  proxima_etapa: string;
  transferir_humano: boolean;
  motivo: string;
};

const GATEWAY = "https://ai.gateway.lovable.dev/v1/responses";

const DECISION_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["resposta", "campos_extraidos", "score", "temperatura", "proxima_etapa", "transferir_humano", "motivo"],
  properties: {
    resposta: { type: "string", description: "Mensagem curta para o lead, uma pergunta por vez." },
    campos_extraidos: {
      type: "object",
      additionalProperties: false,
      required: ["cidade", "capital", "prazo", "decisor", "email", "observacoes"],
      properties: {
        cidade: { type: ["string", "null"] },
        capital: { type: ["string", "null"] },
        prazo: { type: ["string", "null"] },
        decisor: { type: ["string", "null"] },
        email: { type: ["string", "null"] },
        observacoes: { type: ["string", "null"] },
      },
    },
    score: { type: "integer" },
    temperatura: { type: "string", enum: ["frio", "morno", "quente"] },
    proxima_etapa: {
      type: "string",
      enum: ["contato_iniciado", "qualificado", "reuniao_agendada", "perdido", "manter"],
    },
    transferir_humano: { type: "boolean" },
    motivo: { type: "string" },
  },
} as const;

export async function loadAgent(workspaceId: string): Promise<SdrAgent | null> {
  const db = await admin();
  const { data } = await db.from("crm_sdr_agents").select("*").eq("workspace_id", workspaceId).maybeSingle();
  return (data as unknown as SdrAgent | null) ?? null;
}

async function knowledgeFor(agent: SdrAgent) {
  const db = await admin();
  const { data } = await db
    .from("crm_sdr_documents")
    .select("file_name, extracted_text")
    .eq("agent_id", agent.id)
    .limit(10);
  const docs = (data ?? [])
    .map((d) => `# ${d.file_name}\n${String(d.extracted_text ?? "").slice(0, 8000)}`)
    .join("\n\n");
  return [agent.knowledge_text, docs].filter(Boolean).join("\n\n");
}

/** True when "now" falls inside the configured business hours. */
export function withinBusinessHours(agent: SdrAgent, now = new Date()) {
  const hours = agent.business_hours ?? {};
  const timezone = hours.timezone || "America/Sao_Paulo";
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(now);
  const map = Object.fromEntries(parts.map((p) => [p.type, p.value]));
  const weekdays: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  const day = weekdays[map["weekday"] ?? "Mon"] ?? 1;
  const days = hours.days?.length ? hours.days : [1, 2, 3, 4, 5];
  if (!days.includes(day)) return false;
  const minutes = Number(map["hour"]) * 60 + Number(map["minute"]);
  const toMin = (value: string | undefined, fallback: number) => {
    const [h, m] = (value ?? "").split(":");
    const total = Number(h) * 60 + Number(m);
    return Number.isFinite(total) ? total : fallback;
  };
  return minutes >= toMin(hours.start, 540) && minutes < toMin(hours.end, 1080);
}

function buildSystemPrompt(agent: SdrAgent, knowledge: string, lead: Record<string, unknown> | null) {
  const questions = (agent.questions ?? [])
    .map((q) => `- ${q.question} (chave: ${q.key}, peso ${q.weight})`)
    .join("\n");
  const slots = (agent.available_slots ?? []).join(", ");
  return [
    `Voce e ${agent.name}, um SDR virtual. Persona: ${agent.persona || "consultor comercial experiente"}.`,
    `Tom de voz: ${agent.tone}.`,
    `Objetivo: ${agent.goal}`,
    "",
    "REGRAS OBRIGATORIAS:",
    "- Responda em portugues do Brasil, com mensagens curtas (ate 2 frases).",
    "- Faca no maximo UMA pergunta por mensagem.",
    "- Nunca invente informacao. Se nao souber ou nao estiver na base de conhecimento, defina transferir_humano = true.",
    `- Transfira para humano quando o assunto envolver: ${(agent.handoff_triggers ?? []).join(", ") || "negociacao de preco, reclamacao, assunto juridico, pedido de atendente"}.`,
    `- Calcule o score de 0 a 100 somando os pesos das perguntas ja respondidas de forma positiva. Nota minima para qualificar: ${agent.min_score}.`,
    `- Ao atingir a nota minima, defina proxima_etapa = "qualificado" e ofereca horario${agent.scheduling_link ? ` usando o link ${agent.scheduling_link}` : slots ? ` entre as opcoes: ${slots}` : ""}.`,
    '- Quando o lead confirmar um horario, defina proxima_etapa = "reuniao_agendada".',
    '- Se o lead nao tiver perfil (sem interesse, fora do publico), defina proxima_etapa = "perdido" e explique em motivo.',
    '- Use proxima_etapa = "manter" quando ainda estiver qualificando.',
    "",
    "PERGUNTAS DE QUALIFICACAO:",
    questions || "- Entenda a necessidade do lead.",
    "",
    "BASE DE CONHECIMENTO:",
    knowledge || "(sem base cadastrada — nao invente nada)",
    "",
    "DADOS DO LEAD:",
    JSON.stringify(
      {
        nome: lead?.["name"] ?? null,
        telefone: lead?.["phone"] ?? null,
        email: lead?.["email"] ?? null,
        cidade: lead?.["city"] ?? null,
        origem: lead?.["source"] ?? null,
        campanha: lead?.["campaign_name"] ?? null,
        score_atual: lead?.["score"] ?? 0,
      },
      null,
      0,
    ),
  ].join("\n");
}

type Turn = { role: "user" | "assistant"; content: string };

/** Calls Lovable AI and returns the decision plus usage metrics. */
async function askModel(agent: SdrAgent, system: string, history: Turn[]) {
  const apiKey = process.env["LOVABLE_API_KEY"];
  if (!apiKey) throw new Error("LOVABLE_API_KEY ausente no servidor.");

  const input = [
    { role: "system", content: [{ type: "input_text", text: system }] },
    ...history.map((turn) => ({
      role: turn.role,
      content: [{ type: turn.role === "assistant" ? "output_text" : "input_text", text: turn.content }],
    })),
  ];

  const started = Date.now();
  const response = await fetch(GATEWAY, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Lovable-API-Key": apiKey,
      "X-Lovable-AIG-SDK": "fetch",
    },
    body: JSON.stringify({
      model: agent.model || "openai/gpt-6-astra",
      input,
      stream: true,
      store: false,
      reasoning: { effort: "low" },
      text: {
        format: {
          type: "json_schema",
          name: "sdr_decision",
          strict: true,
          schema: DECISION_SCHEMA,
        },
      },
    }),
  });

  if (!response.ok || !response.body) {
    const detail = await response.text().catch(() => "");
    throw new Error(`Falha na IA [${response.status}]: ${detail.slice(0, 400)}`);
  }

  let text = "";
  let usage: { input_tokens?: number; output_tokens?: number } = {};
  const reader = response.body.pipeThrough(new TextDecoderStream()).getReader();
  let buffer = "";
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += value;
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    for (const line of lines) {
      if (!line.startsWith("data:")) continue;
      const payload = line.slice(5).trim();
      if (!payload || payload === "[DONE]") continue;
      try {
        const event = JSON.parse(payload) as Record<string, unknown>;
        if (event["type"] === "response.output_text.delta") text += String(event["delta"] ?? "");
        if (event["type"] === "response.completed") {
          const resp = event["response"] as Record<string, unknown> | undefined;
          if (resp?.["output_text"] && !text) text = String(resp["output_text"]);
          usage = (resp?.["usage"] as typeof usage) ?? usage;
        }
      } catch {
        /* evento parcial: ignora */
      }
    }
  }

  if (!text.trim()) throw new Error("A IA retornou uma resposta vazia.");
  const decision = JSON.parse(text) as SdrDecision;
  return {
    decision,
    durationMs: Date.now() - started,
    inputTokens: usage.input_tokens ?? null,
    outputTokens: usage.output_tokens ?? null,
  };
}

/** Finds the stage that matches a decision keyword. */
async function stageFor(workspaceId: string, pipelineId: string | null, key: string) {
  if (!pipelineId) return null;
  const db = await admin();
  const { data } = await db
    .from("crm_stages")
    .select("id, name, is_won, is_lost")
    .eq("workspace_id", workspaceId)
    .eq("pipeline_id", pipelineId);
  const stages = data ?? [];
  const norm = (s: string) => s.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  const wanted: Record<string, string[]> = {
    contato_iniciado: ["contato"],
    qualificado: ["qualificado"],
    reuniao_agendada: ["reuniao agendada", "agendada"],
    perdido: ["perdido"],
  };
  const terms = wanted[key];
  if (!terms) return null;
  if (key === "perdido") {
    const lost = stages.find((s) => s.is_lost);
    if (lost) return lost;
  }
  return stages.find((s) => terms.some((t) => norm(s.name).includes(t))) ?? null;
}

/** Runs the agent for one inbound message and applies the decision to the lead. */
export async function runSdrAgent(args: {
  workspaceId: string;
  leadId: string;
  conversationId?: string | null;
  inboundText: string;
}) {
  const db = await admin();
  const agent = await loadAgent(args.workspaceId);
  if (!agent || !agent.is_active) return { skipped: "agente inativo" };

  const { data: lead } = await db.from("crm_leads").select("*").eq("id", args.leadId).maybeSingle();
  if (!lead) return { skipped: "lead nao encontrado" };
  if (lead["unsubscribed"] || !lead["ai_active"]) return { skipped: "IA pausada para este lead" };

  const { count } = await db
    .from("crm_messages")
    .select("id", { count: "exact", head: true })
    .eq("lead_id", args.leadId);
  if ((count ?? 0) > agent.max_messages) {
    await db.from("crm_leads").update({ ai_active: false }).eq("id", args.leadId);
    await addInteraction({
      workspaceId: args.workspaceId,
      leadId: args.leadId,
      kind: "ai_action",
      authorType: "ai",
      content: "Limite de mensagens da conversa atingido. Transferido para atendimento humano.",
    });
    return { handoff: true, reason: "limite de mensagens" };
  }

  if (!withinBusinessHours(agent)) {
    // Mensagem de ausência só uma vez por período fora do horário (não a cada mensagem do lead).
    const { count: recentAway } = await db
      .from("crm_messages")
      .select("id", { count: "exact", head: true })
      .eq("lead_id", args.leadId)
      .eq("direction", "out")
      .eq("body", agent.offhours_message)
      .gte("created_at", new Date(Date.now() - 12 * 3600e3).toISOString());
    if ((recentAway ?? 0) > 0) return { offHours: true, reply: null };
    return { offHours: true, reply: agent.offhours_message };
  }

  const { data: history } = await db
    .from("crm_messages")
    .select("direction, body")
    .eq("lead_id", args.leadId)
    .order("created_at", { ascending: false })
    .limit(20);
  const turns: Turn[] = (history ?? [])
    .reverse()
    .filter((m) => !!m.body)
    .map((m) => ({ role: m.direction === "in" ? "user" : "assistant", content: String(m.body) }));
  if (!turns.length || turns[turns.length - 1]?.content !== args.inboundText) {
    turns.push({ role: "user", content: args.inboundText });
  }

  const knowledge = await knowledgeFor(agent);
  const system = buildSystemPrompt(agent, knowledge, lead);

  try {
    const result = await askModel(agent, system, turns);
    await applyDecision({ agent, lead, decision: result.decision });
    await db.from("crm_sdr_runs").insert({
      workspace_id: args.workspaceId,
      agent_id: agent.id,
      lead_id: args.leadId,
      conversation_id: args.conversationId ?? null,
      mode: "live",
      inbound_text: args.inboundText,
      reply_text: result.decision.resposta,
      decision: result.decision as never,
      score: result.decision.score,
      handoff: result.decision.transferir_humano,
      status: "ok",
      model: agent.model,
      input_tokens: result.inputTokens,
      output_tokens: result.outputTokens,
      duration_ms: result.durationMs,
    });
    return { reply: result.decision.resposta, decision: result.decision };
  } catch (err) {
    const detail = err instanceof Error ? err.message : "erro desconhecido";
    console.error("[sdr] execucao falhou:", detail);
    await db.from("crm_sdr_runs").insert({
      workspace_id: args.workspaceId,
      agent_id: agent.id,
      lead_id: args.leadId,
      conversation_id: args.conversationId ?? null,
      mode: "live",
      inbound_text: args.inboundText,
      status: "error",
      error_message: detail,
      model: agent.model,
    });
    return { error: "falha na execucao do agente" };
  }
}

/** Persists everything the decision implies: fields, score, stage, tasks, timeline. */
export async function applyDecision(args: {
  agent: SdrAgent;
  lead: Record<string, unknown>;
  decision: SdrDecision;
}) {
  const db = await admin();
  const { agent, lead, decision } = args;
  const leadId = lead["id"] as string;
  const workspaceId = agent.workspace_id;
  const fields = decision.campos_extraidos ?? {};

  const patch: Record<string, unknown> = {
    score: Math.max(0, Math.min(100, Math.round(decision.score ?? 0))),
    temperature: decision.temperatura,
    last_interaction_at: new Date().toISOString(),
  };
  if (fields["cidade"] && !lead["city"]) patch["city"] = fields["cidade"];
  if (fields["email"] && !lead["email"]) patch["email"] = fields["email"];

  let targetStage: { id: string; name: string } | null = null;
  const stageKey = decision.transferir_humano ? "manter" : decision.proxima_etapa;
  if (stageKey && stageKey !== "manter") {
    targetStage = await stageFor(workspaceId, (lead["pipeline_id"] as string) ?? null, stageKey);
  }
  if (targetStage && targetStage.id !== lead["stage_id"]) {
    patch["stage_id"] = targetStage.id;
    patch["stage_entered_at"] = new Date().toISOString();
  }
  if (decision.proxima_etapa === "perdido") {
    patch["loss_reason"] = decision.motivo || "Desqualificado pelo agente SDR";
    patch["ai_active"] = false;
  }
  if (decision.transferir_humano) patch["ai_active"] = false;

  await db.from("crm_leads").update(patch as never).eq("id", leadId);

  if (patch["stage_id"]) {
    await db.from("crm_stage_history").insert({
      workspace_id: workspaceId,
      lead_id: leadId,
      from_stage_id: (lead["stage_id"] as string) ?? null,
      to_stage_id: patch["stage_id"] as string,
    });
  }

  await addInteraction({
    workspaceId,
    leadId,
    kind: "ai_action",
    authorType: "ai",
    content: decision.resposta,
    metadata: {
      score: decision.score,
      temperatura: decision.temperatura,
      proxima_etapa: decision.proxima_etapa,
      transferir_humano: decision.transferir_humano,
      motivo: decision.motivo,
      campos_extraidos: fields,
    },
  });

  if (decision.proxima_etapa === "perdido" || decision.transferir_humano) {
    await db.from("crm_cadence_runs").update({ status: "stopped" }).eq("lead_id", leadId).eq("status", "running");
  }

  if (decision.transferir_humano) {
    await db.from("crm_tasks").insert({
      workspace_id: workspaceId,
      lead_id: leadId,
      assignee_id: (lead["owner_id"] as string) ?? null,
      title: `Assumir conversa: ${decision.motivo || "transferencia solicitada pelo agente"}`,
      due_at: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
      status: "open",
    });
    await addInteraction({
      workspaceId,
      leadId,
      kind: "ai_action",
      authorType: "system",
      content: `IA pausada e conversa transferida para humano. Motivo: ${decision.motivo || "nao informado"}.`,
    });
  }

  if (decision.proxima_etapa === "reuniao_agendada") {
    await db.from("crm_tasks").insert({
      workspace_id: workspaceId,
      lead_id: leadId,
      assignee_id: (lead["owner_id"] as string) ?? null,
      title: `Reuniao agendada com ${(lead["name"] as string) ?? "lead"}`,
      due_at: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
      status: "open",
    });
    await addInteraction({
      workspaceId,
      leadId,
      kind: "note",
      authorType: "system",
      content: "Reuniao agendada pelo agente SDR. Responsavel notificado por tarefa.",
    });
  }
}

/** Simulated run used by the "Testar agente" screen; nothing is persisted on leads. */
export async function simulateSdrAgent(args: {
  workspaceId: string;
  history: Turn[];
  lead?: Record<string, unknown> | null;
}) {
  const agent = await loadAgent(args.workspaceId);
  if (!agent) throw new Error("Configure o agente antes de testar.");
  const knowledge = await knowledgeFor(agent);
  const system = buildSystemPrompt(agent, knowledge, args.lead ?? { name: "Lead de teste" });
  const result = await askModel(agent, system, args.history);
  const db = await admin();
  await db.from("crm_sdr_runs").insert({
    workspace_id: args.workspaceId,
    agent_id: agent.id,
    mode: "test",
    inbound_text: args.history[args.history.length - 1]?.content ?? null,
    reply_text: result.decision.resposta,
    decision: result.decision as never,
    score: result.decision.score,
    handoff: result.decision.transferir_humano,
    status: "ok",
    model: agent.model,
    input_tokens: result.inputTokens,
    output_tokens: result.outputTokens,
    duration_ms: result.durationMs,
  });
  return result;
}
