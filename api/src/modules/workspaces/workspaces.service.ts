import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { PrismaService } from '../../common/database/prisma.service';
import { WorkspaceAccessService } from '../access/access.service';
import { ActivityService } from '../activity/activity.service';

@Injectable()
export class WorkspacesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: WorkspaceAccessService,
    private readonly activity: ActivityService,
  ) {}

  /** Equivalente ao RPC `create_workspace(_name)`: devolve só o id. */
  async create(userId: string, name: string | undefined): Promise<{ id: string }> {
    const trimmed = (name ?? '').trim();
    if (!trimmed) throw new BadRequestException({ code: 'BAD_REQUEST', message: 'nome obrigatório' });
    const id = randomUUID();
    await this.prisma.$transaction(async (tx) => {
      await tx.workspaces.create({ data: { id, name: trimmed, slug: `ws-${randomUUID().replace(/-/g, '').slice(0, 12)}`, owner_id: userId } });
      await tx.workspace_members.create({ data: { workspace_id: id, user_id: userId, role: 'owner' } });
    });
    return { id };
  }

  /** Mesmo formato que o `select("workspace_id, role, workspaces(id, name, slug, plan)")` do protótipo. */
  async listMine(userId: string) {
    const rows = await this.prisma.workspace_members.findMany({
      where: { user_id: userId },
      orderBy: { created_at: 'asc' },
      select: {
        workspace_id: true,
        role: true,
        workspace: { select: { id: true, name: true, slug: true, plan: true } },
      },
    });
    return rows.map((r) => ({ workspace_id: r.workspace_id, role: r.role, workspaces: r.workspace }));
  }

  async get(userId: string, workspaceId: string) {
    await this.access.require(userId, workspaceId, 'read');
    const ws = await this.prisma.workspaces.findUnique({ where: { id: workspaceId } });
    if (!ws) throw new NotFoundException({ code: 'NOT_FOUND', message: 'Não encontrado.' });
    return ws;
  }

  async rename(userId: string, workspaceId: string, name: string | undefined) {
    await this.access.require(userId, workspaceId, 'manage');
    const trimmed = (name ?? '').trim();
    if (!trimmed) throw new BadRequestException({ code: 'BAD_REQUEST', message: 'nome obrigatório' });
    const ws = await this.prisma.workspaces.update({ where: { id: workspaceId }, data: { name: trimmed } });
    // O protótipo gravava `logActivity('workspace.updated', 'workspace', { name })` depois do update.
    await this.activity.log(workspaceId, userId, 'workspace.updated', 'workspace', { name: trimmed });
    return ws;
  }

  /**
   * Membros + perfis deles (a tela de Configurações lê os perfis dos membros — no Supabase o RLS
   * só devolvia o próprio; aqui qualquer membro enxerga os colegas do MESMO workspace).
   */
  async members(userId: string, workspaceId: string) {
    await this.access.require(userId, workspaceId, 'read');
    const members = await this.prisma.workspace_members.findMany({ where: { workspace_id: workspaceId }, orderBy: { created_at: 'asc' } });
    const profiles = await this.prisma.profiles.findMany({ where: { id: { in: members.map((m) => m.user_id) } } });
    return { members, profiles };
  }

  async getProfile(userId: string) {
    const p = await this.prisma.profiles.findUnique({ where: { id: userId } });
    if (!p) throw new NotFoundException({ code: 'NOT_FOUND', message: 'Não encontrado.' });
    return p;
  }

  async updateProfile(userId: string, data: { full_name?: string; avatar_url?: string }) {
    return this.prisma.profiles.update({
      where: { id: userId },
      data: {
        ...(data.full_name !== undefined ? { full_name: data.full_name } : {}),
        ...(data.avatar_url !== undefined ? { avatar_url: data.avatar_url } : {}),
      },
    });
  }
}
