/**
 * Pipeline de direção de arte para imagens: variações → Biblioteca → crítico visual →
 * melhor escolhida (1 nova tentativa se < 28/50) → composição com logo e textos.
 */
import type { ServerCreativeProvider, GenerationResult } from "@/lib/providers/creative-provider.server";
import type { TargetFormat } from "@/lib/media/formats";
import { providerPrompt } from "./art-director.server";
import { scoreCreative, MIN_SCORE } from "./critic.server";
import { composeCreative } from "./compose.server";
import { loadFont, loadLogo, type BrandRef } from "./refs.server";
import { listField, type AiScore, type ArtDirection, type TextLayout, type Variation, type VisualStyle } from "./visual-style";

async function db() {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return supabaseAdmin;
}

export type PipelineInput = {
  workspaceId: string;
  brand: any | null;
  provider: ServerCreativeProvider;
  ad: ArtDirection;
  aspectRatio: string;
  targetFormat: TargetFormat;
  refs: BrandRef[];
  variations: number;
  layout: TextLayout;
  text: { title?: string | null; price?: string | null; cta?: string | null };
  title: string;
  campaignId?: string | null;
  angle?: string | null;
  igPostId?: string | null;
  createdBy?: string | null;
  /** Reescreve a direção de arte a partir do motivo do crítico. */
  rebuild?: (motivo: string) => Promise<ArtDirection>;
};

export type PipelineResult =
  | { pending: GenerationResult; ad: ArtDirection }
  | {
      pending: null;
      ad: ArtDirection;
      variations: Variation[];
      winner: Variation;
      finalAssetId: string;
      finalUrl: string;
      finalThumb: string | null;
      width: number | null;
      height: number | null;
      igReady: boolean;
      cost: number;
    };

async function patchReport(id: string, report: any, extra: Record<string, unknown>) {
  const s = await db();
  await s
    .from("media_assets" as never)
    .update({ quality_report: { ...(report ?? {}), ...extra } } as never)
    .eq("id", id);
}

export async function runImagePipeline(inp: PipelineInput): Promise<PipelineResult> {
  const { ingestAsset, readAssetBytes } = await import("@/lib/media/assets.server");
  const group = crypto.randomUUID();
  let ad = inp.ad;
  let cost = 0;
  const pool: { asset: any; bytes: Uint8Array; score: AiScore | null; prompt: string }[] = [];
  const vs = (inp.brand?.visual_style ?? {}) as VisualStyle;
  const palette = listField(vs.paleta_hex).length
    ? listField(vs.paleta_hex)
    : [inp.brand?.primary_color, inp.brand?.secondary_color].filter(Boolean);

  const round = async (n: number) => {
    const prompt = providerPrompt(ad);
    const req = {
      finalPrompt: prompt,
      aspectRatio: inp.aspectRatio,
      kind: "image" as const,
      referenceImages: inp.refs.map((r) => ({ bytes: r.bytes, mime: r.mime })),
      referenceUrls: inp.refs.map((r) => r.url).filter(Boolean),
    };
    const settled = await Promise.allSettled(
      Array.from({ length: n }, () => inp.provider.generateImage(req)),
    );
    const ok = settled.filter((s): s is PromiseFulfilledResult<GenerationResult> => s.status === "fulfilled").map((s) => s.value);
    const pending = ok.find((r) => r.status === "generating" && r.externalJobId);
    if (pending && !ok.some((r) => r.status === "ready")) return pending;
    const ready = ok.filter((r) => r.status === "ready" && r.assetUrl);
    if (!ready.length) {
      const err = settled.find((s) => s.status === "rejected") as PromiseRejectedResult | undefined;
      const failed = ok.find((r) => r.status === "failed");
      const reason = err?.reason instanceof Error ? err.reason.message : err?.reason ? String(err.reason) : null;
      throw new Error(reason || failed?.raw || `O provedor não devolveu uma imagem pronta (${ok.map((r) => r.status).join(", ") || "sem resposta"}).`);
    }
    await Promise.all(
      ready.map(async (r) => {
        cost += r.cost;
        const asset = await ingestAsset({
          workspaceId: inp.workspaceId,
          kind: "image",
          targetFormat: inp.targetFormat,
          source: inp.provider.id,
          sourceUrl: r.assetUrl!,
          title: `${inp.title} (limpa)`,
          prompt: ad.prompt_final,
          provider: inp.provider.id,
          cost: r.cost,
          brandId: inp.brand?.id ?? null,
          campaignId: inp.campaignId ?? null,
          angle: inp.angle ?? null,
          igPostId: inp.igPostId ?? null,
          createdBy: inp.createdBy ?? null,
        });
        const { bytes } = await readAssetBytes(asset as any);
        let score: AiScore | null = null;
        try {
          score = await scoreCreative({
            workspaceId: inp.workspaceId,
            image: bytes,
            refs: inp.refs,
            palette,
            aspectRatio: inp.aspectRatio,
            subject: ad.subject,
          });
        } catch (e) {
          console.warn("[critic] falhou", e instanceof Error ? e.message : e);
        }
        pool.push({ asset, bytes, score, prompt: ad.prompt_final });
      }),
    );
    return null;
  };

  const pending = await round(Math.max(1, Math.min(4, inp.variations)));
  if (pending) return { pending, ad };

  const best = () => [...pool].sort((a, b) => (b.score?.total ?? -1) - (a.score?.total ?? -1))[0]!;
  const top = best();
  if (inp.rebuild && top.score && top.score.total < MIN_SCORE) {
    try {
      ad = await inp.rebuild(top.score.motivo);
      await round(1);
    } catch (e) {
      console.warn("[pipeline] nova tentativa falhou", e instanceof Error ? e.message : e);
    }
  }
  const win = best();

  await Promise.all(
    pool.map((p) =>
      patchReport(p.asset.id, p.asset.quality_report, {
        ai_score: p.score,
        winner: p === win,
        variation_group: group,
        version: "clean",
      }),
    ),
  );

  // Composição final (texto e logo por cima). "Limpo" sem logo = a própria vencedora.
  let final = win.asset;
  const logoPos = vs.posicao_logo ?? "none";
  const needsCompose = inp.layout !== "limpo" || logoPos !== "none";
  if (needsCompose) {
    try {
      const [font, logo] = await Promise.all([loadFont(inp.brand?.id), loadLogo(inp.brand?.id)]);
      const composed = await composeCreative({
        image: win.bytes,
        aspectRatio: inp.aspectRatio,
        layout: inp.layout,
        title: inp.text.title,
        price: inp.text.price,
        cta: inp.text.cta,
        logo,
        logoPosition: logoPos,
        font,
        primary: palette[0] ?? null,
        secondary: palette[1] ?? null,
      });
      final = await ingestAsset({
        workspaceId: inp.workspaceId,
        kind: "image",
        targetFormat: inp.targetFormat,
        source: inp.provider.id,
        bytes: composed,
        mime: "image/jpeg",
        title: inp.title,
        prompt: win.prompt,
        provider: inp.provider.id,
        brandId: inp.brand?.id ?? null,
        campaignId: inp.campaignId ?? null,
        angle: inp.angle ?? null,
        igPostId: inp.igPostId ?? null,
        parentId: win.asset.id,
        createdBy: inp.createdBy ?? null,
      });
      await patchReport(final.id, final.quality_report, {
        ai_score: win.score,
        winner: true,
        variation_group: group,
        version: "final",
        layout: inp.layout,
      });
    } catch (e) {
      console.error("[compose] falhou; usando a imagem limpa", e instanceof Error ? e.message : e);
    }
  }

  const variations: Variation[] = pool.map((p) => ({
    assetId: p.asset.id,
    url: p.asset.url,
    score: p.score,
    winner: p === win,
  }));
  return {
    pending: null,
    ad,
    variations,
    winner: variations.find((v) => v.winner)!,
    finalAssetId: final.id,
    finalUrl: final.url,
    finalThumb: final.thumbnail_url ?? final.url,
    width: final.width,
    height: final.height,
    igReady: final.ig_ready,
    cost,
  };
}
