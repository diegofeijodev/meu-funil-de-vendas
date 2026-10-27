"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@/lib/server-fn";
import { toast } from "sonner";
import { Activity } from "lucide-react";
import { Section, StatusPill } from "@/components/ui-bits";
import { Button } from "@/components/ui/button";
import { useWorkspace } from "@/lib/workspace";
import { diagnoseAi, type DiagnosticCheck } from "@/lib/ai-diagnostics.functions";
import { aiKeysStatus } from "@/lib/ai-keys.functions";
import { apiErrorMessage } from "@/modules/shared/infrastructure/http";

/** Selo da verificação; "Não precisa" (neutro, sem caixa alta em cada palavra) quando a instalação não usa aquilo. */
function CheckPill({ c }: { c: DiagnosticCheck }) {
  if (c.status === "skip")
    return <span className="inline-flex items-center rounded-full border border-border bg-muted px-2.5 py-0.5 text-xs font-medium text-muted-foreground">Não precisa</span>;
  if (c.ok === null) return <StatusPill status="disconnected" label="Opcional" />;
  return c.ok ? <StatusPill status="connected" label="OK" /> : <StatusPill status="failed" label="Falhou" />;
}

/** 4.5 Testa de verdade as IAs e conexões desta empresa e mostra o erro real de cada uma. */
export function AiDiagnosticsCard() {
  const { workspaceId } = useWorkspace();
  const run = useServerFn(diagnoseAi);
  const keys = useServerFn(aiKeysStatus);
  // Mesma consulta do quadro de chaves (cache compartilhado): sem IA própria no servidor, não há "créditos do app" para testar.
  const { data: keyStatus } = useQuery({
    queryKey: ["ai-keys", workspaceId],
    enabled: !!workspaceId,
    queryFn: () => keys({ data: { workspaceId: workspaceId! } }),
  });
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ checks: DiagnosticCheck[]; at: string } | null>(null);
  const go = async (withImage: boolean) => {
    if (!workspaceId) return;
    setBusy(true);
    try {
      setResult(await run({ data: { workspaceId, withImage } }));
    } catch (e) {
      toast.error(apiErrorMessage(e, "Não foi possível rodar o diagnóstico."));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Section
      title="Diagnóstico das IAs"
      description="Confere chaves, modelos e conexões desta empresa com chamadas reais."
      actions={
        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="outline" disabled={busy} onClick={() => go(false)}>
            <Activity className="mr-1 size-3.5" /> {busy ? "Testando..." : "Rodar diagnóstico"}
          </Button>
          {keyStatus?.hasGateway !== false && (
            <Button size="sm" variant="ghost" disabled={busy} onClick={() => go(true)} title="Gera 1 imagem de teste (consome crédito de IA do app)">
              + testar geração de imagem
            </Button>
          )}
        </div>
      }
    >
      {!result ? (
        <p className="text-sm text-muted-foreground">Rode depois de conectar ou trocar qualquer chave.</p>
      ) : (
        <div className="space-y-2 text-sm">
          {result.checks.map((c) => (
            <div key={c.name} className="flex flex-wrap items-start justify-between gap-2 rounded-lg border border-border/60 px-3 py-2">
              <div>
                <p className="font-medium">{c.name}</p>
                <p className="text-xs text-muted-foreground">{c.detail}</p>
              </div>
              <CheckPill c={c} />
            </div>
          ))}
          <p className="text-xs text-muted-foreground">Testado em {new Date(result.at).toLocaleString("pt-BR")}.</p>
        </div>
      )}
    </Section>
  );
}
