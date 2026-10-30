import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { FilesService } from '../../files/files.service';
import { AssetsService } from '../../media/assets.service';
import { RefsService } from '../../creative/refs.service';
import { parsePinterestLink } from '../pinterest';

const files = () =>
  new FilesService({ UPLOADS_DIR: mkdtempSync(path.join(tmpdir(), 'sr-')), JWT_SECRET: 'segredo-de-teste-16+', PUBLIC_URL: 'http://api.test', FILES_SIGNING_SECRET: undefined } as any);

describe('bucket style-refs (revisão das Fatias 5/6)', () => {
  it('existe para gravar, ler e assinar (curta validade: 1 h)', async () => {
    const f = files();
    await f.put('style-refs', 'w/b/x.jpg', new Uint8Array([1, 2, 3]));
    expect([...(await f.read('style-refs', 'w/b/x.jpg'))]).toEqual([1, 2, 3]);
    const now = Date.now();
    const url = new URL(f.signedUrl('style-refs', 'w/b/x.jpg', 3600, now));
    expect(Number(url.searchParams.get('exp'))).toBeLessThanOrEqual(Math.floor(now / 1000) + 3600);
  });

  it('referência nunca vira mídia: AssetsService.download recusa URL do bucket style-refs (não lê o arquivo)', async () => {
    const f = files();
    await f.put('style-refs', 'w/b/x.jpg', new Uint8Array([1, 2, 3]));
    const read = jest.spyOn(f, 'read');
    const assets = new AssetsService({} as any, f, {} as any, jest.fn() as any, { NODE_ENV: 'test' } as any);
    await expect(assets.download(f.signedUrl('style-refs', 'w/b/x.jpg'))).rejects.toThrow(/referência de estilo/i);
    expect(read).not.toHaveBeenCalled();
  });

  it('nem como logo da marca (RefsService ignora o bucket style-refs)', async () => {
    const f = files();
    await f.put('style-refs', 'w/b/x.jpg', new Uint8Array([1, 2, 3]));
    const refs = new RefsService({ brand_assets: { findFirst: async () => null }, brands: { findFirst: async () => ({ logo_url: f.signedUrl('style-refs', 'w/b/x.jpg') }) } } as any, f, {} as any, {} as any);
    expect(await refs.loadLogo('w', 'b')).toBeNull();
  });
});

describe('links malformados', () => {
  it('% quebrado no caminho não derruba (null, sem URIError)', () => {
    expect(parsePinterestLink('https://www.pinterest.com/user/%E0%A4%A/')).toBeNull();
  });
});
