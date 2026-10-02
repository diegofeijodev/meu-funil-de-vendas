import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../common/database/prisma.service';
import { isUuid } from '../../common/ids/uuid';
import { ActivityService } from '../activity/activity.service';
import { FilesService } from '../files/files.service';
import {
  CreateBrandAssetDto, CreateBrandDto, CreatePersonaDto, CreateProductDto, UpdateBrandDto, UpdatePersonaDto, UpdateProductDto,
} from './dto/brands.dto';

const notFound = (message = 'Não encontrado.') => new NotFoundException({ code: 'NOT_FOUND', message });
const BUCKET = 'creative-assets';
const MAX_VISUAL_STYLE_CHARS = 50_000;

/**
 * Brand Kit: marcas, produtos, personas, arquivos da marca e aprendizados.
 * Substitui os acessos diretos do navegador (RLS) das telas /brands e /brands/$id.
 * Toda id (marca, produto, persona, arquivo) é conferida contra o workspace da URL.
 */
@Injectable()
export class BrandsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly activity: ActivityService,
    private readonly files: FilesService,
  ) {}

  // ------------------------------------------------------------------ marcas

  /** `brands select *, campaigns(count), products(count)` order created_at. */
  async list(workspaceId: string) {
    const rows = await this.prisma.brands.findMany({
      where: { workspace_id: workspaceId },
      orderBy: { created_at: 'asc' },
      include: { _count: { select: { campaigns: true, products: true } } },
    });
    return rows.map(({ _count, ...b }) => ({ ...b, campaigns: [{ count: _count.campaigns }], products: [{ count: _count.products }] }));
  }

  async create(userId: string, workspaceId: string, dto: CreateBrandDto) {
    const name = dto.name.trim();
    if (!name) throw new BadRequestException({ code: 'BAD_REQUEST', message: 'Informe o nome da marca.' });
    const brand = await this.prisma.brands.create({ data: { workspace_id: workspaceId, name, segment: dto.segment ?? '' } });
    await this.activity.log(workspaceId, userId, 'brand.created', 'brand', { name });
    return brand;
  }

  async get(workspaceId: string, brandId: string) {
    const brand = await this.prisma.brands.findFirst({ where: { id: brandId, workspace_id: workspaceId } });
    if (!brand) throw notFound('Marca não encontrada.');
    return brand;
  }

  async update(userId: string, workspaceId: string, brandId: string, dto: UpdateBrandDto) {
    await this.get(workspaceId, brandId);
    if (dto.name !== undefined && !dto.name.trim()) throw new BadRequestException({ code: 'BAD_REQUEST', message: 'Informe o nome da marca.' });
    if (dto.visual_style !== undefined && JSON.stringify(dto.visual_style).length > MAX_VISUAL_STYLE_CHARS) {
      throw new BadRequestException({ code: 'BAD_REQUEST', message: 'Guia visual grande demais.' });
    }
    const { visual_style, ...rest } = dto;
    const brand = await this.prisma.brands.update({
      where: { id: brandId },
      data: { ...rest, ...(visual_style !== undefined ? { visual_style: visual_style as Prisma.InputJsonObject } : {}) },
    });
    // O "Salvar guia visual" (só `visual_style`) não gravava atividade no protótipo.
    if (Object.keys(rest).length) await this.activity.log(workspaceId, userId, 'brand.updated', 'brand', { brand_id: brandId });
    return brand;
  }

  /** O cascade (campanhas, produtos, criativos…) vem das FKs do banco, como no protótipo. */
  async remove(userId: string, workspaceId: string, brandId: string): Promise<void> {
    const brand = await this.get(workspaceId, brandId);
    await this.prisma.brands.delete({ where: { id: brandId } });
    await this.activity.log(workspaceId, userId, 'brand.deleted', 'brand', { name: brand.name });
  }

  // ------------------------------------------------------------------ produtos

  listProducts(workspaceId: string, brandId: string) {
    return this.scoped(workspaceId, brandId, () =>
      this.prisma.products.findMany({ where: { brand_id: brandId, workspace_id: workspaceId }, orderBy: { created_at: 'asc' } }),
    );
  }

  createProduct(workspaceId: string, brandId: string, dto: CreateProductDto) {
    return this.scoped(workspaceId, brandId, () =>
      this.prisma.products.create({
        data: { workspace_id: workspaceId, brand_id: brandId, name: dto.name, description: dto.description, price: dto.price ?? 0, margin_percent: dto.margin_percent ?? 0 },
      }),
    );
  }

  async updateProduct(workspaceId: string, brandId: string, id: string, dto: UpdateProductDto) {
    await this.child('products', workspaceId, brandId, id);
    return this.prisma.products.update({ where: { id }, data: dto });
  }

  async removeProduct(workspaceId: string, brandId: string, id: string): Promise<void> {
    await this.child('products', workspaceId, brandId, id);
    await this.prisma.products.delete({ where: { id } });
  }

  // ------------------------------------------------------------------ personas

  listPersonas(workspaceId: string, brandId: string) {
    return this.scoped(workspaceId, brandId, () =>
      this.prisma.personas.findMany({ where: { brand_id: brandId, workspace_id: workspaceId }, orderBy: { created_at: 'asc' } }),
    );
  }

  createPersona(workspaceId: string, brandId: string, dto: CreatePersonaDto) {
    return this.scoped(workspaceId, brandId, () => this.prisma.personas.create({ data: { workspace_id: workspaceId, brand_id: brandId, ...dto } }));
  }

  async updatePersona(workspaceId: string, brandId: string, id: string, dto: UpdatePersonaDto) {
    await this.child('personas', workspaceId, brandId, id);
    return this.prisma.personas.update({ where: { id }, data: dto });
  }

  async removePersona(workspaceId: string, brandId: string, id: string): Promise<void> {
    await this.child('personas', workspaceId, brandId, id);
    await this.prisma.personas.delete({ where: { id } });
  }

  // ------------------------------------------------------------------ aprendizados

  /** `brand_learnings select * eq brand_id order score desc`. */
  listLearnings(workspaceId: string, brandId: string) {
    return this.scoped(workspaceId, brandId, () =>
      this.prisma.brand_learnings.findMany({
        where: { brand_id: brandId, workspace_id: workspaceId },
        orderBy: [{ score: { sort: 'desc', nulls: 'last' } }, { created_at: 'asc' }],
      }),
    );
  }

  // ------------------------------------------------------------------ arquivos da marca

  listAssets(workspaceId: string, brandId: string) {
    return this.scoped(workspaceId, brandId, () =>
      this.prisma.brand_assets.findMany({ where: { brand_id: brandId, workspace_id: workspaceId }, orderBy: { created_at: 'asc' } }),
    );
  }

  /**
   * Registra um arquivo enviado antes (`POST …/files?kind=brands`). A chave precisa ser
   * `brands/<workspaceId>/…` e existir; a `url` é a assinada de 5 anos (mesma forma do protótipo).
   * Logo: também grava `brands.logo_url` (o protótipo fazia um segundo `update`).
   */
  async createAsset(workspaceId: string, brandId: string, dto: CreateBrandAssetDto) {
    await this.get(workspaceId, brandId);
    const key = dto.storage_path;
    const ok = key.startsWith('brands/') && this.files.keyBelongsToWorkspace(key, workspaceId) && (await this.safeExists(key));
    if (!ok) throw new BadRequestException({ code: 'BAD_REQUEST', message: 'Chave de arquivo inválida.' });
    const url = this.files.signedUrl(BUCKET, key);
    return this.prisma.$transaction(async (tx) => {
      const asset = await tx.brand_assets.create({
        data: { workspace_id: workspaceId, brand_id: brandId, kind: dto.kind, url, name: dto.name, storage_path: key, tag: dto.kind === 'reference' ? (dto.tag ?? null) : null },
      });
      if (dto.kind === 'logo') await tx.brands.update({ where: { id: brandId }, data: { logo_url: url } });
      return asset;
    });
  }

  async removeAsset(workspaceId: string, brandId: string, id: string): Promise<void> {
    await this.child('brand_assets', workspaceId, brandId, id);
    await this.prisma.brand_assets.delete({ where: { id } });
  }

  // ------------------------------------------------------------------ helpers

  private async safeExists(key: string): Promise<boolean> {
    try {
      return await this.files.exists(BUCKET, key);
    } catch {
      return false;
    }
  }

  /** A marca precisa ser do workspace da URL antes de qualquer leitura/escrita dos filhos. */
  private async scoped<T>(workspaceId: string, brandId: string, fn: () => Promise<T>): Promise<T> {
    await this.get(workspaceId, brandId);
    return fn();
  }

  /** O filho (`products`/`personas`/`brand_assets`) precisa ser da marca E do workspace. */
  private async child(table: 'products' | 'personas' | 'brand_assets', workspaceId: string, brandId: string, id: string): Promise<void> {
    if (!isUuid(id)) throw notFound();
    const where = { id, brand_id: brandId, workspace_id: workspaceId };
    const found = await (this.prisma[table] as unknown as { findFirst(a: { where: typeof where; select: { id: true } }): Promise<{ id: string } | null> }).findFirst({ where, select: { id: true } });
    if (!found) throw notFound();
  }
}
