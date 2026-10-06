import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FilesService } from '../../../modules/files/files.service';
import { copyExportedFiles } from '../copy-files';
import { assertObjects, exportedFilePath, Manifest, readManifest, readTable, tableKeys } from '../export-reader';

const BUCKETS = ['creative-assets', 'ig-media'];
const dirs: string[] = [];
const tmp = () => { const d = mkdtempSync(join(tmpdir(), 'lovexp-')); dirs.push(d); return d; };
afterEach(() => { for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true }); });

function fixture() {
  const dir = tmp();
  const m: Manifest = {
    counts: { 'public.brands': 1, 'auth.users': 0 },
    buckets: [{ id: 'creative-assets', public: false }],
    objects: [{ bucket_id: 'creative-assets', name: 'brands/w1/logo.png', size: 4 }],
  };
  writeFileSync(join(dir, 'manifest.json'), JSON.stringify(m));
  mkdirSync(join(dir, 'tables'));
  writeFileSync(join(dir, 'tables', 'public.brands.json'), JSON.stringify([{ id: 'b1' }]));
  mkdirSync(join(dir, 'storage', 'creative-assets', 'brands', 'w1'), { recursive: true });
  writeFileSync(join(dir, 'storage', 'creative-assets', 'brands', 'w1', 'logo.png'), 'LOGO');
  return { dir, m };
}

describe('export-reader', () => {
  it('lê manifesto, chaves e tabelas', () => {
    const { dir } = fixture();
    const m = readManifest(dir);
    expect(tableKeys(m)).toEqual([{ schema: 'public', table: 'brands', count: 1 }, { schema: 'auth', table: 'users', count: 0 }]);
    expect(readTable(dir, 'public', 'brands')).toEqual([{ id: 'b1' }]);
  });

  it('tabela ausente na pasta aborta', () => {
    const { dir } = fixture();
    expect(() => readTable(dir, 'public', 'nao_existe')).toThrow('falta tables/public.nao_existe.json');
  });

  it('caminho que tenta sair da pasta aborta', () => {
    const { dir } = fixture();
    expect(() => exportedFilePath(dir, 'creative-assets', '../../etc/passwd')).toThrow('caminho de arquivo inválido');
  });

  it('bucket fora do previsto aborta', () => {
    const { dir, m } = fixture();
    m.objects.push({ bucket_id: 'avatars', name: 'a.png', size: 1 });
    expect(() => assertObjects(dir, m, BUCKETS)).toThrow('buckets fora do previsto na exportação: avatars');
  });

  it('arquivo com tamanho diferente do manifesto aborta', () => {
    const { dir, m } = fixture();
    m.objects[0]!.size = 99;
    expect(() => assertObjects(dir, m, BUCKETS)).toThrow('ausentes ou com tamanho diferente');
  });
});

describe('copyExportedFiles', () => {
  const filesFor = (up: string) => new FilesService({ UPLOADS_DIR: up, JWT_SECRET: 'segredo-de-teste-123456', PUBLIC_URL: 'https://api.test' } as never);

  it('copia para UPLOADS_DIR/<bucket>/<chave> e é idempotente', async () => {
    const { dir, m } = fixture();
    const up = tmp();
    expect(await copyExportedFiles(dir, m, filesFor(up))).toEqual({ copied: 1, skipped: 0 });
    expect(readFileSync(join(up, 'creative-assets', 'brands', 'w1', 'logo.png'), 'utf8')).toBe('LOGO');
    expect(await copyExportedFiles(dir, m, filesFor(up))).toEqual({ copied: 0, skipped: 1 });
  });

  it('chave que o FilesService recusa aborta', async () => {
    const { dir, m } = fixture();
    m.objects[0]!.name = 'brands//logo.png';
    await expect(copyExportedFiles(dir, m, filesFor(tmp()))).rejects.toThrow('Chave de arquivo inválida');
  });
});
