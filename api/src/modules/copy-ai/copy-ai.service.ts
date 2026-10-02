import { BadRequestException, Injectable } from '@nestjs/common';
import { WorkspaceAccessService } from '../access/access.service';
import { AiError } from '../ai/ai-error';
import { AiService } from '../ai/ai.service';
import { StrategistService } from '../strategist/strategist.service';
import { strategyBrief } from '../strategist/strategist.prompt';
import { buildCopyPrompt, COPY_SCHEMA } from './copy-ai.prompt';

export type CopyEngine = 'auto' | 'chatgpt' | 'gemini';
const MAX_INPUT_CHARS = 30_000;

/** Mensagens da cópia do protótipo (as do `AiService` são as genéricas do criativo). */
function copyError(e: unknown): unknown {
  if (!(e instanceof AiError)) return e;
  const message = (e.getResponse() as { message?: string }).message ?? '';
  if (message === 'A IA não devolveu o formato esperado.') return new AiError('A IA não devolveu a copy no formato esperado.');
  if (message.startsWith('Créditos de IA esgotados')) return new AiError('Créditos de IA esgotados. Conecte sua própria chave em Integrações.');
  if (message.startsWith('Muitas solicitações agora')) return new AiError('Muitas solicitações agora. Tente em instantes.');
  if (message === 'A IA não conseguiu responder.') return new AiError('A IA não conseguiu gerar a copy.');
  return e;
}

/**
 * Copy Engine (`copy-ai.functions.ts` + `copy-ai.server.ts`). Ordem: chave própria OpenAI → chave própria Gemini
 * → IA do app, orientada pela estratégia aprovada da campanha. Se a IA falhar o erro sobe: nunca devolvemos copy de modelo.
 */
@Injectable()
export class CopyAiService {
  constructor(
    private readonly ai: AiService,
    private readonly access: WorkspaceAccessService,
    private readonly strategist: StrategistService,
  ) {}

  async generate(
    userId: string,
    input: { workspaceId: string; engine?: CopyEngine; brand: Record<string, unknown>; brief: Record<string, unknown>; seed?: number; campaignId?: string | null; angle?: string | null },
  ): Promise<{ content: any; engine: string }> {
    // Gasta crédito de IA: precisa poder editar (a tela esconde o botão do viewer).
    await this.access.require(userId, input.workspaceId, 'write');
    if (JSON.stringify(input.brand).length + JSON.stringify(input.brief).length > MAX_INPUT_CHARS) {
      throw new BadRequestException({ code: 'BAD_REQUEST', message: 'Briefing grande demais.' });
    }
    // A estratégia aprovada da campanha (big idea, ângulos, objeções) orienta a copy.
    const strategy = strategyBrief(await this.strategist.currentStrategy(input.workspaceId, input.campaignId), input.angle);
    const prompt = buildCopyPrompt(input.brand, input.brief, input.seed ?? 0, strategy);
    try {
      return await this.ai.jsonWithEngine(input.workspaceId, { prompt, schema: COPY_SCHEMA, name: 'copy', engine: input.engine ?? 'auto' });
    } catch (e) {
      throw copyError(e);
    }
  }
}
