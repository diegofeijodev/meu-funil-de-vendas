import { createHash } from 'node:crypto';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { ENV } from '../../common/config/env.module';
import { Env } from '../../common/config/env.validation';
import { PrismaService } from '../../common/database/prisma.service';
import { AiKeysService, AiKeyTestResult } from './ai-keys.service';
import { AiVendor } from './ai.types';
import { AI_VENDOR_LABEL } from './vendor-failure';

const VENDORS: AiVendor[] = ['openai', 'gemini'];
const MAX_MESSAGE = 500;

/** 'no_credit' = falta de saldo definitiva (a conta parou) · 'daily_limit' = cota diária do modelo de texto (volta sozinha amanhã). */
export type AiAlertReason = 'no_credit' | 'daily_limit';

/**
 * Uma chamada com a chave própria. `scope`: 'text' = modelo de texto (texto, JSON, visão, copy, teste da chave); 'media' = imagem e
 * vídeo. A cota diária é POR MODELO, então só a do texto vira aviso (a de imagem/vídeo não diz nada da chave), e um sucesso de
 * imagem/vídeo prova saldo mas não apaga o limite diário do texto.
 */
export type AiKeyUse = { workspaceId: string; vendor: AiVendor; key: string; scope: 'text' | 'media' };

export type AiCreditVendorAlert = { vendor: AiVendor; label: string; reason: AiAlertReason; since: Date; last_at: Date; message: string; owner_id: string };

/**
 * Estado da IA da empresa quanto a créditos (contrato §30). `stopped` = todos os provedores com chave estão sem saldo ou no limite de
 * hoje e o servidor não tem gateway (a IA parou); `partial` = sobra um caminho (`fallback`: o outro provedor, ou `app` quando o servidor
 * tem gateway configurado — não conferimos se ele tem crédito).
 */
export type AiCreditStatus = {
  level: 'stopped' | 'partial';
  vendors: AiCreditVendorAlert[];
  fallback: AiVendor | 'app' | null;
  inherited_from: { id: string; name: string } | null;
};

/** Impressão digital da chave só para o cache em memória (a chave nunca é guardada nem logada). */
const fingerprint = (vendor: AiVendor, key: string) => createHash('sha256').update(`${vendor}\n${key}`).digest('hex').slice(0, 24);

/**
 * Aviso de créditos de IA (`ai_credit_alerts`): uma linha por (empresa DONA da chave, provedor) enquanto a chave está sem saldo
 * ou no limite de hoje. Gravação best-effort: erro de banco vai só para o log e nunca derruba a chamada de IA (as escritas não lançam).
 */
@Injectable()
export class AiCreditAlertsService {
  private readonly logger = new Logger(AiCreditAlertsService.name);

  /**
   * Cache "sem aviso gravado" do caminho feliz: `${scope}|${empresa que chamou}|${provedor}|${impressão da chave}`. Com ele, a chamada
   * de IA que dá certo não toca o banco (sem ele seriam 2–4 leituras + 1 DELETE por chamada). Entrada nasce quando o DELETE confirma
   * que não sobrou linha (no escopo `media`, linha de falta de saldo); TODA gravação de aviso apaga as entradas da mesma chave (de
   * qualquer empresa que a use: a mesma chave pode estar em duas empresas). Memória local basta porque a API roda em UMA instância
   * (CLAUDE.md, `SCHEDULER_ENABLED`); com mais de uma, cada uma teria o seu cache e um aviso gravado por outra poderia ficar sem limpeza
   * até a próxima falha/Testar desta.
   */
  private readonly clean = new Set<string>();
  /** Versão por chave: sobe a cada gravação de aviso. Um sucesso que terminou depois de uma falha mais nova não marca o cache. */
  private readonly version = new Map<string, number>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly keys: AiKeysService,
    @Inject(ENV) private readonly env: Pick<Env, 'AI_GATEWAY_URL' | 'AI_GATEWAY_API_KEY'>,
  ) {}

  /** A chave falhou por falta de saldo (ou, no texto, pela cota de hoje): grava ou atualiza o aviso na empresa dona (mantém `first_at`). */
  async exhausted(use: AiKeyUse, reason: AiAlertReason, message: string): Promise<void> {
    if (reason === 'daily_limit' && use.scope !== 'text') return; // cota diária de imagem/vídeo é do modelo, não da chave
    this.forget(use.vendor, use.key, reason);
    await this.safely('gravar', use.vendor, async () => {
      const owner = (await this.keys.resolve(use.workspaceId, use.vendor))?.ownerId;
      if (owner) await this.upsert(owner, use.vendor, reason, message);
    });
  }

  /**
   * A chave respondeu: apaga o aviso daquele provedor na empresa dona. No escopo `media` apaga só a falta de saldo (o limite de hoje
   * é do modelo de texto). Caminho feliz sem banco quando o cache já sabe que não há aviso.
   */
  async recovered(use: AiKeyUse): Promise<void> {
    const entry = this.entry(use.scope, use.workspaceId, use.vendor, use.key);
    if (this.clean.has(entry)) return;
    const seen = this.version.get(this.keyId(use.vendor, use.key)) ?? 0;
    await this.safely('apagar', use.vendor, async () => {
      const owner = (await this.keys.resolve(use.workspaceId, use.vendor))?.ownerId;
      if (!owner) return;
      await this.prisma.ai_credit_alerts.deleteMany({ where: { workspace_id: owner, vendor: use.vendor, ...(use.scope === 'media' ? { reason: 'no_credit' } : {}) } });
      if ((this.version.get(this.keyId(use.vendor, use.key)) ?? 0) === seen) this.clean.add(entry);
    });
  }

  /** Resultado do botão "Testar" (modelo de texto) da chave de `ownerId`: ok apaga, sem saldo/limite de hoje grava, o resto não mexe. */
  async noteTest(ownerId: string, vendor: AiVendor, key: string, result: AiKeyTestResult): Promise<void> {
    if (result.ok) return this.clear(ownerId, vendor);
    const reason: AiAlertReason | null = result.kind === 'noCredit' ? 'no_credit' : result.kind === 'dailyLimit' ? 'daily_limit' : null;
    if (!reason) return;
    this.forget(vendor, key, reason);
    await this.safely('gravar', vendor, () => this.upsert(ownerId, vendor, reason, result.error));
  }

  /** A chave de `ownerId` foi trocada, removida ou testada com sucesso: o aviso dela não vale mais. */
  async clear(ownerId: string, vendor: AiVendor): Promise<void> {
    await this.safely('apagar', vendor, () => this.prisma.ai_credit_alerts.deleteMany({ where: { workspace_id: ownerId, vendor } }));
  }

  /**
   * Leitura para a faixa de aviso, o checklist e o Studio (sempre do banco, sem cache). Só entram os provedores que TÊM chave na
   * empresa dona (aviso de chave removida não aparece); `null` quando nenhum está sem saldo nem no limite de hoje.
   */
  async status(workspaceId: string): Promise<AiCreditStatus | null> {
    const keyed = (
      await Promise.all(VENDORS.map(async (vendor) => ({ vendor, owner: (await this.keys.resolve(workspaceId, vendor))?.ownerId ?? null })))
    ).filter((k): k is { vendor: AiVendor; owner: string } => !!k.owner);
    if (!keyed.length) return null;
    const rows = await this.prisma.ai_credit_alerts.findMany({ where: { OR: keyed.map((k) => ({ workspace_id: k.owner, vendor: k.vendor })) } });
    const vendors = keyed.flatMap((k): AiCreditVendorAlert[] => {
      const r = rows.find((x) => x.workspace_id === k.owner && x.vendor === k.vendor);
      if (!r) return [];
      const reason: AiAlertReason = r.reason === 'daily_limit' ? 'daily_limit' : 'no_credit';
      return [{ vendor: k.vendor, label: AI_VENDOR_LABEL[k.vendor], reason, since: r.first_at, last_at: r.last_at, message: r.message, owner_id: k.owner }];
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

  private keyId(vendor: AiVendor, key: string): string {
    return `${vendor}|${fingerprint(vendor, key)}`;
  }

  private entry(scope: AiKeyUse['scope'], workspaceId: string, vendor: AiVendor, key: string): string {
    return `${scope}|${workspaceId}|${this.keyId(vendor, key)}`;
  }

  /** Aviso novo para esta chave: o cache de quem a usa deixa de valer (o limite de hoje só invalida o escopo de texto). */
  private forget(vendor: AiVendor, key: string, reason: AiAlertReason): void {
    const id = this.keyId(vendor, key);
    this.version.set(id, (this.version.get(id) ?? 0) + 1);
    for (const e of this.clean) if (e.endsWith(`|${id}`) && (reason === 'no_credit' || e.startsWith('text|'))) this.clean.delete(e);
  }

  private async upsert(owner: string, vendor: AiVendor, reason: AiAlertReason, message: string): Promise<void> {
    const now = new Date();
    const text = message.slice(0, MAX_MESSAGE) || 'Sem créditos.';
    await this.prisma.ai_credit_alerts.upsert({
      where: { workspace_id_vendor: { workspace_id: owner, vendor } },
      create: { workspace_id: owner, vendor, reason, message: text, first_at: now, last_at: now },
      update: { reason, message: text, last_at: now },
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
