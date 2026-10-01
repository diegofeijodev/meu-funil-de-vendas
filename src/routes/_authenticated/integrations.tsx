import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useWorkspace } from "@/lib/workspace";
import { PageHeader, Section, StatusPill } from "@/components/ui-bits";
import { shortDate } from "@/lib/format";
import { McpConnections } from "@/components/mcp-connections";
import { MetaAdsCard } from "@/components/meta-ads-card";
import { AdsChannelsCard } from "@/components/ads-channels-card";
import { AiKeysCard } from "@/components/ai-keys-card";
import { AiDiagnosticsCard } from "@/components/ai-diagnostics-card";
import { AgencyConnectionsCard } from "@/components/agency-connections-card";

export const Route = createFileRoute("/_authenticated/integrations")({
  head: () => ({
    meta: [
      { title: "Integrações · Meu Funil" },
      { name: "description", content: "Conexões reais com Meta Ads, Instagram, OpenAI, Gemini e Higgsfield." },
      { property: "og:title", content: "Integrações · Meu Funil" },
      { property: "og:description", content: "Conecte as contas e IAs que a agência usa." },
    ],
  }),
  component: Integrations,
});

function Integrations() {
  const { workspaceId } = useWorkspace();

  const { data } = useQuery({
    queryKey: ["integrations", workspaceId],
    enabled: !!workspaceId,
    queryFn: async () => {
      const { data: jobs } = await supabase
        .from("publishing_jobs")
        .select("*")
        .eq("workspace_id", workspaceId!)
        .order("created_at", { ascending: false })
        .limit(15);
      return { jobs: jobs ?? [] };
    },
  });

  if (!data) return <div className="panel h-64 animate-pulse" />;

  return (
    <>
      <PageHeader
        title="Integrações"
        subtitle="Conecte a Meta, as IAs de imagem e vídeo e o Higgsfield. Cada conexão mostra o passo a passo e o status real."
      />

      <div className="space-y-6">
        <MetaAdsCard />
        <AdsChannelsCard />
        <AgencyConnectionsCard />
        <AiKeysCard />
        <McpConnections />
        <AiDiagnosticsCard />

        <Section title="Histórico de publicações">
          {data.jobs.length === 0 ? (
            <p className="text-sm text-muted-foreground">Nenhuma publicação executada ainda.</p>
          ) : (
            <div className="space-y-2 text-sm">
              {data.jobs.map((j) => (
                <div key={j.id} className="rounded-lg border border-border/60 px-4 py-2.5">
                  <div className="flex items-center justify-between">
                    <span className="font-medium capitalize">{j.target}</span>
                    <div className="flex items-center gap-2 text-xs text-muted-foreground">
                      <span>{shortDate(j.created_at)}</span>
                      <StatusPill status={j.status === "done" ? "approved" : j.status} label={j.mode === "mock" ? "simulado (antigo)" : j.mode === "live" ? "real" : j.mode} />
                    </div>
                  </div>
                  {j.log && <pre className="mt-2 whitespace-pre-wrap text-xs text-muted-foreground">{j.log}</pre>}
                </div>
              ))}
            </div>
          )}
        </Section>
      </div>
    </>
  );
}
