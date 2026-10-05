import { mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { conformArgs, createFfmpegRunner, FFMPEG_TIMEOUT_MS, FfmpegRunner, resolveFfmpegPath } from '../ffmpeg';
import { FfmpegService } from '../ffmpeg.service';

/** FfmpegService com o runner FALSO: grava o arquivo de saída (último argumento) dentro do `cwd`, nenhum binário. */
function world(write: (args: string[], cwd: string) => void = () => undefined) {
  const dir = mkdtempSync(path.join(tmpdir(), 'mf-ffmpeg-'));
  const calls: { args: string[]; cwd: string; timeoutMs: number; files: string[] }[] = [];
  const runner: FfmpegRunner = jest.fn(async (args: string[], opts: { cwd: string; timeoutMs: number }) => {
    calls.push({ args, cwd: opts.cwd, timeoutMs: opts.timeoutMs, files: readdirSync(opts.cwd) });
    write(args, opts.cwd);
  });
  const svc = new FfmpegService(runner, { UPLOADS_DIR: dir });
  return { dir, svc, runner, calls, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}
const outName = (args: string[]) => args[args.length - 1]!;
const writeOut = (content: string) => (args: string[], cwd: string) => writeFileSync(path.join(cwd, outName(args)), Buffer.from(content || outName(args)));

describe('FfmpegService (porta FFMPEG_RUNNER — nenhum binário nos testes)', () => {
  it('quadros em 15/50/85 % da duração; entrada e saídas com nomes fixos num diretório temporário dentro de UPLOADS_DIR, apagado no fim', async () => {
    const w = world(writeOut(''));
    try {
      const frames = await w.svc.extractFrames(new Uint8Array([1, 2, 3]), 8, [0.15, 0.5, 0.85]);
      expect(frames.map((f) => Buffer.from(f).toString())).toEqual(['frame0.jpg', 'frame1.jpg', 'frame2.jpg']);
      expect(w.calls.map((c) => c.args[c.args.indexOf('-ss') + 1])).toEqual(['1.20', '4.00', '6.80']);
      for (const c of w.calls) {
        expect(path.dirname(c.cwd)).toBe(path.join(w.dir, '.ffmpeg-tmp'));
        expect(c.timeoutMs).toBe(FFMPEG_TIMEOUT_MS);
        expect(c.files).toContain('in.mp4');
        expect(c.args.slice(0, 4)).toEqual(['-hide_banner', '-nostdin', '-loglevel', 'error']);
        // Só nomes fixos, relativos ao diretório temporário: nada de caminho vindo de fora.
        expect(c.args.filter((a) => /\.(mp4|jpg)$/.test(a)).every((a) => /^(in\.mp4|frame\d\.jpg)$/.test(a))).toBe(true);
      }
      expect(readdirSync(path.join(w.dir, '.ffmpeg-tmp'))).toEqual([]);
    } finally {
      w.cleanup();
    }
  });

  it('conversão: H.264 High, yuv420p, 30 fps, 1080×1920 com preenchimento, AAC 48 kHz, +faststart, ≤ 60 s; silêncio só quando pedido', async () => {
    const w = world(writeOut('mp4-convertido'));
    try {
      const out = await w.svc.conformForInstagram(new Uint8Array([9]), { silent: false });
      expect(Buffer.from(out).toString()).toBe('mp4-convertido');
      const a = w.calls[0]!.args.join(' ');
      for (const t of ['-c:v libx264', '-profile:v high', '-t 60', 'fps=30', 'format=yuv420p', 'scale=1080:1920:force_original_aspect_ratio=decrease', 'pad=1080:1920', '-c:a aac', '-ar 48000', '-movflags +faststart', '-map 0:a:0?']) {
        expect(a).toContain(t);
      }
      expect(a).not.toContain('anullsrc');
      await w.svc.conformForInstagram(new Uint8Array([9]), { silent: true });
      const s = w.calls[1]!.args.join(' ');
      expect(s).toContain('anullsrc=channel_layout=stereo:sample_rate=48000');
      expect(s).toContain('-map 1:a:0');
      expect(s).not.toContain('0:a:0?');
      expect(outName(w.calls[1]!.args)).toBe('out.mp4');
      expect(conformArgs(true).filter((x) => x.endsWith('.mp4'))).toEqual(['in.mp4', 'out.mp4']);
    } finally {
      w.cleanup();
    }
  });

  it('ffmpeg falhou ou não gerou saída: erro claro e o diretório temporário é apagado mesmo assim', async () => {
    const boom = world(() => {
      throw new Error('ffmpeg falhou (código 1): Invalid data');
    });
    try {
      await expect(boom.svc.conformForInstagram(new Uint8Array([1]), { silent: false })).rejects.toThrow('ffmpeg falhou (código 1): Invalid data');
      expect(readdirSync(path.join(boom.dir, '.ffmpeg-tmp'))).toEqual([]);
    } finally {
      boom.cleanup();
    }
    const empty = world();
    try {
      await expect(empty.svc.extractFrames(new Uint8Array([1]), 8, [0.5])).rejects.toThrow('O ffmpeg não gerou o arquivo esperado.');
      expect(readdirSync(path.join(empty.dir, '.ffmpeg-tmp'))).toEqual([]);
    } finally {
      empty.cleanup();
    }
  });

  it('entrada vazia ou acima do teto é recusada sem chamar o ffmpeg', async () => {
    const w = world(writeOut('x'));
    try {
      w.svc.maxInputBytes = 4;
      await expect(w.svc.conformForInstagram(new Uint8Array(0), { silent: false })).rejects.toThrow('Vídeo vazio.');
      await expect(w.svc.extractFrames(new Uint8Array(5), 8, [0.5])).rejects.toThrow('Vídeo grande demais para processar.');
      expect(w.runner).not.toHaveBeenCalled();
    } finally {
      w.cleanup();
    }
  });
});

describe('createFfmpegRunner (processo filho real; o node faz o papel do binário)', () => {
  const env = { FFMPEG_PATH: process.execPath };
  const cwd = () => mkdtempSync(path.join(tmpdir(), 'mf-run-'));

  it('código 0 resolve; código ≠ 0 rejeita com o fim do stderr', async () => {
    const run = createFfmpegRunner(env);
    const dir = cwd();
    try {
      await expect(run(['-e', '0'], { cwd: dir, timeoutMs: 10_000 })).resolves.toBeUndefined();
      await expect(run(['-e', 'process.stderr.write("deu ruim"); process.exit(3)'], { cwd: dir, timeoutMs: 10_000 })).rejects.toThrow(/ffmpeg falhou \(código 3\): deu ruim/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('passou do tempo-limite: mata o processo e rejeita', async () => {
    const run = createFfmpegRunner(env);
    const dir = cwd();
    try {
      await expect(run(['-e', 'setTimeout(() => {}, 30000)'], { cwd: dir, timeoutMs: 300 })).rejects.toThrow(/tempo-limite/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('FFMPEG_PATH tem prioridade; sem ele e sem o ffmpeg-static, mensagem clara', () => {
    expect(resolveFfmpegPath({ FFMPEG_PATH: '/usr/bin/ffmpeg' })).toBe('/usr/bin/ffmpeg');
    jest.isolateModules(() => {
      jest.doMock('ffmpeg-static', () => null);
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { resolveFfmpegPath: r } = require('../ffmpeg');
      expect(() => r({})).toThrow('ffmpeg não encontrado: instale as dependências da API (ffmpeg-static) ou defina FFMPEG_PATH.');
    });
  });
});
