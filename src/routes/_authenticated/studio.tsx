import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { Sparkles } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useWorkspace, logActivity } from "@/lib/workspace";
import { PageHeader, Section, StatusPill, SandboxBadge } from "@/components/ui-bits";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { CREATIVE_STATUS, FORMATS } from "@/lib/labels";
import { brl } from "@/lib/format";
import { Link } from "@tanstack/react-router";
import { TARGET_FORMATS, TARGET_FORMAT_KEYS, aspectFor, type TargetFormat } from "@/lib/media/formats";
import type { CreativeType } from "@/lib/providers/creative-provider";
import type { FullStrategy } from "@/lib/ai/strategy-types";
import type { CopyContent } from "@/lib/ai/agents";
import { useServerFn } from "@tanstack/react-start";
import { capcutPackage, generateCreative, newCreativeVersion, previewVisualPrompt, retryCreativeJob } from "@/lib/creative.functions";
import { aiKeysHealth } from "@/lib/ai-keys.functions";
import { LayoutSelect, VariationsGrid } from "@/components/creative/art-direction-panel";
import type { TextLayout, Variation } from "@/lib/creative/visual-style";

export const Route = createFileRoute("/_authenticated/studio")({
  head: () => ({
    meta: [
      { title: "Creative Studio · Meu Funil" },
      { name: "description", content: "Gere criativos por formato com prompt automático a partir do Brand Brain." },
      { property: "og:title", content: "Creative Studio · Meu Funil" },
      { property: "og:description", content: "Imagens, vídeos, carrosséis e UGC em um só lugar." },
    ],
  }),
  component: Studio,
});

function Studio() {
  const { workspaceId, canEdit } = useWorkspace();
  const qc = useQueryClient();
  const runGenerate = useServerFn(generateCreative);
  const runRetry = useServerFn(retryCreativeJob);
  const runPreview = useServerFn(previewVisualPrompt);
  const runNewVersion = useServerFn(newCreativeVersion);
  const checkKeys = useServerFn(aiKeysHealth);
  const { data: keyHealth } = useQuery({
    queryKey: ["ai-keys-health", workspaceId],
    enabled: !!workspaceId,
    staleTime: 10 * 60e3,
    queryFn: () => checkKeys({ data: { workspaceId: workspaceId! } }),
  });
  const [art, setArt] = useState<{ ad: Record<string, unknown> | null; prompt: string }>({ ad: null, prompt: "" });
  const [layout, setLayout] = useState<TextLayout>("limpo");
  const [overlay, setOverlay] = useState({ headline: "", price: "", cta: "" });
  const [variationCount, setVariationCount] = useState(3);
  const [lastVariations, setLastVariations] = useState<Variation[]>([]);
  const [adjust, setAdjust] = useState("");
  const [angle, setAngle] = useState("");
  const [videoOpts, setVideoOpts] = useState({ useBrandImage: true, coverWithLogo: false });

  
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState({
    title: "",
    type: "static_image" as CreativeType,
    aspect: "1:1",
    target: "ig_feed_square" as TargetFormat,
    prompt: "",
    copyText: "",
    campaignId: "",
    provider: "auto" as "auto" | "higgsfield" | "chatgpt" | "gemini",
  });

  const { data } = useQuery({
    queryKey: ["studio", workspaceId],
    enabled: !!workspaceId,
    queryFn: async () => {
      const [creatives, campaigns, brands, integrations, jobs] = await Promise.all([
        supabase.from("creatives").select("*, campaigns(name)").eq("workspace_id", workspaceId!).order("created_at", { ascending: false }),
        supabase.from("campaigns").select("id, name, brand_id").eq("workspace_id", workspaceId!),
        supabase.from("brands").select("*").eq("workspace_id", workspaceId!),
        supabase.from("integration_connections").select("*").eq("workspace_id", workspaceId!),
        supabase
          .from("creative_generation_jobs")
          .select("*")
          .eq("workspace_id", workspaceId!)
          .order("created_at", { ascending: false })
          .limit(12),
      ]);
      return {
        creatives: creatives.data ?? [],
        campaigns: campaigns.data ?? [],
        brands: brands.data ?? [],
        integrations: integrations.data ?? [],
        jobs: jobs.data ?? [],
      };
    },
  });

  const selectedCampaignId = form.campaignId || data?.campaigns[0]?.id || "";
  // Estratégia e copy da campanha: o designer segue o ângulo escolhido e usa a copy aprovada (4.3).
  const { data: campaignBrief } = useQuery({
    queryKey: ["studio-brief", selectedCampaignId],
    enabled: !!selectedCampaignId,
    queryFn: async () => {
      const [strategies, copies] = await Promise.all([
        supabase
          .from("campaign_strategies")
          .select("content, status, version")
          .eq("campaign_id", selectedCampaignId)
          .order("version", { ascending: false })
          .limit(10),
        supabase
          .from("copies")
          .select("content, status, version")
          .eq("campaign_id", selectedCampaignId)
          .order("version", { ascending: false })
          .limit(10),
      ]);
      const sRows = strategies.data ?? [];
      const cRows = copies.data ?? [];
      const strategy = (sRows.find((r) => r.status === "approved") ?? sRows[0])?.content as unknown as FullStrategy | undefined;
      const copy = (cRows.find((r) => r.status === "approved") ?? cRows[0])?.content as unknown as CopyContent | undefined;
      return { strategy: strategy ?? null, copy: copy ?? null };
    },
  });
  const angles = campaignBrief?.strategy?.angulos_detalhados ?? [];

  const applyCampaignCopy = () => {
    const c = campaignBrief?.copy;
    if (!c) return;
    const chosen = angles.find((a) => a.nome === angle);
    setOverlay({ headline: (chosen?.gancho || c.headline || "").slice(0, 120), price: overlay.price, cta: (c.cta || "").slice(0, 40) });
    setForm((f) => ({ ...f, copyText: chosen?.gancho || c.headline || f.copyText }));
    if (layout === "limpo") setLayout("titulo_topo");
    toast.success("Título e chamada preenchidos com a copy da campanha.");
  };

  const payload = () => {
    const campaign = data!.campaigns.find((c) => c.id === form.campaignId) ?? data!.campaigns[0];
    return {
      workspaceId: workspaceId!,
      campaignId: campaign?.id ?? null,
      brandId: campaign?.brand_id ?? data!.brands[0]?.id ?? null,
      title: form.title,
      type: form.type,
      aspectRatio: aspectFor(form.target),
      targetFormat: form.target,
      prompt: form.prompt,
      copyText: form.copyText,
      provider: form.provider,
      layout,
      variations: variationCount,
      headline: overlay.headline || null,
      price: overlay.price || null,
      cta: overlay.cta || null,
      angle: angle || null,
      useBrandImage: videoOpts.useBrandImage,
      coverWithLogo: videoOpts.coverWithLogo,
    };
  };

  const preview = async () => {
    if (!workspaceId || !data) return;
    setBusy(true);
    try {
      const r = await runPreview({ data: payload() });
      setArt({ ad: r.artDirection as Record<string, unknown>, prompt: r.artDirection.prompt_final });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Não foi possível montar o prompt visual.");
    } finally {
      setBusy(false);
    }
  };

  const generate = async (adjustText?: string) => {
    if (!workspaceId || !data) return;
    setBusy(true);
    try {
      const res = await runGenerate({
        data: {
          ...payload(),
          visualPrompt: art.prompt || null,
          artDirection: art.ad,
          adjust: adjustText || null,
        },
      });
      qc.invalidateQueries({ queryKey: ["studio", workspaceId] });
      if (res.artDirection) setArt({ ad: res.artDirection as Record<string, unknown>, prompt: String((res.artDirection as any).prompt_final ?? "") });
      setLastVariations((res.variations ?? []) as Variation[]);
      if (res.status === "failed") {
        toast.error(res.error ?? "Não foi possível gerar este criativo. Tente novamente.");
        return;
      }
      if (res.status === "generating") {
        toast.success("A IA ainda está gerando. O criativo aparece na Biblioteca assim que ficar pronto.");
        return;
      }
      await logActivity(workspaceId, "creative.generated", "creative", {
        creative_id: res.creativeId,
        provider: res.provider,
      });
      toast.success(
        res.sandbox ? "Criativo gerado no modo simulado." : `Criativo gerado com ${PROVIDER_LABEL[res.provider] ?? res.provider}.`,
      );
    } catch {
      toast.error("Não foi possível gerar este criativo. Tente novamente.");
    } finally {
      setBusy(false);
    }
  };

  const retry = async (jobId: string) => {
    setBusy(true);
    try {
      const res = await runRetry({ data: { jobId } });
      qc.invalidateQueries({ queryKey: ["studio", workspaceId] });
      if (res.status === "failed") toast.error(res.error ?? "A nova tentativa falhou.");
      else toast.success("Criativo gerado na nova tentativa.");
    } catch {
      toast.error("Não foi possível tentar novamente agora.");
    } finally {
      setBusy(false);
    }
  };

  const setStatus = async (id: string, status: string) => {
    await supabase.from("creatives").update({ status }).eq("id", id);
    if (workspaceId) await logActivity(workspaceId, `creative.${status}`, "creative", { creative_id: id });
    qc.invalidateQueries({ queryKey: ["studio", workspaceId] });
  };

  const newVersion = async (id: string) => {
    if (!workspaceId || !data) return;
    setBusy(true);
    try {
      const res = await runNewVersion({ data: { creativeId: id } });
      qc.invalidateQueries({ queryKey: ["studio", workspaceId] });
      if (res.status === "failed") toast.error(res.error ?? "Não foi possível gerar a nova versão.");
      else if (res.status === "generating") toast.success("A IA está gerando a nova versão. Ela aparece aqui quando ficar pronta.");
      else toast.success("Nova versão gerada.");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Não foi possível gerar a nova versão.");
    } finally {
      setBusy(false);
    }
  };

  if (!data) return <div className="panel h-64 animate-pulse" />;

  const isVideo = ["video", "ugc", "reels", "story"].includes(form.type);
  const totalCost = data.creatives.reduce((s, c) => s + Number(c.real_cost ?? 0), 0);

  return (
    <>
      <PageHeader
        title="Creative Studio"
        subtitle="Gere imagens, vídeos, carrosséis, stories, quizzes e UGC usando o contexto da marca."
        actions={<SandboxBadge label={`Custo acumulado ${brl(totalCost)}`} />}
      />

      {!!keyHealth?.outOfCredit.length && (
        <div className="mb-6 rounded-lg border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm">
          <strong>
            {keyHealth.outOfCredit.map((k) => (k.vendor === "openai" ? "ChatGPT" : "Gemini")).join(" e ")} sem crédito.
          </strong>{" "}
          No modo Automático o Studio passa para o próximo provedor disponível.{" "}
          <Link to="/integrations" className="font-medium underline">
            Ver Integrações
          </Link>
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-[380px_1fr]">
        <Section title="Novo criativo">
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="t">Título</Label>
              <Input id="t" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="camp">Campanha</Label>
              <select
                id="camp"
                className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
                value={form.campaignId}
                onChange={(e) => setForm({ ...form, campaignId: e.target.value })}
              >
                {data.campaigns.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </div>
            {angles.length > 0 && (
              <div className="space-y-1.5">
                <Label htmlFor="ang">Ângulo da estratégia</Label>
                <select
                  id="ang"
                  className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
                  value={angle}
                  onChange={(e) => setAngle(e.target.value)}
                >
                  <option value="">Big idea geral</option>
                  {angles.map((a) => (
                    <option key={a.nome} value={a.nome}>
                      {a.nome} — {a.formato_sugerido}
                    </option>
                  ))}
                </select>
                <p className="text-xs text-muted-foreground">
                  O diretor de arte segue este ângulo e o criativo fica marcado com ele para comparar resultados.
                </p>
              </div>
            )}
            {campaignBrief?.copy && (
              <Button size="sm" variant="outline" className="w-full" onClick={applyCampaignCopy}>
                Usar a copy da campanha no título e na chamada
              </Button>
            )}
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="ty">Formato</Label>
                <select
                  id="ty"
                  className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
                  value={form.type}
                  onChange={(e) => setForm({ ...form, type: e.target.value as CreativeType })}
                >
                  {Object.entries(FORMATS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                </select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="ar">Formato de destino</Label>
                <select
                  id="ar"
                  className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
                  value={form.target}
                  onChange={(e) => setForm({ ...form, target: e.target.value as TargetFormat })}
                >
                  {TARGET_FORMAT_KEYS.map((k) => (
                    <option key={k} value={k}>
                      {TARGET_FORMATS[k].label} ({TARGET_FORMATS[k].width}x{TARGET_FORMATS[k].height})
                    </option>
                  ))}
                </select>
              </div>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="ai">Qual IA usar</Label>
              <select
                id="ai"
                className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
                value={form.provider}
                onChange={(e) => setForm({ ...form, provider: e.target.value as typeof form.provider })}
              >
                <option value="auto">Automático (Higgsfield se conectado)</option>
                <option value="chatgpt" disabled={isVideo}>ChatGPT — imagens{isVideo ? " (não gera vídeo)" : ""}</option>
                <option value="gemini">Gemini — imagens e vídeos</option>
                <option value="higgsfield">Higgsfield — imagens e vídeos</option>
              </select>
              {form.provider === "gemini" && isVideo && (
                <p className="text-xs text-muted-foreground">Vídeos levam de 1 a 3 minutos para ficar prontos.</p>
              )}
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="pr">Prompt</Label>
              <Textarea id="pr" rows={3} value={form.prompt} onChange={(e) => setForm({ ...form, prompt: e.target.value })} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="ct">Texto sobre o criativo</Label>
              <Textarea id="ct" rows={2} value={form.copyText} onChange={(e) => setForm({ ...form, copyText: e.target.value })} />
            </div>
            {isVideo && (
              <div className="space-y-2 rounded-md border border-border/60 p-3 text-sm">
                <label className="flex items-center gap-2">
                  <input type="checkbox" checked={videoOpts.useBrandImage} onChange={(e) => setVideoOpts({ ...videoOpts, useBrandImage: e.target.checked })} />
                  Começar o vídeo pela foto do produto da marca (imagem → vídeo)
                </label>
                <label className="flex items-center gap-2">
                  <input type="checkbox" checked={videoOpts.coverWithLogo} onChange={(e) => setVideoOpts({ ...videoOpts, coverWithLogo: e.target.checked })} />
                  Gerar capa com logo, título e chamada (custa 1 imagem a mais)
                </label>
                <p className="text-xs text-muted-foreground">
                  As legendas (.srt e .vtt) saem do texto sobre o criativo. O vídeo é gerado em segundo plano: pode fechar a tela.
                </p>
                <div className="grid gap-2">
                  <Input placeholder="Título da capa (curto)" maxLength={120} value={overlay.headline} onChange={(e) => setOverlay({ ...overlay, headline: e.target.value })} />
                  <Input placeholder="Chamada da capa (ex.: Peça já)" maxLength={40} value={overlay.cta} onChange={(e) => setOverlay({ ...overlay, cta: e.target.value })} />
                </div>
              </div>
            )}
            {!isVideo && (
              <>
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <Label>Texto sobre a imagem</Label>
                    <LayoutSelect value={layout} onChange={setLayout} />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="vc">Variações</Label>
                    <select id="vc" className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm" value={variationCount} onChange={(e) => setVariationCount(Number(e.target.value))}>
                      {[1, 2, 3, 4].map((n) => <option key={n} value={n}>{n}</option>)}
                    </select>
                  </div>
                </div>
                {layout !== "limpo" && (
                  <div className="grid gap-2">
                    <Input placeholder="Título (curto)" maxLength={120} value={overlay.headline} onChange={(e) => setOverlay({ ...overlay, headline: e.target.value })} />
                    {layout === "preco_destaque" && <Input placeholder="Preço (ex.: R$ 9,90)" maxLength={40} value={overlay.price} onChange={(e) => setOverlay({ ...overlay, price: e.target.value })} />}
                    {layout === "cta_rodape" && <Input placeholder="Chamada (ex.: Peça já)" maxLength={40} value={overlay.cta} onChange={(e) => setOverlay({ ...overlay, cta: e.target.value })} />}
                  </div>
                )}
              </>
            )}
            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <Label htmlFor="vp">Prompt visual</Label>
                <Button size="sm" variant="ghost" onClick={preview} disabled={busy}>Montar com diretor de arte</Button>
              </div>
              <Textarea id="vp" rows={5} value={art.prompt} onChange={(e) => setArt({ ...art, prompt: e.target.value })} placeholder="Opcional: veja e edite o prompt antes de gerar. Se vazio, é montado na hora." />
            </div>
            {canEdit && (
              <Button className="w-full" onClick={() => generate()} disabled={busy}>
                <Sparkles className="mr-2 size-4" />
                {busy ? "Gerando (pode levar 1–2 min)..." : "Gerar com IA"}
              </Button>
            )}
          </div>
        </Section>

        <div className="space-y-6">
        {lastVariations.length > 0 && (
          <Section title="Variações da última geração" description="A de maior nota (troféu) virou o criativo final; todas ficam na Biblioteca.">
            <div className="space-y-3">
              <VariationsGrid variations={lastVariations} />
              {canEdit && (
                <div className="flex gap-2">
                  <Input value={adjust} onChange={(e) => setAdjust(e.target.value)} maxLength={300} placeholder='Ex.: "mais close no copo", "fundo mais escuro"' />
                  <Button disabled={busy || !adjust.trim()} onClick={() => generate(adjust.trim())}>Regenerar com ajuste</Button>
                </div>
              )}
            </div>
          </Section>
        )}
        <Section title="Gerações recentes" description="Acompanhe o processamento de cada solicitação.">
          {data.jobs.length === 0 ? (
            <p className="text-sm text-muted-foreground">Nenhuma geração solicitada ainda.</p>
          ) : (
            <div className="space-y-2 text-sm">
              {data.jobs.map((j) => (
                <div key={j.id} className="rounded-lg border border-border/60 px-4 py-2.5">
                  <div className="flex items-center justify-between gap-3">
                    <span className="truncate">{j.final_prompt ?? j.prompt ?? "Criativo"}</span>
                    <div className="flex shrink-0 items-center gap-2">
                      <span className="text-xs text-muted-foreground">
                        {PROVIDER_LABEL[j.provider] ?? "Simulado"}
                      </span>
                      <StatusPill
                        status={j.status === "ready" ? "approved" : j.status === "failed" ? "failed" : "pending"}
                        label={JOB_STATUS[j.status] ?? j.status}
                      />
                      {j.status === "failed" && canEdit && (
                        <Button size="sm" variant="outline" disabled={busy} onClick={() => retry(j.id)}>
                          Tentar novamente
                        </Button>
                      )}
                    </div>
                  </div>
                  {j.error_message && (
                    <p className="mt-1 text-xs text-destructive">{j.error_message}</p>
                  )}
                  {(j as { provider_log?: string | null }).provider_log && (
                    <p className="mt-1 whitespace-pre-line text-xs text-muted-foreground">
                      {(j as { provider_log?: string | null }).provider_log}
                    </p>
                  )}
                </div>
              ))}
            </div>
          )}
        </Section>

        <Section
          title={`Biblioteca de criativos (${data.creatives.length})`}
          description="Baixe, exporte em PDF e reaproveite as mídias na Biblioteca."
          actions={
            <Button asChild size="sm" variant="outline">
              <Link to="/library">Abrir Biblioteca</Link>
            </Button>
          }
        >
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {data.creatives.map((c) => (
              <div key={c.id} className="overflow-hidden rounded-lg border border-border bg-surface/50">
                {c.preview_url && /\.mp4(\?|$)/.test(c.preview_url) ? (
                  <video src={c.preview_url} controls className="aspect-square w-full bg-muted object-cover" />
                ) : (
                  c.preview_url ? (
                    <img src={c.preview_url} alt={c.title} className="aspect-square w-full object-cover" />
                  ) : (
                    <div className="flex aspect-square w-full items-center justify-center bg-muted text-xs text-muted-foreground">
                      Sem prévia
                    </div>
                  )
                )}
                <div className="space-y-2 p-3">
                  <p className="text-sm font-medium">{c.title}</p>
                  <p className="text-xs text-muted-foreground">
                    {FORMATS[c.type] ?? c.type} · v{c.version} · {c.campaigns?.name ?? "sem campanha"}
                    {(c as { angle?: string | null }).angle ? ` · ângulo: ${(c as { angle?: string | null }).angle}` : ""}
                  </p>
                  <div className="flex items-center justify-between">
                    <StatusPill status={c.status} label={CREATIVE_STATUS[c.status] ?? c.status} />
                    <span className="text-xs text-muted-foreground">{brl(c.real_cost)}</span>
                  </div>
                  <CreativeExtras extras={(c as { extras?: unknown }).extras} creativeId={c.id} isVideo={!!c.preview_url && /\.mp4(\?|$)/.test(c.preview_url)} />
                  {canEdit && (
                    <div className="flex flex-wrap gap-1.5 pt-1">
                      <Button size="sm" variant="outline" onClick={() => setStatus(c.id, "approved")}>Aprovar</Button>
                      <Button size="sm" variant="ghost" onClick={() => setStatus(c.id, "rejected")}>Rejeitar</Button>
                      <Button size="sm" variant="ghost" disabled={busy} onClick={() => newVersion(c.id)}>Nova versão</Button>
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        </Section>
        </div>
      </div>
    </>
  );
}

const JOB_STATUS: Record<string, string> = {
  draft: "Rascunho",
  queued: "Na fila",
  generating: "Gerando",
  ready: "Pronto",
  failed: "Falhou",
  approved: "Aprovado",
  rejected: "Rejeitado",
  published: "Publicado",
};

const PROVIDER_LABEL: Record<string, string> = {
  higgsfield: "Higgsfield",
  chatgpt: "ChatGPT",
  gemini: "Gemini",
  mock: "Simulado",
};

/** Capa, legendas e pacote para CapCut de um criativo de vídeo. */
function CreativeExtras({ extras, creativeId, isVideo }: { extras: unknown; creativeId: string; isVideo: boolean }) {
  const pack = useServerFn(capcutPackage);
  const [busy, setBusy] = useState(false);
  const e = (extras ?? {}) as { cover_url?: string; captions_vtt?: string; captions_srt?: string; errors?: string[] };
  if (!isVideo) return null;
  return (
    <div className="flex flex-wrap items-center gap-2 text-xs">
      {e.cover_url && <a className="text-primary underline" href={e.cover_url} target="_blank" rel="noopener noreferrer">Capa</a>}
      {e.captions_srt && <a className="text-primary underline" href={e.captions_srt} target="_blank" rel="noopener noreferrer">Legendas .srt</a>}
      {e.captions_vtt && <a className="text-primary underline" href={e.captions_vtt} target="_blank" rel="noopener noreferrer">Legendas .vtt</a>}
      <button
        type="button"
        className="text-primary underline disabled:opacity-50"
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          try {
            const r = await pack({ data: { creativeId } });
            window.open(r.url, "_blank");
          } catch (err) {
            toast.error(err instanceof Error ? err.message : "Não foi possível montar o pacote.");
          } finally {
            setBusy(false);
          }
        }}
      >
        {busy ? "Montando…" : "Pacote para CapCut (.zip)"}
      </button>
      {!!e.errors?.length && <span className="text-destructive">{e.errors.join(" · ")}</span>}
    </div>
  );
}
