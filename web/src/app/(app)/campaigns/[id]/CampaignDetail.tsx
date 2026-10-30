"use client";

import { Link, useParams } from "@/lib/router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useState } from "react";
import axios from "axios";
import { toast } from "sonner";
import { AlertTriangle, CircleStop, Rocket, Sparkles } from "lucide-react";
import {
  createCopy,
  endCampaign,
  getCampaignDetail,
  requestCampaignApproval,
  setCampaignBudget,
  setCampaignLandingUrl,
  setCampaignGeoTargets,
  type GeoTargetInput,
} from "@/modules/campaigns/infrastructure/campaigns.api";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { apiErrorCode, apiErrorMessage } from "@/modules/shared/infrastructure/http";
import { useWorkspace } from "@/lib/workspace";
import { PageHeader, Section, StatCard, StatusPill, SandboxBadge } from "@/components/ui-bits";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { CAMPAIGN_STATUS, CREATIVE_STATUS, FORMATS, OBJECTIVES } from "@/lib/labels";
import { brl, fullDate, num } from "@/lib/format";
import { parseMoneyInput } from "@/lib/money-input";
import { campaignPeriod } from "@/lib/campaign-period";
import { RegionPicker, splitCityUf } from "@/components/region-picker";
import { StyleRefsPanel } from "@/components/style-refs-panel";
import { PilotPanel } from "@/components/pilot/pilot-panel";
import { GoLiveDialog } from "@/components/pilot/go-live-dialog";
import { useFeatures } from "@/modules/features/infrastructure/features.api";
import { usePilot } from "@/modules/campaign-pilot/infrastructure/pilot.api";
import { computeKpis, type PerformanceRow } from "@/lib/metrics";
import { generateCopySmart, type CampaignBrief, type CopyContent } from "@/lib/ai/agents";
import type { FullStrategy } from "@/lib/ai/strategy-types";
import { approveCampaignStrategy, createIgPlanFromStrategy, generateCampaignStrategy } from "@/lib/ai/strategist.functions";
import type { PublishStep } from "@/lib/providers/meta-provider";
import { useServerFn } from "@/lib/server-fn";
import { metaAdsStatus, metaAdsPublish, metaAdsSetStatus, metaAdsExcludeCreative } from "@/lib/meta-ads.functions";
import { generateAdsRecommendations, syncAdsInsightsNow } from "@/lib/meta/ads-ops.functions";
import { CampaignAdsSettings } from "@/components/campaign-ads-settings";
import { CampaignChannels } from "@/components/campaign-channels";
import { canvaCreateFromBrief } from "@/lib/creative/canva.functions";
import { setCreativeStatus } from "@/modules/creative/infrastructure/creative.api";
import { HowTo } from "@/components/how-to";
import { GUIDES } from "@/lib/guides";
import { asList, joinList, normalizeCopy, normalizeStrategy } from "@/lib/ai/strategy-normalize";
import { SectionErrorBoundary } from "@/components/section-error-boundary";

export function CampaignDetail() {
  const { id } = useParams<{ id: string }>();
  const { workspaceId, canEdit, role } = useWorkspace();
  const canManage = role === "owner" || role === "admin";
  const qc = useQueryClient();
  const { data: features } = useFeatures(workspaceId);
  // O piloto avisa quando peças ficam prontas: o detalhe recarrega (miniaturas, aba de criativos).
  const refreshDetail = useCallback(() => void qc.invalidateQueries({ queryKey: ["campaign", id] }), [qc, id]);
  // Com o estrategista conduzindo, a estratégia não é regerada nem aprovada pela aba (o "Aprovar" do plano usa a versão da tela).
  const { data: pilotRun } = usePilot(workspaceId, id, !!features?.campaign_pilot);
  const pilotActive = !!pilotRun && ["planning", "running", "blocked"].includes(pilotRun.status);
  const runSync = useServerFn(syncAdsInsightsNow);
  const runRecos = useServerFn(generateAdsRecommendations);
  const metaStatus = useServerFn(metaAdsStatus);
  const metaPublish = useServerFn(metaAdsPublish);
  const metaSetStatus = useServerFn(metaAdsSetStatus);
  const metaExclude = useServerFn(metaAdsExcludeCreative);
  const [goLiveOpen, setGoLiveOpen] = useState(false);
  const runStrategy = useServerFn(generateCampaignStrategy);
  const runApproveStrategy = useServerFn(approveCampaignStrategy);
  const runIgPlan = useServerFn(createIgPlanFromStrategy);
  const runCanvaCreate = useServerFn(canvaCreateFromBrief);

  
  const [busy, setBusy] = useState<string | null>(null);
  const [steps, setSteps] = useState<PublishStep[]>([]);
  const [landing, setLanding] = useState("");
  const [budgetIn, setBudgetIn] = useState("");
  const [budgetTotalIn, setBudgetTotalIn] = useState("");
  const [geoIn, setGeoIn] = useState<GeoTargetInput | null>(null);
  // A Meta não achou a cidade no último "Publicar": o aviso da cidade aparece mesmo com o campo preenchido.
  const [geoProblem, setGeoProblem] = useState(false);
  const [endOpen, setEndOpen] = useState(false);
  // Aba controlada: mensagens de erro podem levar direto à aba certa (ex.: "Ver criativos").
  const [tab, setTab] = useState("estrategia");
  const showTab = (value: string) => {
    setTab(value);
    document.getElementById("campaign-tabs")?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  const { data, isPending } = useQuery({
    queryKey: ["campaign", id],
    enabled: !!workspaceId,
    // Só a PRIMEIRA carga com falha vai para `error.tsx` (Tentar de novo / Voltar para campanhas); erro em refetch de
    // fundo (foco, invalidate, deploy reiniciando) mantém a página já carregada.
    throwOnError: (_err, q) => q.state.data === undefined,
    queryFn: async () => {
      let detail;
      try {
        detail = await getCampaignDetail(workspaceId!, id);
      } catch (e) {
        // Campanha inexistente (404) / sem acesso (403): tela "não encontrada", não carregamento eterno.
        if (axios.isAxiosError(e) && (e.response?.status === 404 || e.response?.status === 403)) return null;
        throw e;
      }
      // A IA pode omitir listas (públicos, ângulos, formatos...): normaliza antes de renderizar.
      // Campos que versões antigas gravaram como "[object Object]": a tela sugere gerar de novo (só nesses).
      const raw = detail.strategy?.content as Record<string, unknown> | null | undefined;
      const junk =
        raw && typeof raw === "object" && !Array.isArray(raw)
          ? Object.entries(raw).filter(([, v]) => typeof v === "string" && v.trim() === "[object Object]").map(([k]) => k)
          : [];
      return {
        ...detail,
        strategyJunk: junk,
        strategy: detail.strategy ? { ...detail.strategy, content: normalizeStrategy(detail.strategy.content) } : null,
        copy: detail.copy ? { ...detail.copy, content: normalizeCopy(detail.copy.content) } : null,
      };
    },
  });

  if (isPending) return <div className="panel h-64 animate-pulse" />;
  if (!data?.campaign)
    return (
      <div className="panel mx-auto mt-10 flex max-w-lg flex-col items-center gap-4 p-8 text-center">
        <p className="text-sm text-muted-foreground">Campanha não encontrada ou sem acesso neste workspace.</p>
        <Button asChild>
          <Link to="/campaigns">Voltar para campanhas</Link>
        </Button>
      </div>
    );
  const c = data.campaign;
  const brand = c.brands;
  const extra = data.costs.reduce((s, x) => s + Number(x.amount), 0);
  const k = computeKpis(data.perf, extra);
  const strategy = (data.strategy?.content ?? undefined) as FullStrategy | undefined;
  const junk = (key: string) => data.strategyJunk.includes(key);
  const strategyApproved = data.strategy?.status === "approved";
  const copy = (data.copy?.content ?? undefined) as CopyContent | undefined;

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

  const saveLanding = async () => {
    if (!workspaceId) return;
    setBusy("landing");
    try {
      await setCampaignLandingUrl(workspaceId, id, landing);
      setLanding("");
      await qc.invalidateQueries({ queryKey: ["campaign", id] });
      toast.success("Página de destino salva. Já dá para publicar na Meta.");
    } catch (e) {
      toast.error(apiErrorMessage(e, "Não foi possível salvar o destino"));
    } finally {
      setBusy(null);
    }
  };

  const saveBudget = async () => {
    if (!workspaceId) return;
    const daily = parseMoneyInput(budgetIn);
    const total = budgetTotalIn.trim() ? parseMoneyInput(budgetTotalIn) : undefined;
    if (!(daily > 0)) {
      toast.error("Informe um valor por dia maior que zero.");
      return;
    }
    if (total !== undefined && !(total > 0)) {
      toast.error("Informe a verba total em reais (ex.: 900) ou deixe em branco.");
      return;
    }
    setBusy("budget");
    try {
      await setCampaignBudget(workspaceId, id, daily, total);
      setBudgetIn("");
      setBudgetTotalIn("");
      await qc.invalidateQueries({ queryKey: ["campaign", id] });
      toast.success(metaId ? "Verba anotada. Na Meta, nada mudou." : `Verba salva: ${brl(daily)} por dia.`);
    } catch (e) {
      toast.error(apiErrorMessage(e, "Não foi possível salvar a verba"));
    } finally {
      setBusy(null);
    }
  };

  const saveRegion = async (target: GeoTargetInput | null) => {
    if (!workspaceId) return;
    if (!target?.name) {
      toast.error("Escreva a cidade (ex.: Jundiaí, SP).");
      return;
    }
    setBusy("city");
    try {
      await setCampaignGeoTargets(workspaceId, id, [target]);
      setGeoIn(null);
      setGeoProblem(false);
      await qc.invalidateQueries({ queryKey: ["campaign", id] });
      toast.success("Região salva. Já dá para publicar na Meta.");
    } catch (e) {
      toast.error(apiErrorMessage(e, "Não foi possível salvar a cidade"));
    } finally {
      setBusy(null);
    }
  };

  const scrollToFix = (elementId: string) => document.getElementById(elementId)?.scrollIntoView({ behavior: "smooth", block: "center" });

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
      toast.error(`Copy não gerada. ${apiErrorMessage(e, "Tente de novo em instantes.")}`);
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
      if (!c.landing_url) throw new Error("Preencha a página de destino (URL) da campanha, no aviso acima das abas, antes de publicar.");
      const approved = c.status === "approved" || c.status === "active";
      if (!approved) {
        throw new Error("Publicação bloqueada: a campanha precisa de aprovação humana antes de ir ao ar.");
      }
      const st = await metaStatus({ data: { workspaceId } });
      if (!st.configured) {
        // Sem Meta conectada não existe publicação: nada de simular nem marcar como ativa.
        throw new Error(
          `Conecte a Meta antes de publicar (faltando: ${joinList(st.missing) || "credenciais"}). Vá em Integrações → Meta Ads.`,
        );
      }
      setSteps([{ key: "meta", label: "Enviando para a Meta (tudo pausado)", status: "pending", detail: c.name }]);
      const out = await metaPublish({ data: { workspaceId, campaignId: id } });
      setSteps(out.steps);
      qc.invalidateQueries({ queryKey: ["campaign", id] });
      toast.success("Campanha criada na Meta, pausada. Clique em Ativar na Meta quando quiser veicular.");
    } catch (e) {
      setSteps([]); // some o "Enviando para a Meta" que ficaria preso depois da falha
      const msg = apiErrorMessage(e, "Falha ao publicar");
      // Sem criativo aprovado (código estável da API): o aviso leva direto à aba Criativos.
      const code = apiErrorCode(e);
      if (code === "NO_APPROVED_CREATIVE")
        toast.error(msg, { duration: 10000, action: { label: "Ver criativos", onClick: () => showTab("criativos") } });
      else if (code === "BUDGET_MISSING")
        toast.error(msg, { duration: 10000, action: { label: "Ajustar", onClick: () => scrollToFix("fix-budget") } });
      else if (code === "GEO_UNRESOLVED") {
        setGeoProblem(true);
        toast.error(msg, { duration: 10000, action: { label: "Ajustar", onClick: () => scrollToFix("fix-city") } });
      } else toast.error(msg);
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
      if (r.errors.length) toast.warning(joinList(r.errors, " · "));
      if (r.created) toast.success(`${r.created} recomendações da IA em AI Insights.`);
    } catch (e) {
      toast.error(apiErrorMessage(e, "Não foi possível gerar recomendações."));
    } finally {
      setBusy(null);
    }
  };

  const setDelivery = async (status: "ACTIVE" | "PAUSED", confirmOffer?: boolean) => {
    if (!workspaceId) return;
    setBusy("delivery");
    try {
      await metaSetStatus({ data: { workspaceId, campaignId: id, status, ...(confirmOffer ? { confirmOffer: true } : {}) } });
      qc.invalidateQueries({ queryKey: ["campaign", id] });
      setGoLiveOpen(false);
      toast.success(
        status === "ACTIVE"
          ? "Anúncio ligado. A Meta pode levar algumas horas para começar a mostrar. Os resultados aparecem aqui a cada 3 horas."
          : "Campanha pausada na Meta.",
      );
    } catch (e) {
      // Recusa nossa (oferta sem confirmação, nenhum anúncio, papel): a frase do servidor. Recusa da Meta: diz que veio de lá.
      const ours = ["OFFER_UNCONFIRMED", "NO_AD_LEFT", "FORBIDDEN", "PERIOD_ENDED"].includes(apiErrorCode(e) ?? "");
      toast.error(
        status === "ACTIVE" && !ours
          ? `A Meta não aceitou ligar o anúncio: ${apiErrorMessage(e, "motivo não informado").replace(/\.$/, "")}. Confira o status na Meta antes de tentar de novo.`
          : apiErrorMessage(e, "Não foi possível alterar na Meta."),
      );
    } finally {
      setBusy(null);
    }
  };
  const finishCampaign = async () => {
    if (!workspaceId) return;
    setBusy("end");
    try {
      const r = await endCampaign(workspaceId, id);
      setEndOpen(false);
      qc.invalidateQueries({ queryKey: ["campaign", id] });
      const failedNames = r.channels.filter((x) => !x.ok && x.channel !== "instagram").map((x) => CHANNEL_NAME[x.channel] ?? x.channel);
      const igFailed = r.channels.some((x) => !x.ok && x.channel === "instagram");
      const description = r.channels.length ? (
        <div className="space-y-0.5">
          {r.channels.map((x) => (
            <p key={x.channel}>{x.message}</p>
          ))}
        </div>
      ) : undefined;
      if (failedNames.length)
        toast.warning(`Campanha encerrada, mas ${joinPt(failedNames)} não ${failedNames.length > 1 ? "confirmaram" : "confirmou"} a pausa.`, { description, duration: 12000 });
      else if (igFailed) toast.warning("Campanha encerrada, mas não deu para cancelar os posts agendados do Instagram.", { description, duration: 12000 });
      else toast.success(r.alreadyEnded ? "Canais conferidos de novo: tudo pausado." : "Campanha encerrada.", { description, duration: 8000 });
    } catch (e) {
      toast.error(apiErrorMessage(e, "Não foi possível encerrar a campanha."));
    } finally {
      setBusy(null);
    }
  };
  const approveCreative = async (creativeId: string) => {
    if (!workspaceId) return;
    setBusy(`approve-${creativeId}`);
    try {
      await setCreativeStatus(workspaceId, creativeId, "approved");
      qc.invalidateQueries({ queryKey: ["campaign", id] });
      toast.success("Criativo aprovado. Ele entra na publicação da campanha.");
    } catch (e) {
      toast.error(apiErrorMessage(e, "Não foi possível aprovar o criativo."));
    } finally {
      setBusy(null);
    }
  };
  const ended = c.status === "finished";
  // Fim do período (Brasília): encerrado não publica nem liga; último dia liga, mas não publica (a Meta pede 24 h).
  const period = campaignPeriod(c.end_date);
  const metaId = (c as { meta_campaign_id?: string | null }).meta_campaign_id;
  // Verba e cidade ainda podem mudar aqui (depois de publicada, o anúncio vive na Meta). Depois do pedido de aprovação, só dono/admin.
  const canChangeTerms = canEdit && (c.status === "draft" || canManage);
  const fixableBeforeMeta = canChangeTerms && !metaId && ["draft", "pending_approval", "approved"].includes(c.status);
  // Verba vazia pode ser preenchida mesmo já na Meta (campanha antiga com o R$ 20 silencioso): Google e TikTok precisam dela.
  const budgetFixable = canChangeTerms && !ended && (fixableBeforeMeta || !!metaId);
  const city = String(((c.audience ?? {}) as Record<string, unknown>).localizacao ?? "").trim();
  // Região de partida do seletor: a 1ª cidade gravada (Fatia 2) ou o texto antigo, com +20 km (igual a hoje).
  const savedGeo = (c.geo_targets ?? [])[0] as GeoTargetInput | undefined;
  const regionFromCampaign: GeoTargetInput | null = savedGeo?.name
    ? savedGeo
    : city
      ? { type: "city", ...splitCityUf(city.split(";")[0] ?? ""), meta_key: null, radius_km: 20 }
      : null;
  const metaDelivery = (c as { meta_delivery_status?: string | null }).meta_delivery_status;
  const ext = c as { google_campaign_id?: string | null; google_status?: string | null; tiktok_campaign_id?: string | null; tiktok_status?: string | null };
  // Canais em que a campanha existe (o diálogo de encerrar cita só esses) e os que ainda estão no ar.
  const liveChannels = [metaId && "meta", ext.google_campaign_id && "google", ext.tiktok_campaign_id && "tiktok"].filter(Boolean) as string[];
  const stillActive = [
    metaId && metaDelivery === "ACTIVE" && "meta",
    ext.google_campaign_id && ext.google_status === "ENABLED" && "google",
    ext.tiktok_campaign_id && ext.tiktok_status === "ENABLE" && "tiktok",
  ].filter(Boolean) as string[];
  // Posts do Instagram da campanha que ainda vão sair (vem da API: vale também depois de recarregar a página).
  const igPending = data.instagram.pending_posts;
  // Encerrada e quem gerencia: o caminho é "Pausar os canais de novo" (o "Pausar na Meta" some para não duplicar).
  const canPauseMeta = canEdit && !!metaId && metaDelivery === "ACTIVE" && !(ended && canManage);
  const endedBanner = ended && (stillActive.length > 0 || igPending > 0);

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
            {/* Pausar aparece sempre que a Meta está veiculando (mesmo encerrada); ativar, só aprovada/ativa e para dono/admin. */}
            {canPauseMeta && (
              <Button variant="outline" disabled={busy === "delivery"} onClick={() => setDelivery("PAUSED")}>
                Pausar na Meta
              </Button>
            )}
            {canEdit && canManage && metaId && metaDelivery !== "ACTIVE" && period !== "ended" && (c.status === "approved" || c.status === "active") && (
              <Button variant="outline" disabled={busy === "delivery"} onClick={() => setGoLiveOpen(true)}>
                Ativar na Meta
              </Button>
            )}
            {canManage && ended && stillActive.length > 0 && (
              <Button variant="outline" disabled={busy === "end"} onClick={() => void finishCampaign()}>
                {busy === "end" ? "Pausando..." : "Pausar os canais de novo"}
              </Button>
            )}
            {canManage && ended && stillActive.length === 0 && igPending > 0 && (
              <Button variant="outline" disabled={busy === "end"} onClick={() => void finishCampaign()}>
                {busy === "end" ? "Cancelando..." : "Cancelar os posts agendados"}
              </Button>
            )}
            {/* Com o estrategista conduzindo, quem monta o anúncio é ele (publicar à mão agora deixaria as artes novas de fora). */}
            {canEdit && !metaId && !pilotActive && period === "open" && (c.status === "approved" || c.status === "active") && (
              <Button onClick={publish} disabled={busy === "publish"}>
                <Rocket className="mr-2 size-4" />
                {busy === "publish" ? "Publicando..." : "Publicar na Meta"}
              </Button>
            )}
            {canManage && !ended && (
              // No celular fica numa linha própria, longe dos outros botões.
              <div className="flex w-full justify-end border-t border-border/60 pt-2 sm:w-auto sm:border-0 sm:pt-0">
                <Button variant="ghost" className="text-destructive hover:bg-destructive/10 hover:text-destructive" onClick={() => setEndOpen(true)}>
                  <CircleStop className="mr-2 size-4" />
                  Encerrar campanha
                </Button>
              </div>
            )}
          </>
        }
      />
      <AlertDialog open={endOpen} onOpenChange={(open) => busy !== "end" && setEndOpen(open)}>
        <AlertDialogContent
          onCloseAutoFocus={(e) => {
            // Depois de encerrar, o foco vai para a faixa que diz o que aconteceu (e não volta a um botão que sumiu).
            if (!document.getElementById("campaign-ended")) return;
            e.preventDefault();
            document.getElementById("campaign-ended")?.focus();
          }}
        >
          <AlertDialogHeader>
            <AlertDialogTitle>Encerrar a campanha &quot;{c.name}&quot;?</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-2 text-sm text-muted-foreground">
                {(liveChannels.length > 0 || data.instagram.linked) && (
                  <ul className="list-disc space-y-1 pl-5">
                    {liveChannels.length > 0 && (
                      <li>Os anúncios {joinPt(liveChannels.map((ch) => CHANNEL_IN[ch]!))} são pausados e param de gastar verba.</li>
                    )}
                    {data.instagram.linked && (
                      <li>
                        {igPending === 0
                          ? "A programação do Instagram desta campanha para de criar posts novos."
                          : igPending === 1
                            ? "O post agendado do Instagram desta campanha é cancelado. Os que já saíram continuam no perfil."
                            : `Os ${igPending} posts agendados do Instagram desta campanha são cancelados. Os que já saíram continuam no perfil.`}
                      </li>
                    )}
                  </ul>
                )}
                <p>
                  Não dá para desfazer: a campanha não pode ser publicada nem ativada de novo. Os resultados continuam aqui.
                  {canPauseMeta ? " Se quiser só dar uma pausa, use Pausar na Meta." : ""}
                </p>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy === "end"}>Não encerrar</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              disabled={busy === "end"}
              onClick={(e) => {
                e.preventDefault(); // fecha só depois da resposta
                void finishCampaign();
              }}
            >
              {busy === "end" ? "Encerrando..." : "Encerrar campanha"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      {endedBanner ? (
        <div id="campaign-ended" tabIndex={-1} role="status" className="panel mb-6 flex items-start gap-3 border-amber-500/50 bg-amber-500/5 p-4 text-sm outline-none">
          <AlertTriangle className="mt-0.5 size-4 shrink-0 text-amber-600" aria-hidden />
          <p>{endedBannerText(stillActive, igPending, canManage ? "manage" : canEdit ? "edit" : "read")}</p>
        </div>
      ) : ended ? (
        <div id="campaign-ended" tabIndex={-1} className="panel mb-6 p-4 text-sm text-muted-foreground outline-none">
          Campanha encerrada: os anúncios ficam pausados e ela não pode ser publicada nem ativada de novo. Os resultados continuam aqui.
        </div>
      ) : null}
      {features?.campaign_pilot && workspaceId && (
        <PilotPanel
          workspaceId={workspaceId}
          campaign={c}
          strategy={data.strategy?.content}
          strategyVersion={data.strategy?.version ?? null}
          creatives={data.creatives}
          onGoLive={() => setGoLiveOpen(true)}
          onOpenTab={(t) => {
            setTab(t);
            setTimeout(() => document.getElementById("campaign-tabs")?.scrollIntoView({ behavior: "smooth", block: "start" }), 0);
          }}
          canEdit={canEdit}
          canManage={canManage}
          onChanged={refreshDetail}
        />
      )}
      <GoLiveDialog
        open={goLiveOpen}
        onOpenChange={setGoLiveOpen}
        campaign={c}
        creatives={data.creatives}
        canManage={canManage}
        busy={busy === "delivery"}
        onConfirm={(confirmOffer) => void setDelivery("ACTIVE", confirmOffer)}
        onExclude={async (creativeId) => {
          try {
            await metaExclude({ data: { workspaceId: workspaceId!, campaignId: id, creativeId } });
            toast.success("Arte tirada: o anúncio dela fica pausado.");
            refreshDetail();
          } catch (e) {
            toast.error(apiErrorMessage(e, "Não conseguimos tirar a arte agora."));
          }
        }}
      />
      <div className="mb-6">
        {(() => {
          const g = features?.campaign_pilot ? GUIDES.campaignPilot : GUIDES.campaign;
          return <HowTo title={g.title} steps={g.steps} references={g.references ?? []} />;
        })()}
      </div>

      <div className="mb-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="Verba total" value={brl(c.budget_total)} hint={`${brl(c.budget_daily)}/dia`} />
        <StatCard label="Investido" value={brl(k.spend)} hint={`+ ${brl(extra)} de custos extras`} />
        <StatCard label="Leads" value={num(k.leads)} hint={`CPL ${brl(k.cpl)}`} tone="accent" />
        <StatCard label="ROAS" value={`${num(k.roas, 2)}x`} hint={`ROI ${num(k.roi, 1)}%`} tone={k.roas >= 3 ? "positive" : "negative"} />
      </div>

      {canEdit && !c.landing_url && ["draft", "pending_approval", "approved"].includes(c.status) && (
        <div className="panel mb-6 border-amber-500/40 p-5">
          <p className="text-sm font-semibold">Falta a página de destino</p>
          <p className="mt-1 text-sm text-muted-foreground">
            Para onde o anúncio leva quem clicar (ex.: a página de cadastro). Sem ela a Meta não aceita a publicação.
          </p>
          <form
            className="mt-3 flex flex-col gap-2 sm:flex-row"
            onSubmit={(e) => {
              e.preventDefault();
              void saveLanding();
            }}
          >
            <Input
              type="url"
              inputMode="url"
              placeholder="https://www.seusite.com.br/pagina"
              value={landing}
              onChange={(e) => setLanding(e.target.value)}
              aria-label="Página de destino (URL)"
              className="sm:max-w-xl"
            />
            <Button type="submit" disabled={busy === "landing" || !landing.trim()}>
              {busy === "landing" ? "Salvando..." : "Salvar destino"}
            </Button>
          </form>
        </div>
      )}

      {!ended && period !== "open" && (!metaId || period === "ended") && (
        <div role="status" className="panel mb-6 border-amber-500/40 p-5">
          <p className="text-sm font-semibold">
            {period === "ended"
              ? `O período desta campanha terminou em ${fullDate(c.end_date)}. Crie uma campanha nova para anunciar de novo.`
              : "Esta campanha termina hoje: a Meta pede pelo menos 24 horas de anúncio. Crie uma campanha nova com mais dias."}
          </p>
          <Button asChild className="mt-3 h-11 sm:h-9">
            <Link to="/campaigns/new">Criar campanha nova</Link>
          </Button>
        </div>
      )}

      {budgetFixable && period === "open" && !(Number(c.budget_daily) > 0) && (
        <div id="fix-budget" className="panel mb-6 border-amber-500/40 p-5">
          <p className="text-sm font-semibold">Falta a verba por dia</p>
          <p className="mt-1 text-sm text-muted-foreground">
            {metaId
              ? "O anúncio já está na Meta e continua com o valor de lá. Este número serve para o Google/TikTok e para os relatórios. Para mudar o gasto, mude no Gerenciador de Anúncios da Meta."
              : "Quanto o anúncio pode gastar por dia. Sem isso não dá para publicar na Meta."}
          </p>
          <form
            className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-end"
            onSubmit={(e) => {
              e.preventDefault();
              void saveBudget();
            }}
          >
            <label className="flex flex-col gap-1 text-sm">
              R$ por dia
              <Input inputMode="decimal" placeholder="Ex.: 30" value={budgetIn} onChange={(e) => setBudgetIn(e.target.value)} className="sm:w-40" />
            </label>
            <label className="flex flex-col gap-1 text-sm">
              Verba total da campanha (opcional)
              <Input
                inputMode="decimal"
                placeholder={Number(c.budget_total) > 0 ? `Hoje: ${brl(c.budget_total)}` : "Ex.: 900"}
                value={budgetTotalIn}
                onChange={(e) => setBudgetTotalIn(e.target.value)}
                className="sm:w-48"
              />
            </label>
            <Button type="submit" className="h-11 sm:h-9" disabled={busy === "budget" || !budgetIn.trim()}>
              {busy === "budget" ? "Salvando..." : "Salvar verba"}
            </Button>
          </form>
        </div>
      )}

      {fixableBeforeMeta && period === "open" && (!city || geoProblem) && (
        <div id="fix-city" className="panel mb-6 border-amber-500/40 p-5">
          <p className="text-sm font-semibold">{city ? "A Meta não achou esta cidade" : "Em que cidade o anúncio aparece"}</p>
          <p className="mt-1 text-sm text-muted-foreground">
            Escolha a cidade na lista da Meta e quanto em volta dela o anúncio aparece.
          </p>
          <form
            className="mt-3 space-y-3 sm:max-w-md"
            onSubmit={(e) => {
              e.preventDefault();
              void saveRegion(geoIn ?? regionFromCampaign);
            }}
          >
            {workspaceId && (
              <RegionPicker workspaceId={workspaceId} value={geoIn ?? regionFromCampaign} onChange={setGeoIn} inputId="fix-city-input" />
            )}
            {geoProblem && !geoIn && !regionFromCampaign?.meta_key && (
              <p className="text-xs text-muted-foreground">Escolha a cidade na lista da Meta (ou mude o texto) para salvar.</p>
            )}
            <Button
              type="submit"
              className="h-11 sm:h-9"
              disabled={busy === "city" || !(geoIn ?? regionFromCampaign)?.name || (geoProblem && !geoIn && !regionFromCampaign?.meta_key)}
            >
              {busy === "city" ? "Salvando..." : "Salvar região"}
            </Button>
          </form>
        </div>
      )}

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

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList id="campaign-tabs" className="mb-6 scroll-mt-20">
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
                  {pilotActive && (
                    <p className="text-sm text-muted-foreground">O estrategista está conduzindo esta campanha. Para mudar o plano, use Ajustar no topo.</p>
                  )}
                  {!pilotActive && data.strategy && !strategyApproved && (
                    <Button size="sm" onClick={approveStrategy} disabled={busy === "approve-strategy"}>
                      Aprovar estratégia
                    </Button>
                  )}
                  {strategy?.plano_instagram && !ended && (
                    <Button size="sm" variant="outline" onClick={createIgPlan} disabled={busy === "ig-plan"}>
                      Criar plano no Instagram
                    </Button>
                  )}
                  {!pilotActive && (
                    <Button size="sm" variant="outline" onClick={regenStrategy} disabled={busy === "strategy"}>
                      <Sparkles className="mr-1 size-3.5" />
                      {busy === "strategy" ? "Gerando (até 1 min)..." : data.strategy ? "Regerar com IA" : "Gerar com IA"}
                    </Button>
                  )}
                </div>
              )
            }
          >
            <SectionErrorBoundary resetKey={data.strategy?.id} onRegenerate={canEdit ? regenStrategy : undefined} regenerating={busy === "strategy"}>
            {!strategy ? (
              <p className="text-sm text-muted-foreground">Nenhuma estratégia gerada ainda.</p>
            ) : (
              <div className="space-y-5 text-sm">
                <Block title="Resumo executivo" regen={junk("resumo_executivo")}>{strategy.resumo_executivo}</Block>
                <Block title="Problema" regen={junk("problema")}>{strategy.problema}</Block>
                <Block title="Objetivo SMART" regen={junk("objetivo_smart")}>{strategy.objetivo_smart}</Block>
                <Block title="ICP" regen={junk("icp")}>{strategy.icp}</Block>
                <Block title="Oferta" regen={junk("oferta")}>{strategy.oferta}</Block>
                <Block title="Big idea" regen={junk("big_idea")}>{strategy.big_idea}</Block>
                <Block title="Ângulos criativos">
                  {asList(strategy.angulos_detalhados).length ? (
                    <div className="grid gap-2 md:grid-cols-2">
                      {asList(strategy.angulos_detalhados).map((a, i) => (
                        <div key={`${a?.nome}-${i}`} className="rounded-md border border-border/60 p-3">
                          {/* Ângulo sem nome (IA com outras chaves): o gancho vira o título em vez de um "—" solto. */}
                          {a?.nome ? (
                            <>
                              <p className="font-medium text-foreground">{a.nome}</p>
                              {a?.gancho && <p className="mt-1">Gancho: &quot;{a.gancho}&quot;</p>}
                            </>
                          ) : (
                            <p className="font-medium text-foreground">{a?.gancho ? <>&quot;{a.gancho}&quot;</> : `Ângulo ${i + 1}`}</p>
                          )}
                          {a?.mensagem && <p className="mt-1">{a.mensagem}</p>}
                          {joinList([a?.formato_sugerido, a?.etapa_funil, a?.dor_ou_desejo].filter(Boolean), " · ") && (
                            <p className="mt-1 text-xs">
                              {joinList([a?.formato_sugerido, a?.etapa_funil, a?.dor_ou_desejo].filter(Boolean), " · ")}
                            </p>
                          )}
                        </div>
                      ))}
                    </div>
                  ) : (
                    <BulletList items={strategy.angulos} />
                  )}
                </Block>
                {asList(strategy.publicos_meta).length > 0 && (
                  <Block title="Públicos para a Meta">
                    <ul className="space-y-1">
                      {asList(strategy.publicos_meta).map((p, i) => (
                        <li key={`${p?.nome}-${i}`}>
                          <span className="text-foreground">{p?.nome || "—"}</span>
                          {p?.tipo ? ` (${p.tipo})` : ""}
                          {p?.descricao ? ` — ${p.descricao}` : ""}
                          {asList(p?.interesses).length ? ` · Interesses: ${joinList(p?.interesses)}` : ""}
                        </li>
                      ))}
                    </ul>
                  </Block>
                )}
                {strategy.briefing_criativo && (
                  <Block title="Briefing para o designer">
                    <p>{strategy.briefing_criativo?.direcao_visual || "—"}</p>
                    <p className="mt-1 text-xs">
                      Formatos: {joinList(strategy.briefing_criativo?.formatos) || "—"} · {strategy.briefing_criativo?.quantidade_por_angulo || "—"} por ângulo · CTA: {strategy.briefing_criativo?.cta || "—"}
                    </p>
                  </Block>
                )}
                {strategy.briefing_video && (
                  <Block title={`Roteiro de vídeo${strategy.briefing_video?.duracao_segundos ? ` (${strategy.briefing_video.duracao_segundos}s)` : ""}`}>
                    <p>{strategy.briefing_video?.roteiro || "—"}</p>
                    {asList(strategy.briefing_video?.cenas).length > 0 && (
                      <ol className="mt-1 list-decimal pl-5">{asList(strategy.briefing_video?.cenas).map((c2, i) => <li key={i}>{c2}</li>)}</ol>
                    )}
                  </Block>
                )}
                {strategy.plano_instagram && (
                  <Block title="Plano para o Instagram">
                    <div className="flex flex-wrap gap-2">
                      {asList(strategy.plano_instagram?.pilares).map((p, i) => (
                        <span key={`${p?.nome}-${i}`} className="rounded-full border border-border px-2.5 py-0.5 text-xs">
                          {p?.nome} · {Math.round((Number(p?.peso) || 0) * 100)}%
                        </span>
                      ))}
                    </div>
                    {asList(strategy.plano_instagram?.temas).length > 0 && (
                      <ul className="mt-2 list-disc pl-5">{asList(strategy.plano_instagram?.temas).map((t, i) => <li key={i}>{t}</li>)}</ul>
                    )}
                  </Block>
                )}
                <Block title="Funil" regen={junk("funil")}>{strategy.funil}</Block>
                <Block title="Objeções e respostas">
                  {asList(strategy.objecoes).length ? (
                    <ul className="space-y-1">
                      {asList(strategy.objecoes).map((o, i) => (
                        <li key={i}><span className="text-foreground">{o?.objecao}</span>{o?.resposta ? ` — ${o.resposta}` : ""}</li>
                      ))}
                    </ul>
                  ) : null}
                </Block>
                <Block title="Canais e distribuição de verba">
                  {strategy.canais || "—"}
                  <div className="mt-2 flex flex-wrap gap-2">
                    {Object.entries(strategy.distribuicao_verba ?? {}).map(([k2, v]) => (
                      <span key={k2} className="rounded-full border border-border px-2.5 py-0.5 text-xs">{k2}: {v}%</span>
                    ))}
                  </div>
                </Block>
                <Block title="KPIs">
                  {Object.keys(strategy.kpis ?? {}).length ? (
                    <div className="flex flex-wrap gap-2">
                      {Object.entries(strategy.kpis ?? {}).map(([k2, v]) => (
                        <span key={k2} className="rounded-full border border-primary/30 bg-primary/10 px-2.5 py-0.5 text-xs text-primary">{k2} {v}</span>
                      ))}
                    </div>
                  ) : null}
                </Block>
                <Block title="Hipóteses e plano de testes">
                  <BulletList items={strategy.hipoteses} />
                  {strategy.plano_testes && <p className="mt-2">{strategy.plano_testes}</p>}
                </Block>
                <Block title="Cronograma" regen={junk("cronograma")}>{strategy.cronograma}</Block>
                <Block title="Recomendações">
                  <BulletList items={strategy.recomendacoes} />
                </Block>
              </div>
            )}
            </SectionErrorBoundary>
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
            <SectionErrorBoundary resetKey={`${data.copy?.id}:${data.copy?.version}`} onRegenerate={canEdit ? regenCopy : undefined} regenerating={busy === "copy"} regenerateLabel="Gerar variação" regeneratingLabel="Gerando...">
            {!copy ? (
              <p className="text-sm text-muted-foreground">Nenhuma copy gerada ainda.</p>
            ) : (
              <div className="space-y-5 text-sm">
                <Block title="Headline principal">{copy.headline}</Block>
                <Block title="Variações de headline">
                  <BulletList items={copy.headline_variacoes} />
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
                  <BulletList items={copy.carrossel} />
                </Block>
                <Block title="Quiz">
                  {asList(copy.quiz).length ? (
                    <ul className="space-y-1">
                      {asList(copy.quiz).map((q, i) => (
                        <li key={i}>{q?.pergunta} <span className="text-muted-foreground">({joinList(q?.opcoes, " · ")})</span></li>
                      ))}
                    </ul>
                  ) : null}
                </Block>
              </div>
            )}
            </SectionErrorBoundary>
          </Section>
        </TabsContent>

        <TabsContent value="criativos">
          <Section title="Criativos da campanha" actions={<Button size="sm" variant="outline" asChild><Link to="/studio">Abrir Creative Studio</Link></Button>}>
            <SectionErrorBoundary resetKey={data.creatives.length} onRegenerate={canEdit ? regenStrategy : undefined} regenerating={busy === "strategy"}>
            {data.creatives.length === 0 ? (
              <div className="flex flex-wrap items-center justify-between gap-3">
                <p className="text-sm text-muted-foreground">Nenhum criativo desta campanha ainda. Crie no Creative Studio.</p>
                {canEdit && (
                  <Button size="sm" asChild>
                    <Link to="/studio">Criar criativo</Link>
                  </Button>
                )}
              </div>
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
                      {canEdit && cr.status !== "approved" && !ended && (
                        <div className="pt-1">
                          <Button size="sm" variant="outline" disabled={busy === `approve-${cr.id}`} onClick={() => void approveCreative(cr.id)}>
                            {busy === `approve-${cr.id}` ? "Aprovando..." : "Aprovar"}
                          </Button>
                        </div>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
            </SectionErrorBoundary>
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
          {workspaceId && c.brand_id && (
            <Section title="Estilo das artes (opcional)">
              <StyleRefsPanel workspaceId={workspaceId} brandId={c.brand_id} campaignId={id} canEdit={canEdit} started={c.status !== "draft"} />
            </Section>
          )}
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
              <Item label="Formatos" value={joinList((Array.isArray(c.formats) ? c.formats : []).map((f) => FORMATS[f] ?? f))} />
              <Item label="Público" value={c.audience && typeof c.audience === "object" ? Object.entries(c.audience as Record<string, string>).map(([a, b]) => `${a}: ${b}`).join(" · ") || "-" : "-"} />
            </dl>
          </Section>
        </TabsContent>
      </Tabs>
    </>
  );
}

/** Campo vazio (texto em branco, lista vazia, null) aparece como "—" em vez de quebrar ou sumir sem aviso. */
const isEmptyNode = (n: React.ReactNode): boolean =>
  n == null || n === false || (typeof n === "string" && !n.trim()) || (Array.isArray(n) && n.every(isEmptyNode));

/** Nomes dos canais nos textos do encerramento (com artigo/preposição). */
const CHANNEL_NAME: Record<string, string> = { meta: "a Meta", google: "o Google Ads", tiktok: "o TikTok Ads" };
const CHANNEL_IN: Record<string, string> = { meta: "na Meta", google: "no Google Ads", tiktok: "no TikTok Ads" };
const CHANNEL_PLACE: Record<string, string> = { meta: "no Gerenciador de Anúncios da Meta", google: "no Google Ads", tiktok: "no TikTok Ads Manager" };
/** "a", "a e b", "a, b e c". */
const joinPt = (items: string[]) => (items.length <= 1 ? (items[0] ?? "") : `${items.slice(0, -1).join(", ")} e ${items[items.length - 1]}`);

/** Faixa da campanha encerrada com pendência: canal que não confirmou a pausa ou post do Instagram ainda na fila; o final muda pelo papel. */
function endedBannerText(active: string[], igPending: number, role: "manage" | "edit" | "read"): string {
  if (active.length) {
    const many = active.length > 1;
    const head = `Campanha encerrada, mas ${joinPt(active.map((ch) => CHANNEL_NAME[ch]!))} ainda não ${many ? "confirmaram" : "confirmou"} a pausa e os anúncios podem continuar gastando.`;
    const place = joinPt(active.map((ch) => CHANNEL_PLACE[ch]!));
    if (role === "manage") return `${head} Clique em Pausar os canais de novo ou pause direto ${place}.`;
    if (role === "edit") return `${head} Use o botão Pausar ${many ? "desses canais" : "desse canal"} ou pause direto ${place}.`;
    return `${head} Avise o dono ou um admin da empresa.`;
  }
  const head =
    igPending === 1
      ? "Campanha encerrada, mas 1 post agendado do Instagram desta campanha ainda vai ser publicado."
      : `Campanha encerrada, mas ${igPending} posts agendados do Instagram desta campanha ainda vão ser publicados.`;
  if (role === "manage") return `${head} Clique em Cancelar os posts agendados para ${igPending === 1 ? "tirá-lo" : "tirá-los"} da fila.`;
  return `${head} Avise o dono ou um admin da empresa.`;
}

function Block({ title, children, regen = false }: { title: string; children: React.ReactNode; regen?: boolean }) {
  const empty = isEmptyNode(children);
  return (
    <div>
      <p className="text-xs font-semibold uppercase tracking-wider text-primary">{title}</p>
      {/* pre-line: campo que a IA mandou como objeto/lista chega em linhas ("Chave: valor"). */}
      <div className="mt-1 whitespace-pre-line text-muted-foreground">
        {empty ? (regen ? <>— <span className="text-xs">Gere de novo para ver este campo.</span></> : "—") : children}
      </div>
    </div>
  );
}

/** Lista de textos da IA: aceita qualquer valor (não-array vira vazio) e mostra "—" quando vazia. */
function BulletList({ items }: { items: unknown }) {
  const list = asList(items as unknown[]).filter((x) => typeof x === "string" && x.trim()) as string[];
  if (!list.length) return <>—</>;
  return <ul className="list-disc pl-5">{list.map((x, i) => <li key={i}>{x}</li>)}</ul>;
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
