jest.setTimeout(60_000);

import { MAX_DOWNLOAD_BYTES } from '../assets.service';
import { assertExternalUrl, createGuardedLookup, isInternalHost, isPrivateIp } from '../external-fetch';
import { imageHeaderSize } from '../image.service';
import { readVideoMeta } from '../video-meta';
import { mediaWorld, sampleMp4, status, WS_A } from './mem';

describe('SSRF — endereços', () => {
  it('isPrivateIp cobre v4, v6, IPv4 embutido em IPv6 e metadados', () => {
    for (const ip of ['0.0.0.0', '10.1.1.1', '127.0.0.1', '169.254.169.254', '172.16.0.1', '192.168.1.1', '100.64.0.1', '198.18.0.1', '224.0.0.1', '::', '::1', 'fc00::1', 'fd12::1', 'fe80::1', '::ffff:127.0.0.1', '::ffff:7f00:1', '::ffff:a9fe:a9fe', '64:ff9b::7f00:1', '2002:7f00:1::', 'ff02::1']) {
      expect([ip, isPrivateIp(ip)]).toEqual([ip, true]);
    }
    for (const ip of ['8.8.8.8', '1.1.1.1', '2606:4700:4700::1111', '::ffff:808:808']) expect([ip, isPrivateIp(ip)]).toEqual([ip, false]);
  });

  it('ponto final no host não escapa (localhost., 127.0.0.1.)', () => {
    expect(isInternalHost('localhost.')).toBe(true);
    expect(isInternalHost('LOCALHOST..')).toBe(true);
    expect(isInternalHost('metadata.internal.')).toBe(true);
    expect(() => assertExternalUrl('https://localhost./x', false)).toThrow();
    expect(() => assertExternalUrl('https://[::ffff:127.0.0.1]/x', false)).toThrow();
    expect(() => assertExternalUrl('https://[fd00::1]/x', false)).toThrow();
  });

  const lookup = (allowLocal: boolean, map: Record<string, { address: string; family: number }[]>) =>
    new Promise<{ err: Error | null; address?: unknown }>((resolve) => {
      const l = createGuardedLookup(allowLocal, async (h) => map[h] ?? []);
      return (host: string) => l(host, {}, (err, address) => resolve({ err, address }));
    }).then(() => undefined);

  const run = (allowLocal: boolean, host: string, list: { address: string; family: number }[], all = false) =>
    new Promise<{ err: Error | null; address?: unknown }>((resolve) =>
      createGuardedLookup(allowLocal, async () => list)(host, { all }, (err, address) => resolve({ err, address })),
    );

  it('nome que RESOLVE para IP privado é recusado (resolvedor falso); qualquer endereço interno da lista basta', async () => {
    void lookup;
    expect((await run(false, 'evil.example.com', [{ address: '10.0.0.5', family: 4 }])).err).toMatchObject({ code: 'EBLOCKED' });
    expect((await run(false, 'rebind.example.com', [{ address: '8.8.8.8', family: 4 }, { address: '169.254.169.254', family: 4 }])).err).toMatchObject({ code: 'EBLOCKED' });
    expect((await run(false, 'v6.example.com', [{ address: '::ffff:10.0.0.1', family: 6 }])).err).toMatchObject({ code: 'EBLOCKED' });
    expect((await run(false, 'vazio.example.com', [])).err).toBeTruthy();
    const ok = await run(false, 'cdn.example.com', [{ address: '8.8.8.8', family: 4 }]);
    expect([ok.err, ok.address]).toEqual([null, '8.8.8.8']); // devolve o endereço JÁ verificado (conexão fixada nele)
    expect((await run(false, 'cdn.example.com', [{ address: '8.8.8.8', family: 4 }], true)).address).toEqual([{ address: '8.8.8.8', family: 4 }]);
  });

  it('loopback só em dev e só para host loopback', async () => {
    expect((await run(true, 'localhost', [{ address: '127.0.0.1', family: 4 }])).err).toBeNull();
    expect((await run(false, 'localhost', [{ address: '127.0.0.1', family: 4 }])).err).toBeTruthy();
    expect((await run(true, 'evil.example.com', [{ address: '127.0.0.1', family: 4 }])).err).toBeTruthy(); // nome público apontando p/ loopback
    expect((await run(true, 'localhost.', [{ address: '10.0.0.1', family: 4 }])).err).toBeTruthy();
  });
});

describe('download externo — redirecionamentos e tamanho', () => {
  it('redirecionamento para IP privado/metadados/http é recusado a cada salto (nada sai para o destino interno)', async () => {
    const w = mediaWorld({ NODE_ENV: 'production' });
    const seen: string[] = [];
    w.fetchImpl.current = async (url, init) => {
      seen.push(`${(init as RequestInit)?.redirect}:${url}`);
      if (url === 'https://cdn.example.com/a.png') return new Response(null, { status: 302, headers: { location: 'https://169.254.169.254/latest/meta-data' } });
      if (url === 'https://cdn.example.com/b.png') return new Response(null, { status: 307, headers: { location: 'http://cdn.example.com/c.png' } });
      if (url === 'https://cdn.example.com/c.png') return new Response(null, { status: 302, headers: { location: 'https://localhost./x' } });
      return new Response('x');
    };
    expect(await status(w.assets.download('https://cdn.example.com/a.png'))).toContain('rede interna');
    expect(await status(w.assets.download('https://cdn.example.com/b.png'))).toContain('https://');
    expect(await status(w.assets.download('https://cdn.example.com/c.png'))).toContain('rede interna');
    expect(seen.every((s) => s.startsWith('manual:'))).toBe(true);
    expect(seen.some((s) => s.includes('169.254'))).toBe(false);
    w.cleanup();
  });

  it('segue redirecionamentos legítimos (≤ 5) e para no sexto', async () => {
    const w = mediaWorld({ NODE_ENV: 'production' });
    let n = 0;
    w.fetchImpl.current = async (url) => {
      if (url.includes('/ok')) return new Response(new Uint8Array([1, 2, 3]), { status: 200 });
      n++;
      return new Response(null, { status: 302, headers: { location: n < 3 ? `https://cdn.example.com/r${n}` : 'https://cdn.example.com/ok' } });
    };
    expect((await w.assets.download('https://cdn.example.com/start')).bytes.length).toBe(3);
    w.fetchImpl.current = async () => new Response(null, { status: 302, headers: { location: 'https://cdn.example.com/loop' } });
    expect(await status(w.assets.download('https://cdn.example.com/start'))).toBe('400:Não foi possível baixar a mídia do provedor (redirecionamentos demais).');
    w.cleanup();
  });

  it('corpo sem content-length é lido em streaming e ABORTADO ao passar do teto', async () => {
    const w = mediaWorld({ NODE_ENV: 'production' });
    let pulled = 0;
    let cancelled = false;
    const chunk = new Uint8Array(32 * 1024 * 1024);
    w.fetchImpl.current = async () =>
      new Response(
        new ReadableStream({
          pull(c) { pulled++; c.enqueue(chunk); if (pulled > 50) c.close(); },
          cancel() { cancelled = true; },
        }),
        { status: 200 },
      );
    expect(await status(w.assets.download('https://cdn.example.com/enorme.mp4'))).toBe('400:A mídia do provedor é grande demais.');
    expect(cancelled).toBe(true);
    expect(pulled * chunk.length).toBeLessThan(MAX_DOWNLOAD_BYTES + 2 * chunk.length + 1);
    // content-length declarado grande também é recusado sem ler
    w.fetchImpl.current = async () => new Response('x', { status: 200, headers: { 'content-length': String(MAX_DOWNLOAD_BYTES + 1) } });
    expect(await status(w.assets.download('https://cdn.example.com/x'))).toBe('400:A mídia do provedor é grande demais.');
    w.cleanup();
  });
});

describe('bomba de descompressão e vídeo corrompido', () => {
  const pngHeader = (w: number, h: number) => {
    const b = Buffer.alloc(33);
    Buffer.from('89504e470d0a1a0a', 'hex').copy(b);
    b.writeUInt32BE(13, 8);
    b.write('IHDR', 12, 'latin1');
    b.writeUInt32BE(w, 16);
    b.writeUInt32BE(h, 20);
    return b;
  };

  it('lê as dimensões do cabeçalho PNG e JPEG sem decodificar', async () => {
    expect(imageHeaderSize(pngHeader(40000, 3))).toEqual({ width: 40000, height: 3 });
    const w = mediaWorld();
    const jpg = Buffer.from(await w.images.encode(w.images.blank(33, 21), false));
    expect(imageHeaderSize(jpg)).toEqual({ width: 33, height: 21 });
    expect(imageHeaderSize(Buffer.from('texto'))).toBeNull();
    w.cleanup();
  });

  it('PNG minúsculo que declara 100 mil × 100 mil px é recusado ANTES de decodificar (400 pt-BR)', async () => {
    const w = mediaWorld();
    expect(await status(w.images.read(pngHeader(100_000, 100_000)))).toBe('400:Imagem grande demais (100000x100000). O limite é de 50 megapixels e 20.000 px por lado.');
    expect(await status(w.images.read(pngHeader(7100, 7100)))).toContain('50 megapixels'); // 50,4 MP
    expect(await status(w.images.read(pngHeader(30_000, 10)))).toContain('20.000 px por lado');
    expect(await status(w.images.read(pngHeader(0, 10)))).toContain('Imagem grande demais');
    // pelos caminhos que decodificam: normalize, size e shrink
    expect(await status(w.images.normalize(pngHeader(100_000, 100_000), 'other'))).toContain('50 megapixels');
    expect(await status(w.images.shrink(pngHeader(100_000, 100_000)))).toContain('50 megapixels');
    expect(await status(w.assets.ingest({ workspaceId: WS_A, kind: 'image', targetFormat: 'other', source: 'upload', bytes: pngHeader(100_000, 100_000) }))).toContain('50 megapixels');
    w.cleanup();
  });

  it('MP4 truncado vira 400 (não RangeError); upload "vídeo" sem ftyp é recusado', async () => {
    const mp4 = sampleMp4();
    const cut = mp4.subarray(0, mp4.length - 30);
    const broken = Buffer.concat([mp4.subarray(0, 40), Buffer.from([0, 0, 0, 40, 0x6d, 0x6f, 0x6f, 0x76, 1, 2, 3])]);
    for (const b of [cut, broken]) {
      try { readVideoMeta(b); } catch (e: any) { expect(e.getStatus()).toBe(400); expect(e.getResponse().message).toBe('Arquivo de vídeo inválido ou corrompido.'); }
    }
    const w = mediaWorld();
    expect(await status(w.assets.ingest({ workspaceId: WS_A, kind: 'video', targetFormat: 'ig_reel', source: 'upload', bytes: Buffer.from('isto nao e um mp4 de verdade') }))).toBe('400:Arquivo de vídeo inválido: não é um MP4/MOV (falta o cabeçalho ftyp).');
    expect(await status(w.assets.ingest({ workspaceId: WS_A, kind: 'video', targetFormat: 'ig_reel', source: 'upload', bytes: mp4 }))).toBe('ok');
    w.cleanup();
  });
});
