/**
 * Mídia recebida no CRM (somente servidor): baixa, guarda no armazenamento do app
 * e transforma em texto para o SDR — transcrição de áudio e descrição de imagem.
 * Áudio: chave Gemini ou OpenAI da empresa. Imagem: chave Gemini ou IA do app.
 */
import { getWorkspaceAiKey } from "@/lib/ai-keys.server";

const BUCKET = "creative-assets";

export async function fetchBytes(url: string, headers: Record<string, string> = {}) {
  const res = await fetch(url, { headers, redirect: "follow" });
  if (!res.ok) throw new Error(`Não foi possível baixar a mídia (HTTP ${res.status}).`);
  return { bytes: new Uint8Array(await res.arrayBuffer()), mime: (res.headers.get("content-type") ?? "").split(";")[0] || "application/octet-stream" };
}

const EXT: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "audio/ogg": "ogg",
  "audio/mpeg": "mp3",
  "audio/mp4": "m4a",
  "audio/aac": "aac",
  "video/mp4": "mp4",
  "application/pdf": "pdf",
};

/** Guarda a mídia do CRM no bucket do app e devolve um link assinado (1 ano). */
export async function storeCrmMedia(workspaceId: string, bytes: Uint8Array, mime: string) {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const path = `crm/${workspaceId}/${new Date().toISOString().slice(0, 10)}/${crypto.randomUUID()}.${EXT[mime] ?? "bin"}`;
  const { error } = await supabaseAdmin.storage.from(BUCKET).upload(path, bytes, { contentType: mime, upsert: false });
  if (error) throw new Error(`Falha ao salvar a mídia: ${error.message}`);
  const { data } = await supabaseAdmin.storage.from(BUCKET).createSignedUrl(path, 60 * 60 * 24 * 365);
  return data?.signedUrl ?? null;
}

/** API oficial do WhatsApp: a mídia chega como id; troca por URL temporária e baixa com o token. */
export async function downloadWhatsAppCloudMedia(token: string, mediaId: string) {
  const meta = await fetch(`https://graph.facebook.com/v21.0/${encodeURIComponent(mediaId)}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!meta.ok) throw new Error(`WhatsApp não liberou a mídia (HTTP ${meta.status}).`);
  const info = (await meta.json()) as { url?: string; mime_type?: string };
  if (!info.url) throw new Error("WhatsApp não devolveu o link da mídia.");
  const file = await fetchBytes(info.url, { Authorization: `Bearer ${token}` });
  return { bytes: file.bytes, mime: info.mime_type?.split(";")[0] || file.mime };
}

const b64 = (b: Uint8Array) => Buffer.from(b).toString("base64");

async function transcribe(workspaceId: string, bytes: Uint8Array, mime: string): Promise<string | null> {
  const gemini = await getWorkspaceAiKey(workspaceId, "gemini");
  if (gemini) {
    const res = await fetch("https://generativelanguage.googleapis.com/v1beta/models/gemini-flash-latest:generateContent", {
      method: "POST",
      headers: { "x-goog-api-key": gemini, "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ parts: [{ inlineData: { mimeType: mime, data: b64(bytes) } }, { text: "Transcreva este áudio em português do Brasil. Devolva só o texto falado." }] }],
      }),
    });
    if (res.ok) {
      const j = (await res.json()) as any;
      const t = (j.candidates?.[0]?.content?.parts ?? []).map((p: any) => p.text ?? "").join("").trim();
      if (t) return t;
    }
  }
  const openai = await getWorkspaceAiKey(workspaceId, "openai");
  if (openai) {
    const fd = new FormData();
    fd.append("model", "whisper-1");
    fd.append("language", "pt");
    fd.append("file", new Blob([bytes as BlobPart], { type: mime }), `audio.${EXT[mime] ?? "ogg"}`);
    const res = await fetch("https://api.openai.com/v1/audio/transcriptions", {
      method: "POST",
      headers: { Authorization: `Bearer ${openai}` },
      body: fd,
    });
    if (res.ok) {
      const j = (await res.json()) as { text?: string };
      if (j.text?.trim()) return j.text.trim();
    }
  }
  return null;
}

async function describeImage(workspaceId: string, bytes: Uint8Array, mime: string): Promise<string | null> {
  const { visionJSON } = await import("@/lib/creative/llm.server");
  const schema = {
    type: "object",
    additionalProperties: false,
    required: ["descricao"],
    properties: { descricao: { type: "string" } },
  };
  const r = (await visionJSON(
    workspaceId,
    "Um cliente enviou esta imagem no atendimento. Descreva em 1 a 2 frases, em português, o que ela mostra e qualquer texto visível (ex.: print de produto, comprovante, foto de ambiente).",
    [{ bytes, mime }],
    schema,
    "image_description",
  )) as { descricao?: string };
  return r.descricao?.trim() || null;
}

/** Texto que o SDR recebe no lugar de um áudio ou imagem. */
export async function describeMedia(
  workspaceId: string,
  source: string | { bytes: Uint8Array; mime: string },
  type: "audio" | "image",
): Promise<string> {
  const file = typeof source === "string" ? await fetchBytes(source) : source;
  if (type === "audio") {
    const t = await transcribe(workspaceId, file.bytes, file.mime).catch(() => null);
    return t
      ? `[Áudio do lead, transcrito] ${t}`
      : "[O lead enviou um áudio que não pôde ser transcrito. Peça gentilmente que escreva a mensagem.]";
  }
  const d = await describeImage(workspaceId, file.bytes, file.mime).catch(() => null);
  return d ? `[O lead enviou uma imagem] ${d}` : "[O lead enviou uma imagem.]";
}
