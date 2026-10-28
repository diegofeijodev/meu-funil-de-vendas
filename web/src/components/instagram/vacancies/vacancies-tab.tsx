"use client";

import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useWorkspace } from "@/lib/workspace";
import { useVacancySettings } from "@/modules/vacancy-stories/infrastructure/vacancy-stories.api";
import { VacanciesFirstRun } from "./first-run";
import { VacanciesStatusCard } from "./status-card";

/**
 * Aba "Vagas" do Instagram. Ordem no celular: situação → "Para aprovar" → "Vagas que chegaram" → "Ajustes".
 * Os três últimos entram nas Tasks 13 e 14 pelos contêineres `data-vac-section` abaixo.
 */
export function VacanciesTab({ workspaceId }: { workspaceId: string }) {
  const { role, canEdit } = useWorkspace();
  const canManage = role === "owner" || role === "admin";
  const { data: settings, isLoading, isError, refetch, isFetching } = useVacancySettings(workspaceId);

  if (isLoading)
    return (
      <div className="space-y-4" aria-busy="true" aria-label="Carregando as vagas">
        <Skeleton className="h-40 w-full" />
        <div className="grid gap-4 sm:grid-cols-3">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="aspect-[9/16] w-full max-w-[200px]" />
          ))}
        </div>
      </div>
    );

  if (isError)
    return (
      <div className="panel space-y-3 p-5" role="alert">
        <p className="text-sm">Não conseguimos carregar as vagas. Verifique a conexão e toque em Tentar de novo.</p>
        <Button className="h-11" variant="outline" disabled={isFetching} onClick={() => refetch()}>
          Tentar de novo
        </Button>
      </div>
    );

  // 404 = empresa fora da lista: sem aba (a página já cai em "Visão geral").
  if (!settings) return null;

  return (
    <div className="space-y-6">
      {settings.template ? (
        <VacanciesStatusCard workspaceId={workspaceId} settings={settings} canManage={canManage} />
      ) : (
        <VacanciesFirstRun workspaceId={workspaceId} canEdit={canEdit} />
      )}
      {/* Task 13: "Para aprovar" e "Vagas que chegaram" */}
      <div data-vac-section="approve" />
      <div data-vac-section="arrived" />
      {/* Task 14: "Ajustes" (fechado, com o resumo de 1 linha) */}
      <div data-vac-section="settings" />
    </div>
  );
}
