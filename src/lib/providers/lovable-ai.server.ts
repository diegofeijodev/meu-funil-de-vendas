/**
 * Provedores de IA de imagem/vídeo via Lovable AI (ChatGPT e Gemini/Veo).
 * Somente servidor: usa LOVABLE_API_KEY e salva o arquivo no armazenamento do app.
 */
import type { GenerationRequest, GenerationResult, ServerCreativeProvider } from "./creative-provider.server";

const BASE = "https://ai.gateway.lovable.dev";
const BUCKET = "creative-assets";

function key() {
  const k = process.env['LOVABLE_API_KEY'];
  if (!k) throw new Error("LOVABLE_API_KEY não configurada no servidor.");
  return k;
}

async function gatewayError(res: Response) {
  const body = await res.text().catch(() => "");
  if (res.status === 402) return new Error("Créditos de IA esgotados. Adicione créditos para continuar.");
  if (res.status === 429) return new Error("Muitas solicitações agora. Aguarde um instante e tente de novo.");
  return new Error(`IA respondeu ${res.status}: ${body.slice(0, 300)}`);
}

async function upload(bytes: Uint8Array, ext: string, contentType: string) {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const path = `${new Date().toISOString().slice(0, 10)}/${crypto.randomUUID()}.${ext}`;
  const { error } = await supabaseAdmin.storage.from(BUCKET).upload(path, bytes, { contentType, upsert: false });
  if (error) throw new Error(`Falha ao salvar arquivo: ${error.message}`);
  // Bucket privado: link assinado de longa duração para exibir no Studio.
  const { data, error: signErr } = await supabaseAdmin.storage
    .from(BUCKET)
    .createSignedUrl(path, 60 * 60 * 24 * 365 * 5);
  if (signErr || !data) throw new Error(`Falha ao gerar link do arquivo: ${signErr?.message}`);
  return data.signedUrl;
}

function ready(url: string, cost: number, externalJobId: string | null = null): GenerationResult {
  return { status: "ready", assetUrl: url, thumbnailUrl: url, externalJobId, cost };
}

const OPENAI_SIZE: Record<string, string> = {
  "1:1": "1024x1024",
  "4:5": "1024x1280",
  "9:16": "1024x1824",
  "16:9": "1824x1024",
};

async function imageFromGateway(body: Record<string, unknown>) {
  const res = await fetch(`${BASE}/v1/images/generations`, {
    method: "POST",
    headers: { Authorization: `Bearer ${key()}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw await gatewayError(res);
  const json = (await res.json()) as { data?: { b64_json?: string }[] };
  const b64 = json.data?.[0]?.b64_json;
  if (!b64) throw new Error("A IA não devolveu imagem (possível recusa de conteúdo).");
  return upload(new Uint8Array(Buffer.from(b64, "base64")), "png", "image/png");
}

/** Veo (Google) — cria o job, acompanha até terminar e salva o MP4. */
async function veoVideo(req: GenerationRequest, model: string) {
  const res = await fetch(`${BASE}/v1/videos`, {
    method: "POST",
    headers: { Authorization: `Bearer ${key()}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model,
      instances: [{ prompt: req.finalPrompt.slice(0, 3000) }],
      parameters: {
        durationSeconds: 8,
        resolution: "720p",
        aspectRatio: req.aspectRatio === "9:16" || req.aspectRatio === "4:5" ? "9:16" : "16:9",
        sampleCount: 1,
        generateAudio: true,
      },
    }),
  });
  if (!res.ok) throw await gatewayError(res);
  let job = (await res.json()) as { id: string; status: string; error?: { message: string } };
  while (job.status !== "completed" && job.status !== "failed") {
    await new Promise((r) => setTimeout(r, 6000));
    const p = await fetch(`${BASE}/v1/videos/${encodeURIComponent(job.id)}`, {
      headers: { Authorization: `Bearer ${key()}` },
    });
    if (!p.ok) throw await gatewayError(p);
    job = await p.json();
  }
  if (job.status === "failed") throw new Error(job.error?.message ?? "Geração de vídeo falhou.");
  const dl = await fetch(`${BASE}/v1/videos/${encodeURIComponent(job.id)}/content`, {
    headers: { Authorization: `Bearer ${key()}` },
  });
  if (!dl.ok) throw await gatewayError(dl);
  const url = await upload(new Uint8Array(await dl.arrayBuffer()), "mp4", "video/mp4");
  return { url, id: job.id };
}

export const chatgptProvider: ServerCreativeProvider = {
  id: "chatgpt",
  label: "ChatGPT (OpenAI)",
  sandbox: false,
  async generateImage(req) {
    const url = await imageFromGateway({
      model: "openai/gpt-image-2.5-sunburst",
      prompt: req.finalPrompt,
      size: OPENAI_SIZE[req.aspectRatio] ?? "1024x1024",
      quality: "medium",
    });
    return ready(url, 1.5);
  },
  async generateVideo() {
    throw new Error("O ChatGPT não gera vídeos. Escolha Gemini ou Higgsfield para vídeo.");
  },
  async getGenerationStatus() {
    return { status: "ready", assetUrl: null, thumbnailUrl: null, externalJobId: null, cost: 0 };
  },
  async getAsset() {
    return null;
  },
};

export const geminiProvider: ServerCreativeProvider = {
  id: "gemini",
  label: "Gemini (Google)",
  sandbox: false,
  async generateImage(req) {
    const url = await imageFromGateway({
      model: "google/gemini-3.1-flash-image",
      messages: [{ role: "user", content: `${req.finalPrompt}\nProporção da imagem: ${req.aspectRatio}.` }],
      modalities: ["image", "text"],
    });
    return ready(url, 1.0);
  },
  async generateVideo(req) {
    const { url, id } = await veoVideo(req, "google/veo-3.1-fast");
    return ready(url, 6.0, id);
  },
  async getGenerationStatus() {
    return { status: "ready", assetUrl: null, thumbnailUrl: null, externalJobId: null, cost: 0 };
  },
  async getAsset() {
    return null;
  },
};
