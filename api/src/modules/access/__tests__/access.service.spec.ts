import { randomUUID } from 'node:crypto';
import { AccessLevel, NOT_A_MEMBER, ROLE_NOT_ALLOWED, WorkspaceAccessService, WorkspaceRole } from '../access.service';

const ws = randomUUID();
const user = randomUUID();

const serviceWith = (role: WorkspaceRole | null) =>
  new WorkspaceAccessService({
    workspace_members: { findUnique: async () => (role ? { role } : null) },
  } as any);

const outcome = async (p: Promise<unknown>) => {
  try { await p; return 'ok'; } catch (e: any) { return `${e.getStatus()}:${e.getResponse().message}`; }
};

// Matriz do spec §2.5: viewer só lê; write = owner|admin|marketing; manage = owner|admin.
const MATRIX: Record<WorkspaceRole, Record<AccessLevel, boolean>> = {
  owner: { read: true, write: true, manage: true },
  admin: { read: true, write: true, manage: true },
  marketing: { read: true, write: true, manage: false },
  viewer: { read: true, write: false, manage: false },
};

describe('WorkspaceAccessService.require', () => {
  for (const role of Object.keys(MATRIX) as WorkspaceRole[]) {
    for (const level of ['read', 'write', 'manage'] as AccessLevel[]) {
      it(`${role} × ${level} → ${MATRIX[role][level] ? 'permitido' : '403'}`, async () => {
        const r = await outcome(serviceWith(role).require(user, ws, level));
        expect(r).toBe(MATRIX[role][level] ? 'ok' : `403:${ROLE_NOT_ALLOWED}`);
      });
    }
  }

  it('não-membro → 403 "Você não tem acesso a esta empresa." em qualquer nível', async () => {
    for (const level of ['read', 'write', 'manage'] as AccessLevel[]) {
      expect(await outcome(serviceWith(null).require(user, ws, level))).toBe(`403:${NOT_A_MEMBER}`);
    }
  });

  it('id de workspace malformado → 404 (nunca chega ao Prisma)', async () => {
    const svc = new WorkspaceAccessService({ workspace_members: { findUnique: () => { throw new Error('não deveria consultar'); } } } as any);
    expect(await outcome(svc.require(user, 'nao-uuid', 'read'))).toBe('404:Não encontrado.');
  });

  it('devolve o papel e `can` não lança', async () => {
    expect(await serviceWith('marketing').require(user, ws, 'write')).toBe('marketing');
    expect(await serviceWith('viewer').can(user, ws, 'write')).toBe(false);
    expect(await serviceWith(null).can(user, ws, 'read')).toBe(false);
  });
});
