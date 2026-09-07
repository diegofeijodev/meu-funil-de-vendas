import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useWorkspace, logActivity } from "@/lib/workspace";
import { PageHeader, Section, StatusPill, SandboxBadge } from "@/components/ui-bits";
import { Button } from "@/components/ui/button";
import { shortDate } from "@/lib/format";
import { McpConnections } from "@/components/mcp-connections";

export const Route = createFileRoute("/_authenticated/integrations")({
  head: () => ({
    meta: [
      { title: "Integrações · AI Marketing OS" },
      { name: "description", content: "Meta Ads, Higgsfield e geradores de imagem em modo sandbox, prontos para credenciais reais." },
      { property: "og:title", content: "Integrações · AI Marketing OS" },
      { property: "og:description", content: "Conecte provedores reais quando quiser sair do modo simulado." },
    ],
  }),
  component: Integrations,
});

const PROVIDERS: Record<string, { label: string; description: string }> = {
  meta: {
    label: "Meta Ads",
    description: "Criação de campanhas, conjuntos, criativos e anúncios. Hoje em sandbox: nada é enviado à Meta real.",
  },
  higgsfield: {
    label: "Higgsfield",
    description: "Geração de vídeos e imagens de alta qualidade. Requer credencial guardada no backend.",
  },
  openai_image: {
    label: "Gerador de imagens",
    description: "Imagens estáticas e variações de criativos por prompt.",
  },
};

function Integrations() {
  const { workspaceId, canEdit } = useWorkspace();
  const qc = useQueryClient();

  const { data } = useQuery({
    queryKey: ["integrations", workspaceId],
    enabled: !!workspaceId,
    queryFn: async () => {
      const [conns, meta, jobs] = await Promise.all([
        supabase.from("integration_connections").select("*").eq("workspace_id", workspaceId!).order("provider"),
        supabase.from("meta_accounts").select("*").eq("workspace_id", workspaceId!).maybeSingle(),
        supabase.from("publishing_jobs").select("*").eq("workspace_id", workspaceId!).order("created_at", { ascending: false }).limit(15),
      ]);
      return { conns: conns.data ?? [], meta: meta.data, jobs: jobs.data ?? [] };
    },
  });

  const toggle = async (id: string, provider: string, connected: boolean) => {
    await supabase
      .from("integration_connections")
      .update({
        status: connected ? "disconnected" : "connected",
        mode: "mock",
        account_label: connected ? null : `${PROVIDERS[provider]?.label ?? provider} (sandbox)`,
        connected_at: connected ? null : new Date().toISOString(),
      })
      .eq("id", id);
    if (workspaceId) await logActivity(workspaceId, connected ? "integration.disconnected" : "integration.connected", "integration", { provider });
    qc.invalidateQueries({ queryKey: ["integrations", workspaceId] });
    toast.success(connected ? "Integração desconectada." : "Integração conectada em modo sandbox.");
  };

  if (!data) return <div className="panel h-64 animate-pulse" />;

  return (
    <>
      <PageHeader
        title="Integrações"
        subtitle="Todas as integrações rodam em modo simulado. A arquitetura já está pronta para credenciais reais no backend."
        actions={<SandboxBadge />}
      />

      <div className="space-y-6">
        <McpConnections />

        <Section title="Provedores">
          <div className="grid gap-4 md:grid-cols-3">
            {data.conns.map((c) => {
              const info = PROVIDERS[c.provider];
              const connected = c.status === "connected";
              return (
                <div key={c.id} className="rounded-lg border border-border bg-surface/50 p-4">
                  <div className="flex items-center justify-between">
                    <h3 className="font-medium">{info?.label ?? c.provider}</h3>
                    <StatusPill status={c.status} label={connected ? "Conectado" : "Desconectado"} />
                  </div>
                  <p className="mt-2 text-sm text-muted-foreground">{info?.description}</p>
                  {c.account_label && <p className="mt-2 text-xs text-muted-foreground">Conta: {c.account_label}</p>}
                  {canEdit && (
                    <Button
                      className="mt-4 w-full"
                      variant={connected ? "outline" : "default"}
                      onClick={() => toggle(c.id, c.provider, connected)}
                    >
                      {connected ? "Desconectar" : "Conectar (sandbox)"}
                    </Button>
                  )}
                </div>
              );
            })}
          </div>
        </Section>

        <Section title="Conta Meta" description="Dados usados na publicação simulada.">
          {!data.meta ? (
            <p className="text-sm text-muted-foreground">Nenhuma conta configurada.</p>
          ) : (
            <dl className="grid gap-4 text-sm md:grid-cols-4">
              <div>
                <dt className="text-xs uppercase tracking-wider text-muted-foreground">Ad Account</dt>
                <dd>{data.meta.ad_account_id}</dd>
              </div>
              <div>
                <dt className="text-xs uppercase tracking-wider text-muted-foreground">Página do Facebook</dt>
                <dd>{data.meta.facebook_page}</dd>
              </div>
              <div>
                <dt className="text-xs uppercase tracking-wider text-muted-foreground">Instagram</dt>
                <dd>{data.meta.instagram_account}</dd>
              </div>
              <div>
                <dt className="text-xs uppercase tracking-wider text-muted-foreground">Pixel</dt>
                <dd>{data.meta.pixel_id}</dd>
              </div>
            </dl>
          )}
        </Section>

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
                      <StatusPill status={j.status === "done" ? "approved" : j.status} label={j.mode === "mock" ? "sandbox" : j.mode} />
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
