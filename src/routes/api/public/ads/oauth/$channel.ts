import { createFileRoute } from "@tanstack/react-router";

/** Retorno do login do Google Ads (?code) e do TikTok for Business (?auth_code). */
export const Route = createFileRoute("/api/public/ads/oauth/$channel")({
  server: {
    handlers: {
      GET: async ({ request, params }) => {
        const url = new URL(request.url);
        const back = (q: string) => Response.redirect(`${url.origin}/integrations?${q}`, 302);
        const channel = params.channel === "google" ? "google" : params.channel === "tiktok" ? "tiktok" : null;
        if (!channel) return back("ads_erro=canal_invalido");
        const err = url.searchParams.get("error_description") ?? url.searchParams.get("error");
        if (err) return back(`ads_erro=${encodeURIComponent(err)}`);
        const code = url.searchParams.get(channel === "google" ? "code" : "auth_code");
        const state = url.searchParams.get("state") ?? "";
        if (!code) return back("ads_erro=retorno_incompleto");
        try {
          const [payload, sig] = state.split(".");
          const data = JSON.parse(Buffer.from(payload ?? "", "base64url").toString()) as { w: string; e: number };
          if (!data?.w || Date.now() > data.e) throw new Error("O login expirou. Tente de novo.");
          const { readCredential } = await import("@/lib/credentials.server");
          const key = channel === "google" ? "GOOGLE_ADS_CLIENT_SECRET" : "TIKTOK_APP_SECRET";
          const secret = (await readCredential(data.w, key)) ?? process.env[key] ?? "";
          const { createHmac, timingSafeEqual } = await import("crypto");
          const expected = Buffer.from(createHmac("sha256", secret).update(payload!).digest("base64url"));
          const got = Buffer.from(sig ?? "");
          if (!secret || expected.length !== got.length || !timingSafeEqual(expected, got)) throw new Error("Assinatura do retorno inválida.");
          if (channel === "google") {
            const { googleExchangeCode } = await import("@/lib/ads/google-ads.server");
            await googleExchangeCode(data.w, code, `${url.origin}/api/public/ads/oauth/google`);
          } else {
            const { tiktokExchangeCode } = await import("@/lib/ads/tiktok-ads.server");
            await tiktokExchangeCode(data.w, code);
          }
          return back(`ads=${channel}`);
        } catch (e) {
          return back(`ads_erro=${encodeURIComponent(e instanceof Error ? e.message : "falhou")}`);
        }
      },
    },
  },
});
