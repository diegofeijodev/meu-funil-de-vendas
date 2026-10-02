import { BadRequestException, ForbiddenException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import { ENV } from '../../common/config/env.module';
import { Env } from '../../common/config/env.validation';
import { deriveKey } from '../../common/crypto/hkdf';

/** Buckets do protótipo: `creative-assets` (privado) e `ig-media`. */
export const BUCKETS = ['creative-assets', 'ig-media'] as const;
/** Validade padrão das URLs assinadas: 5 anos (igual às URLs que o protótipo gravava no banco). */
export const DEFAULT_URL_TTL_SECONDS = 60 * 60 * 24 * 365 * 5;
/** Prefixos de chave aceitos no upload do navegador (`<kind>/<workspaceId>/...`). */
export const UPLOAD_KINDS = ['brands', 'media', 'posts', 'tmp'] as const;

const MIME_EXT: Record<string, string> = {
  'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp', 'image/gif': 'gif',
  'video/mp4': 'mp4', 'video/quicktime': 'mov', 'video/webm': 'webm', 'application/pdf': 'pdf',
  // Só no upload de arquivos da marca (kind=brands): logo/identidade em SVG e fontes.
  'image/svg+xml': 'svg', 'font/ttf': 'ttf', 'font/otf': 'otf',
};
/** Tipos aceitos SOMENTE em `kind=brands` (a biblioteca de mídia/posts não os usa). */
export const BRAND_ONLY_MIMES = ['image/svg+xml', 'font/ttf', 'font/otf'];
const EXT_MIME: Record<string, string> = Object.fromEntries(Object.entries(MIME_EXT).map(([m, e]) => [e, m]));
EXT_MIME['jpeg'] = 'image/jpeg';

export const isAllowedMime = (mime: string) => mime in MIME_EXT;

/** Navegadores mandam fontes como `font/*`, `application/x-font-*` ou `octet-stream`: a extensão decide. */
const FONT_MIME_ALIASES = new Set(['application/octet-stream', 'application/x-font-ttf', 'application/x-font-otf', 'application/x-font-opentype', 'application/font-sfnt', 'font/sfnt', 'font/truetype', 'font/opentype', 'font/ttf', 'font/otf']);

/** Tipo efetivo do upload (resolve o caso das fontes pela extensão do nome). */
export function resolveUploadMime(filename: string, mime: string): string {
  const m = mime.toLowerCase();
  const ext = path.extname(filename || '').slice(1).toLowerCase();
  if ((ext === 'ttf' || ext === 'otf') && FONT_MIME_ALIASES.has(m)) return ext === 'ttf' ? 'font/ttf' : 'font/otf';
  return m;
}

/** O conteúdo bate com o tipo declarado? (só os tipos novos têm checagem de conteúdo) */
export function contentMatchesMime(mime: string, bytes: Buffer): boolean {
  if (mime === 'font/ttf' || mime === 'font/otf') {
    const sig = bytes.subarray(0, 4).toString('latin1');
    return sig === '\u0000\u0001\u0000\u0000' || sig === 'OTTO' || sig === 'true' || sig === 'ttcf';
  }
  if (mime === 'image/svg+xml') return /<svg[\s>]/i.test(bytes.subarray(0, 4096).toString('utf8'));
  return true;
}
export const mimeFromKey = (key: string) => EXT_MIME[path.extname(key).slice(1).toLowerCase()] ?? 'application/octet-stream';
export const extFromMime = (mime: string) => MIME_EXT[mime] ?? 'bin';

@Injectable()
export class FilesService {
  private readonly root: string;
  private readonly signingKey: Buffer;
  private readonly publicUrl: string;

  constructor(@Inject(ENV) env: Pick<Env, 'UPLOADS_DIR' | 'FILES_SIGNING_SECRET' | 'JWT_SECRET' | 'PUBLIC_URL'>) {
    this.root = path.resolve(env.UPLOADS_DIR);
    this.signingKey = deriveKey(env.FILES_SIGNING_SECRET || env.JWT_SECRET, 'files-url-signing');
    this.publicUrl = env.PUBLIC_URL.replace(/\/$/, '');
  }

  // ---------- caminho com contenção ----------

  assertBucket(bucket: string): void {
    if (!(BUCKETS as readonly string[]).includes(bucket)) {
      throw new NotFoundException({ code: 'NOT_FOUND', message: 'Arquivo não encontrado.' });
    }
  }

  /** Normaliza a chave e garante que ela não escapa de UPLOADS_DIR/<bucket>. */
  resolvePath(bucket: string, key: string): string {
    this.assertBucket(bucket);
    if (!key || key.includes('\0') || key.includes('\\') || key.startsWith('/') || key.split('/').some((s) => s === '..' || s === '.' || s === '')) {
      throw new BadRequestException({ code: 'BAD_REQUEST', message: 'Chave de arquivo inválida.' });
    }
    const base = path.join(this.root, bucket);
    const full = path.resolve(base, key);
    if (full !== base && !full.startsWith(base + path.sep)) {
      throw new BadRequestException({ code: 'BAD_REQUEST', message: 'Chave de arquivo inválida.' });
    }
    return full;
  }

  // ---------- armazenamento ----------

  async put(bucket: string, key: string, bytes: Uint8Array | Buffer): Promise<void> {
    const full = this.resolvePath(bucket, key);
    await fs.mkdir(path.dirname(full), { recursive: true });
    await fs.writeFile(full, bytes);
  }

  async read(bucket: string, key: string): Promise<Buffer> {
    const full = this.resolvePath(bucket, key);
    try {
      return await fs.readFile(full);
    } catch {
      throw new NotFoundException({ code: 'NOT_FOUND', message: 'Arquivo não encontrado.' });
    }
  }

  async exists(bucket: string, key: string): Promise<boolean> {
    try {
      await fs.access(this.resolvePath(bucket, key));
      return true;
    } catch {
      return false;
    }
  }

  async delete(bucket: string, key: string): Promise<void> {
    await fs.rm(this.resolvePath(bucket, key), { force: true });
  }

  /** Chave nova no formato do protótipo para arquivos gerados: `YYYY-MM-DD/<uuid>.<ext>`. */
  newGeneratedKey(ext: string, now = new Date()): string {
    return `${now.toISOString().slice(0, 10)}/${randomUUID()}.${ext}`;
  }

  /** Chave de upload do navegador: `<kind>/<workspaceId>/<uuid>.<ext>`. */
  newUploadKey(kind: string, workspaceId: string, ext: string): string {
    if (!(UPLOAD_KINDS as readonly string[]).includes(kind)) {
      throw new BadRequestException({ code: 'BAD_REQUEST', message: 'Tipo de upload inválido.' });
    }
    return `${kind}/${workspaceId}/${randomUUID()}.${ext}`;
  }

  /** O arquivo pertence ao workspace? (`<kind>/<workspaceId>/...`) */
  keyBelongsToWorkspace(key: string, workspaceId: string): boolean {
    const [kind, ws] = key.split('/');
    return !!kind && (UPLOAD_KINDS as readonly string[]).includes(kind) && ws === workspaceId;
  }

  // ---------- URLs assinadas ----------

  private sign(bucket: string, key: string, exp: number): string {
    return createHmac('sha256', this.signingKey).update(`${bucket}\n${key}\n${exp}`).digest('hex');
  }

  /** URL assinada (HMAC-SHA256) de validade longa para `GET /v1/files/:bucket/*`. */
  signedUrl(bucket: string, key: string, ttlSeconds = DEFAULT_URL_TTL_SECONDS, nowMs = Date.now()): string {
    this.resolvePath(bucket, key); // valida
    const exp = Math.floor(nowMs / 1000) + ttlSeconds;
    const encKey = key.split('/').map(encodeURIComponent).join('/');
    return `${this.publicUrl}/v1/files/${bucket}/${encKey}?exp=${exp}&sig=${this.sign(bucket, key, exp)}`;
  }

  /** Se `url` é uma URL assinada DESTA API (`<PUBLIC_URL>/v1/files/<bucket>/<chave>?exp&sig`), devolve suas partes (sem validar). */
  parseOwnUrl(url: string): { bucket: string; key: string; exp: string | null; sig: string | null } | null {
    if (!url.startsWith(`${this.publicUrl}/v1/files/`)) return null;
    try {
      const u = new URL(url);
      const rest = u.pathname.slice('/v1/files/'.length);
      const slash = rest.indexOf('/');
      if (slash < 1) return null;
      const key = rest.slice(slash + 1).split('/').map(decodeURIComponent).join('/');
      return { bucket: rest.slice(0, slash), key, exp: u.searchParams.get('exp'), sig: u.searchParams.get('sig') };
    } catch {
      return null;
    }
  }

  /** Confere assinatura e validade. Lança 403 se inválida/expirada. */
  verify(bucket: string, key: string, exp: string | undefined, sig: string | undefined, nowMs = Date.now()): void {
    const bad = () => new ForbiddenException({ code: 'FORBIDDEN', message: 'Link inválido ou expirado.' });
    const expN = Number(exp);
    if (!sig || !exp || !Number.isFinite(expN)) throw bad();
    const expected = Buffer.from(this.sign(bucket, key, expN), 'hex');
    if (!/^[0-9a-f]{64}$/.test(sig)) throw bad();
    const given = Buffer.from(sig, 'hex');
    if (given.length !== expected.length || !timingSafeEqual(given, expected)) throw bad();
    if (expN * 1000 < nowMs) throw bad();
  }
}
