import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";
import { EDITORS, MANAGERS, requireRole } from "@/lib/membership";

const ws = z.object({ workspaceId: z.string().uuid() });
const channel = z.enum(["google", "tiktok"]);

/** Estado assinado do login (volta no callback e diz de qual empresa é). */
async function signState(workspaceId: string, secret: string) {
  const { createHmac } = await import("crypto");
  const payload = Buffer.from(JSON.stringify({ w: workspaceId, e: Date.now() + 15 * 60e3 })).toString("base64url");
  return `${payload}.${createHmac("sha256", secret).update(payload).digest("base64url")}`;
}

/** Status e o que falta em cada canal. */
export const adsChannelsStatus = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => ws.parse(d))
  .handler(async ({ data, context }) => {
    await requireRole(context, data.workspaceId);
    const { googleMissing } = await import("./google-ads.server");
    const { tiktokMissing } = await import("./tiktok-ads.server");
    const [google, tiktok] = await Promise.all([googleMissing(data.workspaceId), tiktokMissing(data.workspaceId)]);
    return { google, tiktok };
  });

/** Salva as credenciais do app de cada canal (vão para o cofre). */
export const saveAdsChannelApp = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    ws
      .extend({
        channel,
        values: z.record(z.string(), z.string().trim().max(500)),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    await requireRole(context, data.workspaceId, MANAGERS);
    const allowed =
      data.channel === "google"
        ? ["GOOGLE_ADS_CLIENT_ID", "GOOGLE_ADS_CLIENT_SECRET", "GOOGLE_ADS_DEVELOPER_TOKEN", "GOOGLE_ADS_CUSTOMER_ID", "GOOGLE_ADS_LOGIN_CUSTOMER_ID"]
        : ["TIKTOK_APP_ID", "TIKTOK_APP_SECRET", "TIKTOK_ADVERTISER_ID"];
    const rows = Object.fromEntries(Object.entries(data.values).filter(([k, v]) => allowed.includes(k) && v));
    if (!Object.keys(rows).length) throw new Error("Nada para salvar.");
    const { writeCredentials } = await import("@/lib/credentials.server");
    await writeCredentials(data.workspaceId, rows);
    return { ok: true };
  });

/** Link do login (Google OAuth ou autorização do TikTok for Business). */
export const adsChannelLoginUrl = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => ws.extend({ channel, origin: z.string().url() }).parse(d))
  .handler(async ({ data, context }) => {
    await requireRole(context, data.workspaceId, MANAGERS);
    const { readCredential } = await import("@/lib/credentials.server");
    if (data.channel === "google") {
      const [id, secret] = await Promise.all([
        readCredential(data.workspaceId, "GOOGLE_ADS_CLIENT_ID").then((v) => v ?? process.env["GOOGLE_ADS_CLIENT_ID"] ?? null),
        readCredential(data.workspaceId, "GOOGLE_ADS_CLIENT_SECRET").then((v) => v ?? process.env["GOOGLE_ADS_CLIENT_SECRET"] ?? null),
      ]);
      if (!id || !secret) throw new Error("Salve o ID e a chave secreta do cliente OAuth primeiro.");
      const { googleLoginUrl } = await import("./google-ads.server");
      return { url: googleLoginUrl(id, `${data.origin}/api/public/ads/oauth/google`, await signState(data.workspaceId, secret)) };
    }
    const [appId, secret] = await Promise.all([
      readCredential(data.workspaceId, "TIKTOK_APP_ID").then((v) => v ?? process.env["TIKTOK_APP_ID"] ?? null),
      readCredential(data.workspaceId, "TIKTOK_APP_SECRET").then((v) => v ?? process.env["TIKTOK_APP_SECRET"] ?? null),
    ]);
    if (!appId || !secret) throw new Error("Salve o App ID e o Secret do app do TikTok primeiro.");
    const { tiktokLoginUrl } = await import("./tiktok-ads.server");
    return { url: tiktokLoginUrl(appId, `${data.origin}/api/public/ads/oauth/tiktok`, await signState(data.workspaceId, secret)) };
  });

/** Contas que o login enxerga, para escolher. */
export const listAdsChannelAccounts = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => ws.extend({ channel }).parse(d))
  .handler(async ({ data, context }) => {
    await requireRole(context, data.workspaceId, MANAGERS);
    if (data.channel === "google") {
      const { googleListCustomers } = await import("./google-ads.server");
      return (await googleListCustomers(data.workspaceId)).map((c) => ({ id: c.id, name: `${c.name}${c.manager ? " (administradora)" : ""}` }));
    }
    const { tiktokListAdvertisers } = await import("./tiktok-ads.server");
    return tiktokListAdvertisers(data.workspaceId);
  });

/** Liga uma campanha já existente no canal à campanha do app (para trazer os resultados). */
export const linkExternalCampaign = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ campaignId: z.string().uuid(), channel, externalId: z.string().trim().max(40) }).parse(d))
  .handler(async ({ data, context }) => {
    const { data: c } = await context.supabase.from("campaigns").select("id, workspace_id").eq("id", data.campaignId).maybeSingle();
    if (!c) throw new Error("Campanha não encontrada.");
    await requireRole(context, c.workspace_id, EDITORS);
    const col = data.channel === "google" ? "google_campaign_id" : "tiktok_campaign_id";
    const { error } = await context.supabase.from("campaigns").update({ [col]: data.externalId.replace(/\D/g, "") || null } as never).eq("id", c.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

/** Cria a campanha pausada no Google (Pesquisa) ou no TikTok (vídeo) a partir da copy, da estratégia e dos criativos aprovados. */
export const createExternalCampaign = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ campaignId: z.string().uuid(), channel }).parse(d))
  .handler(async ({ data, context }) => {
    const db = context.supabase;
    const { data: c } = await db.from("campaigns").select("*, brands(name, logo_url)").eq("id", data.campaignId).maybeSingle();
    if (!c) throw new Error("Campanha não encontrada.");
    await requireRole(context, c.workspace_id, EDITORS);
    if (c.status !== "approved" && c.status !== "active") throw new Error("A campanha precisa ser aprovada antes de ir para outros canais.");
    if (!c.landing_url) throw new Error("Preencha a página de destino da campanha.");
    const { data: copies } = await db.from("copies").select("content, status").eq("campaign_id", c.id).order("version", { ascending: false }).limit(10);
    const rows = (copies ?? []) as { content: any; status: string }[];
    const copy = ((rows.find((r) => r.status === "approved") ?? rows[0])?.content ?? {}) as any;
    const { currentStrategy } = await import("@/lib/ai/strategist.server");
    const strategy = await currentStrategy(db, c.id);

    if (data.channel === "google") {
      if (c.google_campaign_id) throw new Error("Esta campanha já tem campanha ligada no Google Ads.");
      // Títulos (≤30), descrições (≤90) e palavras-chave no formato do Google, escritos pela IA a partir da copy e da estratégia.
      const { jsonLLM } = await import("@/lib/creative/llm.server");
      const schema = {
        type: "object",
        additionalProperties: false,
        required: ["titulos", "descricoes", "palavras_chave"],
        properties: {
          titulos: { type: "array", items: { type: "string" } },
          descricoes: { type: "array", items: { type: "string" } },
          palavras_chave: { type: "array", items: { type: "string" } },
        },
      };
      const ai = (await jsonLLM(
        c.workspace_id,
        [
          "Você é especialista em Google Ads de Pesquisa no Brasil. Gere em português:",
          "- titulos: 12 a 15 títulos com NO MÁXIMO 30 caracteres cada (contando espaços), sem pontuação de exclamação repetida;",
          "- descricoes: 4 descrições com NO MÁXIMO 90 caracteres;",
          "- palavras_chave: 12 a 20 termos que o cliente digitaria no Google (sem marcas de concorrentes).",
          `OFERTA: ${JSON.stringify({ produto: c.offer_product, promessa: c.offer_promise, preco: c.offer_price, publico: c.audience })}`,
          `COPY: ${JSON.stringify({ headline: copy.headline, variacoes: copy.headline_variacoes, texto: copy.texto_curto, cta: copy.cta })}`,
          `ESTRATÉGIA: ${JSON.stringify({ big_idea: strategy?.big_idea, angulos: strategy?.angulos_detalhados?.map((a) => a.gancho) })}`,
        ].join("\n"),
        schema,
        "google_search_assets",
      )) as { titulos: string[]; descricoes: string[]; palavras_chave: string[] };
      const { googleCreateSearchCampaign } = await import("./google-ads.server");
      const sep = c.landing_url.includes("?") ? "&" : "?";
      const r = await googleCreateSearchCampaign(c.workspace_id, {
        name: c.name,
        objective: c.objective,
        dailyBudget: Number(c.budget_daily ?? 0) || 20,
        landingUrl: `${c.landing_url}${sep}utm_source=google&utm_medium=cpc&utm_campaign=${encodeURIComponent(c.name)}`,
        headlines: ai.titulos ?? [],
        descriptions: ai.descricoes ?? [],
        keywords: ai.palavras_chave ?? [],
      });
      await db.from("campaigns").update({ google_campaign_id: r.campaignId, google_status: "PAUSED" } as never).eq("id", c.id);
      return r;
    }

    if (c.tiktok_campaign_id) throw new Error("Esta campanha já tem campanha ligada no TikTok Ads.");
    const { data: creatives } = await db
      .from("creatives")
      .select("title, preview_url, extras")
      .eq("campaign_id", c.id)
      .eq("status", "approved");
    const videos = ((creatives ?? []) as { title: string; preview_url: string | null; extras: any }[])
      .filter((x) => x.preview_url && /\.mp4(\?|$)/i.test(x.preview_url))
      .map((x) => ({ title: x.title, url: x.preview_url!, cover: x.extras?.cover_url ?? null }));
    if (!videos.length) throw new Error("O TikTok só aceita vídeo: aprove pelo menos um criativo em vídeo desta campanha.");
    const { tiktokCreateCampaign } = await import("./tiktok-ads.server");
    const sep = c.landing_url.includes("?") ? "&" : "?";
    const r = await tiktokCreateCampaign(c.workspace_id, {
      name: c.name,
      objective: c.objective,
      dailyBudget: Number(c.budget_daily ?? 0) || 50,
      landingUrl: `${c.landing_url}${sep}utm_source=tiktok&utm_medium=paid&utm_campaign=${encodeURIComponent(c.name)}`,
      adText: String(copy.headline ?? c.offer_promise ?? c.name),
      brandName: (c.brands as { name?: string } | null)?.name ?? c.name,
      logoUrl: (c.brands as { logo_url?: string | null } | null)?.logo_url ?? null,
      videos,
    });
    await db.from("campaigns").update({ tiktok_campaign_id: r.campaignId, tiktok_status: "DISABLE" } as never).eq("id", c.id);
    return r;
  });

/** Ativar (só dono/admin, gasta verba) ou pausar no canal. */
export const setExternalCampaignStatus = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ campaignId: z.string().uuid(), channel, active: z.boolean() }).parse(d))
  .handler(async ({ data, context }) => {
    const { data: c } = await context.supabase.from("campaigns").select("*").eq("id", data.campaignId).maybeSingle();
    if (!c) throw new Error("Campanha não encontrada.");
    await requireRole(context, c.workspace_id, data.active ? MANAGERS : EDITORS);
    if (data.channel === "google") {
      if (!c.google_campaign_id) throw new Error("Sem campanha no Google Ads.");
      const { googleSetStatus } = await import("./google-ads.server");
      await googleSetStatus(c.workspace_id, c.google_campaign_id, data.active ? "ENABLED" : "PAUSED");
      await context.supabase.from("campaigns").update({ google_status: data.active ? "ENABLED" : "PAUSED" } as never).eq("id", c.id);
    } else {
      if (!c.tiktok_campaign_id) throw new Error("Sem campanha no TikTok Ads.");
      const { tiktokSetStatus } = await import("./tiktok-ads.server");
      await tiktokSetStatus(c.workspace_id, c.tiktok_campaign_id, data.active ? "ENABLE" : "DISABLE");
      await context.supabase.from("campaigns").update({ tiktok_status: data.active ? "ENABLE" : "DISABLE" } as never).eq("id", c.id);
    }
    return { ok: true };
  });
