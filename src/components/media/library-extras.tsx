import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Link } from "@tanstack/react-router";
import { toast } from "sonner";
import { Copy } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { brl, num } from "@/lib/format";
import { mediaAdResults } from "@/lib/media/manage.functions";

/** 6.2 Como esta mídia foi nos anúncios da Meta (via criativo ligado a ela). */
export function AssetAdResults({ workspaceId, creativeId }: { workspaceId: string; creativeId: string | null }) {
  const run = useServerFn(mediaAdResults);
  const { data } = useQuery({
    queryKey: ["media-ad-results", creativeId],
    enabled: !!creativeId,
    queryFn: () => run({ data: { workspaceId, creativeId: creativeId! } }),
  });
  if (!creativeId) return <p className="text-xs text-muted-foreground">Ainda não foi usada em anúncio.</p>;
  if (!data) return null;
  if (!data.days) return <p className="text-xs text-muted-foreground">Usada em campanha, ainda sem resultados sincronizados da Meta.</p>;
  return (
    <div className="grid grid-cols-2 gap-2 text-sm sm:grid-cols-4">
      <div><p className="text-xs text-muted-foreground">Gasto</p>{brl(data.spend)}</div>
      <div><p className="text-xs text-muted-foreground">CTR</p>{data.impressions ? `${num((data.clicks / data.impressions) * 100, 2)}%` : "—"}</div>
      <div><p className="text-xs text-muted-foreground">Leads · CPL</p>{num(data.leads)} · {data.leads ? brl(data.spend / data.leads) : "—"}</div>
      <div><p className="text-xs text-muted-foreground">ROAS</p>{data.spend ? `${num(data.revenue / data.spend, 2)}x` : "—"}</div>
      <p className="col-span-full text-xs text-muted-foreground">Campanhas: {data.campaigns.join(", ") || "—"}</p>
    </div>
  );
}

type CopyRow = {
  id: string;
  version: number;
  status: string;
  angle: string | null;
  created_at: string;
  content: { headline?: string; texto_curto?: string; meta_ad?: string; instagram_feed?: string; cta?: string; reels?: string };
  campaigns: { name: string; brand_id: string | null } | null;
};

/** 6.2 Aba Textos: copies, legendas e roteiros de todas as campanhas, com busca e cópia rápida. */
export function LibraryTexts({ workspaceId, brandId }: { workspaceId: string; brandId: string }) {
  const [q, setQ] = useState("");
  const { data = [], isLoading } = useQuery({
    queryKey: ["library-texts", workspaceId],
    queryFn: async () =>
      ((
        await supabase
          .from("copies")
          .select("id, version, status, angle, created_at, content, campaigns(name, brand_id)")
          .eq("workspace_id", workspaceId)
          .order("created_at", { ascending: false })
          .limit(300)
      ).data ?? []) as unknown as CopyRow[],
  });
  const term = q.trim().toLowerCase();
  const rows = data.filter(
    (r) =>
      (!brandId || r.campaigns?.brand_id === brandId) &&
      (!term || JSON.stringify(r.content).toLowerCase().includes(term) || (r.campaigns?.name ?? "").toLowerCase().includes(term)),
  );
  const copy = (t: string) => {
    navigator.clipboard.writeText(t);
    toast.success("Texto copiado.");
  };
  if (isLoading) return <div className="h-40 animate-pulse rounded-lg bg-muted" />;
  return (
    <div className="space-y-3">
      <Input placeholder="Buscar em títulos, textos e legendas" value={q} onChange={(e) => setQ(e.target.value)} />
      {!rows.length && <p className="text-sm text-muted-foreground">Nenhum texto ainda. As copies geradas nas campanhas aparecem aqui.</p>}
      {rows.map((r) => (
        <div key={r.id} className="space-y-2 rounded-lg border border-border bg-surface/50 p-3 text-sm">
          <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
            <span>
              {r.campaigns?.name ?? "Sem campanha"} · v{r.version} · {r.status === "approved" ? "aprovada" : "rascunho"}
              {r.angle ? ` · ângulo: ${r.angle}` : ""}
            </span>
            <span>{new Date(r.created_at).toLocaleDateString("pt-BR")}</span>
          </div>
          {r.content.headline && <p className="font-medium">{r.content.headline}</p>}
          {(
            [
              ["Anúncio Meta", r.content.meta_ad],
              ["Legenda do feed", r.content.instagram_feed],
              ["Roteiro Reels", r.content.reels],
            ] as [string, string | undefined][]
          )
            .filter(([, v]) => !!v)
            .map(([label, v]) => (
              <div key={label} className="flex items-start justify-between gap-2">
                <p className="whitespace-pre-wrap text-muted-foreground">
                  <span className="text-xs uppercase tracking-wider text-primary">{label}: </span>
                  {v}
                </p>
                <Button size="icon" variant="ghost" onClick={() => copy(v!)} aria-label={`Copiar ${label}`}>
                  <Copy className="size-4" />
                </Button>
              </div>
            ))}
        </div>
      ))}
      <p className="text-xs text-muted-foreground">
        Gere ou aprove copies na tela da <Link to="/campaigns" className="text-primary underline">campanha</Link>.
      </p>
    </div>
  );
}
