import { McpService } from '../../mcp/mcp.service';
import { UserError } from '../../media/user-error';
import { CREATIVE_COSTS, GenerationRequest, GenerationResult, ServerCreativeProvider } from '../creative.types';

export const HIGGSFIELD_MCP_URL = 'https://mcp.higgsfield.ai/mcp';
const IMAGE_MODEL = 'gpt_image_2_5';
const VIDEO_MODEL = 'kling2_6'; // texto→vídeo, 5 ou 10 s, 9:16/16:9/1:1
const VIDEO_RATIOS = new Set(['16:9', '9:16', '1:1']);
const MAX_WAIT_MS = 6 * 60 * 1000;
const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';

export const extractJobId = (blob: string): string | null =>
  new RegExp(`"id"\\s*:\\s*"(${UUID})"`, 'i').exec(blob)?.[1] ?? new RegExp(`\\b(${UUID})\\b`, 'i').exec(blob)?.[1] ?? null;

export const pickUrl = (blob: string): string | null => {
  const urls = [...blob.matchAll(/https:\/\/[^\s"'\\)]+/g)].map((m) => m[0]);
  return urls.find((u) => /\.(mp4|mov|webm|png|jpe?g|webp)(\?|$)/i.test(u)) ?? null;
};

export type HiggsConn = { server_url: string; access_token: string | null };
type Sleep = (ms: number) => Promise<void>;

/**
 * Higgsfield pelo MCP oficial. Contrato: `generate_image`/`generate_video` recebem `{ params }` e devolvem um job id;
 * `job_status { jobId, sync:true }` espera ~25 s por chamada e devolve a URL quando termina.
 * O token da conexão nunca sai do servidor.
 */
export function createHiggsfieldProvider(mcp: Pick<McpService, 'callTool'>, conn: HiggsConn, sleep: Sleep = (ms) => new Promise((r) => setTimeout(r, ms))): ServerCreativeProvider {
  const status = async (jobId: string) => {
    const out = await mcp.callTool(conn, 'job_status', { jobId, sync: true });
    const blob = `${out.structured ?? ''}\n${out.text}`;
    const st = /"status"\s*:\s*"([a-z_]+)"/i.exec(blob)?.[1]?.toLowerCase() ?? '';
    return { st, url: out.mediaUrl ?? pickUrl(blob), raw: blob };
  };

  const generate = async (req: GenerationRequest, video: boolean): Promise<GenerationResult> => {
    const aspect = video && !VIDEO_RATIOS.has(req.aspectRatio) ? '9:16' : req.aspectRatio;
    const params: Record<string, unknown> = { model: video ? VIDEO_MODEL : IMAGE_MODEL, prompt: req.finalPrompt, aspect_ratio: aspect, use_unlim: false };
    if (video) Object.assign(params, { duration: 10, sound: true });
    // Pede a maior resolução disponível; se o modelo recusar o parâmetro, repete sem ele.
    const tool = video ? 'generate_video' : 'generate_image';
    let out;
    try {
      const refs = (req.referenceUrls ?? []).slice(0, 4);
      out = await mcp.callTool(conn, tool, { params: { ...params, resolution: video ? '1080p' : '2k', ...(refs.length ? { input_images: refs } : {}) } });
      if (/invalid|unknown|not (allowed|supported)|resolution/i.test(out.text ?? '') && !extractJobId(`${out.structured ?? ''}\n${out.text}`)) {
        throw new Error('resolution rejected');
      }
    } catch {
      out = await mcp.callTool(conn, tool, { params });
    }
    const jobId = extractJobId(`${out.structured ?? ''}\n${out.text}`);
    if (!jobId) throw new UserError('O Higgsfield não confirmou a geração.');

    const deadline = Date.now() + (req.maxWaitMs ?? MAX_WAIT_MS);
    while (Date.now() < deadline) {
      const s = await status(jobId);
      if (s.url && ['completed', 'complete', 'succeeded', 'success', 'done', 'ready', ''].includes(s.st)) {
        return { status: 'ready', assetUrl: s.url, thumbnailUrl: s.url, externalJobId: jobId, raw: s.raw.slice(0, 2000), cost: CREATIVE_COSTS[req.kind] };
      }
      if (['failed', 'error', 'nsfw', 'cancelled', 'canceled', 'rejected'].includes(s.st)) {
        throw new UserError(`O Higgsfield não conseguiu gerar (${s.st}).`);
      }
      await sleep(2000);
    }
    return { status: 'generating', assetUrl: null, thumbnailUrl: null, externalJobId: jobId, raw: null, cost: CREATIVE_COSTS[req.kind] };
  };

  return {
    id: 'higgsfield',
    label: 'Higgsfield (MCP)',
    sandbox: false,
    generateImage: (req) => generate(req, false),
    generateVideo: (req) => generate(req, true),
    async getGenerationStatus(externalJobId) {
      // O id vira argumento de ferramenta MCP: só UUID (o que o Higgsfield devolve).
      if (!new RegExp(`^${UUID}$`, 'i').test(externalJobId)) {
        return { status: 'failed', assetUrl: null, thumbnailUrl: null, externalJobId, cost: 0 };
      }
      const s = await status(externalJobId);
      return {
        status: s.url ? 'ready' : ['failed', 'error'].includes(s.st) ? 'failed' : 'generating',
        assetUrl: s.url, thumbnailUrl: s.url, externalJobId, raw: s.raw.slice(0, 2000), cost: 0,
      };
    },
    async getAsset(externalJobId) {
      return (await status(externalJobId)).url;
    },
  };
}
