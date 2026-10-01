import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Palette, Loader2 } from "lucide-react";
import { Section, StatusPill } from "@/components/ui-bits";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { HowTo } from "@/components/how-to";
import { useWorkspace } from "@/lib/workspace";
import { canvaDisconnect, canvaGetStatus, canvaOAuthStart, canvaSaveApp, canvaTest } from "@/lib/creative/canva.functions";

const REDIRECT = "https://www.meufunildevendas.com.br/api/public/canva/oauth/callback";

export function CanvaCard() {
  const { workspaceId, workspaceName, canEdit } = useWorkspace();
  const qc = useQueryClient();
  const getStatus = useServerFn(canvaGetStatus);
  const save = useServerFn(canvaSaveApp);
  const start = useServerFn(canvaOAuthStart);
  const test = useServerFn(canvaTest);
  const disconnect = useServerFn(canvaDisconnect);
  const [clientId, setClientId] = useState("");
  const [secret, setSecret] = useState("");
  const [busy, setBusy] = useState<string | null>(null);

  const { data: st } = useQuery({
    queryKey: ["canva", workspaceId],
    enabled: !!workspaceId,
    queryFn: () => getStatus({ data: { workspaceId: workspaceId! } }),
  });

  // Volta do login do Canva: mostra o resultado e limpa a URL.
  useEffect(() => {
    const p = new URLSearchParams(window.location.search);
    const r = p.get("canva");
    if (!r) return;
    if (r === "ok") toast.success("Canva conectado.");
    else toast.error(p.get("msg") ?? "Não foi possível conectar o Canva.");
    p.delete("canva");
    p.delete("msg");
    window.history.replaceState(null, "", `${window.location.pathname}${p.toString() ? `?${p}` : ""}`);
    qc.invalidateQueries({ queryKey: ["canva"] });
  }, [qc]);

  const run = async (key: string, fn: () => Promise<void>) => {
    setBusy(key);
    try {
      await fn();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Falhou.");
    } finally {
      setBusy(null);
      qc.invalidateQueries({ queryKey: ["canva", workspaceId] });
    }
  };

  const ws = workspaceId!;
  return (
    <Section
      title="Canva"
      description="Envie criativos para o Canva, crie designs editáveis a partir da campanha e traga a versão final de volta para a Biblioteca."
    >
      <div className="rounded-lg border border-border bg-surface/50 p-4">
        <div className="flex items-center justify-between">
          <h3 className="flex items-center gap-2 font-medium">
            <Palette className="size-4 text-muted-foreground" /> Canva ({workspaceName})
          </h3>
          <StatusPill status={st?.connected ? "connected" : "disconnected"} label={st?.connected ? "Conectado" : "Desconectado"} />
        </div>
        {st?.connected && (
          <p className="mt-2 text-sm">
            {st.name ?? "Usuário Canva"} {st.email && <span className="text-muted-foreground">· {st.email}</span>}
            {st.inherited && <span className="text-muted-foreground"> · usando a conexão da empresa da agência</span>}
          </p>
        )}
        <div className="mt-3">
          <HowTo
            title="Passo a passo para conectar"
            steps={[
              { text: "Crie um app em Canva Developers com a integração REST (Connect API):", link: { label: "canva.com/developers", url: "https://www.canva.com/developers/integrations" } },
              "Ative os escopos: asset:read, asset:write, design:content:read, design:content:write, design:meta:read e profile:read.",
              `Em "Authentication", cadastre a URL de retorno: ${REDIRECT}`,
              "Copie o Client ID e gere um Client secret. Cole abaixo e clique em Salvar app.",
              "Clique em Entrar com Canva. Você vai para o Canva, autoriza e volta para esta tela já conectado.",
              "O login só funciona no site publicado (meufunildevendas.com.br), porque é para lá que o Canva devolve.",
            ]}
            references={[{ label: "Canva Connect API", url: "https://www.canva.dev/docs/connect/" }]}
          />
        </div>
        {canEdit && (
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            <div>
              <Label className="text-xs">Client ID</Label>
              <Input value={clientId} placeholder={st?.clientIdHint ?? "OC-..."} onChange={(e) => setClientId(e.target.value)} />
            </div>
            <div>
              <Label className="text-xs">Client secret</Label>
              <Input type="password" value={secret} placeholder={st?.appSaved ? "••••" : "Secret do app"} onChange={(e) => setSecret(e.target.value)} />
            </div>
          </div>
        )}
        {canEdit && (
          <div className="mt-4 flex flex-wrap gap-2">
            <Button
              variant="outline"
              disabled={!!busy || !clientId.trim() || (!st?.appSaved && !secret.trim())}
              onClick={() =>
                run("save", async () => {
                  await save({ data: { workspaceId: ws, clientId, clientSecret: secret || null } });
                  setClientId("");
                  setSecret("");
                  toast.success("App Canva salvo.");
                })
              }
            >
              {busy === "save" && <Loader2 className="mr-2 size-4 animate-spin" />}Salvar app
            </Button>
            <Button
              disabled={!!busy || !st?.appSaved}
              onClick={() =>
                run("login", async () => {
                  const { authUrl } = await start({ data: { workspaceId: ws } });
                  window.location.href = authUrl;
                })
              }
            >
              {busy === "login" && <Loader2 className="mr-2 size-4 animate-spin" />}Entrar com Canva
            </Button>
            <Button
              variant="outline"
              disabled={!!busy || !st?.connected}
              onClick={() =>
                run("test", async () => {
                  const r = await test({ data: { workspaceId: ws } });
                  toast.success(`Conexão OK${r.name ? ` (${r.name})` : ""}.`);
                })
              }
            >
              Testar conexão
            </Button>
            <Button
              variant="outline"
              disabled={!!busy || !st?.connected || st?.inherited}
              onClick={() =>
                run("off", async () => {
                  await disconnect({ data: { workspaceId: ws } });
                  toast.success("Canva desconectado.");
                })
              }
            >
              Desconectar
            </Button>
          </div>
        )}
      </div>
    </Section>
  );
}
