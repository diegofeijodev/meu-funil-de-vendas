import { BadRequestException, ConflictException, ForbiddenException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../common/database/prisma.service';
import { WorkspaceAccessService } from '../access/access.service';
import { FilesService } from '../files/files.service';
import {
  BlockerItem,
  CampaignChannels,
  confirmNameMatches,
  DeletionBlocker,
  deletionBlockers,
  ERR_NAME_MISMATCH,
  ERR_ONLY_OWNER_DELETES,
  liveCampaigns,
} from './workspace-deletion';

type Db = Prisma.TransactionClient;

const CHANNEL_COLUMNS = {
  id: true,
  name: true,
  meta_campaign_id: true,
  meta_delivery_status: true,
  google_campaign_id: true,
  google_status: true,
  google_creating_at: true,
  tiktok_campaign_id: true,
  tiktok_status: true,
  tiktok_creating_at: true,
} as const;

/** Post do Instagram que já saiu ou não vai sair: o resto (ideia, em produção, aprovado, agendado, saindo agora) conta como "ainda vai sair". */
const IG_GONE = ['published', 'cancelled', 'failed'];

/** O que a pessoa perde ao apagar (contrato §31). `saved_keys` = chaves do cofre; `connections` = contas conectadas. */
export type DeletionCounts = {
  brands: number;
  campaigns: number;
  creatives: number;
  media_assets: number;
  ig_posts_pending: number;
  ig_posts_published: number;
  crm_leads: number;
  members: number;
  saved_keys: number;
  connections: number;
};

export type DeletionPreview = {
  workspace: { id: string; name: string };
  counts: DeletionCounts;
  /** Empresas que herdam a IA desta e de que o usuário é membro (as outras só entram em `inheritors_hidden`). */
  inheritors: BlockerItem[];
  inheritors_hidden: number;
  blockers: DeletionBlocker[];
};

/** Prisma interativo: o padrão (5 s) não cobre a cascata de 60+ tabelas de uma empresa grande. */
const TX_OPTIONS = { maxWait: 10_000, timeout: 120_000 };

/**
 * "Apagar empresa": só o dono (`workspace_members.role = 'owner'`). Uma transação apaga `oauth_states` (sem FK), as chaves de IA
 * do cofre GLOBAL com o id no nome (`AI_*_KEY:<id>`) e a linha de `workspaces` — o resto vai pela cascata das FKs, e quem herdava a
 * IA desta fica com `ai_inherit_from = NULL`. Arquivos em disco saem DEPOIS do commit, em best-effort. A auditoria vai para o log
 * da API: `activity_logs` é da própria empresa e sai junto na cascata.
 */
@Injectable()
export class WorkspaceDeletionService {
  private readonly logger = new Logger(WorkspaceDeletionService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly access: WorkspaceAccessService,
    private readonly files: FilesService,
  ) {}

  async preview(userId: string, workspaceId: string): Promise<DeletionPreview> {
    await this.requireOwner(userId, workspaceId);
    const id = workspaceId.toLowerCase();
    const ws = await this.prisma.workspaces.findUnique({ where: { id }, select: { id: true, name: true } });
    if (!ws) throw new NotFoundException({ code: 'NOT_FOUND', message: 'Não encontrado.' });
    const [counts, heirs, blockers] = await Promise.all([this.counts(this.prisma, id), this.inheritors(userId, id), this.blockers(this.prisma, userId, id)]);
    return { workspace: ws, counts, inheritors: heirs.visible, inheritors_hidden: heirs.hidden, blockers };
  }

  async remove(userId: string, workspaceId: string, confirmName: string): Promise<void> {
    await this.requireOwner(userId, workspaceId);
    const id = workspaceId.toLowerCase();
    const done = await this.prisma.$transaction(async (tx) => {
      // Duas empresas do mesmo usuário apagadas ao mesmo tempo não podem, juntas, passar pelo "última empresa".
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${'workspace-delete:' + userId}))`;
      // Trava a linha: quem grava filhos (FK) espera o commit e falha depois, em vez de deixar dado pela metade.
      const rows = await tx.$queryRaw<{ name: string }[]>`SELECT name FROM workspaces WHERE id = ${id}::uuid FOR UPDATE`;
      const name = rows[0]?.name;
      if (name === undefined) throw new NotFoundException({ code: 'NOT_FOUND', message: 'Não encontrado.' });
      // O papel de novo, travado (FOR SHARE): ninguém rebaixa o dono entre a checagem de fora e a exclusão.
      const member = await tx.$queryRaw<{ role: string }[]>`
        SELECT role::text AS role FROM workspace_members WHERE workspace_id = ${id}::uuid AND user_id = ${userId}::uuid FOR SHARE`;
      if (member[0]?.role !== 'owner') throw new ForbiddenException({ code: 'FORBIDDEN', message: ERR_ONLY_OWNER_DELETES });
      if (!confirmNameMatches(confirmName, name)) throw new BadRequestException({ code: 'NAME_MISMATCH', message: ERR_NAME_MISMATCH });
      // Os mesmos bloqueios do preview, de novo aqui dentro e com as campanhas TRAVADAS (FOR UPDATE): um "Ativar"/"criar no canal" que
      // chegue agora espera o commit e, sem a linha, cai na compensação de quem ativa (`[workspace-delete-race]`).
      const blockers = await this.blockers(tx, userId, id, true);
      if (blockers.length) throw new ConflictException({ code: blockers[0].code, message: blockers[0].message });

      const counts = await this.counts(tx, id);
      const heirs = await tx.workspaces.findMany({ where: { ai_inherit_from: id }, select: { id: true } });
      const oauth = await tx.oauth_states.deleteMany({ where: { workspace_id: id } });
      const keys = await tx.app_credentials.deleteMany({ where: globalKeysOf(id) });
      await tx.workspaces.delete({ where: { id } });
      return { name, counts, heirs: heirs.map((h) => h.id), oauth: oauth.count, globalKeys: keys.count };
    }, TX_OPTIONS);

    // Depois do commit: falha no disco não desfaz nada nem vira erro para a pessoa — só log (arquivo órfão é inofensivo).
    let folders: string[] = [];
    try {
      folders = await this.files.removeWorkspaceFolders(id);
    } catch (e) {
      this.logger.warn(`[workspace-delete] arquivos da empresa ${id} ficaram no disco: ${e instanceof Error ? e.message : e}`);
    }
    this.logger.log(
      `[workspace-delete] ${JSON.stringify({
        action: 'workspace.deleted',
        user_id: userId,
        workspace_id: id,
        name: done.name,
        counts: done.counts,
        inheritors_unlinked: done.heirs,
        oauth_states: done.oauth,
        global_keys: done.globalKeys,
        file_folders: folders,
        at: new Date().toISOString(),
      })}`,
    );
  }

  /** Mesmo mecanismo das outras rotas (`WorkspaceAccessService.require`): não-membro 403, id malformado 404; aqui só `owner` passa. */
  private async requireOwner(userId: string, workspaceId: string): Promise<void> {
    const role = await this.access.require(userId, workspaceId, 'read');
    if (role !== 'owner') throw new ForbiddenException({ code: 'FORBIDDEN', message: ERR_ONLY_OWNER_DELETES });
  }

  private async blockers(db: Db, userId: string, id: string, lock = false): Promise<DeletionBlocker[]> {
    const [rows, memberships] = await Promise.all([lock ? this.lockedCampaigns(db, id) : this.campaignChannels(db, id), db.workspace_members.count({ where: { user_id: userId } })]);
    return deletionBlockers({ live: liveCampaigns(rows), memberships });
  }

  /** Campanhas com algum canal (publicada ou sendo criada), sem trava — a prévia só lê. */
  private campaignChannels(db: Db, id: string): Promise<CampaignChannels[]> {
    return db.campaigns.findMany({
      where: {
        workspace_id: id,
        OR: [
          { meta_campaign_id: { not: null } },
          { google_campaign_id: { not: null } },
          { tiktok_campaign_id: { not: null } },
          { google_creating_at: { not: null } },
          { tiktok_creating_at: { not: null } },
        ],
      },
      select: CHANNEL_COLUMNS,
      orderBy: { created_at: 'asc' },
    });
  }

  /** Todas as campanhas da empresa com `FOR UPDATE` (na transação do DELETE); o filtro de canal fica no `liveCampaigns`. */
  private lockedCampaigns(db: Db, id: string): Promise<CampaignChannels[]> {
    return db.$queryRaw<CampaignChannels[]>`
      SELECT id, name, meta_campaign_id, meta_delivery_status, google_campaign_id, google_status, google_creating_at,
             tiktok_campaign_id, tiktok_status, tiktok_creating_at
        FROM campaigns WHERE workspace_id = ${id}::uuid ORDER BY created_at ASC FOR UPDATE`;
  }

  private async counts(db: Db, id: string): Promise<DeletionCounts> {
    const ws = { workspace_id: id };
    const [brands, campaigns, creatives, media, igPending, igPublished, leads, members, wsKeys, globalKeys, ig, meta, mcp, integrations, crmIntegrations] =
      await Promise.all([
        db.brands.count({ where: ws }),
        db.campaigns.count({ where: ws }),
        db.creatives.count({ where: ws }),
        db.media_assets.count({ where: ws }),
        db.ig_posts.count({ where: { ...ws, status: { notIn: IG_GONE } } }),
        db.ig_posts.count({ where: { ...ws, status: 'published' } }),
        db.crm_leads.count({ where: ws }),
        db.workspace_members.count({ where: ws }),
        db.app_credentials.count({ where: ws }),
        db.app_credentials.count({ where: globalKeysOf(id) }),
        db.instagram_accounts.count({ where: ws }),
        db.meta_accounts.count({ where: ws }),
        db.mcp_connections.count({ where: ws }),
        db.integration_connections.count({ where: ws }),
        db.crm_integrations.count({ where: ws }),
      ]);
    return {
      brands,
      campaigns,
      creatives,
      media_assets: media,
      ig_posts_pending: igPending,
      ig_posts_published: igPublished,
      crm_leads: leads,
      members,
      saved_keys: wsKeys + globalKeys,
      connections: ig + meta + mcp + integrations + crmIntegrations,
    };
  }

  /** Quem herda a IA desta. Nome só das empresas de que o usuário também é membro: o resto é de outro cliente e vira só número. */
  private async inheritors(userId: string, id: string): Promise<{ visible: BlockerItem[]; hidden: number }> {
    const heirs = await this.prisma.workspaces.findMany({ where: { ai_inherit_from: id, NOT: { id } }, select: { id: true, name: true }, orderBy: { created_at: 'asc' } });
    if (!heirs.length) return { visible: [], hidden: 0 };
    const mine = await this.prisma.workspace_members.findMany({ where: { user_id: userId, workspace_id: { in: heirs.map((h) => h.id) } }, select: { workspace_id: true } });
    const ids = new Set(mine.map((m) => m.workspace_id));
    const visible = heirs.filter((h) => ids.has(h.id));
    return { visible, hidden: heirs.length - visible.length };
  }
}

/** Chaves do cofre GLOBAL (`workspace_id` nulo) com o id da empresa no nome — hoje as de IA, `AI_<PROVEDOR>_KEY:<id>` (`aiKeySlot`). */
export const globalKeysOf = (id: string): Prisma.app_credentialsWhereInput => ({
  workspace_id: null,
  key: { endsWith: `:${id}`, mode: 'insensitive' },
});
