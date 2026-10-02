import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../common/database/prisma.service';
import { CrmDefaultsService } from '../crm-defaults/crm-defaults.service';
import { badRequest, conflict, notFound } from './crm-errors';
import { CreateNamedDto, CreateStageDto, CreateTagDto, SaveSettingsDto, UpdateStageDto } from './dto/crm.dto';

const STAGE_SELECT = { id: true, name: true, color: true, position: true, sla_hours: true, is_won: true, is_lost: true, pipeline_id: true } as const;

/**
 * Funis, etapas, usuários, distribuição, motivos de perda e tags (`/crm/settings` + os ganchos `usePipelines/useStages/
 * useMembers` que todas as telas do CRM usam). Cada leitura garante os padrões do CRM do workspace (`CrmDefaultsService`).
 */
@Injectable()
export class CrmConfigService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly defaults: CrmDefaultsService,
  ) {}

  // ------------------------------------------------------------------ funis e etapas

  async pipelines(ws: string) {
    await this.defaults.ensure(ws);
    return this.prisma.crm_pipelines.findMany({ where: { workspace_id: ws }, orderBy: { created_at: 'asc' }, select: { id: true, name: true, is_default: true } });
  }

  async stages(ws: string, pipelineId?: string) {
    await this.defaults.ensure(ws);
    return this.prisma.crm_stages.findMany({
      where: { workspace_id: ws, ...(pipelineId ? { pipeline_id: pipelineId } : {}) },
      orderBy: { position: 'asc' },
      select: STAGE_SELECT,
    });
  }

  async createStage(ws: string, dto: CreateStageDto) {
    const pipeline = await this.prisma.crm_pipelines.findFirst({ where: { id: dto.pipeline_id, workspace_id: ws }, select: { id: true } });
    if (!pipeline) throw notFound('Funil não encontrado.');
    const name = dto.name.trim();
    if (!name) throw badRequest('Informe o nome da etapa.');
    return this.prisma.crm_stages.create({
      data: {
        workspace_id: ws,
        pipeline_id: dto.pipeline_id,
        name,
        ...(dto.position !== undefined ? { position: dto.position } : {}),
        ...(dto.color ? { color: dto.color } : {}),
        ...(dto.sla_hours !== undefined ? { sla_hours: dto.sla_hours } : {}),
      },
      select: STAGE_SELECT,
    });
  }

  private async stageOr404(ws: string, id: string) {
    const s = await this.prisma.crm_stages.findFirst({ where: { id, workspace_id: ws }, select: { id: true } });
    if (!s) throw notFound('Etapa não encontrada.');
  }

  async updateStage(ws: string, id: string, dto: UpdateStageDto) {
    await this.stageOr404(ws, id);
    if (dto.name !== undefined && !dto.name.trim()) throw badRequest('Informe o nome da etapa.');
    return this.prisma.crm_stages.update({
      where: { id },
      data: {
        ...(dto.name !== undefined ? { name: dto.name.trim() } : {}),
        ...(dto.color !== undefined ? { color: dto.color } : {}),
        ...(dto.position !== undefined ? { position: dto.position } : {}),
        ...(dto.sla_hours !== undefined ? { sla_hours: dto.sla_hours } : {}),
      },
      select: STAGE_SELECT,
    });
  }

  /** Os leads da etapa ficam sem etapa (FK `SET NULL`), como no protótipo. */
  async deleteStage(ws: string, id: string): Promise<void> {
    await this.stageOr404(ws, id);
    await this.prisma.crm_stages.delete({ where: { id } });
  }

  // ------------------------------------------------------------------ usuários

  /** `workspace_members select user_id, role, profiles:user_id(id, full_name, email)`. */
  async members(ws: string) {
    await this.defaults.ensure(ws);
    const members = await this.prisma.workspace_members.findMany({ where: { workspace_id: ws }, orderBy: { created_at: 'asc' }, select: { user_id: true, role: true } });
    const profiles = await this.prisma.profiles.findMany({ where: { id: { in: members.map((m) => m.user_id) } }, select: { id: true, full_name: true, email: true } });
    const byId = new Map(profiles.map((p) => [p.id, p]));
    return members.map((m) => ({ user_id: m.user_id, role: m.role, profiles: byId.get(m.user_id) ?? null }));
  }

  // ------------------------------------------------------------------ distribuição

  async settings(ws: string) {
    await this.defaults.ensure(ws);
    return this.prisma.crm_settings.findUnique({ where: { workspace_id: ws } });
  }

  /** `crm_settings upsert {distribution, default_owner_id|null}`. */
  async saveSettings(ws: string, dto: SaveSettingsDto) {
    await this.defaults.ensure(ws);
    if (dto.default_owner_id) {
      const m = await this.prisma.workspace_members.findUnique({ where: { workspace_id_user_id: { workspace_id: ws, user_id: dto.default_owner_id } }, select: { id: true } });
      if (!m) throw badRequest('Responsável inválido para este workspace.');
    }
    const data = { distribution: dto.distribution, default_owner_id: dto.default_owner_id || null };
    return this.prisma.crm_settings.upsert({ where: { workspace_id: ws }, create: { workspace_id: ws, ...data }, update: data });
  }

  // ------------------------------------------------------------------ motivos de perda e tags

  async lossReasons(ws: string) {
    await this.defaults.ensure(ws);
    return this.prisma.crm_loss_reasons.findMany({ where: { workspace_id: ws }, orderBy: { name: 'asc' }, select: { id: true, name: true } });
  }

  async createLossReason(ws: string, dto: CreateNamedDto) {
    const name = dto.name.trim();
    if (!name) throw badRequest('Informe o motivo de perda.');
    return this.prisma.crm_loss_reasons.create({ data: { workspace_id: ws, name }, select: { id: true, name: true } });
  }

  async deleteLossReason(ws: string, id: string): Promise<void> {
    const r = await this.prisma.crm_loss_reasons.findFirst({ where: { id, workspace_id: ws }, select: { id: true } });
    if (!r) throw notFound('Motivo de perda não encontrado.');
    await this.prisma.crm_loss_reasons.delete({ where: { id } });
  }

  async tags(ws: string) {
    await this.defaults.ensure(ws);
    return this.prisma.crm_tags.findMany({ where: { workspace_id: ws }, orderBy: { name: 'asc' }, select: { id: true, name: true, color: true } });
  }

  async createTag(ws: string, dto: CreateTagDto) {
    const name = dto.name.trim();
    if (!name) throw badRequest('Informe o nome da tag.');
    const dup = await this.prisma.crm_tags.findFirst({ where: { workspace_id: ws, name }, select: { id: true } });
    if (dup) throw conflict('Essa tag já existe.');
    return this.prisma.crm_tags.create({ data: { workspace_id: ws, name, ...(dto.color ? { color: dto.color } : {}) }, select: { id: true, name: true, color: true } });
  }

  async deleteTag(ws: string, id: string): Promise<void> {
    const t = await this.prisma.crm_tags.findFirst({ where: { id, workspace_id: ws }, select: { id: true } });
    if (!t) throw notFound('Tag não encontrada.');
    await this.prisma.crm_tags.delete({ where: { id } });
  }
}
