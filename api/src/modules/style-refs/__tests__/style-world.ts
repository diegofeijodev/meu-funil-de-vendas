import { Jimp } from 'jimp';
import { WorkspaceAccessService } from '../../access/access.service';
import { FakeTable } from '../../brands/__tests__/fake-prisma';
import { ImageService } from '../../media/image.service';
import { StyleRefsService } from '../style-refs.service';

export const WS = '11111111-1111-4111-8111-111111111111';
export const OWNER = '22222222-2222-4222-8222-222222222222';
export const VIEWER = '33333333-3333-4333-8333-333333333333';
export const BRAND = '44444444-4444-4444-8444-444444444444';
export const CAMP = '55555555-5555-4555-8555-555555555555';

export const status = async (p: Promise<unknown>) => {
  try { await p; return 'ok'; } catch (e: any) { return `${e.getStatus?.() ?? 500}:${e.getResponse?.().message ?? e.message}`; }
};

export async function png(): Promise<Uint8Array> {
  return new Uint8Array(await new Jimp({ width: 8, height: 8, color: 0xff8800ff }).getBuffer('image/png'));
}

export const NOTES = { paleta: ['laranja', 'creme'], composicao: 'prato ao centro', luz: 'de fim de tarde', enquadramento: 'bem de perto', clima: 'aconchegante', evitar: ['fundo branco'], categorias: ['comida_hamburguer'], assunto: 'hambúrguer no balcão', acabamento: 'madeira escura, fundo desfocado' };

export async function setup(opts: { pinterest?: boolean; env?: Record<string, unknown>; aiKey?: string | null; aiCredit?: 'no_credit' | 'daily_limit' | null } = {}) {
  const t = {
    brands: new FakeTable(() => ({ segment: null, style_library_enabled: true, style_library_segment: null, style_library_checked_at: null, style_selection_day: null, style_selection_reads: 0 })),
    campaigns: new FakeTable(),
    style_references: new FakeTable(() => ({ status: 'processing', style_notes: {}, error: null, claimed_at: null, attempts: 0, campaign_id: null, source_id: null, pin_id: null, kind: 'image', origin: 'own' })),
    style_ref_sources: new FakeTable(() => ({ last_synced_at: null, last_error: null, title: null, seen_pin_ids: [], origin: 'own' })),
    workspace_members: {
      findUnique: async ({ where }: any) => {
        const k = where.workspace_id_user_id;
        if (k.workspace_id !== WS) return null;
        return k.user_id === OWNER ? { role: 'owner' } : k.user_id === VIEWER ? { role: 'viewer' } : null;
      },
    },
  };
  await t.brands.create({ data: { id: BRAND, workspace_id: WS, name: 'Freela' } });
  await t.campaigns.create({ data: { id: CAMP, workspace_id: WS, brand_id: BRAND, name: 'Jundiaí' } });
  const prisma: any = { ...t, $transaction: async (fn: any) => fn(prisma) };
  const img = await png();
  const routes = new Map<string, () => Response>();
  const fetched: string[] = [];
  const fetch = jest.fn(async (url: string) => {
    fetched.push(url);
    const r = routes.get(url);
    return r ? r() : new Response('não', { status: 404 });
  });
  const files = new Map<string, Uint8Array>();
  const filesSvc: any = {
    put: async (b: string, k: string, bytes: Uint8Array) => { files.set(`${b}/${k}`, new Uint8Array(bytes)); },
    read: async (b: string, k: string) => Buffer.from(files.get(`${b}/${k}`)!),
    delete: async (b: string, k: string) => { files.delete(`${b}/${k}`); },
    signedUrl: (b: string, k: string) => `https://api.test/v1/files/${b}/${k}?sig=x`,
  };
  const ai = { json: jest.fn(async () => NOTES) };
  // Chaves de IA e aviso de crédito falsos (o `AiModule` é @Global): sem chave e sem aviso por padrão; os testes mudam pelos `jest.fn`.
  const keys = { get: jest.fn(async (_ws: string, _vendor: string): Promise<string | null> => opts.aiKey ?? null) };
  const alerts = { status: jest.fn(async (_ws: string): Promise<unknown> => (opts.aiCredit ? { level: 'stopped', vendors: [{ reason: opts.aiCredit }] } : null)) };
  const svc = new StyleRefsService(prisma, new WorkspaceAccessService(prisma), ai as any, filesSvc, new ImageService(), fetch as any, { STYLE_REFS_PINTEREST_ENABLED: opts.pinterest ?? true, STYLE_LIBRARY_ENABLED: false, ...opts.env } as any, keys as any, alerts as any);
  svc.autoProcess = false;
  const image = () => new Response(Buffer.from(img), { status: 200, headers: { 'content-type': 'image/png' } });
  return { t, svc, ai, fetch, fetched, routes, files, img, image, keys, alerts };
}
