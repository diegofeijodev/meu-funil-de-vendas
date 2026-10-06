import { copyFile, mkdir, stat } from 'node:fs/promises';
import * as path from 'node:path';
import { exportedFilePath, Manifest } from './export-reader';

export type FileTarget = { resolvePath(bucket: string, key: string): string };

/** Copia os arquivos exportados para UPLOADS_DIR/<bucket>/<chave> (contenção do FilesService). Idempotente: pula o que já está com o mesmo tamanho. */
export async function copyExportedFiles(dir: string, m: Manifest, files: FileTarget): Promise<{ copied: number; skipped: number }> {
  let copied = 0;
  let skipped = 0;
  for (const o of m.objects) {
    const src = exportedFilePath(dir, o.bucket_id, o.name);
    const dest = files.resolvePath(o.bucket_id, o.name);
    const [s, d] = await Promise.all([stat(src), stat(dest).catch(() => null)]);
    if (d && d.size === s.size) {
      skipped++;
      continue;
    }
    await mkdir(path.dirname(dest), { recursive: true });
    await copyFile(src, dest);
    copied++;
  }
  return { copied, skipped };
}
