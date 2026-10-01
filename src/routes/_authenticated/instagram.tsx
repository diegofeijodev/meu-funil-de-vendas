import { useState } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
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

export const Route = createFileRoute("/_authenticated/instagram")({
  head: () => ({
    meta: [
      { title: "Instagram · Meu Funil" },
      {
        name: "description",
        content:
          "Planeje, gere com IA, aprove e publique posts, carrosséis, Reels e Stories no Instagram.",
      },
      { property: "og:title", content: "Instagram · Meu Funil" },
      {
        property: "og:description",
        content: "Publicação automática no Instagram com criativos e legendas gerados por IA.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  validateSearch: (search: Record<string, unknown>): { tab?: IgTab } =>
    TABS.includes(search["tab"] as IgTab) ? { tab: search["tab"] as IgTab } : {},
  component: InstagramPage,
});

const TABS = ["overview", "strategy", "calendar", "approvals", "results"] as const;
type IgTab = (typeof TABS)[number];

function InstagramPage() {
  const { workspaceId, canEdit } = useWorkspace();
  const { data: posts = [], isLoading } = useIgPosts(workspaceId);
  const { data: account } = useIgAccount(workspaceId);
  const [openId, setOpenId] = useState<string | null>(null);
  const open = posts.find((p) => p.id === openId) ?? null;
  const { tab = "overview" } = Route.useSearch();
  const navigate = useNavigate({ from: "/instagram" });

  if (!workspaceId || isLoading) return <div className="panel h-64 animate-pulse" />;

  return (
    <>
      <PageHeader
        title="Instagram"
        subtitle="Feed, carrossel, Reels e Stories com criativo, legenda e hashtags gerados por IA — da estratégia à publicação."
        actions={account?.status !== "connected" ? <SandboxBadge label="Instagram não conectado" /> : undefined}
      />
      <Tabs value={tab} onValueChange={(v) => navigate({ search: { tab: v as IgTab }, replace: true })}>
        <TabsList className="mb-6 flex h-auto flex-wrap justify-start">
          <TabsTrigger value="overview">Visão geral</TabsTrigger>
          <TabsTrigger value="strategy">Estratégia</TabsTrigger>
          <TabsTrigger value="calendar">Calendário</TabsTrigger>
          <TabsTrigger value="approvals">Aprovações</TabsTrigger>
          <TabsTrigger value="results">Resultados</TabsTrigger>
        </TabsList>
        <TabsContent value="overview">
          <IgOverview workspaceId={workspaceId} posts={posts} onOpen={setOpenId} />
        </TabsContent>
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
          <IgResults workspaceId={workspaceId} posts={posts} onOpen={setOpenId} />
        </TabsContent>
      </Tabs>
      {open && <PostEditor workspaceId={workspaceId} post={open} onClose={() => setOpenId(null)} />}
    </>
  );
}
