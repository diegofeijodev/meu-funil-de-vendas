import { randomUUID } from 'node:crypto';
import type { Prisma } from '@prisma/client';

export interface ProvisionInput {
  email: string;
  passwordHash: string | null;
  googleSub?: string | null;
  fullName?: string | null;
  companyName?: string | null;
  avatarUrl?: string | null;
}

/**
 * O que o trigger `on_auth_user_created → handle_new_user()` fazia: cria o usuário,
 * `profiles` (id = id do usuário), o workspace inicial e a associação `owner`.
 * (A versão final do trigger NÃO semeia dados de demonstração — db.md §4/§8.)
 */
export async function provisionUser(tx: Prisma.TransactionClient, input: ProvisionInput) {
  const id = randomUUID();
  const email = input.email;
  const fullName = input.fullName?.trim() || email.split('@')[0] || email;
  const companyName = input.companyName?.trim() || 'Meu Workspace';
  const user = await tx.users.create({
    data: { id, email, password_hash: input.passwordHash, google_sub: input.googleSub ?? null },
  });
  await tx.profiles.create({ data: { id, email, full_name: fullName, avatar_url: input.avatarUrl ?? null } });
  const workspace = await tx.workspaces.create({
    data: { name: companyName, slug: `ws-${id.replace(/-/g, '').slice(0, 10)}`, owner_id: id },
  });
  await tx.workspace_members.create({ data: { workspace_id: workspace.id, user_id: id, role: 'owner' } });
  return { user, workspace };
}
