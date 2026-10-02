import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { roleAllows, WorkspaceAccessService, WorkspaceRole } from '../../access/access.service';
import { FilesService } from '../../files/files.service';
import { ImageService } from '../../media/image.service';
import { BrandGuideService } from '../brand-guide.service';
import { FakeTable } from './fake-prisma';

const dir = mkdtempSync(path.join(tmpdir(), 'mf-guide-'));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

const WS = randomUUID();
const OTHER_WS = randomUUID();
const USER = randomUUID();
// PNG de verdade (a referência passa pelo jimp antes de ir para a IA); 2000x1000 para provar a redução a 1024 px.
let PNG: Buffer;
const images = new ImageService();
beforeAll(async () => {
  PNG = Buffer.from(await images.encode(images.blank(2000, 1000, 0x336699ff), true));
});

function setup(role: WorkspaceRole | null) {
  const brands = new FakeTable();
  const brand_assets = new FakeTable();
  const prisma: any = { brands, brand_assets, workspace_members: { findUnique: async () => (role ? { role } : null) } };
  const access = new WorkspaceAccessService(prisma);
  const calls: any[] = [];
  const ai: any = { vision: async (ws: string, req: any) => { calls.push({ ws, req }); return { estilo_fotografico: 'x', paleta_hex: ['#fff'] }; } };
  const files = new FilesService({ UPLOADS_DIR: dir, JWT_SECRET: 'segredo-de-teste-16+', PUBLIC_URL: 'http://api.test', FILES_SIGNING_SECRET: undefined } as any);
  return { svc: new BrandGuideService(prisma, access, ai, files, images), brands, brand_assets, files, calls };
}

const status = async (p: Promise<unknown>) => {
  try { await p; return 'ok'; } catch (e: any) { return `${e.getStatus()}:${e.getResponse().message}`; }
};

describe('BrandGuideService.generate', () => {
  it('marca inexistente ou de workspace do qual não sou membro → 404 "Marca não encontrada."', async () => {
    const a = setup('owner');
    expect(await status(a.svc.generate(USER, randomUUID()))).toBe('404:Marca não encontrada.');
    const b = setup(null);
    const brand = await b.brands.create({ data: { workspace_id: OTHER_WS, name: 'Alheia', segment: null } });
    expect(await status(b.svc.generate(USER, brand.id))).toBe('404:Marca não encontrada.');
  });

  it('viewer não gasta crédito de IA → 403', async () => {
    const { svc, brands } = setup('viewer');
    const brand = await brands.create({ data: { workspace_id: WS, name: 'M', segment: null } });
    expect(roleAllows('viewer', 'write')).toBe(false);
    expect(await status(svc.generate(USER, brand.id))).toBe('403:Seu perfil não tem permissão para esta ação.');
  });

  it('sem foto de referência → 400 com a mensagem do protótipo', async () => {
    const { svc, brands } = setup('owner');
    const brand = await brands.create({ data: { workspace_id: WS, name: 'M', segment: null } });
    expect(await status(svc.generate(USER, brand.id))).toBe('400:Envie ao menos uma foto de referência (produto, ambiente ou equipe).');
  });

  it('usa as referências (produto primeiro, sem PDF/SVG/fonte), manda as imagens à IA e devolve guide + ids', async () => {
    const { svc, brands, brand_assets, files, calls } = setup('marketing');
    const brand = await brands.create({ data: { workspace_id: WS, name: 'Bar do Zé', segment: 'Bar' } });
    const mk = async (kind: string, tag: string | null, name: string, ext: string) => {
      const key = files.newUploadKey('brands', WS, ext);
      await files.put('creative-assets', key, PNG);
      return brand_assets.create({ data: { workspace_id: WS, brand_id: brand.id, kind, tag, name, storage_path: key } });
    };
    const amb = await mk('reference', 'ambiente', 'a.png', 'png');
    const prod = await mk('photo', 'produto', 'p.jpg', 'jpg');
    await mk('reference', 'equipe', 'doc.pdf', 'pdf');
    await mk('logo', null, 'logo.png', 'png');
    const out = await svc.generate(USER, brand.id);
    expect(out.referencias).toEqual([prod.id, amb.id]);
    expect(out.guide).toEqual({ estilo_fotografico: 'x', paleta_hex: ['#fff'] });
    expect(calls).toHaveLength(1);
    expect(calls[0].ws).toBe(WS);
    expect(calls[0].req.images).toHaveLength(2);
    expect(calls[0].req.images[0].mime).toBe('image/jpeg');
    // reduzida a no máximo 1024 px no maior lado (como o `shrink` do protótipo)
    const small = await images.read(calls[0].req.images[0].bytes);
    expect(Math.max(small.bitmap.width, small.bitmap.height)).toBe(1024);
    expect(calls[0].req.name).toBe('brand_guide');
    expect(calls[0].req.prompt).toContain('"Bar do Zé" (Bar)');
  });

  it('ignora referência cujo arquivo sumiu ou cuja chave é de outro workspace', async () => {
    const { svc, brands, brand_assets, files } = setup('owner');
    const brand = await brands.create({ data: { workspace_id: WS, name: 'M', segment: null } });
    await brand_assets.create({ data: { workspace_id: WS, brand_id: brand.id, kind: 'reference', name: 'x.png', storage_path: files.newUploadKey('brands', WS, 'png') } });
    await brand_assets.create({ data: { workspace_id: WS, brand_id: brand.id, kind: 'reference', name: 'y.png', storage_path: files.newUploadKey('brands', OTHER_WS, 'png') } });
    expect(await status(svc.generate(USER, brand.id))).toBe('400:Envie ao menos uma foto de referência (produto, ambiente ou equipe).');
  });
});
