import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useWorkspace, logActivity } from "@/lib/workspace";
import { mcpConnect, mcpDisconnect } from "@/lib/mcp.functions";
import { Section, StatusPill } from "@/components/ui-bits";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

type Provider = "higgsfield" | "meta";

const PROVIDERS: { id: Provider; label: string; hint: string }[] = [
  {
    id: "higgsfield",
    label: "Higgsfield",
    hint: "Servidor MCP do Higgsfield para gerar imagens e vídeos reais no Creative Studio.",
  },
  {
    id: "meta",
    label: "Meta Ads",
    hint: "Servidor MCP da Meta para criar e publicar campanhas de verdade após a aprovação.",
  },
];

type Row = {
  id: string;
  provider: string;
  label: string;
  url: string;
  status: string;
  tools: { name: string; title?: string; description?: string }[] | null;
  last_error: string | null;
};

export function McpConnections() {
  const { workspaceId, role } = useWorkspace();
  const qc = useQueryClient();
  const connect = useServerFn(mcpConnect);
  const disconnect = useServerFn(mcpDisconnect);
  const isAdmin = role === "owner" || role === "admin";

  const [form, setForm] = useState<Record<string, { url: string; token: string }>>({});
  const [busy, setBusy] = useState<string | null>(null);

  const { data = [] } = useQuery({
    queryKey: ["mcp-connections", workspaceId],
    enabled: !!workspaceId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("mcp_connections")
        .select("id, provider, label, url, status, tools, last_error")
        .eq("workspace_id", workspaceId!);
      if (error) throw error;
      return (data ?? []) as unknown as Row[];
    },
  });

  const save = async (provider: Provider) => {
    if (!workspaceId) return;
    const existing = data.find((d) => d.provider === provider);
    const state = form[provider];
    const url = state?.url ?? existing?.url ?? "";
    if (!url.trim()) {
      toast.error("Informe o endereço do servidor MCP.");
      return;
    }
    setBusy(provider);
    try {
      const res = await connect({
        data: {
          workspaceId,
          provider,
          url,
          ...(state?.token ? { token: state.token } : {}),
          label: PROVIDERS.find((p) => p.id === provider)!.label,
        },
      });
      await logActivity(workspaceId, "mcp.connected", "integration", { provider, status: res.status });
      qc.invalidateQueries({ queryKey: ["mcp-connections", workspaceId] });
      if (res.status === "connected") {
        toast.success(`${provider} conectado · ${res.tools.length} ferramenta(s) encontradas.`);
      } else {
        toast.error(res.error ?? "Não foi possível conectar.");
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Falha ao conectar.");
    } finally {
      setBusy(null);
    }
  };

  const remove = async (row: Row) => {
    setBusy(row.provider);
    try {
      await disconnect({ data: { id: row.id } });
      if (workspaceId) await logActivity(workspaceId, "mcp.disconnected", "integration", { provider: row.provider });
      qc.invalidateQueries({ queryKey: ["mcp-connections", workspaceId] });
      toast.success("Conexão removida.");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Falha ao remover.");
    } finally {
      setBusy(null);
    }
  };

  return (
    <Section
      title="Conexões MCP"
      description="Conecte os servidores MCP do Higgsfield e da Meta. Enquanto não houver conexão ativa, o app continua no modo simulado."
    >
      <div className="grid gap-4 md:grid-cols-2">
        {PROVIDERS.map((p) => {
          const row = data.find((d) => d.provider === p.id);
          const connected = row?.status === "connected";
          const state = form[p.id] ?? { url: row?.url ?? "", token: "" };
          return (
            <div key={p.id} className="rounded-lg border border-border bg-surface/50 p-4">
              <div className="flex items-center justify-between">
                <h3 className="font-medium">{p.label}</h3>
                <StatusPill
                  status={connected ? "approved" : row?.status === "error" ? "rejected" : "draft"}
                  label={connected ? "Conectado" : row?.status === "error" ? "Erro" : "Não conectado"}
                />
              </div>
              <p className="mt-2 text-sm text-muted-foreground">{p.hint}</p>

              <div className="mt-4 space-y-3">
                <div className="space-y-1.5">
                  <Label htmlFor={`url-${p.id}`}>Endereço do servidor MCP</Label>
                  <Input
                    id={`url-${p.id}`}
                    placeholder="https://..."
                    value={state.url}
                    disabled={!isAdmin}
                    onChange={(e) =>
                      setForm((f) => ({ ...f, [p.id]: { ...state, url: e.target.value } }))
                    }
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor={`tok-${p.id}`}>Chave de acesso (opcional)</Label>
                  <Input
                    id={`tok-${p.id}`}
                    type="password"
                    placeholder={row ? "•••••• (mantida)" : "token do provedor"}
                    value={state.token}
                    disabled={!isAdmin}
                    onChange={(e) =>
                      setForm((f) => ({ ...f, [p.id]: { ...state, token: e.target.value } }))
                    }
                  />
                </div>
              </div>

              {row?.last_error && (
                <p className="mt-3 text-xs text-destructive">{row.last_error}</p>
              )}

              {connected && row?.tools?.length ? (
                <div className="mt-3 flex flex-wrap gap-1.5">
                  {row.tools.slice(0, 8).map((t) => (
                    <span
                      key={t.name}
                      className="rounded-md border border-border/60 px-2 py-0.5 text-xs text-muted-foreground"
                    >
                      {t.name}
                    </span>
                  ))}
                </div>
              ) : null}

              {isAdmin && (
                <div className="mt-4 flex gap-2">
                  <Button className="flex-1" disabled={busy === p.id} onClick={() => save(p.id)}>
                    {busy === p.id ? "Testando..." : connected ? "Testar novamente" : "Conectar"}
                  </Button>
                  {row && (
                    <Button variant="outline" disabled={busy === p.id} onClick={() => remove(row)}>
                      Remover
                    </Button>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
      <p className="mt-4 text-xs text-muted-foreground">
        A chave de acesso fica guardada no backend e nunca é enviada ao navegador. Só donos e admins
        podem alterar estas conexões.
      </p>
    </Section>
  );
}
