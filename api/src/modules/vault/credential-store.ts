import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../common/database/prisma.service';

/** Porta de armazenamento do cofre (tabela `app_credentials`). `workspaceId = null` = global do app. */
export abstract class CredentialStore {
  abstract read(workspaceId: string | null, key: string): Promise<{ value: string; updated_at: Date } | null>;
  abstract upsert(workspaceId: string | null, key: string, value: string): Promise<void>;
  abstract delete(workspaceId: string | null, key: string): Promise<void>;
  abstract list(workspaceId: string | null): Promise<{ key: string; value: string; updated_at: Date }[]>;
}

@Injectable()
export class PrismaCredentialStore extends CredentialStore {
  constructor(private readonly prisma: PrismaService) {
    super();
  }

  async read(workspaceId: string | null, key: string) {
    const row = await this.prisma.app_credentials.findFirst({ where: { workspace_id: workspaceId, key }, select: { value: true, updated_at: true } });
    return row;
  }

  // `UNIQUE NULLS NOT DISTINCT (workspace_id, key)` — o Prisma não faz upsert com workspace_id nulo,
  // então vai por SQL (ON CONFLICT casa com o índice mesmo com workspace_id NULL).
  async upsert(workspaceId: string | null, key: string, value: string) {
    await this.prisma.$executeRaw`
      INSERT INTO app_credentials (id, workspace_id, key, value, updated_at)
      VALUES (gen_random_uuid(), ${workspaceId}::uuid, ${key}, ${value}, now())
      ON CONFLICT (workspace_id, key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`;
  }

  async delete(workspaceId: string | null, key: string) {
    await this.prisma.app_credentials.deleteMany({ where: { workspace_id: workspaceId, key } });
  }

  async list(workspaceId: string | null) {
    return this.prisma.app_credentials.findMany({
      where: { workspace_id: workspaceId },
      select: { key: true, value: true, updated_at: true },
      orderBy: { key: 'asc' },
    });
  }
}
