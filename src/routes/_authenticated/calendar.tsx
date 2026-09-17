import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { Plus } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useWorkspace, logActivity } from "@/lib/workspace";
import { PageHeader, Section, StatusPill, SandboxBadge } from "@/components/ui-bits";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { CHANNELS, POST_STATUS } from "@/lib/labels";
import { shortDate } from "@/lib/format";

export const Route = createFileRoute("/_authenticated/calendar")({
  head: () => ({
    meta: [
      { title: "Calendário de conteúdo · Meu Funil" },
      { name: "description", content: "Planeje, aprove e agende posts por canal com criativos vinculados." },
      { property: "og:title", content: "Calendário de conteúdo · Meu Funil" },
      { property: "og:description", content: "Do rascunho ao agendamento, com publicação simulada." },
    ],
  }),
  component: CalendarPage,
});

const FLOW = ["idea", "draft", "approved", "scheduled", "published"];

function CalendarPage() {
  const { workspaceId, canEdit } = useWorkspace();
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ title: "", channel: "instagram_feed", copy: "", when: "", campaignId: "" });

  const { data } = useQuery({
    queryKey: ["calendar", workspaceId],
    enabled: !!workspaceId,
    queryFn: async () => {
      const [posts, campaigns] = await Promise.all([
        supabase.from("social_posts").select("*, campaigns(name)").eq("workspace_id", workspaceId!).order("scheduled_at"),
        supabase.from("campaigns").select("id, name, brand_id").eq("workspace_id", workspaceId!),
      ]);
      return { posts: posts.data ?? [], campaigns: campaigns.data ?? [] };
    },
  });

  const create = async () => {
    if (!workspaceId) return;
    const campaign = data?.campaigns.find((c) => c.id === form.campaignId) ?? data?.campaigns[0];
    const { error } = await supabase.from("social_posts").insert({
      workspace_id: workspaceId,
      campaign_id: campaign?.id ?? null,
      brand_id: campaign?.brand_id ?? null,
      channel: form.channel,
      title: form.title,
      copy_text: form.copy,
      scheduled_at: form.when ? new Date(form.when).toISOString() : null,
      status: "draft",
    });
    if (error) {
      toast.error(error.message);
      return;
    }
    await logActivity(workspaceId, "post.created", "post", { title: form.title });
    setOpen(false);
    setForm({ title: "", channel: "instagram_feed", copy: "", when: "", campaignId: "" });
    qc.invalidateQueries({ queryKey: ["calendar", workspaceId] });
    toast.success("Post adicionado ao calendário.");
  };

  const advance = async (id: string, status: string) => {
    await supabase.from("social_posts").update({ status }).eq("id", id);
    if (status === "published" && workspaceId) {
      await supabase.from("publishing_jobs").insert({
        workspace_id: workspaceId,
        post_id: id,
        target: "instagram",
        status: "done",
        mode: "mock",
        log: "Publicação simulada concluída (sandbox).",
      });
    }
    if (workspaceId) await logActivity(workspaceId, `post.${status}`, "post", { id });
    qc.invalidateQueries({ queryKey: ["calendar", workspaceId] });
    toast.success("Status atualizado.");
  };

  if (!data) return <div className="panel h-64 animate-pulse" />;

  return (
    <>
      <PageHeader
        title="Calendário de conteúdo"
        subtitle="Fluxo Ideia → Rascunho → Aprovado → Agendado → Publicado, por canal."
        actions={
          <>
            <SandboxBadge label="Publicação simulada" />
            {canEdit && (
              <Dialog open={open} onOpenChange={setOpen}>
                <DialogTrigger asChild>
                  <Button><Plus className="mr-2 size-4" /> Novo post</Button>
                </DialogTrigger>
                <DialogContent>
                  <DialogHeader><DialogTitle>Novo post</DialogTitle></DialogHeader>
                  <div className="space-y-4">
                    <div className="space-y-1.5">
                      <Label htmlFor="pt">Título</Label>
                      <Input id="pt" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} />
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="pc">Canal</Label>
                      <select
                        id="pc"
                        className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
                        value={form.channel}
                        onChange={(e) => setForm({ ...form, channel: e.target.value })}
                      >
                        {Object.entries(CHANNELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                      </select>
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="pcamp">Campanha</Label>
                      <select
                        id="pcamp"
                        className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
                        value={form.campaignId}
                        onChange={(e) => setForm({ ...form, campaignId: e.target.value })}
                      >
                        {data.campaigns.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                      </select>
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="pw">Data e hora</Label>
                      <Input id="pw" type="datetime-local" value={form.when} onChange={(e) => setForm({ ...form, when: e.target.value })} />
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="pcopy">Legenda</Label>
                      <Textarea id="pcopy" rows={3} value={form.copy} onChange={(e) => setForm({ ...form, copy: e.target.value })} />
                    </div>
                    <Button className="w-full" onClick={create} disabled={!form.title.trim()}>Adicionar</Button>
                  </div>
                </DialogContent>
              </Dialog>
            )}
          </>
        }
      />

      <div className="grid gap-4 lg:grid-cols-5">
        {FLOW.map((status) => (
          <div key={status} className="panel p-4">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-sm font-semibold">{POST_STATUS[status]}</h2>
              <span className="text-xs text-muted-foreground">
                {data.posts.filter((p) => p.status === status).length}
              </span>
            </div>
            <div className="space-y-3">
              {data.posts.filter((p) => p.status === status).map((p) => (
                <div key={p.id} className="rounded-lg border border-border bg-surface/60 p-3">
                  <p className="text-sm font-medium">{p.title}</p>
                  <p className="mt-1 text-xs text-muted-foreground">{CHANNELS[p.channel] ?? p.channel}</p>
                  {p.scheduled_at && <p className="text-xs text-muted-foreground">{shortDate(p.scheduled_at)}</p>}
                  {p.copy_text && <p className="mt-2 line-clamp-3 text-xs text-muted-foreground">{p.copy_text}</p>}
                  <div className="mt-2 flex items-center justify-between">
                    <StatusPill status={p.status} label={POST_STATUS[p.status] ?? p.status} />
                    {canEdit && FLOW.indexOf(status) < FLOW.length - 1 && (
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => advance(p.id, FLOW[FLOW.indexOf(status) + 1] as string)}
                      >
                        Avançar
                      </Button>
                    )}
                  </div>
                </div>
              ))}
              {data.posts.filter((p) => p.status === status).length === 0 && (
                <p className="text-xs text-muted-foreground">Vazio</p>
              )}
            </div>
          </div>
        ))}
      </div>

      <div className="mt-6">
        <Section title="Agenda cronológica">
          <div className="space-y-2">
            {[...data.posts]
              .filter((p) => p.scheduled_at)
              .sort((a, b) => (a.scheduled_at ?? "").localeCompare(b.scheduled_at ?? ""))
              .map((p) => (
                <div key={p.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border/60 px-4 py-2.5 text-sm">
                  <span className="w-28 text-xs text-muted-foreground">{shortDate(p.scheduled_at)}</span>
                  <span className="flex-1">{p.title}</span>
                  <span className="text-xs text-muted-foreground">{p.campaigns?.name}</span>
                  <StatusPill status={p.status} label={POST_STATUS[p.status] ?? p.status} />
                </div>
              ))}
          </div>
        </Section>
      </div>
    </>
  );
}
