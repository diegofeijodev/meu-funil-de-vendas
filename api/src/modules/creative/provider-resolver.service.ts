import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../common/database/prisma.service';
import { AiService } from '../ai/ai.service';
import { AiKeysService } from '../ai/ai-keys.service';
import { McpService } from '../mcp/mcp.service';
import { UserError } from '../media/user-error';
import { ProviderChoice, ServerCreativeProvider, GenerationResult } from './creative.types';
import { createAiProvider, OwnsJob } from './providers/ai-creative.provider';
import { createHiggsfieldProvider } from './providers/higgsfield.provider';

export type ChainedProvider = ServerCreativeProvider & { log?: string[] };

/** Texto do `provider_log` do job (cadeia de tentativas ou o provedor/nota que respondeu). */
export const providerLog = (p: ChainedProvider, r?: GenerationResult | null): string => {
  if (p.log?.length) return p.log.join('\n');
  return r?.note ? `Usado: ${r.note}` : `Usado: ${p.label}`;
};

/** Mensagem para o log do job (qualquer erro; limitada): é o que o Studio mostra em "Gerações recentes". */
const logMessage = (e: unknown): string => (e instanceof Error ? e.message : 'erro').slice(0, 200);

/**
 * Provedor que tenta a lista em ordem. A lista é IMUTÁVEL: cada chamada (cada variação, mesmo em paralelo) percorre a sequência inteira
 * por conta própria, então um provedor que falhou numa variação continua elegível para as outras (e para a próxima tentativa).
 * Qualquer erro avança; resultado "failed" / sem mídia / job sem id também conta como falha (o erro real do provedor fica no log).
 * O último provedor propaga o erro.
 */
export function chainProviders(list: ServerCreativeProvider[], warn: (m: string) => void = () => undefined): ChainedProvider {
  let current = list[0]!;
  const log: string[] = [];
  const note = (msg: string) => {
    if (!log.includes(msg)) log.push(msg);
  };
  const run = async (fn: (p: ServerCreativeProvider) => Promise<GenerationResult>): Promise<GenerationResult> => {
    let lastErr: unknown = null;
    for (const p of list) {
      try {
        const r = await fn(p);
        if (r.status === 'failed' || (r.status === 'ready' && !r.assetUrl && !r.bytes) || (r.status === 'generating' && !r.externalJobId))
          throw new Error(r.raw || `${p.label} não devolveu uma imagem pronta.`);
        current = p;
        const msg = `Usado: ${r.note ?? p.label}`;
        if (log[log.length - 1] !== msg) log.push(msg);
        return r;
      } catch (e) {
        lastErr = e;
        if (p === list[list.length - 1]) throw e;
        warn(`[creative-chain] ${p.id} falhou, tentando o próximo: ${logMessage(e)}`);
        note(`${p.label}: ${logMessage(e)} → tentando o próximo`);
      }
    }
    throw lastErr;
  };
  return {
    get id() { return current.id; },
    get label() { return current.label; },
    get sandbox() { return current.sandbox; },
    log,
    generateImage: (req) => run((p) => p.generateImage(req)),
    generateVideo: (req) => run((p) => p.generateVideo(req)),
    getGenerationStatus: (id) => current.getGenerationStatus(id),
    getAsset: (id) => current.getAsset(id),
  };
}

/**
 * Escolha do provedor (`resolveProvider`): chatgpt/gemini direto; higgsfield só se conectado;
 * automático = chave OpenAI → chave Gemini → Higgsfield → créditos do app (nunca um gerador simulado).
 */
@Injectable()
export class ProviderResolverService {
  private readonly logger = new Logger(ProviderResolverService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly ai: AiService,
    private readonly keys: AiKeysService,
    private readonly mcp: McpService,
  ) {}

  /** O id de job externo está gravado num job deste workspace? (vínculo exigido antes de consultar qualquer provedor) */
  readonly owns: OwnsJob = async (workspaceId, externalJobId) =>
    (await this.prisma.creative_generation_jobs.count({ where: { workspace_id: workspaceId, external_job_id: externalJobId } })) > 0 ||
    // Vídeo de post do Instagram: o job fica em `ig_posts.creative_brief.pending_job` (gravado só pelo servidor — o PATCH do cliente não o toca).
    (await this.prisma.ig_posts.count({ where: { workspace_id: workspaceId, status: 'generating', creative_brief: { path: ['pending_job', 'jobId'], equals: externalJobId } } })) > 0;

  /** Envolve o provedor: `getGenerationStatus`/`getAsset` só aceitam ids vinculados ao workspace. */
  private bind(p: ChainedProvider, workspaceId: string): ChainedProvider {
    const failed = (id: string): GenerationResult => ({ status: 'failed', assetUrl: null, thumbnailUrl: null, externalJobId: id, cost: 0 });
    return {
      get id() { return p.id; },
      get label() { return p.label; },
      get sandbox() { return p.sandbox; },
      get log() { return p.log; },
      generateImage: (req) => p.generateImage(req),
      generateVideo: (req) => p.generateVideo(req),
      getGenerationStatus: async (id) => ((await this.owns(workspaceId, id)) ? p.getGenerationStatus(id) : failed(id)),
      getAsset: async (id) => ((await this.owns(workspaceId, id)) ? p.getAsset(id) : null),
    };
  }

  async resolve(workspaceId: string, choice: ProviderChoice = 'auto'): Promise<ChainedProvider> {
    return this.bind(await this.build(workspaceId, choice), workspaceId);
  }

  private async build(workspaceId: string, choice: ProviderChoice): Promise<ChainedProvider> {
    const owns = this.owns;
    if (choice === 'chatgpt') return createAiProvider(this.ai, workspaceId, 'openai', { hasOwnKey: !!(await this.keys.get(workspaceId, 'openai')), owns });
    if (choice === 'gemini') return createAiProvider(this.ai, workspaceId, 'gemini', { hasOwnKey: !!(await this.keys.get(workspaceId, 'gemini')), owns });
    const conn = await this.mcp.getLiveConnection(workspaceId, 'higgsfield');
    const higgs = conn && conn.status === 'connected' ? createHiggsfieldProvider(this.mcp, conn) : null;
    if (choice === 'higgsfield') {
      if (!higgs) throw new UserError('Higgsfield não está conectado nesta empresa. Conecte em Integrações.');
      return higgs;
    }
    // Automático: ChatGPT (chave) → Gemini (chave) → Higgsfield → créditos do app.
    const [gKey, oKey] = await Promise.all([this.keys.get(workspaceId, 'gemini'), this.keys.get(workspaceId, 'openai')]);
    const list: ServerCreativeProvider[] = [];
    if (oKey) list.push(createAiProvider(this.ai, workspaceId, 'openai', { hasOwnKey: true, strict: true, owns }));
    if (gKey) list.push(createAiProvider(this.ai, workspaceId, 'gemini', { hasOwnKey: true, strict: true, owns }));
    if (higgs) list.push(higgs);
    // Sem conexões próprias: créditos de IA do app (gateway, ignorando chaves do workspace).
    const app = createAiProvider(this.ai, workspaceId, 'gemini', { hasOwnKey: false, appOnly: true, label: 'Créditos de IA do app', owns });
    if (!list.length) return app;
    list.push(app);
    return chainProviders(list, (m) => this.logger.warn(m));
  }
}
