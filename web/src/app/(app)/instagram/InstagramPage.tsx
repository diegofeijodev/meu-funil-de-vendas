"use client";

import { useState } from "react";
import { useNavigate, useSearch } from "@/lib/router";
import { useWorkspace } from "@/lib/workspace";
import { PageHeader, SandboxBadge, Section } from "@/components/ui-bits";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useIgAccount, useIgPosts } from "@/components/instagram/shared";
import { IgOverview } from "@/components/instagram/overview";
import { IgStrategy } from "@/components/instagram/strategy";
import { IgCalendar } from "@/components/instagram/calendar";
import { PostEditor } from "@/components/instagram/post-editor";
import { IgApprovalList } from "@/components/instagram/approvals";
import { IgResults } from "@/components/instagram/results";
import { IgAccountInsights } from "@/components/instagram/account-insights";
import { VacanciesTab } from "@/components/instagram/vacancies/vacancies-tab";
import { vagasTabState } from "@/lib/vacancy-stories";
import { useVacancySettings } from "@/modules/vacancy-stories/infrastructure/vacancy-stories.api";
import { HowTo } from "@/components/how-to";
import { GUIDES } from "@/lib/guides";

const TABS = ["overview", "vagas", "strategy", "calendar", "approvals", "results"] as const;
type IgTab = (typeof TABS)[number];

/** `validateSearch` do protótipo: `?tab=` inválido vira "sem aba" (padrão `overview`). `vagas` só existe para empresas com a função (D7). */
const tabOf = (search: Record<string, unknown>, hasVagas: boolean): IgTab | undefined => {
  const t = search["tab"] as IgTab;
  return TABS.includes(t) && (t !== "vagas" || hasVagas) ? t : undefined;
};

export function InstagramPage() {
  const { workspaceId, canEdit } = useWorkspace();
  const { data: posts = [], isLoading } = useIgPosts(workspaceId);
  const { data: account } = useIgAccount(workspaceId);
  const [openId, setOpenId] = useState<string | null>(null);
  const open = posts.find((p) => p.id === openId) ?? null;
  const vacancyQuery = useVacancySettings(workspaceId);
  const vacancySettings = vacancyQuery.data;
  const vagasState = vagasTabState(vacancyQuery);
  // Aba existe com dados ou com erro de carga (o painel "Tentar de novo" aparece em ?tab=vagas); 404 esconde.
  const hasVagas = vagasState === "ready" || vagasState === "error";
  const search = useSearch();
  const tab = tabOf(search, hasVagas) ?? "overview";
  const navigate = useNavigate({ from: "/instagram" });

  // `?tab=vagas` espera a resposta das configurações para não piscar "Visão geral" antes de a aba existir.
  if (!workspaceId || isLoading || (search["tab"] === "vagas" && vagasState === "loading")) return <div className="panel h-64 animate-pulse" />;

  return (
    <>
      <PageHeader
        title="Instagram"
        subtitle="Feed, carrossel, Reels e Stories com criativo, legenda e hashtags gerados por IA — da estratégia à publicação."
        actions={account?.status !== "connected" ? <SandboxBadge label="Instagram não conectado" /> : undefined}
      />
      <div className="mb-6">
        <HowTo title={GUIDES.instagram.title} steps={GUIDES.instagram.steps} references={GUIDES.instagram.references ?? []} />
      </div>
      <Tabs value={tab} onValueChange={(v) => navigate({ search: { tab: v as IgTab }, replace: true })}>
        <TabsList className="mb-6 flex h-auto flex-wrap justify-start">
          <TabsTrigger value="overview">Visão geral</TabsTrigger>
          {hasVagas && (
            <TabsTrigger value="vagas">
              Vagas{vacancySettings && vacancySettings.pending_approval > 0 ? ` (${vacancySettings.pending_approval})` : ""}
            </TabsTrigger>
          )}
          <TabsTrigger value="strategy">Estratégia</TabsTrigger>
          <TabsTrigger value="calendar">Calendário</TabsTrigger>
          <TabsTrigger value="approvals">Aprovações</TabsTrigger>
          <TabsTrigger value="results">Resultados</TabsTrigger>
        </TabsList>
        <TabsContent value="overview">
          <IgOverview workspaceId={workspaceId} posts={posts} onOpen={setOpenId} />
        </TabsContent>
        {hasVagas && (
          <TabsContent value="vagas">
            <VacanciesTab workspaceId={workspaceId} />
          </TabsContent>
        )}
        <TabsContent value="strategy">
          <IgStrategy workspaceId={workspaceId} />
        </TabsContent>
        <TabsContent value="calendar">
          <IgCalendar workspaceId={workspaceId} posts={posts} onOpen={setOpenId} />
        </TabsContent>
        <TabsContent value="approvals">
          <Section title="Posts aguardando aprovação">
            <IgApprovalList workspaceId={workspaceId} onOpen={setOpenId} canEdit={canEdit} />
          </Section>
        </TabsContent>
        <TabsContent value="results">
          <div className="space-y-6">
            <IgAccountInsights workspaceId={workspaceId} />
            <IgResults workspaceId={workspaceId} posts={posts} onOpen={setOpenId} />
          </div>
        </TabsContent>
      </Tabs>
      {open && <PostEditor workspaceId={workspaceId} post={open} onClose={() => setOpenId(null)} />}
    </>
  );
}
