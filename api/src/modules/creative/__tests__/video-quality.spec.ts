jest.setTimeout(60_000);

import { ImageService } from '../../media/image.service';
import { VIDEO_CRITIC_SCHEMA, videoCriticPrompt, VideoQualityService } from '../video-quality.service';

describe('VideoQualityService (crítico de vídeo, C5)', () => {
  const images = new ImageService();

  it('3 quadros (15/50/85 %) → 768 px → crítico com 5 critérios 0–10 (total 50), arredondados e limitados; MIN_VIDEO_SCORE do ambiente', async () => {
    const frame = new Uint8Array(await images.encode(images.blank(1080, 1920, 0x336699ff), false));
    const ffmpeg = { extractFrames: jest.fn(async () => [frame, frame, frame]) };
    const ai = { vision: jest.fn(async () => ({ roteiro: 8.4, marca: 11, tecnica: -2, produto: '7', scroll: 'x', motivo: 'm'.repeat(400) })) };
    const svc = new VideoQualityService(ai as any, images, ffmpeg as any, { MIN_VIDEO_SCORE: 30 } as any);
    const s = await svc.score('ws', new Uint8Array([1]), { durationSec: 8, script: 'Roteiro por tomada: …', subject: 'chope', palette: ['#c0392b'] });
    expect(s).toMatchObject({ roteiro: 8, marca: 10, tecnica: 0, produto: 7, scroll: 0, total: 25 });
    expect(s.motivo).toHaveLength(240);
    expect(ffmpeg.extractFrames).toHaveBeenCalledWith(expect.any(Uint8Array), 8, [0.15, 0.5, 0.85]);
    const req = (ai.vision.mock.calls[0] as any)[1];
    expect(req).toMatchObject({ name: 'video_score', schema: VIDEO_CRITIC_SCHEMA });
    expect(req.images).toHaveLength(3);
    const f0 = await images.read(req.images[0].bytes);
    expect(Math.max(f0.bitmap.width, f0.bitmap.height)).toBe(768);
    expect(svc.minScore).toBe(30);
  });

  it('o prompt avalia aderência ao roteiro/gancho, marca/paleta, defeitos técnicos (inclusive texto gerado), produto e apelo de scroll', () => {
    const p = videoCriticPrompt({ script: 'ROTEIRO', subject: 'chope', palette: ['#c0392b'] });
    for (const t of ['quadros do MESMO vídeo vertical, em ordem (15 %, 50 % e 85 % da duração)', 'Roteiro pedido: ROTEIRO', 'roteiro =', 'marca =', 'tecnica =', 'texto gerado ilegível', 'produto =', 'scroll =', 'motivo =']) {
      expect(p).toContain(t);
    }
  });
});
