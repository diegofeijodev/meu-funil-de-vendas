import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { Rocket, Sparkles } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useWorkspace, logActivity } from "@/lib/workspace";
import { PageHeader, Section, StatCard, StatusPill, SandboxBadge } from "@/components/ui-bits";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { CAMPAIGN_STATUS, CREATIVE_STATUS, FORMATS, OBJECTIVES } from "@/lib/labels";
import { brl, fullDate, num } from "@/lib/format";
import { computeKpis, type PerformanceRow } from "@/lib/metrics";
import { generateCopy, generateStrategy, type CampaignBrief, type CopyContent, type StrategyContent } from "@/lib/ai/agents";
import { metaMockProvider, type PublishStep } from "@/lib/providers/meta-provider";
import { useServerFn } from "@tanstack/react-start";
import { metaAdsStatus, metaAdsPublish, metaAdsSetStatus } from "@/lib/meta-ads.functions";

export const Route = createFileRoute("/_authenticated/campaigns/$id")({
  head: () => ({
    meta: [
      { title: "Campanha · Meu Funil" },
      { name: "description", content: "Estratégia, copies, criativos, performance e publicação da campanha." },
      { property: "og:title", content: "Campanha · Meu Funil" },
      { property: "og:description", content: "Fluxo completo com aprovação humana antes de publicar." },
    ],
  }),
  component: CampaignDetail,
});

function CampaignDetail() {
  const { id } = Route.useParams();
  const { workspaceId, canEdit } = useWorkspace();
  const qc = useQueryClient();
  const metaStatus = useServerFn(metaAdsStatus);
  const metaPublish = useServerFn(metaAdsPublish);
  const metaSetStatus = useServerFn(metaAdsSetStatus);

  
  const [busy, setBusy] = useState<string | null>(null);
  const [steps, setSteps] = useState<PublishStep[]>([]);

  const { data } = useQuery({
    queryKey: ["campaign", id],
    queryFn: async () => {
      const campaign = (await supabase.from("campaigns").select("*, brands(*)").eq("id", id).single()).data;
      const [strategy, copy, creatives, perf, costs] = await Promise.all([
        supabase.from("campaign_strategies").select("*").eq("campaign_id", id).order("version", { ascending: false }).limit(1).maybeSingle(),
        supabase.from("copies").select("*").eq("campaign_id", id).order("version", { ascending: false }).limit(1).maybeSingle(),
        supabase.from("creatives").select("*").eq("campaign_id", id).order("created_at", { ascending: false }),
        supabase.from("performance_daily").select("*").eq("campaign_id", id),
        supabase.from("campaign_costs").select("*").eq("campaign_id", id),
      ]);
      return {
        campaign,
        strategy: strategy.data,
        copy: copy.data,
        creatives: creatives.data ?? [],
        perf: (perf.data ?? []) as unknown as PerformanceRow[],
        costs: costs.data ?? [],
      };
    },
  });

  if (!data?.campaign) return <div className="panel h-64 animate-pulse" />;
  const c = data.campaign;
  const brand = c.brands;
  const extra = data.costs.reduce((s, x) => s + Number(x.amount), 0);
  const k = computeKpis(data.perf, extra);
  const strategy = data.strategy?.content as unknown as StrategyContent | undefined;
  const copy = data.copy?.content as unknown as CopyContent | undefined;

  const brief = (): CampaignBrief => ({
    name: c.name,
    objective: c.objective,
    offer_product: c.offer_product,
    offer_price: c.offer_price,
    offer_promise: c.offer_promise,
    landing_url: c.landing_url,
    start_date: c.start_date,
    end_date: c.end_date,
    audience: (c.audience ?? {}) as Record<string, string>,
    budget_total: c.budget_total,
    budget_daily: c.budget_daily,
    goal_leads: c.goal_leads,
    goal_sales: c.goal_sales,
    avg_ticket: c.avg_ticket,
    margin_percent: c.margin_percent,
    max_cac: c.max_cac,
    formats: c.formats,
  });

  const regenStrategy = async () => {
    if (!workspaceId || !brand) return;
    setBusy("strategy");
    const learnings = (await supabase.from("brand_learnings").select("category, value, metric").eq("brand_id", brand.id).limit(5)).data ?? [];
    const content = await generateStrategy(brand, brief(), learnings);
    await supabase.from("campaign_strategies").insert({
      workspace_id: workspaceId,
      campaign_id: id,
      content,
      status: "draft",
      version: (data.strategy?.version ?? 0) + 1,
    });
    await logActivity(workspaceId, "campaign.strategy_generated", "campaign", { campaign_id: id });
    qc.invalidateQueries({ queryKey: ["campaign", id] });
    setBusy(null);
    toast.success("Nova versão da estratégia gerada.");
  };

  const regenCopy = async () => {
    if (!workspaceId || !brand) return;
    setBusy("copy");
    const version = (data.copy?.version ?? 0) + 1;
    const content = await generateCopy(brand, brief(), version);
    await supabase.from("copies").insert({
      workspace_id: workspaceId,
      campaign_id: id,
      content,
      status: "draft",
      version,
    });
    await logActivity(workspaceId, "campaign.copy_generated", "campaign", { campaign_id: id });
    qc.invalidateQueries({ queryKey: ["campaign", id] });
    setBusy(null);
    toast.success("Novas copies geradas.");
  };

  const requestApproval = async () => {
    if (!workspaceId) return;
    await supabase.from("approval_requests").insert({
      workspace_id: workspaceId,
      entity_type: "campaign",
      entity_id: id,
      campaign_id: id,
      title: `Publicar campanha "${c.name}" na Meta`,
      summary: `Verba diária de ${brl(c.budget_daily)}, ${data.creatives.length} criativo(s), objetivo ${OBJECTIVES[c.objective] ?? c.objective}.`,
      status: "pending",
    });
    await supabase.from("campaigns").update({ status: "pending_approval" }).eq("id", id);
    await logActivity(workspaceId, "campaign.approval_requested", "campaign", { campaign_id: id });
    qc.invalidateQueries({ queryKey: ["campaign", id] });
    toast.success("Aprovação solicitada. Confira em Aprovações.");
  };

  const publish = async () => {
    if (!workspaceId) return;
    setBusy("publish");
    setSteps([]);
    try {
      const approved = c.status === "approved" || c.status === "active";
      if (!approved) {
        throw new Error("Publicação bloqueada: a campanha precisa de aprovação humana antes de ir ao ar.");
      }
      const approvedCreatives = data.creatives.filter((x) => x.status === "approved");
      const utm = `utm_source=meta&utm_campaign=${encodeURIComponent(c.name)}`;

      const st = await metaStatus({ data: { workspaceId } });
      if (st.configured) {
        setSteps([{ key: "meta", label: "Enviando para a Meta (tudo pausado)", status: "pending", detail: c.name }]);
        const out = await metaPublish({ data: { workspaceId, campaignId: id } });
        setSteps(out.steps);
        await logActivity(workspaceId, "campaign.published", "campaign", { campaign_id: id, mode: "live" });
        qc.invalidateQueries({ queryKey: ["campaign", id] });
        toast.success("Campanha criada na Meta, pausada. Clique em Ativar na Meta quando quiser veicular.");
        return;
      }

      const result = await metaMockProvider.publish(
        {
          campaignName: c.name,
          objective: OBJECTIVES[c.objective] ?? c.objective,
          dailyBudget: Number(c.budget_daily ?? 0),
          targeting: (c.audience ?? {}) as Record<string, unknown>,
          placements: ["Instagram Feed", "Reels", "Stories", "Facebook Feed"],
          creatives: approvedCreatives.map((x) => ({ id: x.id, title: x.title })),
          primaryText: copy?.meta_ad ?? "",
          utm,
          approved,
        },
        setSteps,
      );
      const log = result.map((s) => `${s.label}: ${s.detail}`).join("\n");

      await supabase.from("publishing_jobs").insert({
        workspace_id: workspaceId,
        campaign_id: id,
        target: "meta",
        status: "done",
        mode: "mock",
        log,
      });
      await supabase.from("campaigns").update({ status: "active" }).eq("id", id);
      await logActivity(workspaceId, "campaign.published", "campaign", { campaign_id: id, mode: "mock" });
      qc.invalidateQueries({ queryKey: ["campaign", id] });
      toast.success("Campanha publicada no ambiente sandbox da Meta.");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Falha ao publicar");
    } finally {
      setBusy(null);
    }
  };


  const setDelivery = async (status: "ACTIVE" | "PAUSED") => {
    if (!workspaceId) return;
    setBusy("delivery");
    try {
      await metaSetStatus({ data: { workspaceId, campaignId: id, status } });
      qc.invalidateQueries({ queryKey: ["campaign", id] });
      toast.success(status === "ACTIVE" ? "Campanha ativada na Meta." : "Campanha pausada na Meta.");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Não foi possível alterar na Meta.");
    } finally {
      setBusy(null);
    }
  };
  const metaId = (c as { meta_campaign_id?: string | null }).meta_campaign_id;
  const metaDelivery = (c as { meta_delivery_status?: string | null }).meta_delivery_status;

  return (
    <>
      <PageHeader
        title={c.name}
        subtitle={`${brand?.name} · ${OBJECTIVES[c.objective] ?? c.objective} · ${fullDate(c.start_date)} → ${fullDate(c.end_date)}`}
        actions={
          <>
            <StatusPill status={c.status} label={CAMPAIGN_STATUS[c.status] ?? c.status} />
            <Button variant="outline" asChild><Link to="/campaigns">Voltar</Link></Button>
            {canEdit && c.status === "draft" && <Button onClick={requestApproval}>Solicitar aprovação</Button>}
            {canEdit && metaId && (c.status === "approved" || c.status === "active") && (
              <Button variant="outline" disabled={busy === "delivery"} onClick={() => setDelivery(metaDelivery === "ACTIVE" ? "PAUSED" : "ACTIVE")}>
                {metaDelivery === "ACTIVE" ? "Pausar na Meta" : "Ativar na Meta"}
              </Button>
            )}
            {canEdit && !metaId && (c.status === "approved" || c.status === "active") && (
              <Button onClick={publish} disabled={busy === "publish"}>
                <Rocket className="mr-2 size-4" />
                {busy === "publish" ? "Publicando..." : "Publicar na Meta"}
              </Button>
            )}
          </>
        }
      />

      <div className="mb-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="Verba total" value={brl(c.budget_total)} hint={`${brl(c.budget_daily)}/dia`} />
        <StatCard label="Investido" value={brl(k.spend)} hint={`+ ${brl(extra)} de custos extras`} />
        <StatCard label="Leads" value={num(k.leads)} hint={`CPL ${brl(k.cpl)}`} tone="accent" />
        <StatCard label="ROAS" value={`${num(k.roas, 2)}x`} hint={`ROI ${num(k.roi, 1)}%`} tone={k.roas >= 3 ? "positive" : "negative"} />
      </div>

      {steps.length > 0 && (
        <div className="panel mb-6 p-5">
          <div className="mb-3 flex items-center gap-2">
            <span className="text-sm font-semibold">Pipeline de publicação</span>
            <SandboxBadge label="Meta sandbox" />
          </div>
          <ol className="space-y-2 text-sm">
            {steps.map((s) => (
              <li key={s.key} className="flex items-center justify-between gap-3 rounded-md border border-border/60 px-3 py-2">
                <span>{s.label}</span>
                <span className="text-xs text-muted-foreground">{s.detail}</span>
                <StatusPill status={s.status === "done" ? "approved" : "pending"} label={s.status === "done" ? "OK" : "..."} />
              </li>
            ))}
          </ol>
        </div>
      )}

      <Tabs defaultValue="estrategia">
        <TabsList className="mb-6">
          <TabsTrigger value="estrategia">Estratégia</TabsTrigger>
          <TabsTrigger value="copies">Copies</TabsTrigger>
          <TabsTrigger value="criativos">Criativos</TabsTrigger>
          <TabsTrigger value="briefing">Briefing</TabsTrigger>
        </TabsList>

        <TabsContent value="estrategia">
          <Section
            title={`Plano estratégico ${data.strategy ? `v${data.strategy.version}` : ""}`}
            actions={
              canEdit && (
                <Button size="sm" variant="outline" onClick={regenStrategy} disabled={busy === "strategy"}>
                  <Sparkles className="mr-1 size-3.5" />
                  {busy === "strategy" ? "Gerando..." : "Regerar"}
                </Button>
              )
            }
          >
            {!strategy ? (
              <p className="text-sm text-muted-foreground">Nenhuma estratégia gerada ainda.</p>
            ) : (
              <div className="space-y-5 text-sm">
                <Block title="Resumo executivo">{strategy.resumo_executivo}</Block>
                <Block title="Problema">{strategy.problema}</Block>
                <Block title="Objetivo SMART">{strategy.objetivo_smart}</Block>
                <Block title="ICP">{strategy.icp}</Block>
                <Block title="Oferta">{strategy.oferta}</Block>
                <Block title="Big idea">{strategy.big_idea}</Block>
                <Block title="Ângulos criativos">
                  <ul className="list-disc pl-5">{strategy.angulos.map((a) => <li key={a}>{a}</li>)}</ul>
                </Block>
                <Block title="Funil">{strategy.funil}</Block>
                <Block title="Objeções e respostas">
                  <ul className="space-y-1">
                    {strategy.objecoes.map((o) => (
                      <li key={o.objecao}><span className="text-foreground">{o.objecao}</span> — {o.resposta}</li>
                    ))}
                  </ul>
                </Block>
                <Block title="Canais e distribuição de verba">
                  {strategy.canais}
                  <div className="mt-2 flex flex-wrap gap-2">
                    {Object.entries(strategy.distribuicao_verba).map(([k2, v]) => (
                      <span key={k2} className="rounded-full border border-border px-2.5 py-0.5 text-xs">{k2}: {v}%</span>
                    ))}
                  </div>
                </Block>
                <Block title="KPIs">
                  <div className="flex flex-wrap gap-2">
                    {Object.entries(strategy.kpis).map(([k2, v]) => (
                      <span key={k2} className="rounded-full border border-primary/30 bg-primary/10 px-2.5 py-0.5 text-xs text-primary">{k2} {v}</span>
                    ))}
                  </div>
                </Block>
                <Block title="Hipóteses e plano de testes">
                  <ul className="list-disc pl-5">{strategy.hipoteses.map((h) => <li key={h}>{h}</li>)}</ul>
                  <p className="mt-2">{strategy.plano_testes}</p>
                </Block>
                <Block title="Cronograma">{strategy.cronograma}</Block>
                <Block title="Recomendações">
                  <ul className="list-disc pl-5">{strategy.recomendacoes.map((r) => <li key={r}>{r}</li>)}</ul>
                </Block>
              </div>
            )}
          </Section>
        </TabsContent>

        <TabsContent value="copies">
          <Section
            title={`Copies ${data.copy ? `v${data.copy.version}` : ""}`}
            actions={
              canEdit && (
                <Button size="sm" variant="outline" onClick={regenCopy} disabled={busy === "copy"}>
                  <Sparkles className="mr-1 size-3.5" />
                  {busy === "copy" ? "Gerando..." : "Gerar variação"}
                </Button>
              )
            }
          >
            {!copy ? (
              <p className="text-sm text-muted-foreground">Nenhuma copy gerada ainda.</p>
            ) : (
              <div className="space-y-5 text-sm">
                <Block title="Headline principal">{copy.headline}</Block>
                <Block title="Variações de headline">
                  <ul className="list-disc pl-5">{copy.headline_variacoes.map((h) => <li key={h}>{h}</li>)}</ul>
                </Block>
                <Block title="Texto curto">{copy.texto_curto}</Block>
                <Block title="Texto longo">{copy.texto_longo}</Block>
                <Block title="CTA">{copy.cta}</Block>
                <Block title="Anúncio Meta">{copy.meta_ad}</Block>
                <Block title="Instagram feed">{copy.instagram_feed}</Block>
                <Block title="Roteiro Reels"><pre className="whitespace-pre-wrap font-sans">{copy.reels}</pre></Block>
                <Block title="Stories"><pre className="whitespace-pre-wrap font-sans">{copy.stories}</pre></Block>
                <Block title="Script UGC">{copy.script_ugc}</Block>
                <Block title="Script institucional">{copy.script_institucional}</Block>
                <Block title="Carrossel">
                  <ul className="list-disc pl-5">{copy.carrossel.map((s) => <li key={s}>{s}</li>)}</ul>
                </Block>
                <Block title="Quiz">
                  <ul className="space-y-1">
                    {copy.quiz.map((q) => (
                      <li key={q.pergunta}>{q.pergunta} <span className="text-muted-foreground">({q.opcoes.join(" · ")})</span></li>
                    ))}
                  </ul>
                </Block>
              </div>
            )}
          </Section>
        </TabsContent>

        <TabsContent value="criativos">
          <Section title="Criativos da campanha" actions={<Button size="sm" variant="outline" asChild><Link to="/studio">Abrir Creative Studio</Link></Button>}>
            {data.creatives.length === 0 ? (
              <p className="text-sm text-muted-foreground">Nenhum criativo gerado para esta campanha.</p>
            ) : (
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                {data.creatives.map((cr) => (
                  <div key={cr.id} className="overflow-hidden rounded-lg border border-border">
                    <img
                      src={cr.preview_url ?? `https://picsum.photos/seed/${cr.id}/600/600`}
                      alt={cr.title}
                      className="aspect-square w-full object-cover"
                    />
                    <div className="space-y-1 p-3">
                      <p className="text-sm font-medium">{cr.title}</p>
                      <p className="text-xs text-muted-foreground">{FORMATS[cr.type] ?? cr.type} · {cr.aspect_ratio}</p>
                      <StatusPill status={cr.status} label={CREATIVE_STATUS[cr.status] ?? cr.status} />
                    </div>
                  </div>
                ))}
              </div>
            )}
          </Section>
        </TabsContent>

        <TabsContent value="briefing">
          <Section title="Briefing original">
            <dl className="grid gap-4 text-sm md:grid-cols-2">
              <Item label="Produto / oferta" value={`${c.offer_product ?? "-"}${c.offer_price ? ` · ${brl(c.offer_price)}` : ""}`} />
              <Item label="Promessa" value={c.offer_promise ?? "-"} />
              <Item label="Destino" value={c.landing_url ?? "-"} />
              <Item label="Meta de leads" value={num(c.goal_leads)} />
              <Item label="Meta de vendas" value={num(c.goal_sales)} />
              <Item label="Ticket médio" value={brl(c.avg_ticket)} />
              <Item label="Margem" value={`${num(c.margin_percent)}%`} />
              <Item label="CAC máximo" value={brl(c.max_cac)} />
              <Item label="Formatos" value={c.formats.map((f) => FORMATS[f] ?? f).join(", ")} />
              <Item label="Público" value={Object.entries((c.audience ?? {}) as Record<string, string>).map(([a, b]) => `${a}: ${b}`).join(" · ")} />
            </dl>
          </Section>
        </TabsContent>
      </Tabs>
    </>
  );
}

function Block({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="text-xs font-semibold uppercase tracking-wider text-primary">{title}</p>
      <div className="mt-1 text-muted-foreground">{children}</div>
    </div>
  );
}

function Item({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs uppercase tracking-wider text-muted-foreground">{label}</dt>
      <dd className="mt-0.5">{value}</dd>
    </div>
  );
}
