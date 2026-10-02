import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../common/database/prisma.service';
import { WorkspaceAccessService } from '../access/access.service';
import { AiService } from '../ai/ai.service';
import { AiImageInput } from '../ai/ai.types';
import { FilesService, mimeFromKey } from '../files/files.service';
import { ImageService } from '../media/image.service';

const MAX_REFS = 6;
/** Arquivo maior que isto nem é decodificado (a referência é reduzida a ≤1024px JPEG antes do envio à IA, como no protótipo). */
const MAX_REF_BYTES = 20 * 1024 * 1024;
const REF_KINDS = ['reference', 'photo'];

const arr = { type: 'array', items: { type: 'string' } };
export const BRAND_GUIDE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['estilo_fotografico', 'iluminacao', 'paleta_hex', 'ambientes', 'elementos_obrigatorios', 'elementos_proibidos', 'fonte_titulo', 'fonte_corpo'],
  properties: {
    estilo_fotografico: { type: 'string' },
    iluminacao: { type: 'string' },
    paleta_hex: arr,
    ambientes: arr,
    elementos_obrigatorios: arr,
    elementos_proibidos: arr,
    fonte_titulo: { type: 'string' },
    fonte_corpo: { type: 'string' },
  },
};

/** `generateBrandGuide` (creative.functions.ts): a IA olha as fotos de referência e sugere o guia visual. */
@Injectable()
export class BrandGuideService {
  private readonly logger = new Logger(BrandGuideService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly access: WorkspaceAccessService,
    private readonly ai: AiService,
    private readonly files: FilesService,
    private readonly images: ImageService,
  ) {}

  async generate(userId: string, brandId: string) {
    const brand = await this.prisma.brands.findUnique({
      where: { id: brandId },
      select: { id: true, workspace_id: true, name: true, segment: true },
    });
    // Marca de outro workspace parece inexistente (sem vazar que o id existe).
    if (!brand || !(await this.access.roleOf(userId, brand.workspace_id))) {
      throw new NotFoundException({ code: 'NOT_FOUND', message: 'Marca não encontrada.' });
    }
    // Gasta crédito de IA: viewer não (a tela esconde o botão para ele).
    await this.access.require(userId, brand.workspace_id, 'write');

    const refs = await this.loadRefs(brand.workspace_id, brand.id);
    if (!refs.length) {
      throw new BadRequestException({ code: 'BAD_REQUEST', message: 'Envie ao menos uma foto de referência (produto, ambiente ou equipe).' });
    }
    const prompt = [
      `Você é diretor de arte. Estas são fotos reais da marca "${brand.name}" (${brand.segment ?? 'segmento não informado'}).`,
      'Monte o guia visual em português do Brasil, curto e objetivo:',
      'estilo_fotografico (ex.: fotografia gastronômica realista, close, fundo de bar de madeira), iluminacao,',
      'paleta_hex (4 a 6 cores #RRGGBB tiradas das fotos), ambientes (2 a 4), elementos_obrigatorios (o que deve aparecer),',
      'elementos_proibidos (inclua sempre: texto gerado pela IA, marcas de concorrentes), fonte_titulo e fonte_corpo (sugestões de Google Fonts coerentes).',
    ].join('\n');
    const guide = await this.ai.vision(brand.workspace_id, {
      prompt,
      schema: BRAND_GUIDE_SCHEMA,
      name: 'brand_guide',
      images: refs.map((r) => r.image),
    });
    return { guide, referencias: refs.map((r) => r.id) };
  }

  /** `loadBrandRefs`: fotos de referência da marca (produto primeiro), lidas do disco pela `storage_path`. */
  private async loadRefs(workspaceId: string, brandId: string): Promise<{ id: string; image: AiImageInput }[]> {
    const rows = await this.prisma.brand_assets.findMany({
      where: { brand_id: brandId, workspace_id: workspaceId, kind: { in: REF_KINDS } },
      orderBy: { created_at: 'desc' },
      take: 20,
      select: { id: true, tag: true, name: true, storage_path: true },
    });
    const usable = rows.filter((r) => !(r.name ?? '').toLowerCase().endsWith('.pdf'));
    usable.sort((a, b) => Number(b.tag === 'produto') - Number(a.tag === 'produto'));
    const out: { id: string; image: AiImageInput }[] = [];
    for (const r of usable.slice(0, MAX_REFS)) {
      try {
        if (!r.storage_path || !this.files.keyBelongsToWorkspace(r.storage_path, workspaceId)) continue;
        const mime = mimeFromKey(r.storage_path);
        if (!mime.startsWith('image/') || mime === 'image/svg+xml') continue;
        const bytes = await this.files.read('creative-assets', r.storage_path);
        if (bytes.length > MAX_REF_BYTES) continue;
        // Mesmo `shrink` do protótipo (refs.server): ≤1024 px, JPEG q85. Foto ilegível é ignorada.
        out.push({ id: r.id, image: await this.images.shrink(bytes, 1024) });
      } catch (e) {
        this.logger.warn(`[refs] referência ignorada ${r.id}: ${e instanceof Error ? e.message : e}`);
      }
    }
    return out;
  }
}
