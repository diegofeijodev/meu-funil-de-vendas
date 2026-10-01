/**
 * Canal Instagram do CRM (somente servidor): Direct e comentários viram lead,
 * entram na caixa de entrada e acionam o agente SDR. Envio pela Messenger Platform
 * (Instagram com login do Facebook), com o token da Página da empresa.
 */
import { stopCadences } from "./cadence.server";
import { addInteraction, admin, firstStage, isOptOut, pickOwner, startCadence, type Integration } from "./integrations.server";

const WINDOW_MS = 24 * 60 * 60 * 1000;
const convKey = (igsid: string) => `ig:${igsid}`;

export type InstagramConfig = {
  /** Palavra no comentário → DM automática (ex.: QUERO → link da oferta). */
  keywords?: { word: string; dm: string; publicReply?: string | null }[];
  /** Responder qualquer comentário com uma DM gerada pelo SDR. */
  aiReplyComments?: boolean;
};

async function pageToken(workspaceId: string) {
  const { graph, metaConfig, runWithMetaWorkspace } = await import("@/lib/meta/graph.server");
  return runWithMetaWorkspace(workspaceId, async () => {
    const cfg = await metaConfig(workspaceId);
    if (!cfg.pageId) throw new Error("Página do Facebook não configurada em Integrações.");
    const r = await graph<{ access_token?: string }>(`/${cfg.pageId}`, { params: { fields: "access_token" } });
    if (!r.access_token) throw new Error("Sem acesso à Página: dê ao usuário do sistema acesso total à Página.");
    return { pageId: cfg.pageId, token: r.access_token };
  });
}

async function igProfile(workspaceId: string, igsid: string) {
  try {
    const { graph, runWithMetaWorkspace } = await import("@/lib/meta/graph.server");
    const { token } = await pageToken(workspaceId);
    return await runWithMetaWorkspace(workspaceId, () =>
      graph<{ name?: string; username?: string }>(`/${igsid}`, { token, params: { fields: "name,username" } }),
    );
  } catch {
    return {} as { name?: string; username?: string };
  }
}

/** Envia DM (recipient = IGSID) ou resposta privada a um comentário (recipient = comment_id). */
export async function sendInstagramDm(
  workspaceId: string,
  recipient: { id: string } | { comment_id: string },
  text: string,
) {
  const { graph, runWithMetaWorkspace } = await import("@/lib/meta/graph.server");
  const { pageId, token } = await pageToken(workspaceId);
  const r = await runWithMetaWorkspace(workspaceId, () =>
    graph<{ message_id?: string }>(`/${pageId}/messages`, {
      method: "POST",
      token,
      params: { recipient, message: { text: text.slice(0, 1000) } },
    }),
  );
  return r.message_id ?? null;
}

async function replyToComment(workspaceId: string, commentId: string, text: string) {
  const { graph, runWithMetaWorkspace } = await import("@/lib/meta/graph.server");
  const { token } = await pageToken(workspaceId);
  await runWithMetaWorkspace(workspaceId, () =>
    graph(`/${commentId}/replies`, { method: "POST", token, params: { message: text.slice(0, 300) } }),
  );
}

async function findOrCreateLead(
  integration: Integration,
  igsid: string,
  username: string | null,
  source: "instagram_dm" | "instagram_comment",
) {
  const db = await admin();
  const { data: existing } = await db
    .from("crm_leads")
    .select("*")
    .eq("workspace_id", integration.workspace_id)
    .eq("instagram_id" as never, igsid)
    .maybeSingle();
  if (existing) return { lead: existing as Record<string, unknown>, created: false };
  const profile = username ? { username } : await igProfile(integration.workspace_id, igsid);
  const { pipelineId, stageId } = await firstStage(integration.workspace_id);
  const ownerId = await pickOwner(integration.workspace_id);
  const { data: created, error } = await db
    .from("crm_leads")
    .insert({
      workspace_id: integration.workspace_id,
      pipeline_id: pipelineId,
      stage_id: stageId,
      name: (profile as { name?: string }).name || (profile.username ? `@${profile.username}` : "Lead do Instagram"),
      source,
      owner_id: ownerId,
      instagram_id: igsid,
      instagram_username: profile.username ?? null,
    } as never)
    .select("*")
    .single();
  if (error) throw new Error(error.message);
  const lead = created as Record<string, unknown>;
  if (stageId) {
    await db.from("crm_stage_history").insert({
      workspace_id: integration.workspace_id,
      lead_id: lead["id"] as string,
      from_stage_id: null,
      to_stage_id: stageId,
    });
  }
  await startCadence(integration.workspace_id, lead["id"] as string, source);
  return { lead, created: true };
}

async function ensureIgConversation(workspaceId: string, igsid: string, leadId: string) {
  const db = await admin();
  const { data: existing } = await db
    .from("crm_conversations")
    .select("*")
    .eq("workspace_id", workspaceId)
    .eq("phone", convKey(igsid))
    .maybeSingle();
  if (existing) return existing as Record<string, unknown>;
  const { data, error } = await db
    .from("crm_conversations")
    .insert({ workspace_id: workspaceId, lead_id: leadId, phone: convKey(igsid), provider: "instagram" })
    .select("*")
    .single();
  if (error) throw new Error(error.message);
  return data as Record<string, unknown>;
}

/** Grava e envia uma DM (bloqueia lead descadastrado e fora da janela de 24 h). */
export async function sendInstagramAndStore(args: {
  workspaceId: string;
  leadId: string;
  text: string;
  sentBy?: string | null;
  authorType?: "user" | "ai" | "system";
}) {
  const db = await admin();
  const { data: lead } = await db
    .from("crm_leads")
    .select("id, unsubscribed, instagram_id" as never)
    .eq("id", args.leadId)
    .maybeSingle();
  const l = lead as { id: string; unsubscribed: boolean; instagram_id: string | null } | null;
  if (!l?.instagram_id) throw new Error("Este lead não tem conversa no Instagram.");
  if (l.unsubscribed) throw new Error("Lead descadastrado: envios bloqueados.");
  const conv = await ensureIgConversation(args.workspaceId, l.instagram_id, l.id);
  const expires = conv["window_expires_at"] ? new Date(conv["window_expires_at"] as string).getTime() : 0;
  if (expires <= Date.now()) throw new Error("Fora da janela de 24 horas do Instagram: espere o lead mandar mensagem.");
  const { data: row, error } = await db
    .from("crm_messages")
    .insert({
      workspace_id: args.workspaceId,
      conversation_id: conv["id"] as string,
      lead_id: l.id,
      direction: "out",
      message_type: "text",
      body: args.text,
      status: "queued",
      sent_by: args.sentBy ?? null,
      author_type: args.authorType ?? "user",
    })
    .select("id")
    .single();
  if (error) throw new Error(error.message);
  try {
    const externalId = await sendInstagramDm(args.workspaceId, { id: l.instagram_id }, args.text);
    await db.from("crm_messages").update({ status: "sent", external_id: externalId }).eq("id", row.id);
    await db
      .from("crm_conversations")
      .update({ last_message_at: new Date().toISOString(), last_message_preview: args.text.slice(0, 120) })
      .eq("id", conv["id"] as string);
    return { id: row.id as string, externalId };
  } catch (e) {
    const detail = e instanceof Error ? e.message : "erro";
    await db.from("crm_messages").update({ status: "failed", error_message: detail }).eq("id", row.id);
    throw new Error(`Não foi possível enviar no Instagram: ${detail}`);
  }
}

async function replyWithSdr(integration: Integration, leadId: string, conversationId: string, text: string) {
  if (!text.trim()) return;
  try {
    const { runSdrAgent } = await import("./sdr.server");
    const r = await runSdrAgent({ workspaceId: integration.workspace_id, leadId, conversationId, inboundText: text });
    const reply = ("reply" in r && r.reply) || null;
    if (reply) await sendInstagramAndStore({ workspaceId: integration.workspace_id, leadId, text: reply, authorType: "ai" });
  } catch (e) {
    console.error("[instagram-sdr] falha ao responder:", e);
  }
}

export type IgInbound =
  | { kind: "dm"; igsid: string; mid: string; text: string | null; attachmentUrl?: string | null; attachmentType?: string | null }
  | { kind: "comment"; igsid: string; username: string | null; commentId: string; text: string; mediaId: string | null };

export async function handleInstagramInbound(integration: Integration, msg: IgInbound) {
  const db = await admin();
  const source = msg.kind === "dm" ? "instagram_dm" : "instagram_comment";
  const { lead } = await findOrCreateLead(integration, msg.igsid, msg.kind === "comment" ? msg.username : null, source);
  const leadId = lead["id"] as string;

  if (msg.kind === "comment") {
    await addInteraction({
      workspaceId: integration.workspace_id,
      leadId,
      kind: "message_in",
      authorType: "contact",
      content: `Comentou no Instagram: "${msg.text}"`,
      metadata: { comment_id: msg.commentId, media_id: msg.mediaId },
    });
    if (lead["unsubscribed"]) return { leadId };
    const cfg = (integration.config ?? {}) as InstagramConfig;
    const norm = (s: string) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
    const rule = (cfg.keywords ?? []).find((k) => k.word && norm(msg.text).includes(norm(k.word)));
    let dm: string | null = rule?.dm ?? null;
    if (!dm && cfg.aiReplyComments && lead["ai_active"] !== false) {
      const { runSdrAgent } = await import("./sdr.server");
      const r = await runSdrAgent({
        workspaceId: integration.workspace_id,
        leadId,
        inboundText: `[Comentário público no post] ${msg.text}`,
      }).catch(() => null);
      dm = (r && "reply" in r && r.reply) || null;
    }
    if (dm) {
      // Resposta privada ao comentário abre a conversa no Direct.
      const externalId = await sendInstagramDm(integration.workspace_id, { comment_id: msg.commentId }, dm).catch((e) => {
        console.error("[instagram] resposta privada falhou:", e);
        return null;
      });
      const conv = await ensureIgConversation(integration.workspace_id, msg.igsid, leadId);
      await db.from("crm_messages").insert({
        workspace_id: integration.workspace_id,
        conversation_id: conv["id"] as string,
        lead_id: leadId,
        direction: "out",
        message_type: "text",
        body: dm,
        status: externalId ? "sent" : "failed",
        external_id: externalId,
        author_type: rule ? "system" : "ai",
      });
      if (rule?.publicReply) await replyToComment(integration.workspace_id, msg.commentId, rule.publicReply).catch(() => null);
    }
    return { leadId };
  }

  const conv = await ensureIgConversation(integration.workspace_id, msg.igsid, leadId);
  const type = msg.attachmentType === "image" ? "image" : msg.attachmentType === "audio" ? "audio" : msg.attachmentType === "video" ? "video" : msg.text ? "text" : "other";
  await db.from("crm_messages").insert({
    workspace_id: integration.workspace_id,
    conversation_id: conv["id"] as string,
    lead_id: leadId,
    direction: "in",
    message_type: type,
    body: msg.text,
    media_url: msg.attachmentUrl ?? null,
    status: "received",
    external_id: msg.mid,
    author_type: "system",
  });
  await db
    .from("crm_conversations")
    .update({
      lead_id: leadId,
      unread_count: ((conv["unread_count"] as number) ?? 0) + 1,
      last_message_at: new Date().toISOString(),
      last_message_preview: msg.text ?? "Mídia recebida",
      window_expires_at: new Date(Date.now() + WINDOW_MS).toISOString(),
    })
    .eq("id", conv["id"] as string);
  await addInteraction({
    workspaceId: integration.workspace_id,
    leadId,
    kind: "message_in",
    authorType: "contact",
    content: msg.text ?? `Mídia recebida no Direct (${type})`,
  });
  const patch: Record<string, unknown> = {};
  if (!lead["first_response_at"]) patch["first_response_at"] = new Date().toISOString();
  if (isOptOut(msg.text)) {
    patch["unsubscribed"] = true;
    patch["ai_active"] = false;
    await stopCadences(leadId, "opt_out");
  }
  patch["last_interaction_at"] = new Date().toISOString();
  await db.from("crm_leads").update(patch as never).eq("id", leadId);
  if (patch["unsubscribed"]) return { leadId };
  await stopCadences(leadId, "replied");
  let text = msg.text ?? "";
  if (!text && msg.attachmentUrl && (type === "audio" || type === "image")) {
    const { describeMedia } = await import("./media-understanding.server");
    text = (await describeMedia(integration.workspace_id, msg.attachmentUrl, type).catch(() => null)) ?? "";
  }
  await replyWithSdr(integration, leadId, conv["id"] as string, text);
  return { leadId };
}
