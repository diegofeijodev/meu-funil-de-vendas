import { randomUUID } from 'node:crypto';
import { ActivityService } from '../../activity/activity.service';
import { MemTable, mediaWorld, MediaWorld, sampleImage } from '../../media/__tests__/mem';
import { CreativeService } from '../creative.service';
import { CreativeResourcesService } from '../creative.controller';
import { GenerationRequest, GenerationResult, ServerCreativeProvider } from '../creative.types';
import { PipelineService } from '../pipeline.service';
import { RefsService } from '../refs.service';
import { VideoExtrasService } from '../video-extras.service';

export const ART = {
  subject: 'copo de chopp', scene: 'balcão de madeira', composition: 'centrado', lighting: 'quente', camera: '50mm', style: 'foto realista',
  color_palette: ['#c0392b'], mood: 'convidativo', text_in_image: 'none', negative: 'blurry', aspect_ratio: '1:1',
  prompt_final: 'A frosty glass of draft beer on a wooden bar counter, warm light, 50mm lens, shallow depth of field, photorealistic', video_shots: [],
};
export const SCORE = (total: number, motivo = 'ok') => {
  const each = Math.floor(total / 5);
  return { produto: each, fidelidade: each, composicao: each, defeitos: each, paleta: total - each * 4, motivo };
};

export interface CreativeWorld extends MediaWorld {
  svc: CreativeService;
  res: CreativeResourcesService;
  ai: { json: jest.Mock; vision: jest.Mock };
  logs: any[][];
  provider: ServerCreativeProvider & { image: jest.Mock; video: jest.Mock; status: jest.Mock };
  setProvider: (p: ServerCreativeProvider) => void;
  png: Buffer;
  strategy: { current: any };
}

/** Mundo do estúdio: disco temporário + tabelas em memória + IA/provedor falsos (nenhuma rede). */
export async function creativeWorld(): Promise<CreativeWorld> {
  const w = mediaWorld();
  const camp = (r: any) => { const c = w.t['campaigns']!.rows.find((x) => x.id === r.campaign_id); return c ? { name: c.name } : null; };
  w.t['creatives'] = new MemTable(() => ({ version: 1, status: 'draft', extras: {}, provider: 'mock', final_prompt: null }), { campaign: camp });
  w.t['creative_generation_jobs'] = new MemTable(() => ({ status: 'queued', provider: 'mock', options: {}, external_job_id: null, creative_id: null }));
  w.t['creative_versions'] = new MemTable();
  w.t['products'] = new MemTable();
  w.t['brand_assets'] = new MemTable();
  w.t['campaign_strategies'] = new MemTable();
  Object.assign(w.prisma, { creatives: w.t['creatives'], creative_generation_jobs: w.t['creative_generation_jobs'], creative_versions: w.t['creative_versions'], products: w.t['products'], brand_assets: w.t['brand_assets'], campaign_strategies: w.t['campaign_strategies'] });
  const png = await sampleImage(w.images, 200, 200, true);
  const logs: any[][] = [];
  const activity = { log: async (...a: any[]) => { logs.push(a); } } as unknown as ActivityService;
  const ai = { json: jest.fn(async (_ws: string, req: any) => ({ ...ART, __name: req.name })), vision: jest.fn(async () => SCORE(40)) };
  const strategy = { current: null as any };
  const strategist = { currentStrategy: jest.fn(async () => strategy.current) };

  const image = jest.fn(async (_r: GenerationRequest): Promise<GenerationResult> => ({ status: 'ready', assetUrl: null, bytes: png, mime: 'image/png', thumbnailUrl: null, externalJobId: null, cost: 1, note: null }));
  const video = jest.fn(async (_r: GenerationRequest): Promise<GenerationResult> => ({ status: 'generating', assetUrl: null, thumbnailUrl: null, externalJobId: 'veo:job1', cost: 6, note: 'Vídeo pelo Veo do app, ainda gerando' }));
  const statusFn = jest.fn(async (id: string): Promise<GenerationResult> => ({ status: 'generating', assetUrl: null, thumbnailUrl: null, externalJobId: id, cost: 0 }));
  const provider = { id: 'gemini', label: 'Gemini (Google)', sandbox: false, generateImage: image, generateVideo: video, getGenerationStatus: statusFn, getAsset: async () => null, image, video, status: statusFn } as any;
  let current: ServerCreativeProvider = provider;
  const providers = { resolve: jest.fn(async () => current) } as any;

  const refs = new RefsService(w.prisma, w.files, w.assets, w.images);
  const pipeline = new PipelineService(w.prisma, ai as any, w.assets, w.images, refs);
  const extras = new VideoExtrasService(w.assets, refs, w.images);
  const svc = new CreativeService(w.prisma, w.access, activity, ai as any, w.assets, refs, pipeline, providers, strategist as any, extras);
  const res = new CreativeResourcesService(w.prisma, activity);
  return { ...w, svc, res, ai, logs, provider, setProvider: (p) => { current = p; }, png, strategy } as CreativeWorld;
}

export const uuid = () => randomUUID();
