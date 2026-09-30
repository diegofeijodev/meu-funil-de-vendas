/**
 * Leitura dos metadados reais de um MP4/MOV pelo cabeçalho (sem transcodificar)
 * e validação contra as regras do Instagram.
 */
import type { TargetFormat } from "./formats";

export type VideoMeta = {
  width: number | null;
  height: number | null;
  duration: number | null;
  videoCodec: string | null;
  audioCodec: string | null;
  fps: number | null;
  size: number;
  container: string | null;
};

type Box = { type: string; start: number; end: number; body: number };

function boxes(buf: Uint8Array, start: number, end: number): Box[] {
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  const out: Box[] = [];
  let p = start;
  while (p + 8 <= end) {
    let size = dv.getUint32(p);
    const type = String.fromCharCode(buf[p + 4]!, buf[p + 5]!, buf[p + 6]!, buf[p + 7]!);
    let header = 8;
    if (size === 1 && p + 16 <= end) {
      size = Number(dv.getBigUint64(p + 8));
      header = 16;
    } else if (size === 0) size = end - p;
    if (size < header) break;
    out.push({ type, start: p, end: Math.min(end, p + size), body: p + header });
    p += size;
  }
  return out;
}

const find = (buf: Uint8Array, parent: Box, type: string) =>
  boxes(buf, parent.body, parent.end).find((b) => b.type === type);

export function readVideoMeta(buf: Uint8Array): VideoMeta {
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  const meta: VideoMeta = {
    width: null,
    height: null,
    duration: null,
    videoCodec: null,
    audioCodec: null,
    fps: null,
    size: buf.length,
    container: null,
  };
  const top = boxes(buf, 0, buf.length);
  const ftyp = top.find((b) => b.type === "ftyp");
  if (ftyp) meta.container = String.fromCharCode(...buf.slice(ftyp.body, ftyp.body + 4)).trim();
  const moov = top.find((b) => b.type === "moov");
  if (!moov) return meta;
  const mvhd = find(buf, moov, "mvhd");
  if (mvhd) {
    const v = buf[mvhd.body]!;
    const ts = v === 1 ? dv.getUint32(mvhd.body + 20) : dv.getUint32(mvhd.body + 12);
    const dur = v === 1 ? Number(dv.getBigUint64(mvhd.body + 24)) : dv.getUint32(mvhd.body + 16);
    if (ts) meta.duration = Math.round((dur / ts) * 100) / 100;
  }
  for (const trak of boxes(buf, moov.body, moov.end).filter((b) => b.type === "trak")) {
    const mdia = find(buf, trak, "mdia");
    if (!mdia) continue;
    const hdlr = find(buf, mdia, "hdlr");
    const handler = hdlr ? String.fromCharCode(...buf.slice(hdlr.body + 8, hdlr.body + 12)) : "";
    const minf = find(buf, mdia, "minf");
    const stbl = minf ? find(buf, minf, "stbl") : undefined;
    const stsd = stbl ? find(buf, stbl, "stsd") : undefined;
    const codec = stsd ? String.fromCharCode(...buf.slice(stsd.body + 12, stsd.body + 16)) : null;
    if (handler === "vide") {
      meta.videoCodec = codec;
      const tkhd = find(buf, trak, "tkhd");
      if (tkhd) {
        const w = dv.getUint32(tkhd.end - 8) / 65536;
        const h = dv.getUint32(tkhd.end - 4) / 65536;
        if (w && h) {
          meta.width = Math.round(w);
          meta.height = Math.round(h);
        }
      }
      const mdhd = find(buf, mdia, "mdhd");
      const stts = stbl ? find(buf, stbl, "stts") : undefined;
      if (mdhd && stts) {
        const v = buf[mdhd.body]!;
        const ts = v === 1 ? dv.getUint32(mdhd.body + 20) : dv.getUint32(mdhd.body + 12);
        const dur =
          v === 1 ? Number(dv.getBigUint64(mdhd.body + 24)) : dv.getUint32(mdhd.body + 16);
        const n = dv.getUint32(stts.body + 4);
        let samples = 0;
        for (let i = 0; i < n; i++) samples += dv.getUint32(stts.body + 8 + i * 8);
        if (ts && dur) meta.fps = Math.round((samples / (dur / ts)) * 100) / 100;
      }
    } else if (handler === "soun") meta.audioCodec = codec;
  }
  return meta;
}

export type QualityReport = { ok: boolean; issues: string[]; checks: Record<string, unknown> };

const H264 = new Set(["avc1", "avc3"]);

export function validateVideoForInstagram(m: VideoMeta, target: TargetFormat): QualityReport {
  const issues: string[] = [];
  if (m.videoCodec && !H264.has(m.videoCodec))
    issues.push(`Codec de vídeo ${m.videoCodec}; o Instagram pede H.264.`);
  if (!m.videoCodec) issues.push("Não foi possível ler o codec do vídeo (MP4 H.264 esperado).");
  if (m.audioCodec && m.audioCodec !== "mp4a")
    issues.push(`Áudio ${m.audioCodec}; o Instagram pede AAC.`);
  if (m.width && m.width < 720) issues.push(`Largura de ${m.width}px; o mínimo é 720px.`);
  const vertical = target === "ig_reel" || target === "ig_story";
  if (vertical && m.width && m.height) {
    const r = m.width / m.height;
    if (Math.abs(r - 9 / 16) > 0.02)
      issues.push(`Proporção ${m.width}x${m.height}; Reels e Stories pedem 9:16.`);
  }
  if (m.duration != null) {
    if (target === "ig_reel" && (m.duration < 3 || m.duration > 900))
      issues.push(`Duração de ${m.duration}s; Reels vão de 3s a 15 min.`);
    if (target === "ig_story" && m.duration > 60)
      issues.push(`Duração de ${m.duration}s; Stories vão até 60s.`);
  }
  if (m.fps != null && (m.fps < 23 || m.fps > 60))
    issues.push(`${m.fps} quadros por segundo; o Instagram pede entre 23 e 60.`);
  if (m.size > 1024 * 1024 * 1024) issues.push("Arquivo maior que 1 GB.");
  return { ok: issues.length === 0, issues, checks: { ...m } };
}

export function validateImageForInstagram(
  w: number,
  h: number,
  target: TargetFormat,
): QualityReport {
  const issues: string[] = [];
  if (w < 320) issues.push(`Largura de ${w}px é pequena demais.`);
  const r = w / h;
  if (target.startsWith("ig_") && (r < 0.56 || r > 1.91))
    issues.push(`Proporção ${w}x${h} fora do aceito pelo Instagram.`);
  return { ok: issues.length === 0, issues, checks: { width: w, height: h } };
}
