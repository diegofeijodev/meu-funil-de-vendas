import { mkdirSync, mkdtempSync, rmSync, symlinkSync, utimesSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { FilesService } from '../../files/files.service';
import { EXPORTS_CLEANUP_JOB, ExportsCleanupService } from '../exports-cleanup.service';

const HOUR = 3600_000;
const NOW = Date.UTC(2026, 9, 2, 12, 0, 0);

function setup(ttlHours = 24) {
  const dir = mkdtempSync(path.join(tmpdir(), 'mf-exports-'));
  const files = new FilesService({ UPLOADS_DIR: dir, JWT_SECRET: 'segredo-de-teste-16+', PUBLIC_URL: 'http://api.test', FILES_SIGNING_SECRET: undefined } as any);
  const registered: any[] = [];
  const svc = new ExportsCleanupService(files, { register: (j: any) => registered.push(j) } as any, { EXPORTS_TTL_HOURS: ttlHours });
  const bucket = path.join(dir, 'creative-assets');
  const put = (rel: string, ageHours: number, root = bucket) => {
    const full = path.join(root, rel);
    mkdirSync(path.dirname(full), { recursive: true });
    writeFileSync(full, 'x');
    const t = (NOW - ageHours * HOUR) / 1000;
    utimesSync(full, t, t);
    return full;
  };
  return { dir, bucket, svc, put, registered, done: () => rmSync(dir, { recursive: true, force: true }) };
}

describe('ExportsCleanupService', () => {
  it('apaga o que passou do prazo e mantém o recente (por workspace); a pasta vazia some', async () => {
    const w = setup();
    const velho = w.put('exports/ws1/a-capcut.zip', 25);
    const velho2 = w.put('exports/ws2/b.zip', 100);
    const novo = w.put('exports/ws1/novo.zip', 1);
    const r = await w.svc.cleanup(NOW);
    expect(r).toEqual({ deleted: 2, kept: 1, skipped: 0 });
    expect(existsSync(velho)).toBe(false);
    expect(existsSync(velho2)).toBe(false);
    expect(existsSync(novo)).toBe(true);
    expect(existsSync(path.join(w.bucket, 'exports/ws2'))).toBe(false);
    expect(existsSync(path.join(w.bucket, 'exports/ws1'))).toBe(true);
    w.done();
  });

  it('o prazo vem de EXPORTS_TTL_HOURS', async () => {
    const w = setup(2);
    const f = w.put('exports/ws1/x.zip', 3);
    expect((await w.svc.cleanup(NOW)).deleted).toBe(1);
    expect(existsSync(f)).toBe(false);
    w.done();
  });

  it('nunca toca fora de exports/: mídia, uploads e outros buckets velhos continuam lá', async () => {
    const w = setup();
    const midia = w.put('media/ws1/foto.png', 500);
    const marca = w.put('brands/ws1/logo.png', 500);
    const igmedia = w.put('x.png', 500, path.join(w.dir, 'ig-media'));
    w.put('exports/ws1/velho.zip', 500);
    await w.svc.cleanup(NOW);
    for (const f of [midia, marca, igmedia]) expect(existsSync(f)).toBe(true);
    w.done();
  });

  it('link simbólico para fora da raiz é ignorado: nem o alvo nem o link são apagados', async () => {
    const w = setup();
    const fora = w.put('segredo.txt', 900, path.join(w.dir, 'fora'));
    mkdirSync(path.join(w.bucket, 'exports/ws1'), { recursive: true });
    symlinkSync(fora, path.join(w.bucket, 'exports/ws1/atalho.zip'));
    symlinkSync(path.join(w.dir, 'fora'), path.join(w.bucket, 'exports/ws2'));
    const r = await w.svc.cleanup(NOW);
    expect(r.deleted).toBe(0);
    expect(r.skipped).toBe(2);
    expect(existsSync(fora)).toBe(true);
    expect(existsSync(path.join(w.bucket, "exports/ws1/atalho.zip"))).toBe(true);
    w.done();
  });

  it('raiz `exports` que é link simbólico (ou resolve para fora do bucket) → limpeza ignorada, nada apagado', async () => {
    const w = setup();
    const fora = w.put('exports/ws1/velho.zip', 900, path.join(w.dir, 'fora'));
    mkdirSync(w.bucket, { recursive: true });
    symlinkSync(path.join(w.dir, 'fora', 'exports'), path.join(w.bucket, 'exports'));
    const r = await w.svc.cleanup(NOW);
    expect(r).toEqual({ deleted: 0, kept: 0, skipped: 1 });
    expect(existsSync(fora)).toBe(true);
    w.done();
  });

  it('sem pasta exports ainda → nada a fazer; a raiz é validada pelo FilesService (chave com .. é recusada)', async () => {
    const w = setup();
    expect(await w.svc.cleanup(NOW)).toEqual({ deleted: 0, kept: 0, skipped: 0 });
    expect(() => (w.svc as any).files.resolvePath('creative-assets', 'exports/../../etc')).toThrow();
    expect(() => (w.svc as any).files.resolvePath('creative-assets', '../outro')).toThrow();
    w.done();
  });

  it('registra o job no agendador com heartbeat próprio (de hora em hora)', async () => {
    const w = setup();
    w.svc.onModuleInit();
    expect(w.registered).toHaveLength(1);
    expect(w.registered[0]).toMatchObject({ name: EXPORTS_CLEANUP_JOB, cron: '47 * * * *', heartbeat: 'exports_cleanup' });
    w.put('exports/ws1/a.zip', 48);
    expect(await w.registered[0].handler()).toMatch(/1 arquivo/);
    w.done();
  });
});
