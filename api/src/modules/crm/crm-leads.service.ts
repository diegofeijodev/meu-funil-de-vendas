import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../common/database/prisma.service';
import { CrmDefaultsService } from '../crm-defaults/crm-defaults.service';
import { badRequest, notFound } from './crm-errors';
import {
  AddNoteDto, BulkLeadsDto, CreateLeadDto, CreateTaskDto, ImportLeadsDto, MAX_IMPORT_ROWS, UpdateLeadDto, UpdateTaskDto,
} from './dto/crm.dto';

const DAY_MS = 86_400_000;

/**
 * Leads, interações e tarefas do CRM (telas /crm, /crm/leads, /crm/leads/$id, /crm/tasks).
 * Toda id (lead, etapa, funil, responsável) é conferida contra o workspace da URL; o RLS do protótipo deixava qualquer
 * membro escrever em qualquer linha — aqui viewer só lê (guard) e nada cruza workspaces.
 */
@Injectable()
export class CrmLeadsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly defaults: CrmDefaultsService,
  ) {}

  // ------------------------------------------------------------------ conferência de ids

  private async leadOr404(ws: string, id: string, db: Prisma.TransactionClient | PrismaService = this.prisma) {
    const lead = await db.crm_leads.findFirst({ where: { id, workspace_id: ws } });
    if (!lead) throw notFound('Lead não encontrado.');
    return lead;
  }

  private async stageOr404(ws: string, id: string) {
    const stage = await this.prisma.crm_stages.findFirst({ where: { id, workspace_id: ws } });
    if (!stage) throw notFound('Etapa não encontrada.');
    return stage;
  }

  private async pipelineOr404(ws: string, id: string) {
    const p = await this.prisma.crm_pipelines.findFirst({ where: { id, workspace_id: ws }, select: { id: true } });
    if (!p) throw notFound('Funil não encontrado.');
    return p;
  }

  /** Responsável precisa ser membro do mesmo workspace. */
  private async assertMember(ws: string, userId: string) {
    const m = await this.prisma.workspace_members.findUnique({ where: { workspace_id_user_id: { workspace_id: ws, user_id: userId } }, select: { id: true } });
    if (!m) throw badRequest('Responsável inválido para este workspace.');
  }

  // ------------------------------------------------------------------ leitura

  /** `crm_leads select * eq workspace [eq pipeline] order created_at desc` — sem limite, como no protótipo. */
  async list(ws: string, pipelineId?: string) {
    await this.defaults.ensure(ws);
    return this.prisma.crm_leads.findMany({
      where: { workspace_id: ws, ...(pipelineId ? { pipeline_id: pipelineId } : {}) },
      orderBy: { created_at: 'desc' },
    });
  }

  get(ws: string, id: string) {
    return this.leadOr404(ws, id);
  }

  async interactions(ws: string, leadId: string) {
    await this.leadOr404(ws, leadId);
    return this.prisma.crm_interactions.findMany({ where: { lead_id: leadId, workspace_id: ws }, orderBy: { created_at: 'desc' } });
  }

  async leadTasks(ws: string, leadId: string) {
    await this.leadOr404(ws, leadId);
    return this.prisma.crm_tasks.findMany({ where: { lead_id: leadId, workspace_id: ws }, orderBy: { due_at: 'asc' } });
  }

  // ------------------------------------------------------------------ criação

  async create(ws: string, dto: CreateLeadDto) {
    await this.defaults.ensure(ws);
    const name = dto.name.trim();
    if (!name) throw badRequest('Informe o nome do lead.');
    if (dto.pipeline_id) await this.pipelineOr404(ws, dto.pipeline_id);
    if (dto.stage_id) await this.stageOr404(ws, dto.stage_id);
    return this.prisma.crm_leads.create({
      data: {
        workspace_id: ws,
        pipeline_id: dto.pipeline_id ?? null,
        stage_id: dto.stage_id ?? null,
        name,
        phone: dto.phone ?? null,
        email: dto.email ?? null,
        city: dto.city ?? null,
        ...(dto.source ? { source: dto.source } : {}),
      },
    });
  }

  /** Importação de CSV (o navegador faz o parse): um insert só, com teto de linhas. */
  async import(ws: string, dto: ImportLeadsDto) {
    if (dto.rows.length > MAX_IMPORT_ROWS) {
      throw badRequest(`Arquivo grande demais: importe no máximo ${MAX_IMPORT_ROWS} leads por vez (o arquivo tem ${dto.rows.length}).`);
    }
    await this.defaults.ensure(ws);
    if (dto.pipeline_id) await this.pipelineOr404(ws, dto.pipeline_id);
    if (dto.stage_id) await this.stageOr404(ws, dto.stage_id);
    const data = dto.rows.map((r) => ({
      workspace_id: ws,
      pipeline_id: dto.pipeline_id ?? null,
      stage_id: dto.stage_id ?? null,
      name: r.name.trim() || 'Sem nome',
      phone: r.phone || null,
      email: r.email || null,
      city: r.city || null,
      source: 'import',
    }));
    if (!data.length) throw badRequest('Arquivo sem linhas válidas.');
    const res = await this.prisma.crm_leads.createMany({ data });
    return { imported: res.count };
  }

  // ------------------------------------------------------------------ edição

  /** `crm_leads update {...patch} eq id` da ficha do lead (campos limitados; a etapa por aqui NÃO grava histórico — quirk do protótipo). */
  async update(ws: string, id: string, dto: UpdateLeadDto) {
    await this.leadOr404(ws, id);
    if (dto.stage_id !== undefined) await this.stageOr404(ws, dto.stage_id);
    if (dto.owner_id) await this.assertMember(ws, dto.owner_id);
    const data: Prisma.crm_leadsUncheckedUpdateInput = {};
    if (dto.stage_id !== undefined) data.stage_id = dto.stage_id;
    if (dto.stage_entered_at !== undefined) data.stage_entered_at = new Date(dto.stage_entered_at);
    if (dto.owner_id !== undefined) data.owner_id = dto.owner_id;
    if (dto.ai_active !== undefined) data.ai_active = dto.ai_active;
    if (dto.last_interaction_at !== undefined) data.last_interaction_at = new Date(dto.last_interaction_at);
    if (dto.tags !== undefined) data.tags = dto.tags;
    if (!Object.keys(data).length) return this.leadOr404(ws, id);
    return this.prisma.crm_leads.update({ where: { id }, data });
  }

  /**
   * Ação em massa da lista de leads: mover de etapa (só `stage_id` + `stage_entered_at`, sem histórico — quirk do protótipo),
   * atribuir responsável e aplicar tag (união com as tags que o lead já tem). Atômica; qualquer id de outro workspace = 404.
   */
  async bulk(ws: string, dto: BulkLeadsDto) {
    if (dto.stage_id === undefined && dto.owner_id === undefined && dto.add_tag === undefined) throw badRequest('Nada para aplicar.');
    const ids = [...new Set(dto.ids)];
    if (dto.stage_id) await this.stageOr404(ws, dto.stage_id);
    if (dto.owner_id) await this.assertMember(ws, dto.owner_id);
    const found = await this.prisma.crm_leads.findMany({ where: { id: { in: ids }, workspace_id: ws }, select: { id: true, tags: true } });
    if (found.length !== ids.length) throw notFound('Lead não encontrado.');
    await this.prisma.$transaction(async (tx) => {
      const patch: Prisma.crm_leadsUncheckedUpdateManyInput = {};
      if (dto.stage_id) {
        patch.stage_id = dto.stage_id;
        patch.stage_entered_at = new Date();
      }
      if (dto.owner_id !== undefined) patch.owner_id = dto.owner_id;
      if (Object.keys(patch).length) await tx.crm_leads.updateMany({ where: { id: { in: ids }, workspace_id: ws }, data: patch });
      if (dto.add_tag) {
        for (const lead of found) {
          if (lead.tags.includes(dto.add_tag)) continue;
          await tx.crm_leads.update({ where: { id: lead.id }, data: { tags: [...new Set([...lead.tags, dto.add_tag])] } });
        }
      }
    });
    return { updated: ids.length };
  }

  /**
   * "Mover lead" do Kanban — as 3 escritas do navegador numa transação só: lead (`stage_id`, `stage_entered_at`),
   * `crm_stage_history` (de → para) e a interação 'Movido para X.'. Mesma etapa = nada a fazer. A notificação da Meta
   * (Qualificado/Ganho) continua sendo uma chamada separada do navegador, que engole a falha.
   */
  async move(userId: string, ws: string, leadId: string, stageId: string) {
    const stage = await this.stageOr404(ws, stageId);
    return this.prisma.$transaction(async (tx) => {
      const lead = await this.leadOr404(ws, leadId, tx);
      if (lead.stage_id === stageId) return { moved: false, lead, stage_name: stage.name };
      const updated = await tx.crm_leads.update({ where: { id: leadId }, data: { stage_id: stageId, stage_entered_at: new Date() } });
      await tx.crm_stage_history.create({ data: { workspace_id: ws, lead_id: leadId, from_stage_id: lead.stage_id, to_stage_id: stageId, moved_by: userId } });
      await tx.crm_interactions.create({
        data: { workspace_id: ws, lead_id: leadId, kind: 'stage_change', author_type: 'user', author_id: userId, content: `Movido para ${stage.name}.` },
      });
      return { moved: true, lead: updated, stage_name: stage.name };
    });
  }

  /** Nota na timeline: interação `note` + `last_interaction_at` do lead. */
  async addNote(userId: string, ws: string, leadId: string, dto: AddNoteDto) {
    const content = dto.content.trim();
    if (!content) throw badRequest('Escreva a nota.');
    return this.prisma.$transaction(async (tx) => {
      await this.leadOr404(ws, leadId, tx);
      const note = await tx.crm_interactions.create({ data: { workspace_id: ws, lead_id: leadId, kind: 'note', author_type: 'user', author_id: userId, content } });
      await tx.crm_leads.update({ where: { id: leadId }, data: { last_interaction_at: new Date() } });
      return note;
    });
  }

  /** "Assumir conversa" / "Devolver para IA": liga/desliga `ai_active` e registra a nota (mesmos textos do protótipo). */
  async setAi(userId: string, ws: string, leadId: string, active: boolean) {
    return this.prisma.$transaction(async (tx) => {
      await this.leadOr404(ws, leadId, tx);
      const lead = await tx.crm_leads.update({ where: { id: leadId }, data: { ai_active: active } });
      await tx.crm_interactions.create({
        data: {
          workspace_id: ws,
          lead_id: leadId,
          kind: 'note',
          author_type: 'user',
          author_id: userId,
          content: active ? 'Conversa devolvida para a IA.' : 'Atendimento assumido por humano (IA pausada).',
        },
      });
      return lead;
    });
  }

  // ------------------------------------------------------------------ tarefas

  /** Todas as tarefas do workspace (a tela "Minhas tarefas" não filtra por usuário — quirk do protótipo). */
  async tasks(ws: string) {
    const rows = await this.prisma.crm_tasks.findMany({
      where: { workspace_id: ws },
      orderBy: { due_at: 'asc' },
      select: { id: true, title: true, due_at: true, status: true, lead_id: true, lead: { select: { name: true } } },
    });
    return rows.map(({ lead, ...t }) => ({ ...t, crm_leads: lead }));
  }

  async createTask(ws: string, leadId: string, dto: CreateTaskDto) {
    await this.leadOr404(ws, leadId);
    const title = dto.title.trim();
    if (!title) throw badRequest('Informe o título da tarefa.');
    return this.prisma.crm_tasks.create({
      data: { workspace_id: ws, lead_id: leadId, title, due_at: dto.due_at ? new Date(dto.due_at) : new Date(Date.now() + DAY_MS) },
    });
  }

  async updateTask(ws: string, id: string, dto: UpdateTaskDto) {
    const task = await this.prisma.crm_tasks.findFirst({ where: { id, workspace_id: ws }, select: { id: true } });
    if (!task) throw notFound('Tarefa não encontrada.');
    return this.prisma.crm_tasks.update({ where: { id }, data: { status: dto.status } });
  }
}
