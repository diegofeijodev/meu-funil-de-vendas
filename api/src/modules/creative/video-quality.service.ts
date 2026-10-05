import { Inject, Injectable } from '@nestjs/common';
import { ENV } from '../../common/config/env.module';
import { Env } from '../../common/config/env.validation';
import { AiService } from '../ai/ai.service';
import { FfmpegService } from '../media/ffmpeg.service';
import { ImageService } from '../media/image.service';

export type VideoScore = { roteiro: number; marca: number; tecnica: number; produto: number; scroll: number; total: number; motivo: string };

const n = { type: 'number' };
export const VIDEO_CRITIC_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['roteiro', 'marca', 'tecnica', 'produto', 'scroll', 'motivo'],
  properties: { roteiro: n, marca: n, tecnica: n, produto: n, scroll: n, motivo: { type: 'string' } },
};
/** Quadros avaliados: 15 %, 50 % e 85 % da duração. */
export const VIDEO_FRAME_POINTS = [0.15, 0.5, 0.85];

const clamp = (v: unknown) => Math.max(0, Math.min(10, Math.round(Number(v) || 0)));
const clip = (t: string, max: number) => (t.length <= max ? t : `${t.slice(0, max)}…`);

export function videoCriticPrompt(o: { script: string; subject: string; palette: string[] }): string {
  return [
    'Você é um crítico de vídeos publicitários para Instagram. As 3 imagens são quadros do MESMO vídeo vertical, em ordem (15 %, 50 % e 85 % da duração).',
    `Roteiro pedido: ${clip(o.script, 1500)}`,
    `Assunto/produto esperado: ${o.subject}. Paleta da marca: ${o.palette.join(', ') || 'livre'}.`,
    'Dê notas de 0 a 10:',
    'roteiro = aderência ao roteiro e ao gancho (o que aparece bate com as tomadas pedidas);',
    'marca = fidelidade à marca e à paleta (cores, estilo, ambiente);',
    'tecnica = qualidade técnica (10 = sem defeitos; deformações, mãos ou rostos errados, artefatos, objetos derretendo e texto gerado ilegível reduzem muito);',
    'produto = clareza do produto (reconhecível, protagonista, apetitoso/atraente);',
    'scroll = apelo para parar o scroll no feed (o primeiro quadro prende o olhar?).',
    'motivo = 1 frase em português com o principal problema a corrigir (ou o ponto forte, se estiver ótimo).',
  ].join('\n');
}

/** Nota de qualidade do vídeo (0–50): 3 quadros pelo ffmpeg → JPEG 768 px → crítico de visão (via `AiService`). */
@Injectable()
export class VideoQualityService {
  readonly minScore: number;

  constructor(
    private readonly ai: AiService,
    private readonly images: ImageService,
    private readonly ffmpeg: FfmpegService,
    @Inject(ENV) env: Pick<Env, 'MIN_VIDEO_SCORE'>,
  ) {
    this.minScore = env.MIN_VIDEO_SCORE;
  }

  async score(workspaceId: string, video: Uint8Array, o: { durationSec: number; script: string; subject: string; palette: string[] }): Promise<VideoScore> {
    const raw = await this.ffmpeg.extractFrames(video, o.durationSec, VIDEO_FRAME_POINTS);
    const frames = await Promise.all(raw.map((f) => this.images.shrink(f, 768)));
    const r = await this.ai.vision<Record<string, unknown>>(workspaceId, { prompt: videoCriticPrompt(o), schema: VIDEO_CRITIC_SCHEMA, name: 'video_score', images: frames });
    const s = { roteiro: clamp(r.roteiro), marca: clamp(r.marca), tecnica: clamp(r.tecnica), produto: clamp(r.produto), scroll: clamp(r.scroll), motivo: String(r.motivo ?? '').slice(0, 240) };
    return { ...s, total: s.roteiro + s.marca + s.tecnica + s.produto + s.scroll };
  }
}
