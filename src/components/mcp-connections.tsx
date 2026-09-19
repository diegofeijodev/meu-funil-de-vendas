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
import { fetchMcpConnections, type McpProvider } from "@/lib/mcp-client";
import { mcpConnect, mcpDisconnect, mcpOAuthStart } from "@/lib/mcp.functions";

const PROVIDERS: {
  id: McpProvider;
  label: string;
  hint: string;
  placeholder: string;
  defaultUrl: string;
  steps: string[];
}[] = [
  {
    id: "higgsfield",
    label: "Higgsfield",
    hint: "Gerador de imagens e vídeos por IA. Conectado, o Creative Studio passa a gerar ativos reais pelo MCP oficial.",
    placeholder: "https://mcp.higgsfield.ai/mcp",
    defaultUrl: "https://mcp.higgsfield.ai/mcp",
    steps: [
      "Tenha uma conta paga no Higgsfield (é ela que autoriza as gerações e paga os créditos).",
      "Deixe o endereço abaixo como está e clique em Conectar. Deixe o campo de chave vazio.",
      "Uma janela do Higgsfield abre para você entrar e autorizar o acesso. Permita a janela pop-up.",
      "Ao voltar, o status muda para Conectado e a lista de ferramentas aparece no cartão.",
      "Abra o Creative Studio e gere um criativo: ele passa a usar o Higgsfield de verdade.",
    ],
  },
  {
    id: "meta",
    label: "Meta Ads (MCP)",
    hint: "Ao conectar, a publicação aprovada de campanhas usa as ferramentas MCP da Meta em vez do modo simulado.",
    placeholder: "https://seu-servidor-mcp-meta.com/mcp",
    defaultUrl: "",
    steps: [
      "A Meta não oferece um endereço público pronto: você precisa de um servidor MCP de anúncios (próprio ou de um fornecedor).",
      "Nesse servidor, use um usuário com acesso à sua conta de anúncios, página e Instagram.",
      "Cole aqui o endereço do servidor e, se ele pedir, a chave de acesso; se ele usar login, deixe a chave vazia.",
      "Clique em Conectar: se o servidor pedir login, abrimos a janela de autorização automaticamente.",
      "Conectado, a publicação de campanhas aprovadas sai do modo simulado e vai para a Meta.",
    ],
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
  const { workspaceId, canEdit } = useWorkspace();
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

  // Ao voltar da janela de autorização, recarrega o status da integração.
  useEffect(() => {
    const onMessage = (e: MessageEvent) => {
      if ((e.data as { type?: string })?.type === "mcp-oauth") {
        qc.invalidateQueries({ queryKey: ["mcp", workspaceId] });
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

              <details className="mt-3 rounded-lg border border-border/60 bg-background/40 p-3">
                <summary className="cursor-pointer text-xs font-medium">Passo a passo para conectar</summary>
                <ol className="mt-2 list-decimal space-y-1 pl-4 text-xs text-muted-foreground">
                  {p.steps.map((s) => (
                    <li key={s}>{s}</li>
                  ))}
                </ol>
              </details>


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
                    {connected ? "Testar conexão" : status === "disconnected" ? "Conectar" : "Reconectar"}
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
