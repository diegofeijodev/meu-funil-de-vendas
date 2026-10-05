"use client";

import { Link, useParams } from "@/lib/router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { Rocket, Sparkles } from "lucide-react";
import {
  createCopy,
  getCampaignDetail,
  requestCampaignApproval,
} from "@/modules/campaigns/infrastructure/campaigns.api";
import { apiErrorMessage } from "@/modules/shared/infrastructure/http";
import { useWorkspace } from "@/lib/workspace";
import { PageHeader, Section, StatCard, StatusPill, SandboxBadge } from "@/components/ui-bits";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { CAMPAIGN_STATUS, CREATIVE_STATUS, FORMATS, OBJECTIVES } from "@/lib/labels";
import { brl, fullDate, num } from "@/lib/format";
import { computeKpis, type PerformanceRow } from "@/lib/metrics";
import { generateCopySmart, type CampaignBrief, type CopyContent } from "@/lib/ai/agents";
import type { FullStrategy } from "@/lib/ai/strategy-types";
import { approveCampaignStrategy, createIgPlanFromStrategy, generateCampaignStrategy } from "@/lib/ai/strategist.functions";
import type { PublishStep } from "@/lib/providers/meta-provider";
import { useServerFn } from "@/lib/server-fn";
import { metaAdsStatus, metaAdsPublish, metaAdsSetStatus } from "@/lib/meta-ads.functions";
import { generateAdsRecommendations, syncAdsInsightsNow } from "@/lib/meta/ads-ops.functions";
import { CampaignAdsSettings } from "@/components/campaign-ads-settings";
import { CampaignChannels } from "@/components/campaign-channels";
import { canvaCreateFromBrief } from "@/lib/creative/canva.functions";
import { HowTo } from "@/components/how-to";
import { GUIDES } from "@/lib/guides";

export function CampaignDetail() {
  const { id } = useParams<{ id: string }>();
  const { workspaceId, canEdit, role } = useWorkspace();
  const canManage = role === "owner" || role === "admin";
  const qc = useQueryClient();
  const runSync = useServerFn(syncAdsInsightsNow);
  const runRecos = useServerFn(generateAdsRecommendations);
  const metaStatus = useServerFn(metaAdsStatus);
  const metaPublish = useServerFn(metaAdsPublish);
  const metaSetStatus = useServerFn(metaAdsSetStatus);
  const runStrategy = useServerFn(generateCampaignStrategy);
  const runApproveStrategy = useServerFn(approveCampaignStrategy);
  const runIgPlan = useServerFn(createIgPlanFromStrategy);
  const runCanvaCreate = useServerFn(canvaCreateFromBrief);

  
  const [busy, setBusy] = useState<string | null>(null);
  const [steps, setSteps] = useState<PublishStep[]>([]);

  const { data } = useQuery({
    queryKey: ["campaign", id],
    enabled: !!workspaceId,
    queryFn: () => getCampaignDetail(workspaceId!, id),
  });

  if (!data?.campaign) return <div className="panel h-64 animate-pulse" />;
  const c = data.campaign;
  const brand = c.brands;
  const extra = data.costs.reduce((s, x) => s + Number(x.amount), 0);
  const k = computeKpis(data.perf, extra);
  const strategy = data.strategy?.content as unknown as FullStrategy | undefined;
  const strategyApproved = data.strategy?.status === "approved";
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
    if (!workspaceId) return;
    setBusy("strategy");
    try {
      const r = await runStrategy({ data: { campaignId: id } });
      qc.invalidateQueries({ queryKey: ["campaign", id] });
      toast.success(`Estratégia v${r.version} gerada pela IA. Revise e aprove para orientar copy e criativos.`);
    } catch (e) {
      toast.error(apiErrorMessage(e, "Não foi possível gerar a estratégia."));
    } finally {
      setBusy(null);
    }
  };

  const approveStrategy = async () => {
    if (!data.strategy) return;
    setBusy("approve-strategy");
    try {
      await runApproveStrategy({ data: { strategyId: data.strategy.id } });
      qc.invalidateQueries({ queryKey: ["campaign", id] });
      toast.success("Estratégia aprovada. Copy, criativos e vídeos passam a seguir esta versão.");
    } catch (e) {
      toast.error(apiErrorMessage(e, "Não foi possível aprovar."));
    } finally {
      setBusy(null);
    }
  };

  const createIgPlan = async () => {
    setBusy("ig-plan");
    try {
      await runIgPlan({ data: { campaignId: id } });
      toast.success("Plano do Instagram criado em rascunho. Revise em Instagram → Estratégia.");
    } catch (e) {
      toast.error(apiErrorMessage(e, "Não foi possível criar o plano."));
    } finally {
      setBusy(null);
    }
  };

  const regenCopy = async () => {
    if (!workspaceId || !brand) return;
    setBusy("copy");
    try {
      const version = (data.copy?.version ?? 0) + 1;
      const { content, engine } = await generateCopySmart(workspaceId, brand, brief(), version, { campaignId: id });
      await createCopy(workspaceId, id, content);
      qc.invalidateQueries({ queryKey: ["campaign", id] });
      toast.success(`Novas copies geradas com ${engine}.`);
    } catch (e) {
      toast.error(`Copy não gerada: ${apiErrorMessage(e, "erro")}`);
    } finally {
      setBusy(null);
    }
  };

  const canvaFromCopy = async () => {
    if (!workspaceId || !copy) return;
    setBusy("canva");
    try {
      const r = await runCanvaCreate({ data: { workspaceId, title: `${brand?.name ?? "Campanha"} · ${copy.headline}`, size: "portrait" } });
      if (r.editUrl) {
        window.open(r.editUrl, "_blank");
        toast.success("Design criado no Canva. Edite e depois use Importar do Canva na Biblioteca.");
      } else toast.success("O Canva ainda está montando o design. Ele aparece nos seus designs em instantes.");
    } catch (e) {
      toast.error(apiErrorMessage(e, "Não foi possível criar no Canva."));
    } finally {
      setBusy(null);
    }
  };

  const requestApproval = async () => {
    if (!workspaceId) return;
    try {
      await requestCampaignApproval(workspaceId, id);
      qc.invalidateQueries({ queryKey: ["campaign", id] });
      toast.success("Aprovação solicitada. Confira em Aprovações.");
    } catch (e) {
      toast.error(apiErrorMessage(e, "Não foi possível solicitar a aprovação."));
    }
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
      const st = await metaStatus({ data: { workspaceId } });
      if (!st.configured) {
        // Sem Meta conectada não existe publicação: nada de simular nem marcar como ativa.
        throw new Error(
          `Conecte a Meta antes de publicar (faltando: ${(st.missing ?? []).join(", ") || "credenciais"}). Vá em Integrações → Meta Ads.`,
        );
      }
      setSteps([{ key: "meta", label: "Enviando para a Meta (tudo pausado)", status: "pending", detail: c.name }]);
      const out = await metaPublish({ data: { workspaceId, campaignId: id } });
      setSteps(out.steps);
      qc.invalidateQueries({ queryKey: ["campaign", id] });
      toast.success("Campanha criada na Meta, pausada. Clique em Ativar na Meta quando quiser veicular.");
    } catch (e) {
      toast.error(apiErrorMessage(e, "Falha ao publicar"));
    } finally {
      setBusy(null);
    }
  };


  const syncNow = async () => {
    if (!workspaceId) return;
    setBusy("sync");
    try {
      const r = await runSync({ data: { workspaceId } });
      qc.invalidateQueries({ queryKey: ["campaign", id] });
      if (r.message) toast.info(r.message);
      else toast.success(`Resultados da Meta sincronizados (${r.rows} linhas de anúncio por dia).`);
    } catch (e) {
      toast.error(apiErrorMessage(e, "Não foi possível sincronizar."));
    } finally {
      setBusy(null);
    }
  };

  const recos = async () => {
    if (!workspaceId) return;
    setBusy("recos");
    try {
      const r = await runRecos({ data: { workspaceId, campaignId: id } });
      if (r.errors.length) toast.warning(r.errors.join(" · "));
      if (r.created) toast.success(`${r.created} recomendações da IA em AI Insights.`);
    } catch (e) {
      toast.error(apiErrorMessage(e, "Não foi possível gerar recomendações."));
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
      toast.error(apiErrorMessage(e, "Não foi possível alterar na Meta."));
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
            {canEdit && metaId && (c.status === "approved" || c.status === "active") && (metaDelivery === "ACTIVE" || canManage) && (
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
      <div className="mb-6">
        <HowTo title={GUIDES.campaign.title} steps={GUIDES.campaign.steps} references={GUIDES.campaign.references ?? []} />
      </div>

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
            <SandboxBadge label="Meta Ads" />
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
          <TabsTrigger value="anuncios">Anúncios e regras</TabsTrigger>
          <TabsTrigger value="briefing">Briefing</TabsTrigger>
        </TabsList>

        <TabsContent value="estrategia">
          <Section
            title={`Plano estratégico ${data.strategy ? `v${data.strategy.version}` : ""}`}
            description={
              data.strategy
                ? strategyApproved
                  ? "Aprovada: copy, criativos, vídeos e públicos seguem esta versão."
                  : "Rascunho: revise e aprove para que os outros agentes sigam esta estratégia."
                : "Gere a estratégia com IA: ela orienta copy, criativos, vídeos, públicos e o Instagram."
            }
            actions={
              canEdit && (
                <div className="flex flex-wrap gap-2">
                  {data.strategy && !strategyApproved && (
                    <Button size="sm" onClick={approveStrategy} disabled={busy === "approve-strategy"}>
                      Aprovar estratégia
                    </Button>
                  )}
                  {strategy?.plano_instagram && (
                    <Button size="sm" variant="outline" onClick={createIgPlan} disabled={busy === "ig-plan"}>
                      Criar plano no Instagram
                    </Button>
                  )}
                  <Button size="sm" variant="outline" onClick={regenStrategy} disabled={busy === "strategy"}>
                    <Sparkles className="mr-1 size-3.5" />
                    {busy === "strategy" ? "Gerando (até 1 min)..." : data.strategy ? "Regerar com IA" : "Gerar com IA"}
                  </Button>
                </div>
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
                  {strategy.angulos_detalhados?.length ? (
                    <div className="grid gap-2 md:grid-cols-2">
                      {strategy.angulos_detalhados.map((a) => (
                        <div key={a.nome} className="rounded-md border border-border/60 p-3">
                          <p className="font-medium text-foreground">{a.nome}</p>
                          <p className="mt-1">Gancho: &quot;{a.gancho}&quot;</p>
                          <p className="mt-1">{a.mensagem}</p>
                          <p className="mt-1 text-xs">
                            {a.formato_sugerido} · {a.etapa_funil} · {a.dor_ou_desejo}
                          </p>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <ul className="list-disc pl-5">{strategy.angulos.map((a) => <li key={a}>{a}</li>)}</ul>
                  )}
                </Block>
                {!!strategy.publicos_meta?.length && (
                  <Block title="Públicos para a Meta">
                    <ul className="space-y-1">
                      {strategy.publicos_meta.map((p) => (
                        <li key={p.nome}>
                          <span className="text-foreground">{p.nome}</span> ({p.tipo}) — {p.descricao}
                          {p.interesses.length ? ` · Interesses: ${p.interesses.join(", ")}` : ""}
                        </li>
                      ))}
                    </ul>
                  </Block>
                )}
                {strategy.briefing_criativo && (
                  <Block title="Briefing para o designer">
                    <p>{strategy.briefing_criativo.direcao_visual}</p>
                    <p className="mt-1 text-xs">
                      Formatos: {strategy.briefing_criativo.formatos.join(", ")} · {strategy.briefing_criativo.quantidade_por_angulo} por ângulo · CTA: {strategy.briefing_criativo.cta}
                    </p>
                  </Block>
                )}
                {strategy.briefing_video && (
                  <Block title={`Roteiro de vídeo (${strategy.briefing_video.duracao_segundos}s)`}>
                    <p>{strategy.briefing_video.roteiro}</p>
                    <ol className="mt-1 list-decimal pl-5">{strategy.briefing_video.cenas.map((c2) => <li key={c2}>{c2}</li>)}</ol>
                  </Block>
                )}
                {strategy.plano_instagram && (
                  <Block title="Plano para o Instagram">
                    <div className="flex flex-wrap gap-2">
                      {strategy.plano_instagram.pilares.map((p) => (
                        <span key={p.nome} className="rounded-full border border-border px-2.5 py-0.5 text-xs">
                          {p.nome} · {Math.round(p.peso * 100)}%
                        </span>
                      ))}
                    </div>
                    <ul className="mt-2 list-disc pl-5">{strategy.plano_instagram.temas.map((t) => <li key={t}>{t}</li>)}</ul>
                  </Block>
                )}
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
                <div className="flex flex-wrap gap-2">
                  {copy && (
                    <Button size="sm" variant="outline" onClick={canvaFromCopy} disabled={busy === "canva"}>
                      {busy === "canva" ? "Criando no Canva..." : "Criar design no Canva"}
                    </Button>
                  )}
                  <Button size="sm" variant="outline" onClick={regenCopy} disabled={busy === "copy"}>
                    <Sparkles className="mr-1 size-3.5" />
                    {busy === "copy" ? "Gerando..." : "Gerar variação"}
                  </Button>
                </div>
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
                    {cr.preview_url && /\.mp4(\?|$)/.test(cr.preview_url) ? (
                      <video src={cr.preview_url} controls className="aspect-square w-full bg-muted object-cover" />
                    ) : cr.preview_url ? (
                      <img src={cr.preview_url} alt={cr.title} className="aspect-square w-full object-cover" />
                    ) : (
                      <div className="flex aspect-square w-full items-center justify-center bg-muted text-xs text-muted-foreground">
                        Sem prévia
                      </div>
                    )}
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

        <TabsContent value="anuncios">
          <div className="space-y-6">
            <Section
              title="Resultados reais por anúncio e ângulo"
              description={
                (c as { last_insights_sync_at?: string | null }).last_insights_sync_at
                  ? `Última sincronização com a Meta: ${new Date((c as { last_insights_sync_at: string }).last_insights_sync_at).toLocaleString("pt-BR")}. Atualiza sozinho a cada 3 horas.`
                  : "Aparece depois que a campanha veicular na Meta. Atualiza sozinho a cada 3 horas."
              }
              actions={
                metaId ? (
                  <div className="flex flex-wrap gap-2">
                    <Button size="sm" variant="outline" onClick={syncNow} disabled={busy === "sync"}>
                      {busy === "sync" ? "Sincronizando..." : "Sincronizar agora"}
                    </Button>
                    {canEdit && (
                      <Button size="sm" variant="outline" onClick={recos} disabled={busy === "recos"}>
                        <Sparkles className="mr-1 size-3.5" />
                        {busy === "recos" ? "Analisando..." : "Recomendações da IA"}
                      </Button>
                    )}
                  </div>
                ) : undefined
              }
            >
              <AdBreakdown perf={data.perf} creatives={data.creatives} />
            </Section>
            <CampaignChannels campaign={c as never} canEdit={canEdit} canManage={canManage} />
            {workspaceId && (
              <CampaignAdsSettings
                campaign={c as never}
                workspaceId={workspaceId}
                canEdit={canEdit}
                canManage={canManage}
                hasStrategyAudiences={!!strategy?.publicos_meta?.length}
              />
            )}
          </div>
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

type PerfWithAd = PerformanceRow & { meta_ad_id?: string | null; ad_name?: string | null; adset_name?: string | null };

/** Desempenho agregado por anúncio e por ângulo da estratégia (para saber qual ângulo vende mais). */
function AdBreakdown({ perf, creatives }: { perf: PerformanceRow[]; creatives: { id: string; angle?: string | null }[] }) {
  if (!perf.length) return <p className="text-sm text-muted-foreground">Ainda sem resultados da Meta.</p>;
  const angleOf = new Map(creatives.map((cr) => [cr.id, cr.angle ?? null]));
  type Row = { name: string; spend: number; impressions: number; clicks: number; leads: number; revenue: number };
  const add = (m: Map<string, Row>, key: string, name: string, r: PerfWithAd) => {
    const a = m.get(key) ?? { name, spend: 0, impressions: 0, clicks: 0, leads: 0, revenue: 0 };
    a.spend += Number(r.spend);
    a.impressions += Number(r.impressions);
    a.clicks += Number(r.clicks);
    a.leads += Number(r.leads);
    a.revenue += Number(r.revenue);
    m.set(key, a);
  };
  const byAd = new Map<string, Row>();
  const byAngle = new Map<string, Row>();
  for (const r of perf as PerfWithAd[]) {
    add(byAd, r.meta_ad_id ?? r.creative_id ?? "?", r.ad_name ?? "Anúncio", r);
    const ang = (r.creative_id && angleOf.get(r.creative_id)) || "Sem ângulo";
    add(byAngle, ang, ang, r);
  }
  const table = (rows: Row[]) => (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead className="text-left text-xs uppercase tracking-wider text-muted-foreground">
          <tr>
            <th className="py-2 pr-3">Nome</th>
            <th className="py-2 pr-3">Gasto</th>
            <th className="py-2 pr-3">CTR</th>
            <th className="py-2 pr-3">Leads</th>
            <th className="py-2 pr-3">CPL</th>
            <th className="py-2">ROAS</th>
          </tr>
        </thead>
        <tbody>
          {rows
            .sort((a, b) => (a.leads ? a.spend / a.leads : 1e9) - (b.leads ? b.spend / b.leads : 1e9))
            .map((r) => (
              <tr key={r.name} className="border-t border-border/50">
                <td className="py-2 pr-3">{r.name}</td>
                <td className="py-2 pr-3">{brl(r.spend)}</td>
                <td className="py-2 pr-3">{r.impressions ? `${num((r.clicks / r.impressions) * 100, 2)}%` : "-"}</td>
                <td className="py-2 pr-3">{num(r.leads)}</td>
                <td className="py-2 pr-3">{r.leads ? brl(r.spend / r.leads) : "-"}</td>
                <td className="py-2">{r.spend ? `${num(r.revenue / r.spend, 2)}x` : "-"}</td>
              </tr>
            ))}
        </tbody>
      </table>
    </div>
  );
  return (
    <div className="space-y-5">
      {byAngle.size > 1 && (
        <div>
          <p className="mb-1 text-xs font-semibold uppercase tracking-wider text-primary">Por ângulo da estratégia</p>
          {table([...byAngle.values()])}
        </div>
      )}
      <div>
        <p className="mb-1 text-xs font-semibold uppercase tracking-wider text-primary">Por anúncio</p>
        {table([...byAd.values()])}
      </div>
    </div>
  );
}
