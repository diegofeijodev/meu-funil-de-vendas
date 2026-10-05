"use client";

import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@/lib/server-fn";
import { toast } from "sonner";
import { Section } from "@/components/ui-bits";
import { Button } from "@/components/ui/button";
import { useWorkspace } from "@/lib/workspace";
import { fetchAiInheritFrom } from "@/modules/integrations/infrastructure/integrations.api";
import { applyAiInheritanceToAll, setAiInheritance } from "@/lib/agency.functions";

/** 7.1 Conexões de IA da agência: conecte uma vez e as outras empresas herdam. */
export function AgencyConnectionsCard() {
  const { workspaceId, memberships, role } = useWorkspace();
  const qc = useQueryClient();
  const setInherit = useServerFn(setAiInheritance);
  const applyAll = useServerFn(applyAiInheritanceToAll);
  const [busy, setBusy] = useState(false);
  const managed = memberships.filter((m) => m.role === "owner" || m.role === "admin");
  const { data: current } = useQuery({
    queryKey: ["ai-inherit", workspaceId],
    enabled: !!workspaceId,
    queryFn: () => fetchAiInheritFrom(workspaceId!),
  });
  if (role !== "owner" && role !== "admin") return null;
  const others = managed.filter((m) => m.workspace_id !== workspaceId);
  const act = async (fn: () => Promise<unknown>, ok: string) => {
    setBusy(true);
    try {
      await fn();
      qc.invalidateQueries({ queryKey: ["ai-inherit"] });
      qc.invalidateQueries({ queryKey: ["mcp"] });
      toast.success(ok);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Não foi possível salvar.");
    } finally {
      setBusy(false);
    }
  };
  return (
    <Section
      title="Conexões de IA da agência"
      description="Conecte OpenAI, Gemini, Higgsfield e Canva uma vez, na empresa da agência, e as outras empresas usam as mesmas conexões. Cada empresa ainda pode conectar uma conta própria, que tem prioridade."
    >
      <div className="space-y-3 text-sm">
        <div className="flex flex-wrap items-center gap-2">
          <span>Esta empresa usa as IAs de:</span>
          <select
            className="h-9 rounded-md border border-input bg-background px-3 text-sm"
            value={current ?? ""}
            disabled={busy}
            onChange={(e) =>
              act(() => setInherit({ data: { workspaceId: workspaceId!, sourceId: e.target.value || null } }), "Conexões atualizadas.")
            }
          >
            <option value="">Só as conexões desta empresa</option>
            {others.map((m) => (
              <option key={m.workspace_id} value={m.workspace_id}>
                {m.workspaces?.name ?? "Empresa"}
              </option>
            ))}
          </select>
        </div>
        {current && (
          <p className="text-xs text-muted-foreground">
            Os cartões abaixo mostram só as conexões próprias desta empresa. Onde estiver desconectado, a geração usa automaticamente a conexão da empresa escolhida acima.
          </p>
        )}
        {!current && others.length > 0 && (
          <Button
            size="sm"
            variant="outline"
            disabled={busy}
            onClick={() =>
              act(async () => {
                const r = await applyAll({ data: { sourceId: workspaceId! } });
                return r;
              }, `As outras ${others.length} empresa(s) que você administra passam a usar as IAs desta.`)
            }
          >
            Usar esta como empresa da agência para todas as minhas empresas
          </Button>
        )}
        <p className="text-xs text-muted-foreground">
          Meta, WhatsApp, e-mail e agenda continuam por empresa: cada cliente tem sua conta de anúncios, Página e número.
        </p>
      </div>
    </Section>
  );
}
