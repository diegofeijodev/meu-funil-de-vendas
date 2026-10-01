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

function pendingResult(externalJobId: string, cost: number, note: string | null): GenerationResult {
  return { status: "generating", assetUrl: null, thumbnailUrl: null, externalJobId, cost, note };
}

function ready(url: string, cost: number, externalJobId: string | null = null, note: string | null = null): GenerationResult {
  return { status: "ready", assetUrl: url, thumbnailUrl: url, externalJobId, cost, note };
}

const OPENAI_SIZE: Record<string, string> = {
  "1:1": "1024x1024",
  "4:5": "1024x1536",
  "9:16": "1024x1536",
  "16:9": "1536x1024",
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

/** Veo (Google) — cria o job e acompanha até terminar (ou até o prazo, devolvendo o job para o cron). */
async function veoVideo(req: GenerationRequest, model: string) {
  // Pede 1080p; se o modelo não aceitar, repete em 720p.
  let res = await veoCreate(req, model, "1080p");
  if (res.status === 400 || res.status === 422) res = await veoCreate(req, model, "720p");
  if (!res.ok) throw await gatewayError(res);
  const job = (await res.json()) as { id: string; status: string; error?: { message: string } };
  return veoWait(job.id, Date.now() + (req.maxWaitMs ?? 6 * 60e3));
}

/** Foto da marca como primeiro quadro (imagem → vídeo) quando houver referência. */
function veoImage(req: GenerationRequest) {
  const ref = req.referenceImages?.[0];
  return ref ? { image: { bytesBase64Encoded: Buffer.from(ref.bytes).toString("base64"), mimeType: ref.mime } } : {};
}

async function veoCreate(req: GenerationRequest, model: string, resolution: string) {
  return fetch(`${BASE}/v1/videos`, {
    method: "POST",
    headers: { Authorization: `Bearer ${key()}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model,
      instances: [{ prompt: req.finalPrompt.slice(0, 3000), ...veoImage(req) }],
      parameters: {
        durationSeconds: 8,
        resolution,
        aspectRatio: req.aspectRatio === "9:16" || req.aspectRatio === "4:5" ? "9:16" : "16:9",
        sampleCount: 1,
        generateAudio: true,
      },
    }),
  });
}

/** Acompanha o job do Veo; null = ainda gerando quando o prazo acabou. */
async function veoWait(id: string, deadline: number): Promise<{ url: string; id: string } | { pending: string }> {
  for (;;) {
    const p = await fetch(`${BASE}/v1/videos/${encodeURIComponent(id)}`, { headers: { Authorization: `Bearer ${key()}` } });
    if (!p.ok) throw await gatewayError(p);
    const job = (await p.json()) as { id: string; status: string; error?: { message: string } };
    if (job.status === "failed") throw new Error(job.error?.message ?? "Geração de vídeo falhou.");
    if (job.status === "completed") break;
    if (Date.now() + 6000 > deadline) return { pending: id };
    await new Promise((r) => setTimeout(r, 6000));
  }
  const dl = await fetch(`${BASE}/v1/videos/${encodeURIComponent(id)}/content`, {
    headers: { Authorization: `Bearer ${key()}` },
  });
  if (!dl.ok) throw await gatewayError(dl);
  const url = await upload(new Uint8Array(await dl.arrayBuffer()), "mp4", "video/mp4");
  return { url, id };
}

import { vendorError } from "../ai-keys.server";

function editForm(model: string, req: GenerationRequest, size: string) {
  const fd = new FormData();
  fd.append("model", model);
  fd.append("prompt", req.finalPrompt.slice(0, 30000));
  fd.append("size", size);
  fd.append("quality", "high");
  (req.referenceImages ?? []).slice(0, 4).forEach((r, i) =>
    fd.append("image[]", new Blob([r.bytes as BlobPart], { type: r.mime }), `ref${i}.jpg`),
  );
  return fd;
}

/** Gateway: edição com as fotos de referência; se o endpoint recusar, gera sem elas. */
async function imageEditFromGateway(model: string, req: GenerationRequest, size: string) {
  const res = await fetch(`${BASE}/v1/images/edits`, {
    method: "POST",
    headers: { Authorization: `Bearer ${key()}` },
    body: editForm(model, req, size),
  });
  if (res.status === 400 || res.status === 404 || res.status === 415 || res.status === 422) {
    console.warn("[chatgpt] edição com referências recusada:", res.status, (await res.text()).slice(0, 200));
    return null;
  }
  if (!res.ok) throw await gatewayError(res);
  const json = (await res.json()) as { data?: { b64_json?: string }[] };
  const b64 = json.data?.[0]?.b64_json;
  if (!b64) throw new Error("A IA não devolveu imagem (possível recusa de conteúdo).");
  return upload(new Uint8Array(Buffer.from(b64, "base64")), "png", "image/png");
}

const b64of = (b: Uint8Array) => Buffer.from(b).toString("base64");

/** OpenAI direto com a chave do cliente. */
async function openaiDirectImage(key: string, req: GenerationRequest) {
  const size = req.aspectRatio === "9:16" || req.aspectRatio === "4:5" ? "1024x1536" : req.aspectRatio === "16:9" ? "1536x1024" : "1024x1024";
  if (req.referenceImages?.length) {
    const r = await fetch("https://api.openai.com/v1/images/edits", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}` },
      body: editForm("gpt-image-1", req, size),
    });
    if (!r.ok) throw await vendorError("openai", r);
    const j = (await r.json()) as { data?: { b64_json?: string }[] };
    const b = j.data?.[0]?.b64_json;
    if (!b) throw new Error("A OpenAI não devolveu imagem (possível recusa de conteúdo).");
    return upload(new Uint8Array(Buffer.from(b, "base64")), "png", "image/png");
  }
  const res = await fetch("https://api.openai.com/v1/images/generations", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({ model: "gpt-image-1", prompt: req.finalPrompt.slice(0, 30000), size, quality: "high" }),
  });
  if (!res.ok) throw await vendorError("openai", res);
  const json = (await res.json()) as { data?: { b64_json?: string }[] };
  const b64 = json.data?.[0]?.b64_json;
  if (!b64) throw new Error("A OpenAI não devolveu imagem (possível recusa de conteúdo).");
  return upload(new Uint8Array(Buffer.from(b64, "base64")), "png", "image/png");
}

const G = "https://generativelanguage.googleapis.com/v1beta";

/** Gemini direto com a chave do cliente. */
async function geminiDirectImage(key: string, req: GenerationRequest) {
  const res = await fetch(`${G}/models/gemini-3.1-flash-image:generateContent`, {
    method: "POST",
    headers: { "x-goog-api-key": key, "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [
        {
          parts: [
            ...(req.referenceImages ?? []).slice(0, 4).map((r) => ({ inlineData: { mimeType: r.mime, data: b64of(r.bytes) } })),
            { text: `${req.finalPrompt}\nProporção da imagem: ${req.aspectRatio}.` },
          ],
        },
      ],
      generationConfig: { responseModalities: ["IMAGE", "TEXT"], imageConfig: { aspectRatio: req.aspectRatio } },
    }),
  });
  if (!res.ok) throw await vendorError("gemini", res);
  const json = (await res.json()) as any;
  const part = (json.candidates?.[0]?.content?.parts ?? []).find((p: any) => p.inlineData?.data);
  if (!part) throw new Error("O Gemini não devolveu imagem (possível recusa de conteúdo).");
  const mime = part.inlineData.mimeType ?? "image/png";
  return upload(new Uint8Array(Buffer.from(part.inlineData.data, "base64")), mime.includes("jpeg") ? "jpg" : "png", mime);
}

const VEO_DIRECT_MODELS = ["veo-3.1-fast-generate-preview", "veo-3.0-fast-generate-preview"];

/** Tenta os modelos Veo da chave Gemini em ordem; 404 = modelo inexistente, passa para o próximo. */
async function geminiDirectVideo(key: string, req: GenerationRequest) {
  let lastErr: unknown = null;
  for (const model of VEO_DIRECT_MODELS) {
    try {
      const r = await geminiDirectVideoModel(key, req, model);
      return { r, model };
    } catch (e) {
      lastErr = e;
      console.warn(`[gemini] vídeo com ${model} falhou:`, e instanceof Error ? e.message : e);
    }
  }
  throw lastErr ?? new Error("Nenhum modelo Veo disponível na sua chave Gemini.");
}

async function geminiDirectVideoModel(key: string, req: GenerationRequest, model: string) {
  const create = (resolution: string) =>
    fetch(`${G}/models/${model}:predictLongRunning`, {
      method: "POST",
      headers: { "x-goog-api-key": key, "Content-Type": "application/json" },
      body: JSON.stringify({
        instances: [{ prompt: req.finalPrompt.slice(0, 3000), ...veoImage(req) }],
        parameters: {
          aspectRatio: req.aspectRatio === "9:16" || req.aspectRatio === "4:5" ? "9:16" : "16:9",
          resolution,
        },
      }),
    });
  // 1080p quando o modelo aceitar; senão 720p.
  let res = await create("1080p");
  if (res.status === 400 || res.status === 422) res = await create("720p");
  if (!res.ok) throw await vendorError("gemini", res);
  const op = (await res.json()) as any;
  return geminiDirectWait(key, op.name as string, Date.now() + (req.maxWaitMs ?? 6 * 60e3));
}

async function geminiDirectWait(key: string, name: string, deadline: number): Promise<{ url: string; id: string } | { pending: string }> {
  let op: any = { done: false, name };
  for (;;) {
    const p = await fetch(`${G}/${name}`, { headers: { "x-goog-api-key": key } });
    if (!p.ok) throw await vendorError("gemini", p);
    op = await p.json();
    if (op.done) break;
    if (Date.now() + 8000 > deadline) return { pending: name };
    await new Promise((r) => setTimeout(r, 8000));
  }
  if (op.error) throw new Error(op.error.message ?? "Geração de vídeo falhou.");
  const uri = op.response?.generateVideoResponse?.generatedSamples?.[0]?.video?.uri;
  if (!uri) throw new Error("O Gemini não devolveu vídeo (possível recusa de conteúdo).");
  const dl = await fetch(uri, { headers: { "x-goog-api-key": key }, redirect: "follow" });
  if (!dl.ok) throw await vendorError("gemini", dl);
  const url = await upload(new Uint8Array(await dl.arrayBuffer()), "mp4", "video/mp4");
  return { url, id: name };
}

const idle = {
  async getGenerationStatus() {
    return { status: "ready" as const, assetUrl: null, thumbnailUrl: null, externalJobId: null, cost: 0 };
  },
  async getAsset() {
    return null;
  },
};

/** userKey preenchida = usa a conta do cliente (custo 0 para o app). */
/** strict = não cai para os créditos do app (a cadeia automática decide o próximo). */
export function createChatgptProvider(userKey: string | null, opts: { strict?: boolean } = {}): ServerCreativeProvider {
  return {
    id: "chatgpt",
    label: userKey ? "ChatGPT (sua conta OpenAI)" : "ChatGPT (OpenAI)",
    sandbox: false,
    async generateImage(req) {
      if (userKey) {
        try {
          return ready(await openaiDirectImage(userKey, req), 0, null, "ChatGPT (chave do workspace)");
        } catch (e) {
          if (opts.strict) throw e;
          // Chave do cliente sem crédito/inválida: cai para os créditos de IA do app em vez de travar.
          console.warn("[chatgpt] chave própria falhou, usando créditos do app:", e instanceof Error ? e.message : e);
        }
      }
      const size = OPENAI_SIZE[req.aspectRatio] ?? "1024x1024";
      if (req.referenceImages?.length) {
        const edited = await imageEditFromGateway("openai/gpt-image-2.5-sunburst", req, size);
        if (edited) return ready(edited, 1.5);
      }
      const url = await imageFromGateway({
        model: "openai/gpt-image-2.5-sunburst",
        prompt: req.finalPrompt,
        size: OPENAI_SIZE[req.aspectRatio] ?? "1024x1024",
        quality: "high",
      });
      return ready(url, 1.5);
    },
    async generateVideo() {
      throw new Error("O ChatGPT não gera vídeos. Escolha Gemini ou Higgsfield para vídeo.");
    },
    ...idle,
  };
}

export function createGeminiProvider(userKey: string | null, opts: { strict?: boolean } = {}): ServerCreativeProvider {
  return {
    id: "gemini",
    label: userKey ? "Gemini (sua conta Google)" : "Gemini (Google)",
    sandbox: false,
    async generateImage(req) {
      if (userKey) {
        try {
          return ready(await geminiDirectImage(userKey, req), 0, null, "Gemini (chave do workspace)");
        } catch (e) {
          if (opts.strict) throw e;
          console.warn("[gemini] chave própria falhou, usando créditos do app:", e instanceof Error ? e.message : e);
        }
      }
      const url = await imageFromGateway({
        model: "google/gemini-3.1-flash-image",
        messages: [
          {
            role: "user",
            content: req.referenceImages?.length
              ? [
                  ...req.referenceImages.slice(0, 4).map((r) => ({
                    type: "image_url",
                    image_url: { url: `data:${r.mime};base64,${b64of(r.bytes)}` },
                  })),
                  { type: "text", text: `${req.finalPrompt}\nProporção da imagem: ${req.aspectRatio}.` },
                ]
              : `${req.finalPrompt}\nProporção da imagem: ${req.aspectRatio}.`,
          },
        ],
        modalities: ["image", "text"],
      });
      return ready(url, 1.0);
    },
    async generateVideo(req) {
      if (userKey) {
        try {
          const { r, model } = await geminiDirectVideo(userKey, req);
          if ("pending" in r) return pendingResult(`gveo:${r.pending}`, 0, `Vídeo pela chave Gemini (${model}), ainda gerando`);
          return ready(r.url, 0, r.id, `Vídeo pela chave Gemini (${model})`);
        } catch (e) {
          if (opts.strict) throw e;
          console.warn("[gemini] vídeo pela chave falhou, usando Veo com créditos do app:", e instanceof Error ? e.message : e);
        }
      }
      const r = await veoVideo(req, "google/veo-3.1-fast");
      const note = userKey ? "Chave Gemini falhou; vídeo pelo Veo com créditos do app (google/veo-3.1-fast)" : "Vídeo pelo Veo com créditos do app (google/veo-3.1-fast)";
      if ("pending" in r) return pendingResult(`veo:${r.pending}`, 6.0, `${note}, ainda gerando`);
      return ready(r.url, 6.0, r.id, note);
    },
    // Vídeos que passaram do prazo da requisição: o cron consulta aqui até ficarem prontos.
    async getGenerationStatus(externalJobId) {
      const wait = Date.now() + 20_000;
      const r = externalJobId.startsWith("veo:")
        ? await veoWait(externalJobId.slice(4), wait)
        : externalJobId.startsWith("gveo:") && userKey
          ? await geminiDirectWait(userKey, externalJobId.slice(5), wait)
          : null;
      if (!r) return { status: "failed" as const, assetUrl: null, thumbnailUrl: null, externalJobId, cost: 0 };
      if ("pending" in r) return pendingResult(externalJobId, 0, null);
      return ready(r.url, 0, externalJobId);
    },
    async getAsset() {
      return null;
    },
  };
}

export const chatgptProvider = createChatgptProvider(null);
export const geminiProvider = createGeminiProvider(null);
