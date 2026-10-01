import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { PageHeader, Section, EmptyState } from "@/components/ui-bits";
import { Button } from "@/components/ui/button";
import { useWorkspace } from "@/lib/workspace";
import { agencyOverview } from "@/lib/agency.functions";
import { ROLE_LABELS } from "@/lib/labels";
import { brl, num } from "@/lib/format";

export const Route = createFileRoute("/_authenticated/agency")({
  head: () => ({
    meta: [
      { title: "Agência · Meu Funil" },
      { name: "description", content: "Todas as empresas lado a lado: verba, leads, CPL, posts da semana e aprovações pendentes." },
    ],
  }),
  component: AgencyPage,
});

/** 7.4 Painel da agência: todas as empresas do usuário lado a lado. */
function AgencyPage() {
  const run = useServerFn(agencyOverview);
  const { setWorkspaceId } = useWorkspace();
  const navigate = useNavigate();
  const { data, isLoading } = useQuery({ queryKey: ["agency-overview"], queryFn: () => run() });
  const rows = data?.workspaces ?? [];
  const names = new Map(rows.map((r) => [r.id, r.name]));
  const open = (id: string, to: "/overview" | "/approvals" | "/crm" | "/instagram") => {
    setWorkspaceId(id);
    navigate({ to });
  };
  const total = rows.reduce(
    (a, r) => ({ spend: a.spend + r.spend, leads: a.leads + r.adLeads, crm: a.crm + r.crmLeads7d, pending: a.pending + r.pending }),
    { spend: 0, leads: 0, crm: 0, pending: 0 },
  );
  return (
    <>
      <PageHeader
        title="Agência"
        subtitle={`${rows.length} empresa(s). Verba e leads dos anúncios nos últimos 30 dias (dados reais da Meta); leads do CRM e posts nos últimos 7 dias.`}
      />
      {isLoading ? (
        <div className="panel h-64 animate-pulse" />
      ) : !rows.length ? (
        <EmptyState title="Nenhuma empresa" description="Crie uma empresa no seletor do menu." />
      ) : (
        <Section
          title="Empresas"
          description={`Total: ${brl(total.spend)} investidos · ${num(total.leads)} leads de anúncio · ${num(total.crm)} leads no CRM (7 dias) · ${num(total.pending)} aprovações pendentes.`}
        >
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-left text-xs uppercase tracking-wider text-muted-foreground">
                <tr>
                  <th className="py-2 pr-3">Empresa</th>
                  <th className="py-2 pr-3">Gasto 30d</th>
                  <th className="py-2 pr-3">Leads anúncio</th>
                  <th className="py-2 pr-3">CPL</th>
                  <th className="py-2 pr-3">ROAS</th>
                  <th className="py-2 pr-3">Campanhas ativas</th>
                  <th className="py-2 pr-3">Leads CRM 7d</th>
                  <th className="py-2 pr-3">Posts da semana</th>
                  <th className="py-2 pr-3">Pendências</th>
                  <th className="py-2" />
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id} className="border-t border-border/50">
                    <td className="py-2 pr-3">
                      <p className="font-medium">{r.name}</p>
                      <p className="text-xs text-muted-foreground">
                        {ROLE_LABELS[r.role] ?? r.role}
                        {r.inheritFrom ? ` · IAs de ${names.get(r.inheritFrom) ?? "outra empresa"}` : ""}
                      </p>
                    </td>
                    <td className="py-2 pr-3">{brl(r.spend)}</td>
                    <td className="py-2 pr-3">{num(r.adLeads)}</td>
                    <td className="py-2 pr-3">{r.cpl != null ? brl(r.cpl) : "—"}</td>
                    <td className="py-2 pr-3">{r.roas != null ? `${num(r.roas, 2)}x` : "—"}</td>
                    <td className="py-2 pr-3">{num(r.activeCampaigns)}</td>
                    <td className="py-2 pr-3">
                      <button type="button" className="text-primary underline" onClick={() => open(r.id, "/crm")}>
                        {num(r.crmLeads7d)}
                      </button>
                    </td>
                    <td className="py-2 pr-3">
                      <button type="button" className="text-primary underline" onClick={() => open(r.id, "/instagram")}>
                        {num(r.postsWeek)}
                      </button>
                    </td>
                    <td className="py-2 pr-3">
                      {r.pending ? (
                        <button type="button" className="font-medium text-amber-500 underline" onClick={() => open(r.id, "/approvals")}>
                          {r.pending}
                        </button>
                      ) : (
                        "0"
                      )}
                    </td>
                    <td className="py-2">
                      <Button size="sm" variant="outline" onClick={() => open(r.id, "/overview")}>
                        Abrir
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Section>
      )}
    </>
  );
}
