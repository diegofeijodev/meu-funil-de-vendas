import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Plug, Loader2 } from "lucide-react";
import { Section, StatusPill } from "@/components/ui-bits";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useWorkspace, logActivity } from "@/lib/workspace";
import { fetchMcpConnections, type McpProvider } from "@/lib/mcp-client";
import { mcpConnect, mcpDisconnect } from "@/lib/mcp.functions";

const PROVIDERS: { id: McpProvider; label: string; hint: string; placeholder: string }[] = [
  {
    id: "higgsfield",
    label: "Higgsfield (MCP)",
    hint: "Ao conectar, o Creative Studio passa a gerar imagens e vídeos pelas ferramentas reais do Higgsfield.",
    placeholder: "https://mcp.higgsfield.ai/mcp",
  },
  {
    id: "meta",
    label: "Meta Ads (MCP)",
    hint: "Ao conectar, a publicação aprovada de campanhas usa as ferramentas MCP da Meta em vez do modo simulado.",
    placeholder: "https://seu-servidor-mcp-meta.com/mcp",
  },
];

export function McpConnections() {
  const { workspaceId, canEdit } = useWorkspace();
  const qc = useQueryClient();
  const connect = useServerFn(mcpConnect);
  const disconnect = useServerFn(mcpDisconnect);
  const [drafts, setDrafts] = useState<Record<string, { url: string; token: string }>>({});
  const [busy, setBusy] = useState<string | null>(null);

  const { data: conns } = useQuery({
    queryKey: ["mcp", workspaceId],
    enabled: !!workspaceId,
    queryFn: () => fetchMcpConnections(workspaceId!),
  });

  const handleConnect = async (provider: McpProvider, fallbackUrl: string) => {
    if (!workspaceId) return;
    const draft = drafts[provider];
    const url = (draft?.url ?? fallbackUrl).trim();
    if (!url) {
      toast.error("Informe o endereço do servidor MCP.");
      return;
    }
    setBusy(provider);
    try {
      const res = await connect({
        data: {
          workspaceId,
          provider,
          serverUrl: url,
          accessToken: draft?.token?.trim() || null,
          label: PROVIDERS.find((p) => p.id === provider)?.label ?? provider,
        },
      });
      await qc.invalidateQueries({ queryKey: ["mcp", workspaceId] });
      if (res.status === "connected") {
        await logActivity(workspaceId, "mcp.connected", "integration", { provider, tools: res.tools.length });
        toast.success(`Conectado. ${res.tools.length} ferramenta(s) encontrada(s).`);
      } else {
        toast.error(res.error ?? "Não foi possível conectar.");
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Falha ao conectar.");
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
      toast.success("Conexão removida. O provedor volta ao modo simulado.");
    } finally {
      setBusy(null);
    }
  };

  return (
    <Section
      title="Conexões MCP"
      description="Conecte servidores MCP do Higgsfield e da Meta. A chave de acesso fica guardada no servidor e nunca aparece no navegador."
    >
      <div className="grid gap-4 md:grid-cols-2">
        {PROVIDERS.map((p) => {
          const conn = conns?.find((c) => c.provider === p.id);
          const connected = conn?.status === "connected";
          const draft = drafts[p.id] ?? { url: conn?.server_url ?? "", token: "" };
          return (
            <div key={p.id} className="rounded-lg border border-border bg-surface/50 p-4">
              <div className="flex items-center justify-between">
                <h3 className="flex items-center gap-2 font-medium">
                  <Plug className="size-4 text-muted-foreground" />
                  {p.label}
                </h3>
                <StatusPill
                  status={connected ? "connected" : conn?.status === "error" ? "failed" : "disconnected"}
                  label={connected ? "Conectado" : conn?.status === "error" ? "Erro" : "Desconectado"}
                />
              </div>
              <p className="mt-2 text-sm text-muted-foreground">{p.hint}</p>

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
                  <Label className="text-xs">Chave de acesso (opcional)</Label>
                  <Input
                    type="password"
                    value={draft.token}
                    placeholder={conn?.hasToken ? "•••••• (guardada)" : "Token do provedor"}
                    disabled={!canEdit}
                    onChange={(e) => setDrafts((d) => ({ ...d, [p.id]: { ...draft, token: e.target.value } }))}
                  />
                </div>
              </div>

              {conn?.last_error && <p className="mt-3 text-xs text-destructive">{conn.last_error}</p>}

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
                    onClick={() => handleConnect(p.id, draft.url)}
                  >
                    {busy === p.id && <Loader2 className="mr-2 size-4 animate-spin" />}
                    {connected ? "Testar novamente" : "Conectar"}
                  </Button>
                  {conn && (
                    <Button variant="outline" disabled={busy === p.id} onClick={() => handleDisconnect(p.id)}>
                      Remover
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
