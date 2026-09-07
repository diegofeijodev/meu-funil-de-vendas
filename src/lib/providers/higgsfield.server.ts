/**
 * HiggsfieldProvider — implementação real via MCP oficial (https://mcp.higgsfield.ai/mcp).
 * Só roda no servidor. O access token vem da conexão do workspace e nunca é exposto.
 */
import { callTool, listTools, pickTool, type McpTool } from "@/lib/mcp.server";
import {
  CREATIVE_COSTS,
  type GenerationRequest,
  type GenerationResult,
  type ServerCreativeProvider,
} from "./creative-provider.server";

export const HIGGSFIELD_MCP_URL = "https://mcp.higgsfield.ai/mcp";

const IMAGE_KEYWORDS = ["generate_image", "text2image", "image", "generate"];
const VIDEO_KEYWORDS = ["generate_video", "text2video", "video", "generate"];
const STATUS_KEYWORDS = ["status", "job", "get_generation", "poll"];
const ASSET_KEYWORDS = ["asset", "result", "download", "get_"];

export function createHiggsfieldProvider(opts: {
  serverUrl: string;
  accessToken: string | null;
  tools: McpTool[];
}): ServerCreativeProvider {
  const { serverUrl, accessToken } = opts;

  const run = async (keywords: string[], args: Record<string, unknown>) => {
    const tools = opts.tools.length ? opts.tools : await listTools(serverUrl, accessToken);
    const tool = pickTool(tools, keywords);
    if (!tool) throw new Error("O servidor MCP do Higgsfield não expôs ferramentas utilizáveis.");
    return { tool: tool.name, out: await callTool(serverUrl, accessToken, tool.name, args) };
  };

  const generate = async (req: GenerationRequest, keywords: string[]): Promise<GenerationResult> => {
    const { out } = await run(keywords, {
      prompt: req.finalPrompt,
      aspect_ratio: req.aspectRatio,
    });
    const externalJobId = extractJobId(out.structured);
    return {
      status: out.mediaUrl ? "ready" : externalJobId ? "generating" : "failed",
      assetUrl: out.mediaUrl,
      thumbnailUrl: out.mediaUrl,
      externalJobId,
      raw: out.text || out.structured,
      cost: CREATIVE_COSTS[req.kind],
    };
  };

  return {
    id: "higgsfield",
    label: "Higgsfield (MCP)",
    sandbox: false,
    generateImage: (req) => generate(req, IMAGE_KEYWORDS),
    generateVideo: (req) => generate(req, VIDEO_KEYWORDS),
    async getGenerationStatus(externalJobId) {
      const { out } = await run(STATUS_KEYWORDS, { job_id: externalJobId, id: externalJobId });
      return {
        status: out.mediaUrl ? "ready" : "generating",
        assetUrl: out.mediaUrl,
        thumbnailUrl: out.mediaUrl,
        externalJobId,
        raw: out.text || out.structured,
        cost: 0,
      };
    },
    async getAsset(externalJobId) {
      const { out } = await run(ASSET_KEYWORDS, { job_id: externalJobId, id: externalJobId });
      return out.mediaUrl;
    },
  };
}

function extractJobId(structured: string | null): string | null {
  if (!structured) return null;
  const match = /"(?:job_id|jobId|id|generation_id)"\s*:\s*"([^"]+)"/.exec(structured);
  return match?.[1] ?? null;
}
