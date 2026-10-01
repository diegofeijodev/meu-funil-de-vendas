/**
 * E-mail do CRM (somente servidor) pelo Resend, com o domínio da empresa.
 * Chave por empresa (RESEND_API_KEY em CRM → Integrações) ou global do servidor.
 * Todo e-mail leva link de descadastro assinado.
 */
import { createHmac } from "crypto";
import { addInteraction, admin, workspaceSecret, type Integration } from "./integrations.server";

const APP_URL = () => (process.env["PUBLIC_APP_URL"] || "https://www.meufunildevendas.com.br").replace(/\/$/, "");

async function unsubscribeSecret() {
  const db = await admin();
  const { data } = await db.from("cron_tokens").select("token").eq("name", "unsubscribe").maybeSingle();
  return (data?.token as string | undefined) ?? process.env["CRM_CRON_SECRET"] ?? "meu-funil-unsubscribe";
}

export async function unsubscribeLink(leadId: string) {
  const sig = createHmac("sha256", await unsubscribeSecret()).update(leadId).digest("hex").slice(0, 32);
  return `${APP_URL()}/api/public/unsubscribe/${leadId}?t=${sig}`;
}

export async function verifyUnsubscribe(leadId: string, token: string) {
  const sig = createHmac("sha256", await unsubscribeSecret()).update(leadId).digest("hex").slice(0, 32);
  return token === sig;
}

export async function emailIntegration(workspaceId: string) {
  const db = await admin();
  const { data } = await db
    .from("crm_integrations")
    .select("*")
    .eq("workspace_id", workspaceId)
    .eq("kind", "email")
    .maybeSingle();
  return (data as unknown as Integration | null) ?? null;
}

const escape = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** Envia um e-mail para o lead e registra na linha do tempo. */
export async function sendLeadEmail(args: {
  workspaceId: string;
  leadId: string;
  subject: string;
  body: string;
  authorType?: "user" | "ai" | "system";
}) {
  const db = await admin();
  const { data: lead } = await db.from("crm_leads").select("id, email, name, unsubscribed").eq("id", args.leadId).maybeSingle();
  if (!lead?.email) throw new Error("Lead sem e-mail.");
  if (lead.unsubscribed) throw new Error("Lead descadastrado: envios bloqueados.");
  const integration = await emailIntegration(args.workspaceId);
  if (!integration || integration.status !== "connected") throw new Error("E-mail não configurado em CRM → Integrações.");
  const cfg = (integration.config ?? {}) as { from_email?: string; from_name?: string; reply_to?: string };
  if (!cfg.from_email) throw new Error("Remetente de e-mail não configurado.");
  const key = await workspaceSecret(args.workspaceId, "RESEND_API_KEY");
  if (!key) throw new Error("Chave do Resend (RESEND_API_KEY) não configurada.");
  const unsub = await unsubscribeLink(lead.id as string);
  const html = `<div style="font-family:Arial,sans-serif;font-size:15px;line-height:1.5;color:#111">${escape(args.body).replace(/\n/g, "<br>")}</div>
<p style="font-size:12px;color:#888;margin-top:32px">Não quer mais receber? <a href="${unsub}">Descadastre-se</a>.</p>`;
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      from: cfg.from_name ? `${cfg.from_name} <${cfg.from_email}>` : cfg.from_email,
      to: [lead.email],
      subject: args.subject,
      html,
      text: `${args.body}\n\nDescadastrar: ${unsub}`,
      ...(cfg.reply_to ? { reply_to: cfg.reply_to } : {}),
      headers: { "List-Unsubscribe": `<${unsub}>` },
    }),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`Resend [${res.status}]: ${text.slice(0, 300)}`);
  const id = (JSON.parse(text || "{}") as { id?: string }).id ?? null;
  await addInteraction({
    workspaceId: args.workspaceId,
    leadId: lead.id as string,
    kind: "email_out",
    authorType: args.authorType ?? "system",
    content: `E-mail enviado: ${args.subject}\n\n${args.body}`,
    metadata: { resend_id: id },
  });
  return { id };
}

/** Teste: valida a chave no Resend (lista domínios). */
export async function testEmail(workspaceId: string) {
  const key = await workspaceSecret(workspaceId, "RESEND_API_KEY");
  if (!key) throw new Error("Chave do Resend (RESEND_API_KEY) não configurada.");
  const res = await fetch("https://api.resend.com/domains", { headers: { Authorization: `Bearer ${key}` } });
  if (!res.ok) throw new Error(`Resend recusou a chave (HTTP ${res.status}).`);
  const j = (await res.json()) as { data?: { name: string; status: string }[] };
  return (j.data ?? []).map((d) => ({ name: d.name, status: d.status }));
}
