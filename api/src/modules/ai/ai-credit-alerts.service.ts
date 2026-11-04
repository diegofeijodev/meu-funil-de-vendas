import { Inject, Injectable, Logger } from '@nestjs/common';
import { ENV } from '../../common/config/env.module';
import { Env } from '../../common/config/env.validation';
import { PrismaService } from '../../common/database/prisma.service';
import { AiKeysService, AiKeyTestResult } from './ai-keys.service';
import { AiVendor } from './ai.types';
import { AI_VENDOR_LABEL } from './vendor-failure';

const VENDORS: AiVendor[] = ['openai', 'gemini'];
const MAX_MESSAGE = 500;

export type AiCreditVendorAlert = { vendor: AiVendor; label: string; since: Date; last_at: Date; message: string; owner_id: string };

/**
 * Estado da IA da empresa quanto a créditos (contrato §30). `stopped` = todos os provedores com chave estão sem saldo e o servidor
 * não tem gateway (a IA parou); `partial` = alguém ainda responde (`fallback`: o outro provedor ou `app`, o gateway do app).
 */
export type AiCreditStatus = {
  level: 'stopped' | 'partial';
  vendors: AiCreditVendorAlert[];
  fallback: AiVendor | 'app' | null;
  inherited_from: { id: string; name: string } | null;
};

/**
 * Aviso de créditos de IA (`ai_credit_alerts`): uma linha por (empresa DONA da chave, provedor) enquanto a chave está sem saldo.
 * Gravação best-effort: erro de banco vai só para o log e nunca derruba a chamada de IA de quem chamou (os métodos de escrita não lançam).
 */
@Injectable()
export class AiCreditAlertsService {
  private readonly logger = new Logger(AiCreditAlertsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly keys: AiKeysService,
    @Inject(ENV) private readonly env: Pick<Env, 'AI_GATEWAY_URL' | 'AI_GATEWAY_API_KEY'>,
  ) {}

  /** A chave que `workspaceId` usa falhou por falta de saldo: grava ou atualiza o aviso na empresa dona da chave (mantém `first_at`). */
  async exhausted(workspaceId: string, vendor: AiVendor, message: string): Promise<void> {
    await this.safely('gravar', vendor, async () => {
      const owner = (await this.keys.resolve(workspaceId, vendor))?.ownerId;
      if (owner) await this.upsert(owner, vendor, message);
    });
  }

  /** A chave que `workspaceId` usa respondeu: apaga o aviso daquele provedor na empresa dona da chave. */
  async recovered(workspaceId: string, vendor: AiVendor): Promise<void> {
    await this.safely('apagar', vendor, async () => {
      const owner = (await this.keys.resolve(workspaceId, vendor))?.ownerId;
      if (owner) await this.prisma.ai_credit_alerts.deleteMany({ where: { workspace_id: owner, vendor } });
    });
  }

  /** Resultado do botão "Testar" da chave de `ownerId` (a dona): ok apaga o aviso, sem saldo grava; outros motivos não mexem. */
  async noteTest(ownerId: string, vendor: AiVendor, result: AiKeyTestResult): Promise<void> {
    if (result.ok) return this.clear(ownerId, vendor);
    if (result.kind !== 'noCredit') return;
    await this.safely('gravar', vendor, () => this.upsert(ownerId, vendor, result.error));
  }

  /** A chave de `ownerId` foi trocada ou removida: o aviso dela não vale mais. */
  async clear(ownerId: string, vendor: AiVendor): Promise<void> {
    await this.safely('apagar', vendor, () => this.prisma.ai_credit_alerts.deleteMany({ where: { workspace_id: ownerId, vendor } }));
  }

  /**
   * Leitura para a faixa de aviso, o checklist e o Studio. Só entram os provedores que TÊM chave na empresa dona (aviso de chave
   * removida não aparece); `null` quando nenhum está sem saldo.
   */
  async status(workspaceId: string): Promise<AiCreditStatus | null> {
    const keyed = (
      await Promise.all(VENDORS.map(async (vendor) => ({ vendor, owner: (await this.keys.resolve(workspaceId, vendor))?.ownerId ?? null })))
    ).filter((k): k is { vendor: AiVendor; owner: string } => !!k.owner);
    if (!keyed.length) return null;
    const rows = await this.prisma.ai_credit_alerts.findMany({ where: { OR: keyed.map((k) => ({ workspace_id: k.owner, vendor: k.vendor })) } });
    const vendors = keyed.flatMap((k): AiCreditVendorAlert[] => {
      const r = rows.find((x) => x.workspace_id === k.owner && x.vendor === k.vendor);
      return r ? [{ vendor: k.vendor, label: AI_VENDOR_LABEL[k.vendor], since: r.first_at, last_at: r.last_at, message: r.message, owner_id: k.owner }] : [];
    });
    if (!vendors.length) return null;
    const working = keyed.find((k) => !vendors.some((v) => v.vendor === k.vendor))?.vendor;
    const fallback = working ?? (this.hasGateway() ? 'app' : null);
    const foreign = vendors.find((v) => v.owner_id !== workspaceId)?.owner_id;
    const inherited_from = foreign ? await this.prisma.workspaces.findUnique({ where: { id: foreign }, select: { id: true, name: true } }) : null;
    return { level: fallback ? 'partial' : 'stopped', vendors, fallback, inherited_from };
  }

  private hasGateway(): boolean {
    return !!(this.env.AI_GATEWAY_URL?.trim() && this.env.AI_GATEWAY_API_KEY?.trim());
  }

  private async upsert(owner: string, vendor: AiVendor, message: string): Promise<void> {
    const now = new Date();
    const text = message.slice(0, MAX_MESSAGE) || 'Sem créditos.';
    await this.prisma.ai_credit_alerts.upsert({
      where: { workspace_id_vendor: { workspace_id: owner, vendor } },
      create: { workspace_id: owner, vendor, message: text, first_at: now, last_at: now },
      update: { message: text, last_at: now },
    });
  }

  /** O aviso nunca derruba a chamada de IA: o erro vai para o log (sem chave — só o provedor e a mensagem do banco). */
  private async safely(what: string, vendor: AiVendor, fn: () => Promise<unknown>): Promise<void> {
    try {
      await fn();
    } catch (e) {
      this.logger.warn(`não foi possível ${what} o aviso de créditos (${vendor}): ${e instanceof Error ? e.message.slice(0, 200) : 'erro'}`);
    }
  }
}
