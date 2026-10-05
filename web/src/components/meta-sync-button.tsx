"use client";

import { useState } from "react";
import { useServerFn } from "@/lib/server-fn";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useWorkspace } from "@/lib/workspace";
import { syncAdsInsightsNow } from "@/lib/meta/ads-ops.functions";
import { apiErrorMessage } from "@/modules/shared/infrastructure/http";

/** Painéis com dados reais da Meta: botão para puxar os resultados na hora (o cron atualiza a cada 3 h). */
export function MetaSyncButton({ invalidate }: { invalidate: unknown[] }) {
  const { workspaceId } = useWorkspace();
  const qc = useQueryClient();
  const run = useServerFn(syncAdsInsightsNow);
  const [busy, setBusy] = useState(false);
  return (
    <Button
      variant="outline"
      disabled={busy || !workspaceId}
      title="Os dados vêm da Meta e atualizam sozinhos a cada 3 horas."
      onClick={async () => {
        setBusy(true);
        try {
          const r = await run({ data: { workspaceId: workspaceId! } });
          qc.invalidateQueries({ queryKey: invalidate });
          if (r.message) toast.info(r.message);
          else toast.success(r.campaigns ? `Resultados da Meta atualizados (${r.campaigns} campanha(s)).` : "Nenhuma campanha publicada na Meta ainda.");
        } catch (e) {
          toast.error(apiErrorMessage(e, "Não foi possível sincronizar com a Meta."));
        } finally {
          setBusy(false);
        }
      }}
    >
      <RefreshCw className={`mr-2 size-4 ${busy ? "animate-spin" : ""}`} />
      {busy ? "Sincronizando..." : "Atualizar da Meta"}
    </Button>
  );
}
