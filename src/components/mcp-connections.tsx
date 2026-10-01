import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Plug, Loader2 } from "lucide-react";
import { Section, StatusPill } from "@/components/ui-bits";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useWorkspace, logActivity } from "@/lib/workspace";
import { supabase } from "@/integrations/supabase/client";
import { fetchMcpConnections, type McpProvider } from "@/lib/mcp-client";
import { mcpConnect, mcpDisconnect, mcpOAuthStart } from "@/lib/mcp.functions";
import { HowTo, type HowToStep } from "@/components/how-to";

const PROVIDERS: {
  id: McpProvider;
  label: string;
  hint: string;
  placeholder: string;
  defaultUrl: string;
  steps: HowToStep[];
  refs: { label: string; url: string }[];
}[] = [
  {
    id: "higgsfield",
    label: "Higgsfield",
    hint: "Gerador de imagens e vídeos por IA. Conectado, o Creative Studio passa a gerar ativos reais pelo MCP oficial.",
    placeholder: "https://mcp.higgsfield.ai/mcp",
    defaultUrl: "https://mcp.higgsfield.ai/mcp",
    steps: [
      { text: "Tenha uma conta paga no Higgsfield (é ela que autoriza as gerações e paga os créditos):", link: { label: "higgsfield.ai", url: "https://higgsfield.ai" } },
      "Deixe o endereço abaixo como está e clique em Conectar. Deixe o campo de chave vazio.",
      "Uma janela do Higgsfield abre para você entrar e autorizar o acesso. Permita a janela pop-up.",
      "Ao voltar, o status muda para Conectado e a lista de ferramentas aparece no cartão.",
      "Abra o Creative Studio e gere um criativo: ele passa a usar o Higgsfield de verdade.",
    ],
    refs: [{ label: "Higgsfield", url: "https://higgsfield.ai" }],
  },
  {
    id: "canva",
    label: "Canva",
    hint: "Envie criativos para o Canva, crie designs a partir da copy e traga a versão editada de volta para a Biblioteca.",
    placeholder: "https://mcp.canva.com/mcp",
    defaultUrl: "https://mcp.canva.com/mcp",
    steps: [
      { text: "Tenha uma conta Canva (Pro ou Teams recomendada para kits de marca):", link: { label: "canva.com", url: "https://www.canva.com" } },
      "Deixe o endereço abaixo como está e clique em Conectar. Deixe o campo de chave vazio.",
      "Uma janela do Canva abre para você entrar e autorizar o acesso. Permita a janela pop-up.",
      "Na Biblioteca, use \"Enviar ao Canva\" em uma mídia e \"Importar do Canva\" para trazer o design editado.",
      "Na campanha, use \"Criar design no Canva\" para montar um layout editável com a copy.",
    ],
    refs: [{ label: "Canva para desenvolvedores", url: "https://www.canva.dev" }],
  },
];

const STATUS_LABEL: Record<string, { label: string; pill: string }> = {
  connected: { label: "Conectado", pill: "connected" },
  connecting: { label: "Conectando…", pill: "pending" },
  expired: { label: "Sessão expirada", pill: "pending" },
  error: { label: "Erro", pill: "failed" },
  disconnected: { label: "Desconectado", pill: "disconnected" },
};

export function McpConnections() {
  const { workspaceId, canEdit, memberships, workspaceName } = useWorkspace();
  const qc = useQueryClient();
  const connect = useServerFn(mcpConnect);
  const disconnect = useServerFn(mcpDisconnect);
  const oauthStart = useServerFn(mcpOAuthStart);
  const [drafts, setDrafts] = useState<Record<string, { url: string; token: string }>>({});
  const [busy, setBusy] = useState<string | null>(null);

  const { data: conns } = useQuery({
    queryKey: ["mcp", workspaceId],
    enabled: !!workspaceId,
    queryFn: () => fetchMcpConnections(workspaceId!),
    refetchInterval: (q) =>
      (q.state.data ?? []).some((c) => c.status === "connecting") ? 3000 : false,
  });

  // Status do Higgsfield em todas as empresas do usuário (a conexão é por empresa).
  const wsIds = memberships.map((m) => m.workspace_id);
  const { data: perCompany } = useQuery({
    queryKey: ["mcp-all", wsIds.join(",")],
    enabled: wsIds.length > 0,
    queryFn: async () => {
      const { data } = await supabase
        .from("mcp_connections")
        .select("workspace_id, provider, status")
        .in("workspace_id", wsIds)
        .eq("provider", "higgsfield");
      return data ?? [];
    },
  });

  // Ao voltar da janela de autorização, recarrega o status da integração.
  useEffect(() => {
    const onMessage = (e: MessageEvent) => {
      if ((e.data as { type?: string })?.type === "mcp-oauth") {
        qc.invalidateQueries({ queryKey: ["mcp", workspaceId] });
        qc.invalidateQueries({ queryKey: ["mcp-all"] });
      }
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [qc, workspaceId]);

  const handleConnect = async (provider: McpProvider, url: string, token: string | null) => {
    if (!workspaceId) return;
    if (!url.trim()) {
      toast.error("Informe o endereço do servidor MCP.");
      return;
    }
    setBusy(provider);
    try {
      const label = PROVIDERS.find((p) => p.id === provider)?.label ?? provider;
      const res = await connect({
        data: { workspaceId, provider, serverUrl: url.trim(), accessToken: token?.trim() || null, label },
      });
      await qc.invalidateQueries({ queryKey: ["mcp", workspaceId] });

      if (res.status === "connected") {
        await logActivity(workspaceId, "mcp.connected", "integration", { provider, tools: res.tools.length });
        toast.success(`Conectado. ${res.tools.length} ferramenta(s) disponível(is).`);
        return;
      }
      if (res.needsAuth) {
        toast.info("Abrindo a autorização do provedor…");
        const { authUrl } = await oauthStart({ data: { workspaceId, provider, serverUrl: url.trim(), label } });
        await qc.invalidateQueries({ queryKey: ["mcp", workspaceId] });
        window.open(authUrl, "_blank", "width=520,height=720");
        return;
      }
      toast.error(res.error ?? "Não foi possível conectar.");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Não foi possível conectar agora. Tente novamente.");
    } finally {
      setBusy(null);
    }
  };

  const handleDisconnect = async (provider: McpProvider) => {
    if (!workspaceId) return;
    setBusy(provider);
    try {
      await disconnect({ data: { workspaceId, provider } });
      await logActivity(workspaceId, "mcp.disconnected", "integration", { provider });
      await qc.invalidateQueries({ queryKey: ["mcp", workspaceId] });
      qc.invalidateQueries({ queryKey: ["mcp-all"] });
      toast.success("Conexão removida. O provedor volta ao modo simulado.");
    } finally {
      setBusy(null);
    }
  };

  return (
    <Section
      title="Conexões MCP"
      description="Conecte o Higgsfield e a Meta. A autorização e as credenciais ficam no servidor — nada sensível aparece no navegador."
    >
      <div className="grid gap-4 md:grid-cols-2">
        {PROVIDERS.map((p) => {
          const conn = conns?.find((c) => c.provider === p.id);
          const status = conn?.status ?? "disconnected";
          const info = STATUS_LABEL[status] ?? STATUS_LABEL["disconnected"]!;
          const connected = status === "connected";
          const draft = drafts[p.id] ?? { url: conn?.server_url ?? p.defaultUrl, token: "" };
          return (
            <div key={p.id} className="rounded-lg border border-border bg-surface/50 p-4">
              <div className="flex items-center justify-between">
                <h3 className="flex items-center gap-2 font-medium">
                  <Plug className="size-4 text-muted-foreground" />
                  {p.label}
                </h3>
                <StatusPill status={info.pill} label={info.label} />
              </div>
              <p className="mt-2 text-sm text-muted-foreground">{p.hint}</p>
              {p.id === "higgsfield" && (
                <div className="mt-3 rounded-lg border border-border/60 bg-background/40 p-3 text-xs">
                  <p className="font-medium">A conexão é por empresa.</p>
                  <p className="mt-0.5 text-muted-foreground">
                    Cada empresa precisa conectar a sua. Empresa atual: <strong>{workspaceName}</strong>.
                  </p>
                  <ul className="mt-2 space-y-1">
                    {memberships.map((m) => {
                      const on = perCompany?.find((c) => c.workspace_id === m.workspace_id)?.status === "connected";
                      return (
                        <li key={m.workspace_id} className="flex items-center justify-between gap-2">
                          <span className="truncate">
                            {m.workspaces?.name ?? "Empresa"}
                            {m.workspace_id === workspaceId && " (atual)"}
                          </span>
                          <StatusPill status={on ? "connected" : "disconnected"} label={on ? "Conectado" : "Não conectado"} />
                        </li>
                      );
                    })}
                  </ul>
                </div>
              )}

              <div className="mt-3">
                <HowTo title="Passo a passo para conectar" steps={p.steps} references={p.refs} />
              </div>


              <div className="mt-4 space-y-3">
                <div>
                  <Label className="text-xs">Endereço do servidor MCP</Label>
                  <Input
                    value={draft.url}
                    placeholder={p.placeholder}
                    disabled={!canEdit}
                    onChange={(e) => setDrafts((d) => ({ ...d, [p.id]: { ...draft, url: e.target.value } }))}
                  />
                </div>
                <div>
                  <Label className="text-xs">Chave de acesso (opcional — só se o provedor não usar login)</Label>
                  <Input
                    type="password"
                    value={draft.token}
                    placeholder={conn?.hasToken ? "•••••• (guardada no servidor)" : "Token do provedor"}
                    disabled={!canEdit}
                    onChange={(e) => setDrafts((d) => ({ ...d, [p.id]: { ...draft, token: e.target.value } }))}
                  />
                </div>
              </div>

              {conn?.last_error && status !== "connected" && (
                <p className="mt-3 text-xs text-destructive">{conn.last_error}</p>
              )}
              {status === "expired" && (
                <p className="mt-3 text-xs text-muted-foreground">
                  O acesso expirou. Clique em “Reconectar” para autorizar novamente.
                </p>
              )}

              {conn && conn.tools.length > 0 && (
                <div className="mt-3">
                  <p className="text-xs uppercase tracking-wider text-muted-foreground">Ferramentas</p>
                  <div className="mt-1 flex flex-wrap gap-1.5">
                    {conn.tools.slice(0, 8).map((t) => (
                      <span key={t.name} className="rounded-md border border-border/60 px-2 py-0.5 text-xs">
                        {t.name}
                      </span>
                    ))}
                  </div>
                </div>
              )}

              {canEdit && (
                <div className="mt-4 flex gap-2">
                  <Button
                    className="flex-1"
                    disabled={busy === p.id}
                    onClick={() => handleConnect(p.id, draft.url, draft.token)}
                  >
                    {busy === p.id && <Loader2 className="mr-2 size-4 animate-spin" />}
                    {connected
                      ? "Testar conexão"
                      : status !== "disconnected"
                        ? "Reconectar"
                        : p.id === "higgsfield" && perCompany?.some((c) => c.status === "connected")
                          ? "Conectar também nesta empresa"
                          : "Conectar"}
                  </Button>
                  {conn && (
                    <Button variant="outline" disabled={busy === p.id} onClick={() => handleDisconnect(p.id)}>
                      Desconectar
                    </Button>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </Section>
  );
}
