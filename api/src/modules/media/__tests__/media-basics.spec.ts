import { readVideoMeta, validateImageForInstagram, validateVideoForInstagram } from '../video-meta';
import { aspectFor, targetFromAspect, TARGET_FORMATS } from '../formats';
import { assertExternalUrl, isInternalHost } from '../external-fetch';
// jimp é JavaScript puro: imagens de 1080 px levam alguns segundos numa máquina carregada.
jest.setTimeout(120_000);

import { mediaWorld, sampleImage, sampleMp4, status, WS_A } from './mem';

describe('ImageService', () => {
  const w = mediaWorld();
  afterAll(() => w.cleanup());

  it('normaliza com corte "cover" para o tamanho exato do formato, em JPEG, com miniatura de 400 px', async () => {
    const src = await sampleImage(w.images, 1000, 500);
    const n = await w.images.normalize(src, 'ig_feed_portrait');
    expect([n.width, n.height, n.ext, n.mime]).toEqual([1080, 1350, 'jpg', 'image/jpeg']);
    const thumb = await w.images.read(n.thumb);
    expect(thumb.bitmap.width).toBe(400);
  });

  it('formato "other" mantém o tamanho; PNG com transparência continua PNG', async () => {
    const png = Buffer.from(await w.images.encode(w.images.blank(120, 80, 0x00000000), true));
    const n = await w.images.normalize(png, 'other');
    expect([n.width, n.height, n.ext]).toEqual([120, 80, 'png']);
  });

  it('shrink reduz ao maior lado de 1024 px (JPEG) e não amplia imagem pequena', async () => {
    const big = await w.images.shrink(await sampleImage(w.images, 3000, 1500), 1024);
    const r = await w.images.read(big.bytes);
    expect([r.bitmap.width, r.bitmap.height, big.mime]).toEqual([1024, 512, 'image/jpeg']);
    const small = await w.images.shrink(await sampleImage(w.images, 300, 200), 1024);
    expect((await w.images.read(small.bytes)).bitmap.width).toBe(300);
  });

  it('arquivo que não é imagem → 400 com mensagem simples', async () => {
    expect(await status(w.images.read(Buffer.from('isso não é uma imagem')))).toBe('400:Não foi possível ler a imagem (arquivo inválido ou formato não suportado).');
  });

  it('convert e size', async () => {
    const png = await sampleImage(w.images, 64, 32, true);
    const jpg = await w.images.convert(png, 'jpg');
    expect(jpg[0]).toBe(0xff);
    expect(await w.images.size(jpg)).toEqual({ width: 64, height: 32 });
  });
});

describe('cabeçalho de vídeo (MP4) e regras do Instagram', () => {
  it('lê duração, dimensões, codecs e fps do MP4', () => {
    const m = readVideoMeta(sampleMp4({ width: 1080, height: 1920, durationSec: 8 }));
    expect(m).toMatchObject({ width: 1080, height: 1920, duration: 8, videoCodec: 'avc1', audioCodec: 'mp4a', fps: 30, container: 'isom' });
  });

  it('reel válido: H.264 + AAC, 9:16, 3s–15min', () => {
    const r = validateVideoForInstagram(readVideoMeta(sampleMp4()), 'ig_reel');
    expect(r.ok).toBe(true);
    expect(r.checks['resolution']).toBe('1080p');
  });

  it('aponta codec, proporção, largura, duração e fps fora do padrão', () => {
    const r = validateVideoForInstagram(readVideoMeta(sampleMp4({ width: 640, height: 640, codec: 'hvc1', audio: 'ac-3', durationSec: 2, fps: 12 })), 'ig_reel');
    expect(r.ok).toBe(false);
    const text = r.issues.join(' | ');
    expect(text).toContain('Codec de vídeo hvc1');
    expect(text).toContain('Áudio ac-3');
    expect(text).toContain('Largura de 640px');
    expect(text).toContain('9:16');
    expect(text).toContain('Reels vão de 3s');
    expect(text).toContain('12 quadros por segundo');
  });

  it('arquivo sem moov: não lê o codec e avisa', () => {
    const r = validateVideoForInstagram(readVideoMeta(Buffer.from('xxxxxxxxxxxxxxxxxxxxxxxx')), 'ig_story');
    expect(r.ok).toBe(false);
    expect(r.issues[0]).toContain('Não foi possível ler o codec');
  });

  it('imagem: largura mínima e proporção 0,56–1,91', () => {
    expect(validateImageForInstagram(1080, 1080, 'ig_feed_square').ok).toBe(true);
    expect(validateImageForInstagram(200, 200, 'ig_feed_square').issues[0]).toContain('pequena demais');
    expect(validateImageForInstagram(2000, 500, 'ig_feed_square').issues[0]).toContain('fora do aceito');
  });
});

describe('formatos de destino', () => {
  it('aspecto → formato (vídeo 9:16 = reel) e aspecto do formato', () => {
    expect(targetFromAspect('1:1')).toBe('ig_feed_square');
    expect(targetFromAspect('9:16', true)).toBe('ig_reel');
    expect(targetFromAspect('9:16', false)).toBe('ig_story');
    expect(targetFromAspect('16:9')).toBe('meta_ad_landscape');
    expect(targetFromAspect('3:2')).toBe('other');
    expect(aspectFor('ig_feed_portrait')).toBe('4:5');
    expect(TARGET_FORMATS.meta_ad_landscape).toMatchObject({ width: 1200, height: 628 });
  });
});

describe('download externo seguro', () => {
  it('só https, nunca rede interna em produção', () => {
    expect(isInternalHost('127.0.0.1')).toBe(true);
    expect(isInternalHost('10.1.2.3')).toBe(true);
    expect(isInternalHost('172.20.0.1')).toBe(true);
    expect(isInternalHost('169.254.169.254')).toBe(true);
    expect(isInternalHost('metadata.internal')).toBe(true);
    expect(isInternalHost('[::1]')).toBe(true);
    expect(isInternalHost('cdn.canva.com')).toBe(false);
    expect(assertExternalUrl('https://cdn.canva.com/x.png', false)).toBe('https://cdn.canva.com/x.png');
    expect(() => assertExternalUrl('http://cdn.canva.com/x.png', false)).toThrow();
    expect(() => assertExternalUrl('https://127.0.0.1/x', false)).toThrow();
    expect(assertExternalUrl('http://localhost:9000/x', true)).toContain('localhost');
    // em dev só o loopback é liberado: rede privada e link-local (metadados de nuvem) nunca
    expect(() => assertExternalUrl('https://10.0.0.1/x', true)).toThrow();
    expect(() => assertExternalUrl('http://169.254.169.254/latest', true)).toThrow();
    expect(() => assertExternalUrl('não é url', true)).toThrow();
  });
});

describe('AssetsService.ingest', () => {
  const w = mediaWorld();
  afterAll(() => w.cleanup());

  it('imagem de upload: padroniza no formato, grava arquivo + miniatura no disco e registra media_assets com URL assinada', async () => {
    const src = await sampleImage(w.images, 1000, 700);
    const a = await w.assets.ingest({ workspaceId: WS_A, kind: 'image', targetFormat: 'ig_feed_square', source: 'upload', bytes: src, mime: 'image/png', title: 'Foto do bar', createdBy: 'u1' });
    expect(a.storage_path).toMatch(new RegExp(`^media/${WS_A}/\\d{4}-\\d{2}-\\d{2}/[0-9a-f-]{36}\\.jpg$`));
    expect(a.thumbnail_path).toMatch(/_thumb\.jpg$/);
    expect([a.width, a.height, a.aspect_ratio, a.ig_ready, a.source, a.status]).toEqual([1080, 1080, '1:1', true, 'upload', 'draft']);
    expect(await w.files.exists('creative-assets', a.storage_path!)).toBe(true);
    // a URL guardada é a assinada desta API e é legível por `download` (verifica a assinatura)
    expect((await w.assets.download(a.url!)).bytes.length).toBe((await w.files.read('creative-assets', a.storage_path!)).length);
  });

  it('source desconhecido vira "other"; título é cortado em 200; normalize:false guarda os bytes originais', async () => {
    const png = await sampleImage(w.images, 300, 200, true);
    const a = await w.assets.ingest({ workspaceId: WS_A, kind: 'image', targetFormat: 'other', source: 'qualquer', bytes: png, mime: 'image/png', title: 'x'.repeat(300), normalize: false });
    expect(a.source).toBe('other');
    expect(a.title).toHaveLength(200);
    expect(a.mime).toBe('image/png');
    expect(a.thumbnail_path).toBeNull();
    expect(Buffer.from(await w.files.read('creative-assets', a.storage_path!)).equals(png)).toBe(true);
  });

  it('vídeo: lê o cabeçalho, valida (sem transcodificar) e guarda os bytes como estão', async () => {
    const mp4 = sampleMp4({ durationSec: 8 });
    const a = await w.assets.ingest({ workspaceId: WS_A, kind: 'video', targetFormat: 'ig_reel', source: 'gemini', bytes: mp4, title: 'Reel' });
    expect(a.storage_path).toMatch(/\.mp4$/);
    expect([a.width, a.height, Number(a.duration_seconds), a.ig_ready, a.aspect_ratio]).toEqual([1080, 1920, 8, true, '9:16']);
    expect(Buffer.from(await w.files.read('creative-assets', a.storage_path!)).equals(mp4)).toBe(true);
  });

  it('vídeo fora do padrão fica ig_ready=false com os problemas no relatório', async () => {
    const a = await w.assets.ingest({ workspaceId: WS_A, kind: 'video', targetFormat: 'ig_reel', source: 'upload', bytes: sampleMp4({ codec: 'hvc1' }) });
    expect(a.ig_ready).toBe(false);
    expect((a.quality_report as any).issues[0]).toContain('Codec de vídeo hvc1');
  });

  it('baixa de https externo pela porta injetada; 404 do provedor vira erro claro; data: URL funciona', async () => {
    const png = await sampleImage(w.images, 100, 100, true);
    w.fetchImpl.current = async () => new Response(new Uint8Array(png), { status: 200, headers: { 'content-type': 'image/png' } });
    const a = await w.assets.ingest({ workspaceId: WS_A, kind: 'image', targetFormat: 'other', source: 'canva', sourceUrl: 'https://export.canva.com/x.png', normalize: false });
    expect(a.source).toBe('canva');
    expect(w.calls.at(-1)!.url).toBe('https://export.canva.com/x.png');
    w.fetchImpl.current = async () => new Response('x', { status: 404 });
    expect(await status(w.assets.ingest({ workspaceId: WS_A, kind: 'image', targetFormat: 'other', source: 'canva', sourceUrl: 'https://export.canva.com/y.png' }))).toBe('400:Não foi possível baixar a mídia do provedor (HTTP 404).');
    const d = await w.assets.download(`data:image/png;base64,${png.toString('base64')}`);
    expect([d.mime, d.bytes.length]).toEqual(['image/png', png.length]);
  });

  it('rede interna e http são barrados (SSRF); URL assinada adulterada → 403; sem arquivo nem URL → erro', async () => {
    const w = mediaWorld({ NODE_ENV: 'production' });
    const before = w.calls.length;
    expect(await status(w.assets.download('https://127.0.0.1/x.png'))).toContain('400');
    expect(await status(w.assets.download('http://cdn.example.com/x.png'))).toContain('400');
    expect(w.calls.length).toBe(before); // nada saiu para a rede
    const key = w.files.newUploadKey('media', WS_A, 'png');
    await w.files.put('creative-assets', key, Buffer.from('x'));
    const good = w.files.signedUrl('creative-assets', key);
    expect((await w.assets.download(good)).bytes.length).toBe(1);
    expect(await status(w.assets.download(good.replace(/sig=([0-9a-f])/, (_m, c) => `sig=${c === '0' ? '1' : '0'}`)))).toBe('403:Link inválido ou expirado.');
    expect(await status(w.assets.ingest({ workspaceId: WS_A, kind: 'image', targetFormat: 'other', source: 'upload' }))).toBe('400:Mídia sem arquivo nem URL.');
    w.cleanup();
  });

  it('reformat: só imagem do próprio workspace; vídeo é recusado', async () => {
    const img = await w.assets.ingest({ workspaceId: WS_A, kind: 'image', targetFormat: 'ig_feed_square', source: 'upload', bytes: await sampleImage(w.images, 900, 900), title: 'A' });
    const out = await w.assets.reformat(WS_A, img.id, 'ig_story', 'u1');
    expect([out.width, out.height, out.parent_id, out.title]).toEqual([1080, 1920, img.id, 'A']);
    const vid = await w.assets.ingest({ workspaceId: WS_A, kind: 'video', targetFormat: 'ig_reel', source: 'upload', bytes: sampleMp4() });
    expect(await status(w.assets.reformat(WS_A, vid.id, 'ig_story'))).toBe('400:Vídeos não são recortados no servidor. Gere um novo vídeo neste formato.');
    expect(await status(w.assets.reformat('00000000-0000-4000-8000-000000000000', img.id, 'ig_story'))).toBe('404:Mídia não encontrada.');
  });
});
