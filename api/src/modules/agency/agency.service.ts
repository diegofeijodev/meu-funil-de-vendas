import { BadRequestException, ForbiddenException, Injectable } from '@nestjs/common';
import { PrismaService } from '../../common/database/prisma.service';
import { addDays, todaySp } from '../../common/time/dates';
import { MANAGERS, WorkspaceRole } from '../access/access.service';

export const ERR_ONLY_ADMIN_TARGET = 'Só o dono ou um administrador altera esta empresa.';
export const ERR_ONLY_ADMIN_SOURCE = 'Você precisa ser dono ou administrador da empresa de origem.';
export const ERR_SAME_SOURCE = 'Escolha outra empresa como origem.';

const forbidden = (message: string) => new ForbiddenException({ code: 'FORBIDDEN', message });
const num = (v: unknown) => Number(v ?? 0);

/** `agency.functions.ts`: herança de conexões de IA entre empresas e o painel da agência. */
@Injectable()
export class AgencyService {
  constructor(private readonly prisma: PrismaService) {}

  /** Empresas em que o usuário é owner|admin (`managedWorkspaces`). */
  private async managedWorkspaces(userId: string): Promise<Set<string>> {
    const rows = await this.prisma.workspace_members.findMany({ where: { user_id: userId }, select: { workspace_id: true, role: true } });
    return new Set(rows.filter((m) => (MANAGERS as string[]).includes(m.role as WorkspaceRole)).map((m) => m.workspace_id));
  }

  /**
   * Esta empresa passa a usar as conexões de IA de outra (a da agência). `null` = só as próprias.
   * Segurança: o chamador precisa ser owner|admin da empresa E da origem — senão qualquer um poderia
   * "pegar emprestadas" as chaves de IA (BYO) de outro cliente.
   */
  async setInheritance(userId: string, workspaceId: string, sourceId: string | null): Promise<{ ok: true }> {
    const managed = await this.managedWorkspaces(userId);
    if (!managed.has(workspaceId)) throw forbidden(ERR_ONLY_ADMIN_TARGET);
    if (sourceId && !managed.has(sourceId)) throw forbidden(ERR_ONLY_ADMIN_SOURCE);
    if (sourceId === workspaceId) throw new BadRequestException({ code: 'BAD_REQUEST', message: ERR_SAME_SOURCE });
    await this.prisma.$transaction(async (tx) => {
      // Evita corrente: a origem não pode herdar de ninguém.
      if (sourceId) await tx.workspaces.update({ where: { id: sourceId }, data: { ai_inherit_from: null } });
      await tx.workspaces.update({ where: { id: workspaceId }, data: { ai_inherit_from: sourceId } });
    });
    return { ok: true };
  }

  /** Aplica a origem a todas as empresas que você administra (menos a própria origem). */
  async applyToAll(userId: string, sourceId: string): Promise<{ updated: number }> {
    const managed = await this.managedWorkspaces(userId);
    if (!managed.has(sourceId)) throw forbidden(ERR_ONLY_ADMIN_SOURCE);
    const targets = [...managed].filter((id) => id !== sourceId);
    await this.prisma.$transaction(async (tx) => {
      await tx.workspaces.update({ where: { id: sourceId }, data: { ai_inherit_from: null } });
      if (targets.length) await tx.workspaces.updateMany({ where: { id: { in: targets } }, data: { ai_inherit_from: sourceId } });
    });
    return { updated: targets.length };
  }

  /** Painel da agência: números de todas as empresas do usuário (qualquer papel). */
  async overview(userId: string, now = new Date()) {
    const members = await this.prisma.workspace_members.findMany({
      where: { user_id: userId },
      orderBy: { created_at: 'asc' },
      select: { workspace_id: true, role: true, workspace: { select: { id: true, name: true, ai_inherit_from: true } } },
    });
    const list = members.map((m) => ({
      id: m.workspace_id,
      name: m.workspace?.name ?? 'Empresa',
      role: m.role as string,
      inheritFrom: m.workspace?.ai_inherit_from ?? null,
    }));
    const ids = list.map((w) => w.id);
    if (!ids.length) return { workspaces: [] };

    const since30 = new Date(`${addDays(todaySp(now), -30)}T00:00:00Z`);
    const since7 = new Date(now.getTime() - 7 * 86400e3);
    const weekEnd = new Date(now.getTime() + 7 * 86400e3);
    const [perf, leads, posts, approvals, igPending, active] = await Promise.all([
      this.prisma.performance_daily.groupBy({
        by: ['workspace_id'],
        where: { workspace_id: { in: ids }, source: { not: 'demo' }, date: { gte: since30 } },
        _sum: { spend: true, leads: true, revenue: true },
      }),
      this.prisma.crm_leads.groupBy({ by: ['workspace_id'], where: { workspace_id: { in: ids }, created_at: { gte: since7 } }, _count: { _all: true } }),
      this.prisma.ig_posts.groupBy({
        by: ['workspace_id'],
        where: { workspace_id: { in: ids }, OR: [{ scheduled_at: { gte: since7, lte: weekEnd } }, { published_at: { gte: since7 } }] },
        _count: { _all: true },
      }),
      this.prisma.approval_requests.groupBy({ by: ['workspace_id'], where: { workspace_id: { in: ids }, status: 'pending' }, _count: { _all: true } }),
      this.prisma.ig_posts.groupBy({ by: ['workspace_id'], where: { workspace_id: { in: ids }, status: 'pending_approval' }, _count: { _all: true } }),
      this.prisma.campaigns.groupBy({ by: ['workspace_id'], where: { workspace_id: { in: ids }, meta_delivery_status: 'ACTIVE' }, _count: { _all: true } }),
    ]);
    const counts = (rows: { workspace_id: string; _count: { _all: number } }[]) => new Map(rows.map((r) => [r.workspace_id, r._count._all]));
    const lead = counts(leads), post = counts(posts), appr = counts(approvals), igp = counts(igPending), act = counts(active);
    const sums = new Map(perf.map((r) => [r.workspace_id, r._sum]));
    return {
      workspaces: list.map((w) => {
        const s = sums.get(w.id);
        const spend = num(s?.spend), adLeads = num(s?.leads), revenue = num(s?.revenue);
        return {
          ...w,
          spend,
          adLeads,
          cpl: adLeads ? spend / adLeads : null,
          roas: spend ? revenue / spend : null,
          crmLeads7d: lead.get(w.id) ?? 0,
          postsWeek: post.get(w.id) ?? 0,
          pending: (appr.get(w.id) ?? 0) + (igp.get(w.id) ?? 0),
          activeCampaigns: act.get(w.id) ?? 0,
        };
      }),
    };
  }
}
