import { createFileRoute } from "@tanstack/react-router";

// TEMPORÁRIO: exportação de arquivos para migração. Remover depois da virada.
const TOKEN_SHA256 = "1016da56d6e50fe4b0e432fd10c345128f172c1e4fb763ea25e2abcf942c00ec";
const ALLOWED_BUCKETS = new Set(["creative-assets", "ig-media"]);

export const Route = createFileRoute("/api/export-file")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const token = request.headers.get("x-export-token") ?? "";
        const { createHash, timingSafeEqual } = await import("node:crypto");
        const got = createHash("sha256").update(token, "utf8").digest();
        const want = Buffer.from(TOKEN_SHA256, "hex");
        if (!token || !timingSafeEqual(got, want)) {
          return new Response(null, { status: 403 });
        }
        const url = new URL(request.url);
        const bucket = url.searchParams.get("bucket") ?? "";
        const name = url.searchParams.get("name") ?? "";
        if (!ALLOWED_BUCKETS.has(bucket)) return new Response(null, { status: 403 });
        if (!name) return new Response(null, { status: 404 });

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const { data, error } = await supabaseAdmin.storage.from(bucket).download(name);
        if (error || !data) return new Response(null, { status: 404 });
        return new Response(await data.arrayBuffer(), {
          status: 200,
          headers: { "content-type": "application/octet-stream" },
        });
      },
    },
  },
});
