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
import { resolveCreativeProvider, type CreativeType } from "@/lib/providers/creative-provider";
import { useServerFn } from "@tanstack/react-start";
import { generateCreative, retryCreativeJob } from "@/lib/creative.functions";

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

  
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState({
    title: "",
    type: "static_image" as CreativeType,
    aspect: "1:1",
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

  const generate = async () => {
    if (!workspaceId || !data) return;
    setBusy(true);
    try {
      const campaign = data.campaigns.find((c) => c.id === form.campaignId) ?? data.campaigns[0];
      const res = await runGenerate({
        data: {
          workspaceId,
          campaignId: campaign?.id ?? null,
          brandId: campaign?.brand_id ?? data.brands[0]?.id ?? null,
          title: form.title,
          type: form.type,
          aspectRatio: form.aspect,
          prompt: form.prompt,
          copyText: form.copyText,
          provider: form.provider,
        },
      });
      qc.invalidateQueries({ queryKey: ["studio", workspaceId] });
      if (res.status === "failed") {
        toast.error(res.error ?? "Não foi possível gerar este criativo. Tente novamente.");
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
    const cr = data.creatives.find((x) => x.id === id);
    if (!cr) return;
    const provider = resolveCreativeProvider(cr.provider);
    const result = await provider.generate({
      prompt: `${cr.prompt ?? cr.title} (variação ${cr.version + 1})`,
      type: cr.type as CreativeType,
      aspectRatio: cr.aspect_ratio ?? "1:1",
    });
    await supabase.from("creatives").update({
      version: cr.version + 1,
      preview_url: result.previewUrl,
      status: "ready",
      real_cost: Number(cr.real_cost ?? 0) + result.realCost,
    }).eq("id", id);
    await supabase.from("creative_versions").insert({
      workspace_id: workspaceId,
      creative_id: id,
      version: cr.version + 1,
      prompt: cr.prompt,
      preview_url: result.previewUrl,
    });
    qc.invalidateQueries({ queryKey: ["studio", workspaceId] });
    toast.success("Nova versão gerada.");
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
                <Label htmlFor="ar">Proporção</Label>
                <select
                  id="ar"
                  className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
                  value={form.aspect}
                  onChange={(e) => setForm({ ...form, aspect: e.target.value })}
                >
                  {["1:1", "4:5", "9:16", "16:9"].map((a) => <option key={a} value={a}>{a}</option>)}
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
            {canEdit && (
              <Button className="w-full" onClick={generate} disabled={busy}>
                <Sparkles className="mr-2 size-4" />
                {busy ? "Gerando..." : "Gerar com IA"}
              </Button>
            )}
          </div>
        </Section>

        <div className="space-y-6">
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
                    <p className="mt-1 text-xs text-destructive">
                      Não foi possível gerar este criativo. Tente novamente.
                    </p>
                  )}
                </div>
              ))}
            </div>
          )}
        </Section>

        <Section title={`Biblioteca de criativos (${data.creatives.length})`}>
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {data.creatives.map((c) => (
              <div key={c.id} className="overflow-hidden rounded-lg border border-border bg-surface/50">
                {c.preview_url && /\.mp4(\?|$)/.test(c.preview_url) ? (
                  <video src={c.preview_url} controls className="aspect-square w-full bg-muted object-cover" />
                ) : (
                  <img
                    src={c.preview_url ?? `https://picsum.photos/seed/${c.id}/600/600`}
                    alt={c.title}
                    className="aspect-square w-full object-cover"
                  />
                )}
                <div className="space-y-2 p-3">
                  <p className="text-sm font-medium">{c.title}</p>
                  <p className="text-xs text-muted-foreground">
                    {FORMATS[c.type] ?? c.type} · v{c.version} · {c.campaigns?.name ?? "sem campanha"}
                  </p>
                  <div className="flex items-center justify-between">
                    <StatusPill status={c.status} label={CREATIVE_STATUS[c.status] ?? c.status} />
                    <span className="text-xs text-muted-foreground">{brl(c.real_cost)}</span>
                  </div>
                  {canEdit && (
                    <div className="flex flex-wrap gap-1.5 pt-1">
                      <Button size="sm" variant="outline" onClick={() => setStatus(c.id, "approved")}>Aprovar</Button>
                      <Button size="sm" variant="ghost" onClick={() => setStatus(c.id, "rejected")}>Rejeitar</Button>
                      <Button size="sm" variant="ghost" onClick={() => newVersion(c.id)}>Nova versão</Button>
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
