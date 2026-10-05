import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { ENV } from '../../common/config/env.module';
import { Env } from '../../common/config/env.validation';
import { assertExternalUrl } from '../media/external-fetch';
import { AiDownloadBlockedError, AiError } from './ai-error';
import { AiKeysService } from './ai-keys.service';
import { resolveModel } from './model-map';
import { isValidVideoJobId } from './video-job-id';
import {
  AI_FETCH, AI_GUARDED_FETCH, AiFetch, AiImageInput, AiImageRequest, AiImageResult, AiJsonRequest, AiTextRequest, AiVendor, AiVideoRequest, AiVideoResult,
} from './ai.types';
import { testOverridesAllowed } from '../../common/config/test-overrides';

const GEMINI = 'https://generativelanguage.googleapis.com/v1beta';
const OPENAI = 'https://api.openai.com/v1';
const b64 = (b: Uint8Array) => Buffer.from(b).toString('base64');
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
/** Teto do vídeo baixado do Gemini e saltos de redirecionamento seguidos à mão. */
export const MAX_VIDEO_BYTES = 100 * 1024 * 1024;
const MAX_VIDEO_HOPS = 4;
const REDIRECTS = new Set([301, 302, 303, 307, 308]);
const isVertical = (ar: string) => ar === '9:16' || ar === '4:5';

/** Custos estimados (créditos do app); 0 quando é a chave do cliente. */
export const AI_COST = { chatgptImage: 1.5, geminiImage: 1.0, video: 6.0 } as const;

const OPENAI_SIZE: Record<string, string> = { '1:1': '1024x1024', '4:5': '1024x1536', '9:16': '1024x1536', '16:9': '1536x1024' };

/** Extrai o primeiro objeto `{...}` do texto (a IA às vezes embrulha o JSON). Contrato do protótipo. */
export function parseJsonLoose(text: string): any {
  const m = text.match(/\{[\s\S]*\}/);
  if (!m) throw new AiError('A IA não devolveu o formato esperado.');
  try {
    return JSON.parse(m[0]);
  } catch {
    throw new AiError('A IA não devolveu o formato esperado.');
  }
}

/**
 * Cliente de IA do app: texto, JSON com schema estrito, visão, imagem e vídeo.
 * Ordem (igual ao protótipo): chave própria OpenAI → chave própria Gemini → gateway do app
 * (API compatível com OpenAI em AI_GATEWAY_URL). Nenhuma rede é feita aqui diretamente:
 * tudo passa pelo `AiFetch` injetado.
 */
@Injectable()
export class AiService {
  private readonly logger = new Logger(AiService.name);

  constructor(
    private readonly keys: AiKeysService,
    @Inject(AI_FETCH) private readonly http: AiFetch,
    @Inject(ENV) private readonly env: Env,
    /** Fetch com DNS verificado (SSRF) para baixar URLs devolvidas pelo provedor; sem ele (testes) usa a porta comum. */
    @Optional() @Inject(AI_GUARDED_FETCH) private readonly guarded?: AiFetch,
  ) {
    // Fail-closed: em produção o download de URLs do provedor SEMPRE passa pelo fetch com DNS verificado (SSRF).
    if (!testOverridesAllowed(env) && !guarded) throw new Error('AI_GUARDED_FETCH ausente fora de desenvolvimento/teste: o download de vídeo exige o fetch guardado (SSRF).');
  }

  model(id?: string): string {
    return resolveModel(this.env, id);
  }

  // ------------------------------------------------------------------ erros

  private async vendorError(vendor: AiVendor, res: Response): Promise<AiError> {
    const body = await res.text().catch(() => '');
    const name = vendor === 'openai' ? 'OpenAI' : 'Google Gemini';
    if (res.status === 401 || res.status === 403) return new AiError(`Chave da ${name} inválida ou sem permissão.`);
    if (res.status === 429) return new AiError(`Sua conta ${name} está sem créditos ou atingiu o limite.`);
    return new AiError(`${name} respondeu ${res.status}: ${body.slice(0, 300)}`);
  }

  private async gatewayError(res: Response): Promise<AiError> {
    const body = await res.text().catch(() => '');
    if (res.status === 402) return new AiError('Créditos de IA esgotados. Adicione créditos para continuar.');
    if (res.status === 429) return new AiError('Muitas solicitações agora. Aguarde um instante e tente de novo.');
    return new AiError(`IA respondeu ${res.status}: ${body.slice(0, 300)}`);
  }

  // ------------------------------------------------------------------ gateway

  private gateway(): { base: string; key: string } {
    const base = this.env.AI_GATEWAY_URL?.replace(/\/$/, '');
    const key = this.env.AI_GATEWAY_API_KEY;
    if (!base || !key) throw new AiError('IA do app não configurada.', 'AI_NOT_CONFIGURED');
    return { base, key };
  }

  private async gw(path: string, init: RequestInit & { json?: unknown }): Promise<Response> {
    const { base, key } = this.gateway();
    const headers: Record<string, string> = { Authorization: `Bearer ${key}`, ...(init.headers as Record<string, string> | undefined) };
    let body = init.body;
    if (init.json !== undefined) {
      headers['Content-Type'] = 'application/json';
      body = JSON.stringify(init.json);
    }
    return this.http(`${base}${path}`, { method: init.method ?? 'POST', headers, body, signal: AbortSignal.timeout(180_000) });
  }

  private async gatewayChat(model: string, content: unknown, extra: Record<string, unknown> = {}): Promise<any> {
    const res = await this.gw('/chat/completions', { json: { model, messages: [{ role: 'user', content }], ...extra } });
    if (!res.ok) throw await this.gatewayError(res);
    return res.json();
  }

  // ------------------------------------------------------------------ texto

  /** Texto livre. BYO OpenAI → BYO Gemini → gateway. */
  async text(workspaceId: string, req: AiTextRequest): Promise<string> {
    const [o, g] = await Promise.all([this.keys.get(workspaceId, 'openai'), this.keys.get(workspaceId, 'gemini')]);
    const prompt = req.system ? `${req.system}\n\n${req.prompt}` : req.prompt;
    if (o) {
      try { return await this.openaiText(o, prompt, false); } catch (e) { this.warn('chave OpenAI', e); }
    }
    if (g) {
      try { return await this.geminiText(g, [{ text: prompt }], false); } catch (e) { this.warn('chave Gemini', e); }
    }
    const j = await this.gatewayChat(this.model(req.model), prompt);
    return String(j.choices?.[0]?.message?.content ?? '');
  }

  /**
   * JSON com schema estrito (texto ou visão). O gateway usa `json_schema` strict; as chaves próprias
   * usam modo JSON. Em todos os casos o retorno passa pelo parser `{...}` tolerante (contrato do protótipo).
   */
  async json<T = any>(workspaceId: string, req: AiJsonRequest): Promise<T> {
    const images = req.images ?? [];
    const keysHint = req.schema['properties'] ? Object.keys(req.schema['properties'] as object) : [];
    const full = `${req.prompt}\nDevolva SOMENTE JSON com estas chaves: ${JSON.stringify(keysHint)}.`;
    const [o, g] = await Promise.all([
      images.length ? Promise.resolve(null) : this.keys.get(workspaceId, 'openai'),
      this.keys.get(workspaceId, 'gemini'),
    ]);
    if (o) {
      try { return parseJsonLoose(await this.openaiText(o, full, true)); } catch (e) { this.warn('chave OpenAI', e); }
    }
    if (g) {
      try {
        const parts = [...images.map((i) => ({ inlineData: { mimeType: i.mime, data: b64(i.bytes) } })), { text: images.length ? `${req.prompt}\nDevolva SOMENTE JSON.` : full }];
        return parseJsonLoose(await this.geminiText(g, parts, true));
      } catch (e) { this.warn('chave Gemini', e); }
    }
    return this.gatewayJson<T>(req);
  }

  /**
   * JSON com escolha de motor e rótulo do motor usado (Copy Engine). Diferente de `json`, o prompt vai
   * como veio (sem o sufixo "Devolva SOMENTE JSON…": o prompt de copy já lista as chaves), `engine`
   * limita quais chaves próprias são tentadas (`chatgpt` só OpenAI, `gemini` só Gemini, `auto` as duas)
   * e o resultado diz quem respondeu. Chave própria que falha cai para o gateway (rótulo "sua chave falhou").
   */
  async jsonWithEngine<T = any>(
    workspaceId: string,
    req: Pick<AiJsonRequest, 'prompt' | 'schema' | 'name' | 'model'> & { engine?: 'auto' | 'chatgpt' | 'gemini' },
  ): Promise<{ content: T; engine: string }> {
    const engine = req.engine ?? 'auto';
    const [o, g] = await Promise.all([this.keys.get(workspaceId, 'openai'), this.keys.get(workspaceId, 'gemini')]);
    const fails: string[] = [];
    if ((engine === 'chatgpt' || engine === 'auto') && o) {
      try { return { content: parseJsonLoose(await this.openaiText(o, req.prompt, true)), engine: 'Sua conta OpenAI' }; }
      catch (e) { fails.push(`OpenAI: ${e instanceof Error ? e.message : 'falhou'}`); }
    }
    if ((engine === 'gemini' || engine === 'auto') && g) {
      try { return { content: parseJsonLoose(await this.geminiText(g, [{ text: req.prompt }], true)), engine: 'Sua conta Gemini' }; }
      catch (e) { fails.push(`Gemini: ${e instanceof Error ? e.message : 'falhou'}`); }
    }
    if (fails.length) this.logger.warn(`chaves próprias falharam: ${fails.join(' | ')}`);
    return { content: await this.gatewayJson<T>(req), engine: fails.length ? 'IA do app (sua chave falhou)' : 'IA do app' };
  }

  /** Diagnóstico: um JSON mínimo pelo gateway do app (NUNCA pelas chaves próprias). */
  async pingGateway(): Promise<{ model: string; ok: boolean }> {
    const model = this.model();
    const r = await this.gatewayJson<{ ok?: boolean }>({
      prompt: 'Responda exatamente com o JSON {"ok": true}.',
      name: 'ping',
      schema: { type: 'object', additionalProperties: false, required: ['ok'], properties: { ok: { type: 'boolean' } } },
    });
    return { model, ok: r.ok === true };
  }

  /** Atalho de visão: JSON a partir de imagens + prompt. */
  vision<T = any>(workspaceId: string, req: AiJsonRequest & { images: AiImageInput[] }): Promise<T> {
    return this.json<T>(workspaceId, req);
  }

  private async gatewayJson<T>(req: AiJsonRequest): Promise<T> {
    const content: unknown = req.images?.length
      ? [
          ...req.images.map((i) => ({ type: 'image_url', image_url: { url: `data:${i.mime};base64,${b64(i.bytes)}` } })),
          { type: 'text', text: req.prompt },
        ]
      : req.prompt;
    const j = await this.gatewayChat(this.model(req.model), content, {
      response_format: { type: 'json_schema', json_schema: { name: req.name, strict: true, schema: req.schema } },
    });
    const out = j.choices?.[0]?.message?.content;
    if (!out) throw new AiError('A IA não conseguiu responder.');
    return parseJsonLoose(String(out));
  }

  private async openaiText(key: string, prompt: string, asJson: boolean): Promise<string> {
    const res = await this.http(`${OPENAI}/chat/completions`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: this.env.AI_BYO_OPENAI_TEXT_MODEL,
        ...(asJson ? { response_format: { type: 'json_object' } } : {}),
        messages: [{ role: 'user', content: prompt }],
      }),
      signal: AbortSignal.timeout(120_000),
    });
    if (!res.ok) throw await this.vendorError('openai', res);
    const j = (await res.json()) as any;
    return String(j.choices?.[0]?.message?.content ?? '');
  }

  private async geminiText(key: string, parts: unknown[], asJson: boolean): Promise<string> {
    const res = await this.http(`${GEMINI}/models/${this.env.AI_BYO_GEMINI_TEXT_MODEL}:generateContent`, {
      method: 'POST',
      headers: { 'x-goog-api-key': key, 'Content-Type': 'application/json' },
      body: JSON.stringify({ contents: [{ parts }], ...(asJson ? { generationConfig: { responseMimeType: 'application/json' } } : {}) }),
      signal: AbortSignal.timeout(120_000),
    });
    if (!res.ok) throw await this.vendorError('gemini', res);
    const j = (await res.json()) as any;
    return (j.candidates?.[0]?.content?.parts ?? []).map((x: any) => x.text ?? '').join('');
  }

  // ------------------------------------------------------------------ imagem

  async image(workspaceId: string, req: AiImageRequest): Promise<AiImageResult> {
    const userKey = req.appOnly ? null : await this.keys.get(workspaceId, req.vendor);
    if (userKey) {
      try {
        const r = req.vendor === 'openai' ? await this.openaiDirectImage(userKey, req) : await this.geminiDirectImage(userKey, req);
        return { ...r, cost: 0, note: req.vendor === 'openai' ? 'ChatGPT (chave do workspace)' : 'Gemini (chave do workspace)' };
      } catch (e) {
        if (req.strict) throw e;
        this.warn(`chave própria ${req.vendor} (usando o gateway do app)`, e);
      }
    }
    const r = req.vendor === 'openai' ? await this.gatewayOpenaiImage(req) : await this.gatewayGeminiImage(req);
    return { ...r, cost: req.vendor === 'openai' ? AI_COST.chatgptImage : AI_COST.geminiImage, note: null };
  }

  private pngResult(b64png: string | undefined, who: string): { bytes: Buffer; mime: string; ext: string } {
    if (!b64png) throw new AiError(`${who} não devolveu imagem (possível recusa de conteúdo).`);
    return { bytes: Buffer.from(b64png, 'base64'), mime: 'image/png', ext: 'png' };
  }

  private editForm(model: string, req: AiImageRequest, size: string): FormData {
    const fd = new FormData();
    fd.append('model', model);
    fd.append('prompt', req.prompt.slice(0, 30000));
    fd.append('size', size);
    fd.append('quality', 'high');
    (req.referenceImages ?? []).slice(0, 4).forEach((r, i) => fd.append('image[]', new Blob([r.bytes as BlobPart], { type: r.mime }), `ref${i}.jpg`));
    return fd;
  }

  private async openaiDirectImage(key: string, req: AiImageRequest) {
    const size = OPENAI_SIZE[req.aspectRatio] ?? '1024x1024';
    const model = this.env.AI_MODEL_IMAGE_OPENAI;
    const res = req.referenceImages?.length
      ? await this.http(`${OPENAI}/images/edits`, { method: 'POST', headers: { Authorization: `Bearer ${key}` }, body: this.editForm(model, req, size), signal: AbortSignal.timeout(180_000) })
      : await this.http(`${OPENAI}/images/generations`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ model, prompt: req.prompt.slice(0, 30000), size, quality: 'high' }),
          signal: AbortSignal.timeout(180_000),
        });
    if (!res.ok) throw await this.vendorError('openai', res);
    const j = (await res.json()) as { data?: { b64_json?: string }[] };
    return this.pngResult(j.data?.[0]?.b64_json, 'A OpenAI');
  }

  private async geminiDirectImage(key: string, req: AiImageRequest) {
    const res = await this.http(`${GEMINI}/models/${this.env.AI_MODEL_IMAGE_GEMINI}:generateContent`, {
      method: 'POST',
      headers: { 'x-goog-api-key': key, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [...(req.referenceImages ?? []).slice(0, 4).map((r) => ({ inlineData: { mimeType: r.mime, data: b64(r.bytes) } })), { text: `${req.prompt}\nProporção da imagem: ${req.aspectRatio}.` }] }],
        generationConfig: { responseModalities: ['IMAGE', 'TEXT'], imageConfig: { aspectRatio: req.aspectRatio } },
      }),
      signal: AbortSignal.timeout(180_000),
    });
    if (!res.ok) throw await this.vendorError('gemini', res);
    const j = (await res.json()) as any;
    const part = (j.candidates?.[0]?.content?.parts ?? []).find((p: any) => p.inlineData?.data);
    if (!part) throw new AiError('O Gemini não devolveu imagem (possível recusa de conteúdo).');
    const mime: string = part.inlineData.mimeType ?? 'image/png';
    return { bytes: Buffer.from(part.inlineData.data, 'base64'), mime, ext: mime.includes('jpeg') ? 'jpg' : 'png' };
  }

  private async gatewayOpenaiImage(req: AiImageRequest) {
    const model = this.model('openai/gpt-image-2.5-sunburst');
    const size = OPENAI_SIZE[req.aspectRatio] ?? '1024x1024';
    if (req.referenceImages?.length) {
      // Edição com as fotos de referência; se o endpoint recusar, gera sem elas.
      const res = await this.gw('/images/edits', { body: this.editForm(model, req, size) });
      if ([400, 404, 415, 422].includes(res.status)) {
        this.logger.warn(`edição com referências recusada: ${res.status}`);
      } else {
        if (!res.ok) throw await this.gatewayError(res);
        const j = (await res.json()) as { data?: { b64_json?: string }[] };
        return this.pngResult(j.data?.[0]?.b64_json, 'A IA');
      }
    }
    const res = await this.gw('/images/generations', { json: { model, prompt: req.prompt, size, quality: 'high' } });
    if (!res.ok) throw await this.gatewayError(res);
    const j = (await res.json()) as { data?: { b64_json?: string }[] };
    return this.pngResult(j.data?.[0]?.b64_json, 'A IA');
  }

  private async gatewayGeminiImage(req: AiImageRequest) {
    const res = await this.gw('/images/generations', {
      json: { model: this.model('google/gemini-3.1-flash-image'), prompt: `${req.prompt}\nProporção da imagem: ${req.aspectRatio}.`, size: OPENAI_SIZE[req.aspectRatio] ?? '1024x1024' },
    });
    if (!res.ok) throw await this.gatewayError(res);
    const j = (await res.json()) as { data?: { b64_json?: string }[] };
    return this.pngResult(j.data?.[0]?.b64_json, 'A IA');
  }

  // ------------------------------------------------------------------ vídeo

  /**
   * Vídeo (Veo). Chave Gemini do cliente primeiro; senão gateway do app. Se passar do prazo
   * devolve `pending` com o id do job (`veo:`/`gveo:`) para `videoStatus` consultar depois.
   */
  async video(workspaceId: string, req: AiVideoRequest): Promise<AiVideoResult> {
    const deadline = Date.now() + (req.maxWaitMs ?? 6 * 60_000);
    const userKey = req.appOnly ? null : await this.keys.get(workspaceId, 'gemini');
    if (userKey) {
      try {
        const r = await this.geminiDirectVideo(userKey, req, deadline);
        if ('pending' in r) return { status: 'pending', jobId: `gveo:${r.pending}`, cost: 0, note: 'Vídeo pela chave Gemini, ainda gerando' };
        return { status: 'ready', bytes: r.bytes, mime: 'video/mp4', jobId: r.id, cost: 0, note: 'Vídeo pela chave Gemini' };
      } catch (e) {
        if (req.strict || e instanceof AiDownloadBlockedError) throw e; // bloqueio (SSRF/teto): nunca cai em silêncio no gateway pago
        this.warn('vídeo pela chave Gemini (usando o gateway do app)', e);
      }
    }
    const r = await this.gatewayVideo(req, deadline);
    if ('pending' in r) return { status: 'pending', jobId: `veo:${r.pending}`, cost: AI_COST.video, note: 'Vídeo pelo Veo do app, ainda gerando' };
    return { status: 'ready', bytes: r.bytes, mime: 'video/mp4', jobId: r.id, cost: AI_COST.video, note: 'Vídeo pelo Veo do app' };
  }

  /** Consulta um job de vídeo que passou do prazo da requisição (`pending`). */
  async videoStatus(workspaceId: string, jobId: string, waitMs = 20_000): Promise<AiVideoResult | { status: 'failed' }> {
    // Defesa em profundidade: o chamador também confere o vínculo com o workspace (ver createAiProvider).
    if (!isValidVideoJobId(jobId)) return { status: 'failed' };
    const deadline = Date.now() + waitMs;
    if (jobId.startsWith('veo:')) {
      const r = await this.gatewayVideoWait(jobId.slice(4), deadline);
      return 'pending' in r ? { status: 'pending', jobId, cost: 0, note: null } : { status: 'ready', bytes: r.bytes, mime: 'video/mp4', jobId, cost: 0, note: null };
    }
    if (jobId.startsWith('gveo:')) {
      const key = await this.keys.get(workspaceId, 'gemini');
      if (!key) return { status: 'failed' };
      const r = await this.geminiVideoWait(key, jobId.slice(5), deadline);
      return 'pending' in r ? { status: 'pending', jobId, cost: 0, note: null } : { status: 'ready', bytes: r.bytes, mime: 'video/mp4', jobId, cost: 0, note: null };
    }
    return { status: 'failed' };
  }

  private veoInstance(req: AiVideoRequest) {
    const ref = req.referenceImages?.[0];
    return { prompt: req.prompt.slice(0, 3000), ...(ref ? { image: { bytesBase64Encoded: b64(ref.bytes), mimeType: ref.mime } } : {}) };
  }

  private async gatewayVideo(req: AiVideoRequest, deadline: number) {
    const create = (resolution: string) =>
      this.gw('/videos', {
        json: {
          model: this.model('google/veo-3.1-fast'),
          instances: [this.veoInstance(req)],
          parameters: { durationSeconds: 8, resolution, aspectRatio: isVertical(req.aspectRatio) ? '9:16' : '16:9', sampleCount: 1, generateAudio: true },
        },
      });
    let res = await create('1080p');
    if (res.status === 400 || res.status === 422) res = await create('720p');
    if (!res.ok) throw await this.gatewayError(res);
    const job = (await res.json()) as { id: string };
    return this.gatewayVideoWait(job.id, deadline);
  }

  private async gatewayVideoWait(id: string, deadline: number): Promise<{ bytes: Buffer; id: string } | { pending: string }> {
    for (;;) {
      const p = await this.gw(`/videos/${encodeURIComponent(id)}`, { method: 'GET' });
      if (!p.ok) throw await this.gatewayError(p);
      const job = (await p.json()) as { status: string; error?: { message?: string } };
      if (job.status === 'failed') throw new AiError(job.error?.message ?? 'Geração de vídeo falhou.');
      if (job.status === 'completed') break;
      if (Date.now() + 6000 > deadline) return { pending: id };
      await sleep(6000);
    }
    const dl = await this.gw(`/videos/${encodeURIComponent(id)}/content`, { method: 'GET' });
    if (!dl.ok) throw await this.gatewayError(dl);
    return { bytes: Buffer.from(await dl.arrayBuffer()), id };
  }

  private async geminiDirectVideo(key: string, req: AiVideoRequest, deadline: number) {
    let lastErr: unknown = null;
    for (const model of [this.env.AI_MODEL_VIDEO, 'veo-3.0-fast-generate-preview']) {
      try {
        const create = (resolution: string) =>
          this.http(`${GEMINI}/models/${model}:predictLongRunning`, {
            method: 'POST',
            headers: { 'x-goog-api-key': key, 'Content-Type': 'application/json' },
            body: JSON.stringify({ instances: [this.veoInstance(req)], parameters: { aspectRatio: isVertical(req.aspectRatio) ? '9:16' : '16:9', resolution } }),
            signal: AbortSignal.timeout(120_000),
          });
        let res = await create('1080p');
        if (res.status === 400 || res.status === 422) res = await create('720p');
        if (!res.ok) throw await this.vendorError('gemini', res);
        const op = (await res.json()) as { name: string };
        return await this.geminiVideoWait(key, op.name, deadline);
      } catch (e) {
        if (e instanceof AiDownloadBlockedError) throw e; // bloqueio de segurança/tamanho: não tenta outro modelo
        lastErr = e;
        this.warn(`vídeo com ${model}`, e);
      }
    }
    throw lastErr ?? new AiError('Nenhum modelo Veo disponível na sua chave Gemini.');
  }

  private async geminiVideoWait(key: string, name: string, deadline: number): Promise<{ bytes: Buffer; id: string } | { pending: string }> {
    let op: any;
    for (;;) {
      const p = await this.http(`${GEMINI}/${name}`, { headers: { 'x-goog-api-key': key } });
      if (!p.ok) throw await this.vendorError('gemini', p);
      op = await p.json();
      if (op.done) break;
      if (Date.now() + 8000 > deadline) return { pending: name };
      await sleep(8000);
    }
    if (op.error) throw new AiError(op.error.message ?? 'Geração de vídeo falhou.');
    const uri = op.response?.generateVideoResponse?.generatedSamples?.[0]?.video?.uri;
    if (!uri) throw new AiError('O Gemini não devolveu vídeo (possível recusa de conteúdo).');
    return { bytes: await this.downloadGeminiVideo(uri, key), id: name };
  }

  /**
   * A `uri` vem do provedor, então não é confiável: https público, DNS verificado (fetch guardado), redirecionamentos
   * seguidos à mão (≤ 4) revalidando cada salto, a chave só vai ao host original e o corpo é lido com teto.
   */
  private async downloadGeminiVideo(uri: string, key: string): Promise<Buffer> {
    const allowLocal = testOverridesAllowed(this.env);
    const fetcher = this.guarded ?? this.http;
    let url = this.blockedIfUnsafe(uri, allowLocal);
    const originHost = new URL(url).host;
    for (let hop = 0; hop <= MAX_VIDEO_HOPS; hop++) {
      const headers: Record<string, string> = new URL(url).host === originHost ? { 'x-goog-api-key': key } : {};
      let dl: Response;
      try {
        dl = await fetcher(url, { headers, redirect: 'manual', signal: AbortSignal.timeout(120_000) });
      } catch (e) {
        // O guarda de DNS (SSRF) recusa a conexão com EBLOCKED: bloqueio, não falha de rede.
        const code = (e as { code?: string; cause?: { code?: string } } | null);
        if (code?.code === 'EBLOCKED' || code?.cause?.code === 'EBLOCKED') throw new AiDownloadBlockedError('O endereço do vídeo aponta para a rede interna e não é permitido.');
        throw e;
      }
      if (REDIRECTS.has(dl.status)) {
        const loc = dl.headers.get('location');
        await dl.body?.cancel().catch(() => undefined);
        if (!loc) throw new AiError('O Gemini devolveu um redirecionamento sem destino ao baixar o vídeo.');
        url = this.blockedIfUnsafe(new URL(loc, url).toString(), allowLocal);
        continue;
      }
      if (!dl.ok) throw await this.vendorError('gemini', dl);
      return this.readVideoCapped(dl);
    }
    throw new AiDownloadBlockedError('O Gemini redirecionou o download do vídeo vezes demais.');
  }

  /** `assertExternalUrl` com o erro marcado como bloqueio (não cai no gateway pago). */
  private blockedIfUnsafe(raw: string, allowLocal: boolean): string {
    try {
      return assertExternalUrl(raw, allowLocal, 'endereço do vídeo');
    } catch (e) {
      throw new AiDownloadBlockedError(e instanceof Error ? e.message : 'Endereço do vídeo não permitido.');
    }
  }

  /** Lê o corpo aos pedaços e aborta ao passar do teto (não confia em content-length). */
  private async readVideoCapped(res: Response): Promise<Buffer> {
    const tooBig = () => new AiDownloadBlockedError('O vídeo devolvido pelo Gemini é grande demais.');
    if (Number(res.headers.get('content-length') ?? 0) > MAX_VIDEO_BYTES) {
      await res.body?.cancel().catch(() => undefined);
      throw tooBig();
    }
    if (!res.body) {
      const all = Buffer.from(await res.arrayBuffer());
      if (all.length > MAX_VIDEO_BYTES) throw tooBig();
      return all;
    }
    const reader = res.body.getReader();
    const chunks: Uint8Array[] = [];
    let total = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.length;
      if (total > MAX_VIDEO_BYTES) {
        await reader.cancel().catch(() => undefined);
        throw tooBig();
      }
      chunks.push(value);
    }
    return Buffer.concat(chunks);
  }

  private warn(what: string, e: unknown) {
    this.logger.warn(`${what} falhou: ${e instanceof Error ? e.message : e}`);
  }
}
