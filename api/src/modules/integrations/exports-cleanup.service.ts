import { Inject, Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import { ENV } from '../../common/config/env.module';
import { Env } from '../../common/config/env.validation';
import { FilesService } from '../files/files.service';
import { MEDIA_BUCKET } from '../media/assets.service';
import { SchedulerService } from '../scheduler/scheduler.service';

/** Pasta (dentro do bucket de mídia) onde os exports da biblioteca/CapCut são gravados: `exports/<workspaceId>/...`. */
export const EXPORTS_PREFIX = 'exports';
export const EXPORTS_CLEANUP_JOB = 'exports-cleanup-hourly';

export interface CleanupResult {
  deleted: number;
  kept: number;
  skipped: number;
}

/**
 * Apaga os arquivos de `exports/<workspaceId>/` mais velhos que `EXPORTS_TTL_HOURS` (padrão 24 h).
 * O link de download vale só 10 min (`AssetsService.storeForDownload`), então 24 h sobra e nada fica acumulando em disco.
 * Só mexe DENTRO de `<UPLOADS_DIR>/creative-assets/exports`: a raiz vem de `FilesService.resolvePath` (rejeita `..`),
 * links simbólicos nunca são seguidos nem apagados e cada alvo é conferido de novo por `realpath` antes do `rm`.
 * Roda de hora em hora no agendador (`SCHEDULER_ENABLED=true`), com heartbeat `exports_cleanup`.
 */
@Injectable()
export class ExportsCleanupService implements OnModuleInit {
  private readonly logger = new Logger(ExportsCleanupService.name);

  constructor(
    private readonly files: FilesService,
    private readonly scheduler: SchedulerService,
    @Inject(ENV) private readonly env: Pick<Env, 'EXPORTS_TTL_HOURS'>,
  ) {}

  onModuleInit() {
    this.scheduler.register({
      name: EXPORTS_CLEANUP_JOB,
      cron: '47 * * * *',
      heartbeat: 'exports_cleanup',
      handler: async () => {
        const r = await this.cleanup();
        return `${r.deleted} arquivo(s) de export apagado(s), ${r.kept} dentro do prazo`;
      },
    });
  }

  get ttlMs(): number {
    return (this.env.EXPORTS_TTL_HOURS ?? 24) * 3600_000;
  }

  async cleanup(now = Date.now(), ttlMs = this.ttlMs): Promise<CleanupResult> {
    const out: CleanupResult = { deleted: 0, kept: 0, skipped: 0 };
    const root = this.files.resolvePath(MEDIA_BUCKET, EXPORTS_PREFIX);
    let realRoot: string;
    try {
      realRoot = await fs.realpath(root);
    } catch {
      return out; // ainda não houve nenhum export
    }
    // A própria raiz precisa ser uma pasta real DENTRO do bucket: link simbólico em `exports` (ou bucket trocado) = não mexe em nada.
    const realBucket = await fs.realpath(path.dirname(root)).catch(() => null);
    const rootIsLink = (await fs.lstat(root).catch(() => null))?.isSymbolicLink() ?? true;
    if (rootIsLink || !realBucket || !realRoot.startsWith(realBucket + path.sep)) {
      this.logger.warn('exports: a raiz não está dentro do bucket (link simbólico?); limpeza ignorada');
      out.skipped++;
      return out;
    }
    await this.walk(root, realRoot, now - ttlMs, out, true);
    return out;
  }

  private async walk(dir: string, realRoot: string, cutoff: number, out: CleanupResult, isRoot = false): Promise<void> {
    let entries: import('node:fs').Dirent[];
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      const full = path.join(dir, e.name);
      if (e.isSymbolicLink()) {
        out.skipped++;
        continue;
      }
      if (e.isDirectory()) {
        await this.walk(full, realRoot, cutoff, out);
        continue;
      }
      if (!e.isFile()) continue;
      try {
        const real = await fs.realpath(full);
        if (!real.startsWith(realRoot + path.sep)) {
          out.skipped++;
          continue;
        }
        const st = await fs.stat(real);
        if (st.mtimeMs >= cutoff) {
          out.kept++;
          continue;
        }
        await fs.rm(real, { force: true });
        out.deleted++;
      } catch (err) {
        out.skipped++;
        this.logger.warn(`exports: ${e.name}: ${err instanceof Error ? err.message : err}`);
      }
    }
    if (!isRoot) await fs.rmdir(dir).catch(() => undefined); // pasta do workspace vazia some (rmdir não apaga se ainda tiver algo)
  }
}
