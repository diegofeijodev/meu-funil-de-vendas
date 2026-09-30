/**
 * HiggsfieldProvider — implementação real via MCP oficial (https://mcp.higgsfield.ai/mcp).
 * Só roda no servidor. O access token vem da conexão do workspace e nunca é exposto.
 *
 * Contrato do MCP (validado): generate_image / generate_video recebem { params: { model, prompt,
 * aspect_ratio, duration?, use_unlim } } e devolvem um job id; job_status { jobId, sync:true }
 * espera até ~25s por chamada e devolve a URL quando termina.
 */
import { callTool } from "@/lib/mcp.server";
import {
  CREATIVE_COSTS,
  type GenerationRequest,
  type GenerationResult,
  type ServerCreativeProvider,
} from "./creative-provider.server";

export const HIGGSFIELD_MCP_URL = "https://mcp.higgsfield.ai/mcp";
const IMAGE_MODEL = "gpt_image_2_5";
const VIDEO_MODEL = "kling2_6"; // texto→vídeo, 5 ou 10 s, 9:16/16:9/1:1
const VIDEO_RATIOS = new Set(["16:9", "9:16", "1:1"]);
const MAX_WAIT_MS = 6 * 60 * 1000;

export function createHiggsfieldProvider(opts: {
  serverUrl: string;
  accessToken: string | null;
  tools?: unknown[];
}): ServerCreativeProvider {
  const { serverUrl, accessToken } = opts;

  const status = async (jobId: string) => {
    const out = await callTool(serverUrl, accessToken, "job_status", { jobId, sync: true });
    const blob = `${out.structured ?? ""}\n${out.text}`;
    const st = /"status"\s*:\s*"([a-z_]+)"/i.exec(blob)?.[1]?.toLowerCase() ?? "";
    const url = out.mediaUrl ?? pickUrl(blob);
    return { st, url, raw: blob };
  };

  const generate = async (req: GenerationRequest, video: boolean): Promise<GenerationResult> => {
    const aspect = video && !VIDEO_RATIOS.has(req.aspectRatio) ? "9:16" : req.aspectRatio;
    const params: Record<string, unknown> = {
      model: video ? VIDEO_MODEL : IMAGE_MODEL,
      prompt: req.finalPrompt,
      aspect_ratio: aspect,
      use_unlim: false,
    };
    if (video) Object.assign(params, { duration: (req as any).durationSeconds && (req as any).durationSeconds <= 5 ? 5 : 10, sound: true });
    // Pede a maior resolução disponível; se o modelo recusar o parâmetro, repete sem ele.
    const tool = video ? "generate_video" : "generate_image";
    let out;
    try {
      out = await callTool(serverUrl, accessToken, tool, { params: { ...params, resolution: video ? "1080p" : "2k" } });
      if (/invalid|unknown|not (allowed|supported)|resolution/i.test(out.text ?? "") && !extractJobId(`${out.structured ?? ""}\n${out.text}`))
        throw new Error("resolution rejected");
    } catch {
      out = await callTool(serverUrl, accessToken, tool, { params });
    }
    const jobId = extractJobId(`${out.structured ?? ""}\n${out.text}`);
    if (!jobId) throw new Error("O Higgsfield não confirmou a geração.");

    const deadline = Date.now() + MAX_WAIT_MS;
    while (Date.now() < deadline) {
      const s = await status(jobId);
      if (s.url && ["completed", "complete", "succeeded", "success", "done", "ready", ""].includes(s.st)) {
        return { status: "ready", assetUrl: s.url, thumbnailUrl: s.url, externalJobId: jobId, raw: s.raw.slice(0, 2000), cost: CREATIVE_COSTS[req.kind] };
      }
      if (["failed", "error", "nsfw", "cancelled", "canceled", "rejected"].includes(s.st)) {
        throw new Error(`O Higgsfield não conseguiu gerar (${s.st}).`);
      }
    }
    return { status: "generating", assetUrl: null, thumbnailUrl: null, externalJobId: jobId, raw: null, cost: CREATIVE_COSTS[req.kind] };
  };

  return {
    id: "higgsfield",
    label: "Higgsfield (MCP)",
    sandbox: false,
    generateImage: (req) => generate(req, false),
    generateVideo: (req) => generate(req, true),
    async getGenerationStatus(externalJobId) {
      const s = await status(externalJobId);
      return {
        status: s.url ? "ready" : ["failed", "error"].includes(s.st) ? "failed" : "generating",
        assetUrl: s.url,
        thumbnailUrl: s.url,
        externalJobId,
        raw: s.raw.slice(0, 2000),
        cost: 0,
      };
    },
    async getAsset(externalJobId) {
      return (await status(externalJobId)).url;
    },
  };
}

function extractJobId(blob: string): string | null {
  return /"id"\s*:\s*"([0-9a-f-]{36})"/i.exec(blob)?.[1] ?? /\b([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\b/i.exec(blob)?.[1] ?? null;
}

function pickUrl(blob: string): string | null {
  const urls = [...blob.matchAll(/https:\/\/[^\s"'\\)]+/g)].map((m) => m[0]);
  return urls.find((u) => /\.(mp4|mov|webm|png|jpe?g|webp)(\?|$)/i.test(u)) ?? null;
}
