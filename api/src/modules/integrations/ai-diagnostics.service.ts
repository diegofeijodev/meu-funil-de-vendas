import { HttpException, Inject, Injectable } from '@nestjs/common';
import { ENV } from '../../common/config/env.module';
import { Env } from '../../common/config/env.validation';
import { WorkspaceAccessService } from '../access/access.service';
import { AiKeysService } from '../ai/ai-keys.service';
import { AiService } from '../ai/ai.service';
import { AI_FETCH, AiFetch } from '../ai/ai.types';
import { CanvaService } from '../canva/canva.service';
import { McpService } from '../mcp/mcp.service';
import { errMessage } from '../media/user-error';

export interface DiagnosticCheck {
  name: string;
  /** `null` = opcional / não conectado. */
  ok: boolean | null;
  detail: string;
}

type EnvSlice = Pick<
  Env,
  'AI_GATEWAY_URL' | 'AI_GATEWAY_API_KEY' | 'AI_MODEL_IMAGE_OPENAI' | 'AI_MODEL_IMAGE_GEMINI' | 'AI_MODEL_VIDEO' | 'AI_BYO_OPENAI_TEXT_MODEL' | 'AI_BYO_GEMINI_TEXT_MODEL'
>;

const HIGGSFIELD_TOOLS = ['generate_image', 'generate_video', 'job_status'];
const TIMEOUT_MS = 20_000;

/** Tira chaves (a inteira, a versão codificada e qualquer coisa com cara de chave) de textos vindos do provedor. */
export function redactSecrets(text: string, secrets: (string | null | undefined)[]): string {
  let out = text;
  for (const s of secrets) {
    if (!s || s.length < 6) continue;
    for (const v of new Set([s, encodeURIComponent(s), JSON.stringify(s).slice(1, -1)])) out = out.replaceAll(v, '••••');
  }
  return out.replace(/\b(?:sk-[A-Za-z0-9_-]{10,}|AIza[0-9A-Za-z_-]{10,})/g, '••••').replace(/(Bearer\s+)[A-Za-z0-9._~+/=-]{8,}/gi, '$1••••');
}

const msg = (e: unknown) => (e instanceof HttpException ? errMessage(e) : e instanceof Error ? e.message : String(e)).slice(0, 300);

/**
 * `diagnoseAi` (`ai-diagnostics.functions.ts`): confere de verdade o gateway do app, as chaves BYO, o Canva e o Higgsfield.
 * Adaptações à troca de infra (mesmo formato `{ checks:[{name,ok,detail}], at }`):
 *  - "IA do app" testa `AI_GATEWAY_URL` + `AI_GATEWAY_API_KEY` (era `LOVABLE_API_KEY`) e mostra o modelo configurado (era `openai/gpt-6-astra`);
 *  - os modelos exigidos de cada chave BYO são os configurados em `AI_MODEL_*`/`AI_BYO_*` (o protótipo fixava ids do Lovable);
 *  - o teste de imagem usa o gateway do app (`appOnly`), não o provedor Lovable.
 */
@Injectable()
export class AiDiagnosticsService {
  constructor(
    private readonly access: WorkspaceAccessService,
    private readonly keys: AiKeysService,
    private readonly ai: AiService,
    private readonly canva: CanvaService,
    private readonly mcp: McpService,
    @Inject(AI_FETCH) private readonly http: AiFetch,
    @Inject(ENV) private readonly env: EnvSlice,
  ) {}

  private get(url: string, headers: Record<string, string>) {
    return this.http(url, { headers, signal: AbortSignal.timeout(TIMEOUT_MS) });
  }

  async diagnose(userId: string, workspaceId: string, withImage: boolean): Promise<{ checks: DiagnosticCheck[]; at: string }> {
    await this.access.require(userId, workspaceId, 'read');
    const checks: DiagnosticCheck[] = [];
    const run = async (name: string, fn: () => Promise<DiagnosticCheck | DiagnosticCheck[]>) => {
      try {
        const r = await fn();
        checks.push(...(Array.isArray(r) ? r : [r]));
      } catch (e) {
        checks.push({ name, ok: false, detail: msg(e) });
      }
    };

    // IA do app (texto) — estrategista, copy, diretor de arte e SDR.
    if (!this.env.AI_GATEWAY_URL || !this.env.AI_GATEWAY_API_KEY) {
      checks.push({ name: 'IA do app (texto)', ok: false, detail: 'AI_GATEWAY_URL e AI_GATEWAY_API_KEY não configuradas no servidor.' });
    } else {
      const label = `IA do app (texto · ${this.ai.model()})`;
      await run(label, async () => {
        const r = await this.ai.pingGateway();
        return { name: label, ok: r.ok, detail: r.ok ? 'Respondendo.' : 'Resposta inesperada.' };
      });
    }

    const [openai, gemini] = await Promise.all([this.keys.get(workspaceId, 'openai'), this.keys.get(workspaceId, 'gemini')]);

    if (!openai) checks.push({ name: 'Chave OpenAI', ok: null, detail: 'Não conectada (opcional).' });
    else {
      await run('Chave OpenAI', async () => {
        const r = await this.get(`${this.keys.baseUrl('openai')}/models`, { Authorization: `Bearer ${openai}` });
        if (!r.ok) throw new Error(`OpenAI respondeu ${r.status}: ${(await r.text()).slice(0, 150)}`);
        const ids = new Set(((await r.json()) as { data?: { id: string }[] }).data?.map((m) => m.id) ?? []);
        const need = [this.env.AI_MODEL_IMAGE_OPENAI, this.env.AI_BYO_OPENAI_TEXT_MODEL, 'whisper-1'];
        const missing = need.filter((m) => !ids.has(m));
        return {
          name: 'Chave OpenAI',
          ok: missing.length === 0,
          detail: missing.length ? `Válida, mas sem acesso a: ${missing.join(', ')} (gpt-image-1 exige organização verificada).` : `Válida, com ${need.slice(0, -1).join(', ')} e ${need[need.length - 1]}.`,
        };
      });
    }

    if (!gemini) checks.push({ name: 'Chave Gemini', ok: null, detail: 'Não conectada (opcional).' });
    else {
      await run('Chave Gemini', async () => {
        const r = await this.get(`${this.keys.baseUrl('gemini')}/models?pageSize=1000`, { 'x-goog-api-key': gemini });
        if (!r.ok) throw new Error(`Gemini respondeu ${r.status}: ${(await r.text()).slice(0, 150)}`);
        const names = ((await r.json()) as { models?: { name: string }[] }).models?.map((m) => m.name.replace('models/', '')) ?? [];
        const want: [string, string][] = [
          [this.env.AI_MODEL_IMAGE_GEMINI, 'imagem'],
          [this.env.AI_MODEL_VIDEO, 'vídeo Veo'],
          [this.env.AI_BYO_GEMINI_TEXT_MODEL, 'texto/visão/áudio'],
        ];
        const missing = want.filter(([m]) => !names.some((n) => n.startsWith(m))).map(([m, d]) => `${m} (${d})`);
        return {
          name: 'Chave Gemini',
          ok: missing.length < want.length,
          detail: missing.length ? `Válida. Indisponíveis nesta chave: ${missing.join(', ')}.` : 'Válida, com imagem, vídeo Veo e texto.',
        };
      });
    }

    await run('Canva', async () => {
      const cs = await this.canva.status(userId, workspaceId);
      if (!cs.connected) return { name: 'Canva', ok: null, detail: 'Não conectado (opcional).' };
      await this.canva.test(userId, workspaceId);
      return { name: 'Canva', ok: true, detail: `Conectado${cs.name ? ` como ${cs.name}` : ''}.` };
    });

    await run('Higgsfield', async () => {
      const c = await this.mcp.getLiveConnection(workspaceId, 'higgsfield').catch(() => null);
      if (!c) return { name: 'Higgsfield', ok: null, detail: 'Não conectado (opcional).' };
      const names = (c.tools ?? []).map((t) => t.name);
      const missing = HIGGSFIELD_TOOLS.filter((t) => !names.includes(t));
      return {
        name: 'Higgsfield',
        ok: c.status === 'connected' && missing.length === 0,
        detail:
          c.status !== 'connected'
            ? `Status: ${c.status}. Reconecte em Integrações.`
            : missing.length
              ? `Conectado, mas sem as ferramentas: ${missing.join(', ')}.`
              : `Conectado (${names.length} ferramentas).`,
      };
    });

    if (withImage) {
      const label = `Imagem com créditos do app (${this.ai.model('google/gemini-3.1-flash-image')})`;
      await run(label, async () => {
        const r = await this.ai.image(workspaceId, { prompt: 'A simple red apple on a white table, studio photo.', aspectRatio: '1:1', vendor: 'gemini', appOnly: true });
        return { name: label, ok: r.bytes.length > 0, detail: r.bytes.length > 0 ? 'Imagem gerada.' : 'Sem imagem.' };
      });
    }
    // O corpo de erro de um provedor pode ecoar a chave (ou parte dela): nada disso sai daqui.
    const secrets = [openai, gemini, this.env.AI_GATEWAY_API_KEY];
    for (const c of checks) c.detail = redactSecrets(c.detail, secrets);
    return { checks, at: new Date().toISOString() };
  }
}
