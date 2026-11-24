/**
 * QR code da vaga no rodapé da arte (desenho de 24/11 §2.3 e §12; UI §2.2–§2.3). A matriz vem da `qrcode-generator` (versão exata, sem
 * dependências); o desenho é nosso, módulo a módulo, em pixels inteiros (nada de anti-aliasing nas bordas). Conferência em produção SEM
 * decodificador: `verifyQrPixels` reabre os bytes finais (JPEG), reduz para 720 px de largura como o Instagram e compara cada módulo com a
 * matriz (o jest prova com o `jsqr`, só em dev, que a mesma arte é lida).
 */
import qrcode = require('qrcode-generator');
import type { Img, ImageService } from '../media/image.service';

/** Quadrado branco do QR na arte 1080 × 1920: (64, 1508), 180 × 180 (dentro do rodapé preto e do canto arredondado). */
export const QR_BOX = { x: 64, y: 1508, size: 180 } as const;
/** Zona clara em volta do código, em módulos (a norma pede 4; fundo escuro em volta é o pior caso para achar os cantos). */
export const QR_QUIET = 4;
/** Módulo nunca menor que isto na arte (≈ 2,7 px depois da redução do Instagram para 720 px). */
export const QR_MIN_MODULE = 4;
/** Largura em que o Instagram costuma reduzir o story; a conferência mede nela. */
export const QR_CHECK_WIDTH = 720;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * Link da vaga (diária) para o QR: sem `www` (o domínio responde 308 para o `www` mantendo caminho e query) e `?o=ig` (origem; o site lê
 * quando quiser). 77 caracteres → versão 5 com correção M. Id que não é UUID (o `id` da vitrine é texto livre; a vaga de exemplo) → null.
 */
export function vacancyLink(id: string): string | null {
  return UUID.test(id) ? `https://freelaservicos.com.br/vagas/${id.toLowerCase()}?o=ig` : null;
}

export type QrPlan = { url: string; count: number; ecl: 'M' | 'L'; module: number; dark: boolean[][] };

/**
 * Matriz do QR que cabe no quadrado com módulo ≥ 4 px e zona clara de 4 módulos, tentando correção M e depois L (a versão sai da
 * biblioteca). Não cabe → null (V5: a arte sai sem QR, nunca um QR ilegível).
 */
export function planQr(url: string): QrPlan | null {
  for (const ecl of ['M', 'L'] as const) {
    let q: ReturnType<typeof qrcode>;
    try {
      q = qrcode(0, ecl);
      q.addData(url, 'Byte');
      q.make();
    } catch {
      continue; // dado grande demais até para a versão 40
    }
    const count = q.getModuleCount();
    const module = Math.floor(QR_BOX.size / (count + 2 * QR_QUIET));
    if (module < QR_MIN_MODULE) continue;
    const dark = Array.from({ length: count }, (_, r) => Array.from({ length: count }, (_, c) => q.isDark(r, c)));
    return { url, count, ecl, module, dark };
  }
  return null;
}

/** Canto de cima à esquerda do código (sem a zona clara) dentro do quadrado, centralizado em pixels inteiros. */
export function qrOrigin(p: Pick<QrPlan, 'count' | 'module'>): { x: number; y: number } {
  const off = Math.floor((QR_BOX.size - p.count * p.module) / 2);
  return { x: QR_BOX.x + off, y: QR_BOX.y + off };
}

/** Quadrado branco + módulos em tinta (17, 17, 17), pixel a pixel. */
export function drawQr(img: Img, p: QrPlan, ink: [number, number, number] = [17, 17, 17]): void {
  const d = img.bitmap.data as Uint8Array;
  const W = img.bitmap.width as number;
  const paint = (x0: number, y0: number, w: number, h: number, [r, g, b]: [number, number, number]) => {
    for (let y = y0; y < y0 + h; y++)
      for (let x = x0; x < x0 + w; x++) {
        const o = (y * W + x) * 4;
        d[o] = r;
        d[o + 1] = g;
        d[o + 2] = b;
        d[o + 3] = 255;
      }
  };
  paint(QR_BOX.x, QR_BOX.y, QR_BOX.size, QR_BOX.size, [255, 255, 255]);
  const o = qrOrigin(p);
  for (let r = 0; r < p.count; r++) for (let c = 0; c < p.count; c++) if (p.dark[r]![c]) paint(o.x + c * p.module, o.y + r * p.module, p.module, p.module, ink);
}

/**
 * "O sistema leu o QR" sem decodificador (decisão de 24/11, §12): reabre a arte final, reduz para 720 px de largura e confere, no centro de
 * cada módulo, que escuro é escuro e claro é claro — os módulos do código e os 4 de zona clara em volta. Qualquer módulo trocado = falso.
 */
export async function verifyQrPixels(images: ImageService, bytes: Uint8Array, p: QrPlan): Promise<boolean> {
  const img = await images.read(bytes);
  const W0 = img.bitmap.width as number;
  const scale = QR_CHECK_WIDTH / W0;
  img.resize({ w: QR_CHECK_WIDTH, h: Math.round((img.bitmap.height as number) * scale) });
  const d = img.bitmap.data as Uint8Array;
  const W = img.bitmap.width as number;
  const H = img.bitmap.height as number;
  const lum = (x: number, y: number) => {
    const xi = Math.min(W - 1, Math.max(0, Math.round(x)));
    const yi = Math.min(H - 1, Math.max(0, Math.round(y)));
    const o = (yi * W + xi) * 4;
    return 0.299 * d[o]! + 0.587 * d[o + 1]! + 0.114 * d[o + 2]!;
  };
  const o = qrOrigin(p);
  const n = p.count + 2 * QR_QUIET;
  for (let r = 0; r < n; r++)
    for (let c = 0; c < n; c++) {
      const mr = r - QR_QUIET;
      const mc = c - QR_QUIET;
      const inside = mr >= 0 && mc >= 0 && mr < p.count && mc < p.count;
      const want = inside ? p.dark[mr]![mc]! : false;
      // centro do módulo na arte original → escala de 720 px (pixel em [x, x+1) tem centro em x + 0,5)
      const cx = (o.x + mc * p.module + p.module / 2) * scale - 0.5;
      const cy = (o.y + mr * p.module + p.module / 2) * scale - 0.5;
      const dark = lum(cx, cy) < 128;
      if (dark !== want) return false;
    }
  return true;
}
