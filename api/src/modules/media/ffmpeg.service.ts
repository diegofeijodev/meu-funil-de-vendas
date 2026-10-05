import { Inject, Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import { ENV } from '../../common/config/env.module';
import { Env } from '../../common/config/env.validation';
import { conformArgs, FFMPEG_MAX_INPUT_BYTES, FFMPEG_RUNNER, FFMPEG_TIMEOUT_MS, FfmpegRunner } from './ffmpeg';
import { UserError } from './user-error';

const BASE = ['-hide_banner', '-nostdin', '-loglevel', 'error'];
const MAX_OUTPUT_BYTES = 150 * 1024 * 1024;

/**
 * ffmpeg confinado: cada chamada ganha um diretório temporário próprio em `UPLOADS_DIR/.ffmpeg-tmp/<uuid>` (fora dos buckets servidos),
 * com nomes de arquivo fixos (`in.mp4`, `out.mp4`, `frameN.jpg`) — nenhum caminho vem de fora — e o diretório é apagado no `finally`.
 */
@Injectable()
export class FfmpegService {
  /** Teto da entrada; público só para os testes. */
  maxInputBytes = FFMPEG_MAX_INPUT_BYTES;
  private readonly root: string;

  constructor(
    @Inject(FFMPEG_RUNNER) private readonly runner: FfmpegRunner,
    @Inject(ENV) env: Pick<Env, 'UPLOADS_DIR'>,
  ) {
    this.root = path.join(path.resolve(env.UPLOADS_DIR), '.ffmpeg-tmp');
  }

  private async withWorkdir<T>(fn: (dir: string) => Promise<T>): Promise<T> {
    const dir = path.join(this.root, randomUUID());
    await fs.mkdir(dir, { recursive: true });
    try {
      return await fn(dir);
    } finally {
      await fs.rm(dir, { recursive: true, force: true }).catch(() => undefined);
    }
  }

  private assertInput(bytes: Uint8Array) {
    if (!bytes.length) throw new UserError('Vídeo vazio.');
    if (bytes.length > this.maxInputBytes) throw new UserError('Vídeo grande demais para processar.');
  }

  private run(args: string[], dir: string) {
    return this.runner([...BASE, ...args], { cwd: dir, timeoutMs: FFMPEG_TIMEOUT_MS });
  }

  private async readOut(dir: string, name: string): Promise<Uint8Array> {
    const st = await fs.stat(path.join(dir, name)).catch(() => null);
    if (!st || !st.size) throw new UserError('O ffmpeg não gerou o arquivo esperado.');
    if (st.size > MAX_OUTPUT_BYTES) throw new UserError('O vídeo convertido ficou grande demais.');
    return new Uint8Array(await fs.readFile(path.join(dir, name)));
  }

  /** Quadros JPEG (≤ 768 px no maior lado) nas frações da duração (ex.: 0.15, 0.5, 0.85). */
  async extractFrames(video: Uint8Array, durationSec: number, fractions: number[]): Promise<Uint8Array[]> {
    this.assertInput(video);
    return this.withWorkdir(async (dir) => {
      await fs.writeFile(path.join(dir, 'in.mp4'), video);
      const out: Uint8Array[] = [];
      for (const [i, f] of fractions.entries()) {
        const t = Math.max(0, Math.min(Math.max(0, durationSec - 0.05), durationSec * f));
        const name = `frame${i}.jpg`;
        await this.run(['-y', '-ss', t.toFixed(2), '-i', 'in.mp4', '-frames:v', '1', '-vf', 'scale=768:768:force_original_aspect_ratio=decrease', '-q:v', '3', name], dir);
        out.push(await this.readOut(dir, name));
      }
      return out;
    });
  }

  /** Converte para o padrão do Instagram (ver `conformArgs`). */
  async conformForInstagram(video: Uint8Array, opts: { silent: boolean }): Promise<Uint8Array> {
    this.assertInput(video);
    return this.withWorkdir(async (dir) => {
      await fs.writeFile(path.join(dir, 'in.mp4'), video);
      await this.run(conformArgs(opts.silent), dir);
      return this.readOut(dir, 'out.mp4');
    });
  }
}
