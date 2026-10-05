import { mediaWorld, sampleMp4, WS_A } from './mem';
import { VideoConformService } from '../video-conform.service';

describe('VideoConformService (C6: conversão para o padrão do Instagram)', () => {
  const meta = { workspaceId: WS_A, brandId: null, igPostId: null, title: 'Reels', provider: 'gemini' };

  it('vídeo fora do padrão (640 px) é convertido, reingerido como filho do original e revalidado', async () => {
    const w = mediaWorld();
    try {
      const bad = await w.assets.ingest({ workspaceId: WS_A, kind: 'video', targetFormat: 'ig_reel', source: 'gemini', bytes: sampleMp4({ width: 640, height: 1136 }), title: 'Reels' });
      expect(bad.ig_ready).toBe(false);
      const ffmpeg = { conformForInstagram: jest.fn(async () => new Uint8Array(sampleMp4())) };
      const ok = await new VideoConformService(w.assets, ffmpeg as any).ensureIgReady(bad, meta, { silent: false });
      expect(ok).toMatchObject({ ig_ready: true, parent_id: bad.id, width: 1080, height: 1920, kind: 'video' });
      expect(ffmpeg.conformForInstagram).toHaveBeenCalledWith(expect.any(Uint8Array), { silent: false });
    } finally {
      w.cleanup();
    }
  });

  it('já no padrão: não converte; modo "sem áudio" com trilha de som: converte com silêncio', async () => {
    const w = mediaWorld();
    try {
      const good = await w.assets.ingest({ workspaceId: WS_A, kind: 'video', targetFormat: 'ig_reel', source: 'gemini', bytes: sampleMp4(), title: 'Reels' });
      const ffmpeg = { conformForInstagram: jest.fn(async () => new Uint8Array(sampleMp4({ audio: 'mp4a' }))) };
      const svc = new VideoConformService(w.assets, ffmpeg as any);
      expect(await svc.ensureIgReady(good, meta, { silent: false })).toBe(good);
      expect(ffmpeg.conformForInstagram).not.toHaveBeenCalled();
      const silent = await svc.ensureIgReady(good, meta, { silent: true });
      expect(ffmpeg.conformForInstagram).toHaveBeenCalledWith(expect.any(Uint8Array), { silent: true });
      expect(silent.parent_id).toBe(good.id);
    } finally {
      w.cleanup();
    }
  });

  it('continua fora do padrão depois da conversão: erro claro (o post vira failed com failure_kind "media")', async () => {
    const w = mediaWorld();
    try {
      const bad = await w.assets.ingest({ workspaceId: WS_A, kind: 'video', targetFormat: 'ig_reel', source: 'gemini', bytes: sampleMp4({ width: 640, height: 1136 }), title: 'Reels' });
      const ffmpeg = { conformForInstagram: jest.fn(async () => new Uint8Array(sampleMp4({ width: 640, height: 1136 }))) };
      await expect(new VideoConformService(w.assets, ffmpeg as any).ensureIgReady(bad, meta, { silent: false })).rejects.toThrow(/^Vídeo fora do padrão do Instagram mesmo depois da conversão: Largura de 640px; o mínimo é 720px\./);
    } finally {
      w.cleanup();
    }
  });
});
