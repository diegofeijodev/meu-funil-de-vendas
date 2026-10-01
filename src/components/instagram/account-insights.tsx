import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { supabase } from "@/integrations/supabase/client";
import { Section, StatCard } from "@/components/ui-bits";
import { Button } from "@/components/ui/button";
import { collectAccountInsightsNow } from "@/lib/instagram/instagram.functions";
import { fmtNum } from "./shared";

/** 5.2 Evolução da conta: seguidores, alcance, visitas ao perfil e cliques no link (30 dias). */
export function IgAccountInsights({ workspaceId }: { workspaceId: string }) {
  const qc = useQueryClient();
  const run = useServerFn(collectAccountInsightsNow);
  const [busy, setBusy] = useState(false);
  const { data = [] } = useQuery({
    queryKey: ["ig-account-insights", workspaceId],
    queryFn: async () =>
      (
        await supabase
          .from("ig_account_insights")
          .select("*")
          .eq("workspace_id", workspaceId)
          .gte("date", new Date(Date.now() - 30 * 86400e3).toISOString().slice(0, 10))
          .order("date")
      ).data ?? [],
  });
  const sum = (k: "new_followers" | "reach" | "profile_views" | "website_clicks") => data.reduce((a, r) => a + Number(r[k] ?? 0), 0);
  const followers = [...data].reverse().find((r) => r.followers_total != null)?.followers_total ?? null;
  return (
    <Section
      title="Conta do Instagram (30 dias)"
      description="Atualiza sozinho todo dia. Novos seguidores e alcance vêm da própria Meta."
      actions={
        <Button
          size="sm"
          variant="outline"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            try {
              const r = await run({ data: { workspaceId } });
              qc.invalidateQueries({ queryKey: ["ig-account-insights", workspaceId] });
              toast.success("skipped" in r ? String(r.skipped) : `Conta atualizada (${r.days} dia(s)).`);
            } catch (e) {
              toast.error(e instanceof Error ? e.message : "Não foi possível atualizar.");
            } finally {
              setBusy(false);
            }
          }}
        >
          {busy ? "Atualizando..." : "Atualizar agora"}
        </Button>
      }
    >
      {!data.length ? (
        <p className="text-sm text-muted-foreground">Sem dados ainda. Conecte a conta e clique em Atualizar agora.</p>
      ) : (
        <>
          <div className="mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
            <StatCard label="Seguidores" value={followers != null ? fmtNum(followers) : "—"} />
            <StatCard label="Novos seguidores" value={fmtNum(sum("new_followers"))} tone="positive" />
            <StatCard label="Alcance" value={fmtNum(sum("reach"))} />
            <StatCard label="Visitas ao perfil" value={fmtNum(sum("profile_views"))} />
            <StatCard label="Cliques no link" value={fmtNum(sum("website_clicks"))} tone="accent" />
          </div>
          <div className="h-56 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={data.map((r) => ({ dia: r.date.slice(5), alcance: r.reach ?? 0, novos: r.new_followers ?? 0 }))}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" />
                <XAxis dataKey="dia" fontSize={11} />
                <YAxis fontSize={11} />
                <Tooltip />
                <Line type="monotone" dataKey="alcance" name="Alcance" stroke="var(--color-chart-1)" dot={false} />
                <Line type="monotone" dataKey="novos" name="Novos seguidores" stroke="var(--color-chart-2)" dot={false} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </>
      )}
    </Section>
  );
}
