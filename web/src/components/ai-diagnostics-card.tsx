"use client";

import { useState } from "react";
import { useServerFn } from "@/lib/server-fn";
import { toast } from "sonner";
import { Activity } from "lucide-react";
import { Section, StatusPill } from "@/components/ui-bits";
import { Button } from "@/components/ui/button";
import { useWorkspace } from "@/lib/workspace";
import { diagnoseAi } from "@/lib/ai-diagnostics.functions";
import { apiErrorMessage } from "@/modules/shared/infrastructure/http";

/** 4.5 Testa de verdade as IAs e conexões desta empresa e mostra o erro real de cada uma. */
export function AiDiagnosticsCard() {
  const { workspaceId } = useWorkspace();
  const run = useServerFn(diagnoseAi);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ checks: { name: string; ok: boolean | null; detail: string }[]; at: string } | null>(null);
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
          <Button size="sm" variant="ghost" disabled={busy} onClick={() => go(true)} title="Gera 1 imagem de teste (consome crédito de IA do app)">
            + testar geração de imagem
          </Button>
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
              <StatusPill status={c.ok === null ? "disconnected" : c.ok ? "connected" : "error"} label={c.ok === null ? "Opcional" : c.ok ? "OK" : "Falhou"} />
            </div>
          ))}
          <p className="text-xs text-muted-foreground">Testado em {new Date(result.at).toLocaleString("pt-BR")}.</p>
        </div>
      )}
    </Section>
  );
}
