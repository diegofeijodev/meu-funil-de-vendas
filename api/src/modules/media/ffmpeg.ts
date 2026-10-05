/**
 * Porta do ffmpeg (processo filho). Tudo que roda o binário passa por aqui: nos testes entra um runner falso (nenhum binário).
 * O binário é o de `FFMPEG_PATH` (contêiner: /usr/bin/ffmpeg) ou o do pacote `ffmpeg-static`, resolvido só no primeiro uso.
 */
import { spawn } from 'node:child_process';
import { setPriority } from 'node:os';
import { Env } from '../../common/config/env.validation';

export const FFMPEG_RUNNER = Symbol('FFMPEG_RUNNER');
/** Roda o ffmpeg com `args` dentro de `cwd` (só nomes relativos de arquivos daquele diretório). Rejeita com o fim do stderr. */
export type FfmpegRunner = (args: string[], opts: { cwd: string; timeoutMs: number }) => Promise<void>;
export const FFMPEG_TIMEOUT_MS = 120_000;
/** Teto da entrada (= MAX_DOWNLOAD_BYTES da biblioteca de mídia). */
export const FFMPEG_MAX_INPUT_BYTES = 200 * 1024 * 1024;

export function resolveFfmpegPath(env: Pick<Env, 'FFMPEG_PATH'>): string {
  if (env.FFMPEG_PATH) return env.FFMPEG_PATH;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const p = require('ffmpeg-static') as string | null;
    if (p) return p;
  } catch {
    /* pacote ausente: cai na mensagem abaixo */
  }
  throw new Error('ffmpeg não encontrado: instale as dependências da API (ffmpeg-static) ou defina FFMPEG_PATH.');
}

/** Runner real: prioridade baixa (nice 10), stderr limitado, SIGKILL no tempo-limite. */
export function createFfmpegRunner(env: Pick<Env, 'FFMPEG_PATH'>): FfmpegRunner {
  return (args, opts) =>
    new Promise<void>((resolve, reject) => {
      let bin: string;
      try {
        bin = resolveFfmpegPath(env);
      } catch (e) {
        reject(e);
        return;
      }
      const child = spawn(bin, args, { cwd: opts.cwd, stdio: ['ignore', 'ignore', 'pipe'] });
      try {
        if (child.pid) setPriority(child.pid, 10);
      } catch {
        /* sem permissão para mudar a prioridade: segue na normal */
      }
      let stderr = '';
      child.stderr?.on('data', (c: Buffer) => {
        stderr = (stderr + c.toString('utf8')).slice(-2000);
      });
      const timer = setTimeout(() => {
        child.kill('SIGKILL');
        reject(new Error(`ffmpeg passou do tempo-limite (${Math.round(opts.timeoutMs / 1000)} s).`));
      }, opts.timeoutMs);
      child.on('error', (e) => {
        clearTimeout(timer);
        reject(e);
      });
      child.on('close', (code) => {
        clearTimeout(timer);
        if (code === 0) resolve();
        else reject(new Error(`ffmpeg falhou (código ${code}): ${stderr.trim().slice(-500)}`));
      });
    });
}

/** Padrão do Instagram: H.264 High + yuv420p, 30 fps, 1080×1920 (escala + preenchimento), AAC 48 kHz (silêncio se `silent`), +faststart, ≤ 60 s. */
export function conformArgs(silent: boolean): string[] {
  const vf = 'scale=1080:1920:force_original_aspect_ratio=decrease,pad=1080:1920:(ow-iw)/2:(oh-ih)/2:color=black,fps=30,format=yuv420p';
  return [
    '-y', '-i', 'in.mp4',
    ...(silent ? ['-f', 'lavfi', '-i', 'anullsrc=channel_layout=stereo:sample_rate=48000'] : []),
    '-map', '0:v:0',
    ...(silent ? ['-map', '1:a:0', '-shortest'] : ['-map', '0:a:0?']),
    '-t', '60', '-vf', vf,
    '-c:v', 'libx264', '-profile:v', 'high', '-preset', 'veryfast', '-crf', '21', '-threads', '2',
    '-c:a', 'aac', '-ar', '48000', '-b:a', '128k',
    '-movflags', '+faststart', 'out.mp4',
  ];
}
