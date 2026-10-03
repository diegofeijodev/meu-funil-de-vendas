/**
 * Acabamento do vídeo (somente servidor), sem transcodificar o MP4:
 * - capa (Reels/Stories) com logo, título e CTA aplicados por cima — texto nunca gerado pela IA;
 * - legendas em .vtt (players/Instagram) e .srt (CapCut, Premiere) a partir da copy.
 */
import type { ServerCreativeProvider } from "@/lib/providers/creative-provider.server";

const pad = (n: number, w = 2) => String(Math.floor(n)).padStart(w, "0");
const stamp = (sec: number, sep: "." | ",") => `${pad(sec / 3600)}:${pad((sec % 3600) / 60)}:${pad(sec % 60)}${sep}${pad((sec % 1) * 1000, 3)}`;

/** Quebra o texto em blocos de até 6 palavras distribuídos ao longo do vídeo. */
export function buildCaptions(text: string, durationSec: number) {
  const words = text.replace(/\s+/g, " ").trim().split(" ").filter(Boolean);
  const chunks: string[] = [];
  for (let i = 0; i < words.length; i += 6) chunks.push(words.slice(i, i + 6).join(" "));
  if (!chunks.length) return { vtt: "WEBVTT\n", srt: "" };
  const slot = durationSec / chunks.length;
  const cues = chunks.map((c, i) => ({ start: i * slot, end: Math.min(durationSec, (i + 1) * slot - 0.05), text: c }));
  const vtt = `WEBVTT\n\n${cues.map((c) => `${stamp(c.start, ".")} --> ${stamp(c.end, ".")}\n${c.text}`).join("\n\n")}\n`;
  const srt = `${cues.map((c, i) => `${i + 1}\n${stamp(c.start, ",")} --> ${stamp(c.end, ",")}\n${c.text}`).join("\n\n")}\n`;
  return { vtt, srt };
}

async function storeText(workspaceId: string, name: string, content: string, mime: string) {
  const { storeBytes } = await import("@/lib/media/assets.server");
  const path = `media/${workspaceId}/${new Date().toISOString().slice(0, 10)}/${crypto.randomUUID()}-${name}`;
  return storeBytes(path, new TextEncoder().encode(content), mime);
}

export type VideoExtrasInput = {
  workspaceId: string;
  brand: { id: string; primary_color?: string | null; secondary_color?: string | null } | null;
  provider: ServerCreativeProvider | null;
  visualPrompt: string;
  aspectRatio: string;
  durationSec: number;
  headline: string | null;
  cta: string | null;
  captionText: string | null;
  videoAssetId: string | null;
  campaignId: string | null;
  title: string;
  withCover: boolean;
};

export async function buildVideoExtras(inp: VideoExtrasInput) {
  const out: { cover_url?: string; cover_asset_id?: string; captions_vtt?: string; captions_srt?: string; errors?: string[] } = {};
  const errors: string[] = [];
  const caption = (inp.captionText || inp.headline || "").trim();
  if (caption) {
    try {
      const { vtt, srt } = buildCaptions(caption, inp.durationSec);
      out.captions_vtt = await storeText(inp.workspaceId, "legendas.vtt", vtt, "text/vtt");
      out.captions_srt = await storeText(inp.workspaceId, "legendas.srt", srt, "application/x-subrip");
    } catch (e) {
      errors.push(`legendas: ${e instanceof Error ? e.message : "falhou"}`);
    }
  }
  if (inp.withCover && inp.provider) {
    try {
      const still = await inp.provider.generateImage({
        finalPrompt: `${inp.visualPrompt}\nQuadro estático para a capa de um vídeo. Não inclua texto, letras nem logotipos.`,
        aspectRatio: inp.aspectRatio === "16:9" ? "16:9" : "9:16",
        kind: "image",
      });
      if (!still.assetUrl) throw new Error("o provedor não devolveu a imagem da capa");
      const res = await fetch(still.assetUrl);
      if (!res.ok) throw new Error(`não foi possível baixar a capa (${res.status})`);
      const image = new Uint8Array(await res.arrayBuffer());
      const { loadFont, loadLogo } = await import("./refs.server");
      const { composeCreative } = await import("./compose.server");
      const [font, logo] = await Promise.all([loadFont(inp.brand?.id), loadLogo(inp.brand?.id)]);
      const composed = await composeCreative({
        image,
        aspectRatio: inp.aspectRatio === "16:9" ? "16:9" : "9:16",
        layout: inp.cta ? "cta_rodape" : "titulo_topo",
        title: inp.headline,
        cta: inp.cta,
        logo,
        font,
        primary: inp.brand?.primary_color ?? null,
        secondary: inp.brand?.secondary_color ?? null,
      });
      const { ingestAsset } = await import("@/lib/media/assets.server");
      const asset = await ingestAsset({
        workspaceId: inp.workspaceId,
        kind: "image",
        targetFormat: inp.aspectRatio === "16:9" ? "other" : "ig_story",
        source: inp.provider.id,
        bytes: composed,
        mime: "image/jpeg",
        title: `${inp.title} (capa)`,
        provider: inp.provider.id,
        brandId: inp.brand?.id ?? null,
        campaignId: inp.campaignId,
        parentId: inp.videoAssetId,
        normalize: true,
      });
      out.cover_url = asset.url;
      out.cover_asset_id = asset.id;
    } catch (e) {
      errors.push(`capa: ${e instanceof Error ? e.message : "falhou"}`);
    }
  }
  if (errors.length) out.errors = errors;
  return out;
}
