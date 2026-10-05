"use client";

import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@/lib/server-fn";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";
import { Section, StatusPill } from "@/components/ui-bits";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useWorkspace } from "@/lib/workspace";
import { aiKeysStatus, aiKeysSave, aiKeysTest, aiKeysRemove } from "@/lib/ai-keys.functions";
import { HowTo, type HowToStep } from "@/components/how-to";
import { apiErrorMessage } from "@/modules/shared/infrastructure/http";

type Vendor = "openai" | "gemini";

const INFO: Record<Vendor, { title: string; does: string; placeholder: string; steps: HowToStep[]; refs: { label: string; url: string }[] }> = {
  openai: {
    title: "ChatGPT (sua conta OpenAI)",
    does: "Imagens dos criativos e copies das campanhas cobradas na sua conta OpenAI.",
    placeholder: "sk-...",
    steps: [
      { text: "Entre na plataforma da OpenAI com sua conta (a mesma do ChatGPT serve):", link: { label: "platform.openai.com", url: "https://platform.openai.com" } },
      { text: "Adicione cartão e créditos — a assinatura ChatGPT Plus não vale para a API:", link: { label: "Faturamento", url: "https://platform.openai.com/settings/organization/billing/overview" } },
      { text: "Verifique a organização (necessário para gerar imagens com gpt-image-1):", link: { label: "Configurações da organização", url: "https://platform.openai.com/settings/organization/general" } },
      { text: "Crie uma chave secreta (ex.: Meu Funil) e copie (começa com sk-):", link: { label: "Chaves de API", url: "https://platform.openai.com/api-keys" } },
      "Cole abaixo e clique em Salvar. Testamos a chave antes de guardar no cofre do servidor.",
    ],
    refs: [{ label: "Documentação da API da OpenAI", url: "https://platform.openai.com/docs" }],
  },
  gemini: {
    title: "Gemini (sua conta Google)",
    does: "Imagens, vídeos (Veo) e copies das campanhas cobrados na sua conta Google.",
    placeholder: "AIza...",
    steps: [
      { text: "Crie a chave no Google AI Studio e escolha (ou crie) um projeto do Google Cloud:", link: { label: "Chaves do AI Studio", url: "https://aistudio.google.com/apikey" } },
      { text: "Para imagens e vídeos (Veo), ative o faturamento do projeto — no plano grátis só texto funciona:", link: { label: "Faturamento do Google Cloud", url: "https://console.cloud.google.com/billing" } },
      "Copie a chave (começa com AIza).",
      "Cole abaixo e clique em Salvar. Testamos a chave antes de guardar no cofre do servidor.",
    ],
    refs: [{ label: "Documentação da API Gemini", url: "https://ai.google.dev/gemini-api/docs" }],
  },
};

export function AiKeysCard() {
  const { workspaceId, canEdit } = useWorkspace();
  const qc = useQueryClient();
  const status = useServerFn(aiKeysStatus);
  const { data } = useQuery({
    queryKey: ["ai-keys", workspaceId],
    enabled: !!workspaceId,
    queryFn: () => status({ data: { workspaceId: workspaceId! } }),
  });
  const refresh = () => qc.invalidateQueries({ queryKey: ["ai-keys", workspaceId] });

  return (
    <Section
      title="IAs com a sua conta (ChatGPT e Gemini)"
      description="Conecte sua própria chave para que criativos, vídeos e copies usem os seus créditos. Sem chave, usamos os créditos de IA do app."
    >
      <div className="grid gap-4 md:grid-cols-2">
        {(["openai", "gemini"] as Vendor[]).map((v) => (
          <VendorBox key={v} vendor={v} state={data?.[v]} canEdit={canEdit} workspaceId={workspaceId} onChange={refresh} />
        ))}
      </div>
      <p className="mt-4 text-xs text-muted-foreground">
        No Creative Studio, escolha ChatGPT ou Gemini em &quot;Qual IA usar&quot;. Copies usam sua chave OpenAI primeiro, depois a do Gemini.
        As chaves ficam só no servidor e valem para esta área de trabalho.
      </p>
    </Section>
  );
}

function VendorBox({
  vendor, state, canEdit, workspaceId, onChange,
}: {
  vendor: Vendor;
  state: { connected: boolean; hint: string | null } | undefined;
  canEdit: boolean;
  workspaceId: string | null;
  onChange: () => void;
}) {
  const info = INFO[vendor];
  const save = useServerFn(aiKeysSave);
  const test = useServerFn(aiKeysTest);
  const remove = useServerFn(aiKeysRemove);
  const [key, setKey] = useState("");
  const [busy, setBusy] = useState<string | null>(null);

  const run = async (kind: string, fn: () => Promise<void>) => {
    setBusy(kind);
    try { await fn(); } catch (e) { toast.error(apiErrorMessage(e, "Não foi possível agora.")); }
    finally { setBusy(null); }
  };

  return (
    <div className="rounded-lg border border-border bg-surface/50 p-4">
      <div className="flex items-center justify-between gap-2">
        <h3 className="font-medium">{info.title}</h3>
        <StatusPill status={state?.connected ? "connected" : "disconnected"} label={state?.connected ? "Conectado" : "Desconectado"} />
      </div>
      <p className="mt-2 text-sm text-muted-foreground">{info.does}</p>
      {state?.hint && <p className="mt-1 text-xs text-muted-foreground">Chave salva: {state.hint}</p>}

      <div className="mt-3">
        <HowTo title="Passo a passo para conectar" steps={info.steps} references={info.refs} />
      </div>

      {canEdit && workspaceId && (
        <div className="mt-4 space-y-2">
          <Input type="password" autoComplete="off" placeholder={info.placeholder} value={key} onChange={(e) => setKey(e.target.value)} />
          <div className="flex flex-wrap gap-2">
            <Button
              disabled={!key.trim() || !!busy}
              onClick={() => run("save", async () => {
                const r = await save({ data: { workspaceId, vendor, apiKey: key.trim() } });
                if (!r.ok) return void toast.error(r.error ?? "Chave recusada.");
                setKey(""); onChange(); toast.success("Chave testada e salva.");
              })}
            >
              {busy === "save" && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Salvar
            </Button>
            {state?.connected && (
              <>
                <Button variant="outline" disabled={!!busy} onClick={() => run("test", async () => {
                  const r = await test({ data: { workspaceId, vendor } });
                  r.ok ? toast.success("Chave funcionando.") : toast.error(r.error ?? "Falhou.");
                })}>
                  {busy === "test" && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Testar
                </Button>
                <Button variant="ghost" disabled={!!busy} onClick={() => run("rm", async () => {
                  await remove({ data: { workspaceId, vendor } }); onChange(); toast.success("Chave removida.");
                })}>Remover</Button>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
