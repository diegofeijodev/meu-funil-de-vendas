import { ForbiddenException, Injectable } from '@nestjs/common';
import { AiKeysService } from '../ai/ai-keys.service';
import { AiVendor } from '../ai/ai.types';
import { WorkspaceAccessService } from '../access/access.service';

export const ERR_NOT_MEMBER = 'Você não tem acesso a esta área de trabalho.';
export const ERR_NOT_MANAGER = 'Só o dono ou um administrador altera as chaves de IA.';

/** `••••` + 4 últimos caracteres: a única parte da chave que sai do servidor. */
export const keyHint = (key: string) => `••••${key.slice(-4)}`;

/**
 * Ações de `ai-keys.functions.ts` (status/save/test/remove). A chave fica no cofre global
 * (`AI_<VENDOR>_KEY:<workspaceId>`); o navegador só recebe `{ connected, hint }`.
 * `aiKeysHealth` mora no módulo do Studio (`AiKeysHealthController`).
 */
@Injectable()
export class AiKeysActionsService {
  constructor(
    private readonly access: WorkspaceAccessService,
    private readonly keys: AiKeysService,
  ) {}

  /** `requireMember` do protótipo (mensagens próprias): membro lê; `manage` exige owner|admin. */
  private async requireMember(userId: string, workspaceId: string, manage = false): Promise<void> {
    const role = await this.access.roleOf(userId, workspaceId);
    if (!role) throw new ForbiddenException({ code: 'FORBIDDEN', message: ERR_NOT_MEMBER });
    if (manage && role !== 'owner' && role !== 'admin') throw new ForbiddenException({ code: 'FORBIDDEN', message: ERR_NOT_MANAGER });
  }

  async status(userId: string, workspaceId: string) {
    await this.requireMember(userId, workspaceId);
    const [o, g] = await Promise.all([this.keys.get(workspaceId, 'openai'), this.keys.get(workspaceId, 'gemini')]);
    return {
      openai: o ? { connected: true, hint: keyHint(o) } : { connected: false, hint: null },
      gemini: g ? { connected: true, hint: keyHint(g) } : { connected: false, hint: null },
    };
  }

  /** Testa e só então grava. Recusa do provedor volta como `{ ok:false, error }` (HTTP 200), como no protótipo. */
  async save(userId: string, workspaceId: string, vendor: AiVendor, apiKey: string) {
    await this.requireMember(userId, workspaceId, true);
    const t = await this.keys.test(vendor, apiKey);
    if (!t.ok) return { ok: false, error: t.error ?? 'Chave recusada.' };
    await this.keys.set(workspaceId, vendor, apiKey);
    return { ok: true, error: null as string | null };
  }

  async test(userId: string, workspaceId: string, vendor: AiVendor) {
    await this.requireMember(userId, workspaceId);
    const k = await this.keys.get(workspaceId, vendor);
    if (!k) return { ok: false, error: 'Nenhuma chave salva.' };
    return this.keys.test(vendor, k);
  }

  async remove(userId: string, workspaceId: string, vendor: AiVendor) {
    await this.requireMember(userId, workspaceId, true);
    await this.keys.set(workspaceId, vendor, null);
    return { ok: true };
  }
}
