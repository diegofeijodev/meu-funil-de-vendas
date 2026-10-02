import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { FilesService, mimeFromKey } from '../files.service';

const dir = mkdtempSync(path.join(tmpdir(), 'mf-files-'));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

const mk = (over: Record<string, string> = {}) =>
  new FilesService({ UPLOADS_DIR: dir, JWT_SECRET: 'segredo-de-teste-16+', PUBLIC_URL: 'http://api.test', FILES_SIGNING_SECRET: undefined, ...over } as any);
const q = (url: string) => new URL(url).searchParams;
const code = (fn: () => unknown) => { try { fn(); } catch (e: any) { return e.getStatus(); } return 'ok'; };

describe('FilesService — URL assinada', () => {
  const svc = mk();
  const key = '2026-10-02/abc-123.png';

  it('assina e verifica; URL tem bucket, chave, exp e sig', () => {
    const url = svc.signedUrl('creative-assets', key);
    expect(url.startsWith('http://api.test/v1/files/creative-assets/2026-10-02/abc-123.png?')).toBe(true);
    const p = q(url);
    expect(() => svc.verify('creative-assets', key, p.get('exp')!, p.get('sig')!)).not.toThrow();
  });

  it('validade padrão ~5 anos', () => {
    const exp = Number(q(svc.signedUrl('creative-assets', key, undefined, 0)).get('exp'));
    expect(exp).toBe(60 * 60 * 24 * 365 * 5);
  });

  it('expirada → 403', () => {
    const p = q(svc.signedUrl('creative-assets', key, 60, 1_000_000));
    expect(code(() => svc.verify('creative-assets', key, p.get('exp')!, p.get('sig')!, 1_000_000 + 59_000))).toBe('ok');
    expect(code(() => svc.verify('creative-assets', key, p.get('exp')!, p.get('sig')!, 1_000_000 + 61_000))).toBe(403);
  });

  it('assinatura/chave/bucket/exp adulterados → 403', () => {
    const p = q(svc.signedUrl('creative-assets', key));
    const [exp, sig] = [p.get('exp')!, p.get('sig')!];
    expect(code(() => svc.verify('creative-assets', '2026-10-02/outro.png', exp, sig))).toBe(403);
    expect(code(() => svc.verify('ig-media', key, exp, sig))).toBe(403);
    expect(code(() => svc.verify('creative-assets', key, String(Number(exp) + 1), sig))).toBe(403);
    expect(code(() => svc.verify('creative-assets', key, exp, sig.replace(/^./, sig[0] === 'a' ? 'b' : 'a')))).toBe(403);
    expect(code(() => svc.verify('creative-assets', key, exp, 'zz'))).toBe(403);
    expect(code(() => svc.verify('creative-assets', key, exp, 'g'.repeat(64)))).toBe(403);
    expect(code(() => svc.verify('creative-assets', key, exp, sig.toUpperCase()))).toBe(403);
    expect(code(() => svc.verify('creative-assets', key, undefined, undefined))).toBe(403);
  });

  it('outro segredo não valida a assinatura', () => {
    const p = q(svc.signedUrl('creative-assets', key));
    expect(code(() => mk({ JWT_SECRET: 'outro-segredo-16+++' }).verify('creative-assets', key, p.get('exp')!, p.get('sig')!))).toBe(403);
  });
});

describe('FilesService — contenção de caminho', () => {
  const svc = mk();
  it.each(['../etc/passwd', 'a/../../x', '/abs/x', 'a\\b', 'a//b', './x', 'a/./b', '', 'x\0y'])('rejeita chave %j', (k) => {
    expect(code(() => svc.resolvePath('creative-assets', k))).toBe(400);
  });
  it('bucket desconhecido → 404', () => {
    expect(code(() => svc.resolvePath('outro', 'a/b.png'))).toBe(404);
    expect(code(() => svc.resolvePath('../creative-assets', 'a.png'))).toBe(404);
  });
  it('caminho resolvido fica dentro de UPLOADS_DIR/<bucket>', () => {
    const p = svc.resolvePath('creative-assets', 'brands/ws/a.png');
    expect(p).toBe(path.join(dir, 'creative-assets', 'brands', 'ws', 'a.png'));
  });
  it('signedUrl valida a chave (não assina caminho que escapa)', () => {
    expect(code(() => svc.signedUrl('creative-assets', '../x'))).toBe(400);
  });
});

describe('FilesService — disco e chaves de upload', () => {
  const svc = mk();
  const ws = '22222222-2222-4222-8222-222222222222';
  it('put/read/exists/delete', async () => {
    await svc.put('creative-assets', 'media/x/a.png', Buffer.from('png!'));
    expect(await svc.exists('creative-assets', 'media/x/a.png')).toBe(true);
    expect((await svc.read('creative-assets', 'media/x/a.png')).toString()).toBe('png!');
    await svc.delete('creative-assets', 'media/x/a.png');
    expect(await svc.exists('creative-assets', 'media/x/a.png')).toBe(false);
    await expect(svc.read('creative-assets', 'media/x/a.png')).rejects.toMatchObject({ status: 404 });
  });
  it('chave de upload é <kind>/<workspaceId>/<uuid>.<ext> e pertence ao workspace', () => {
    const k = svc.newUploadKey('brands', ws, 'png');
    expect(k).toMatch(new RegExp(`^brands/${ws}/[0-9a-f-]{36}\\.png$`));
    expect(svc.keyBelongsToWorkspace(k, ws)).toBe(true);
    expect(svc.keyBelongsToWorkspace(k, '33333333-3333-4333-8333-333333333333')).toBe(false);
    expect(svc.keyBelongsToWorkspace('2026-10-02/x.png', ws)).toBe(false);
    expect(code(() => svc.newUploadKey('..', ws, 'png'))).toBe(400);
  });
  it('chave gerada segue YYYY-MM-DD/<uuid>.<ext> e o mime sai da extensão', () => {
    expect(svc.newGeneratedKey('mp4', new Date('2026-10-02T12:00:00Z'))).toMatch(/^2026-10-02\/[0-9a-f-]{36}\.mp4$/);
    expect(mimeFromKey('a/b.JPG')).toBe('image/jpeg');
    expect(mimeFromKey('a/b.xyz')).toBe('application/octet-stream');
  });
});
