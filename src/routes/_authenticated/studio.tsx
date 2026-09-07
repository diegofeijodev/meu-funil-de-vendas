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
import {
  creativeProviders,
  resolveCreativeProvider,
  type CreativeType,
} from "@/lib/providers/creative-provider";
import { isMcpConnected } from "@/lib/mcp-client";
import { mcpRun } from "@/lib/mcp.functions";
import { useServerFn } from "@tanstack/react-start";

export const Route = createFileRoute("/_authenticated/studio")({
  head: () => ({
    meta: [
      { title: "Creative Studio · AI Marketing OS" },
      { name: "description", content: "Gere criativos por formato com prompt automático a partir do Brand Brain." },
      { property: "og:title", content: "Creative Studio · AI Marketing OS" },
      { property: "og:description", content: "Imagens, vídeos, carrosséis e UGC em um só lugar." },
    ],
  }),
  component: Studio,
});

function Studio() {
  const { workspaceId, canEdit } = useWorkspace();
  const qc = useQueryClient();
  const runMcp = useServerFn(mcpRun);
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState({
    title: "",
    type: "static_image" as CreativeType,
    aspect: "1:1",
    prompt: "",
    copyText: "",
    campaignId: "",
    providerId: "mock",
  });

  const { data } = useQuery({
    queryKey: ["studio", workspaceId],
    enabled: !!workspaceId,
    queryFn: async () => {
      const [creatives, campaigns, brands, integrations] = await Promise.all([
        supabase.from("creatives").select("*, campaigns(name)").eq("workspace_id", workspaceId!).order("created_at", { ascending: false }),
        supabase.from("campaigns").select("id, name, brand_id").eq("workspace_id", workspaceId!),
        supabase.from("brands").select("*").eq("workspace_id", workspaceId!),
        supabase.from("integration_connections").select("*").eq("workspace_id", workspaceId!),
      ]);
      return {
        creatives: creatives.data ?? [],
        campaigns: campaigns.data ?? [],
        brands: brands.data ?? [],
        integrations: integrations.data ?? [],
      };
    },
  });

  const generate = async () => {
    if (!workspaceId || !data) return;
    setBusy(true);
    try {
      const campaign = data.campaigns.find((c) => c.id === form.campaignId) ?? data.campaigns[0];
      const brand = data.brands.find((b) => b.id === campaign?.brand_id) ?? data.brands[0];
      const brandContext = brand
        ? `${brand.name} · ${brand.segment ?? ""} · cores ${brand.primary_color}/${brand.secondary_color} · tom ${brand.tone_of_voice ?? ""}`
        : "";

      let provider = resolveCreativeProvider(form.providerId);
      let result: Awaited<ReturnType<typeof provider.generate>>;

      const useMcp = await isMcpConnected(workspaceId, "higgsfield");
      if (useMcp) {
        const run = await runMcp({
          data: {
            workspaceId,
            provider: "higgsfield",
            intent: form.type === "video" || form.type === "ugc" ? "generate_video" : "generate_image",
            input: {
              prompt: `${form.prompt || form.title}${brandContext ? ` — ${brandContext}` : ""}`,
              aspect_ratio: form.aspect,
            },
          },
        });
        if (!run.url) throw new Error("A ferramenta MCP não devolveu uma mídia utilizável.");
        provider = { ...provider, id: "higgsfield", label: "Higgsfield (MCP)" };
        result = {
          previewUrl: run.url,
          provider: "higgsfield",
          estimatedCost: 0,
          realCost: 0,
          status: "ready",
        };
      } else {
        if (provider.id !== form.providerId) {
          toast.info("Provedor selecionado não está conectado — usando o gerador simulado.");
        }
        result = await provider.generate({
          prompt: form.prompt || form.title,
          type: form.type,
          aspectRatio: form.aspect,
          brandContext,
        });
      }

      const { data: created, error } = await supabase
        .from("creatives")
        .insert({
          workspace_id: workspaceId,
          campaign_id: campaign?.id ?? null,
          brand_id: brand?.id ?? null,
          title: form.title || "Criativo sem título",
          type: form.type,
          prompt: form.prompt,
          aspect_ratio: form.aspect,
          copy_text: form.copyText,
          status: result.status,
          provider: result.provider,
          estimated_cost: result.estimatedCost,
          real_cost: result.realCost,
          preview_url: result.previewUrl,
          version: 1,
        })
        .select()
        .single();
      if (error) throw error;
      await supabase.from("creative_versions").insert({
        workspace_id: workspaceId,
        creative_id: created.id,
        version: 1,
        prompt: form.prompt,
        preview_url: result.previewUrl,
      });
      await logActivity(workspaceId, "creative.generated", "creative", { creative_id: created.id, provider: provider.id });
      qc.invalidateQueries({ queryKey: ["studio", workspaceId] });
      toast.success(`Criativo gerado (${provider.label}) — custo estimado ${brl(result.estimatedCost)}.`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Falha ao gerar criativo");
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
              <Label htmlFor="pr">Prompt</Label>
              <Textarea id="pr" rows={3} value={form.prompt} onChange={(e) => setForm({ ...form, prompt: e.target.value })} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="ct">Texto sobre o criativo</Label>
              <Textarea id="ct" rows={2} value={form.copyText} onChange={(e) => setForm({ ...form, copyText: e.target.value })} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="pv">Provedor</Label>
              <select
                id="pv"
                className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
                value={form.providerId}
                onChange={(e) => setForm({ ...form, providerId: e.target.value })}
              >
                {creativeProviders.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.label}{p.isConnected() ? "" : " — desconectado"}
                  </option>
                ))}
              </select>
            </div>
            {canEdit && (
              <Button className="w-full" onClick={generate} disabled={busy}>
                <Sparkles className="mr-2 size-4" />
                {busy ? "Gerando..." : "Gerar criativo"}
              </Button>
            )}
          </div>
        </Section>

        <Section title={`Biblioteca de criativos (${data.creatives.length})`}>
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {data.creatives.map((c) => (
              <div key={c.id} className="overflow-hidden rounded-lg border border-border bg-surface/50">
                <img
                  src={c.preview_url ?? `https://picsum.photos/seed/${c.id}/600/600`}
                  alt={c.title}
                  className="aspect-square w-full object-cover"
                />
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
    </>
  );
}
