import { useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Loader2, RefreshCw, Upload, X } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import {
  approvePost,
  generatePostAssets,
  publishInstagramPost,
  regenerateCaption,
  rejectPost,
  schedulePost,
  uploadPostMedia,
} from "@/lib/instagram/instagram.functions";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { StatusPill } from "@/components/ui-bits";
import { cn } from "@/lib/utils";
import { FORMATS, STATUS_LABEL, type IgPost } from "./shared";

const toLocal = (iso: string | null) => {
  if (!iso) return "";
  const d = new Date(iso);
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
};

export function PostEditor({ workspaceId, post, onClose }: { workspaceId: string; post: IgPost | null; onClose: () => void }) {
  const qc = useQueryClient();
  const [caption, setCaption] = useState("");
  const [tags, setTags] = useState<string[]>([]);
  const [tag, setTag] = useState("");
  const [cta, setCta] = useState("");
  const [when, setWhen] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const fns = {
    gen: useServerFn(generatePostAssets),
    cap: useServerFn(regenerateCaption),
    approve: useServerFn(approvePost),
    reject: useServerFn(rejectPost),
    schedule: useServerFn(schedulePost),
    publish: useServerFn(publishInstagramPost),
    upload: useServerFn(uploadPostMedia),
  };

  useEffect(() => {
    if (!post) return;
    setCaption(post.caption ?? "");
    setTags(post.hashtags ?? []);
    setCta(post.cta ?? "");
    setWhen(toLocal(post.scheduled_at));
  }, [post?.id, post?.caption, post?.hashtags?.join(","), post?.cta, post?.scheduled_at]);

  if (!post) return <Sheet open={false} onOpenChange={onClose}><SheetContent /></Sheet>;
  const F = FORMATS[post.format] ?? FORMATS["feed_image"]!;
  const media = [...(post.media ?? [])].sort((a, b) => a.order - b.order);
  const refresh = () => qc.invalidateQueries({ queryKey: ["ig-posts", workspaceId] });

  const run = async (label: string, fn: () => Promise<any>, ok: string) => {
    setBusy(label);
    try {
      const r = await fn();
      if (r && r.ok === false) throw new Error(r.error ?? "Falhou.");
      toast.success(typeof ok === "string" ? ok : "Feito.");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Algo deu errado.");
    } finally {
      setBusy(null);
      refresh();
    }
  };

  const save = () =>
    run(
      "save",
      async () => {
        const { error } = await supabase
          .from("ig_posts")
          .update({ caption, hashtags: tags, cta, scheduled_at: when ? new Date(when).toISOString() : null })
          .eq("id", post.id);
        if (error) throw error;
      },
      "Post salvo.",
    );

  const addTag = () => {
    const v = tag.trim().replace(/^#/, "").replace(/\s+/g, "");
    if (v && tags.length < 30 && !tags.includes(v)) setTags([...tags, v]);
    setTag("");
  };

  const upload = (file: File) => {
    const fd = new FormData();
    fd.set("workspaceId", workspaceId);
    fd.set("postId", post.id);
    fd.set("file", file);
    run("upload", () => fns.upload({ data: fd }), "Mídia enviada.");
  };

  const B = ({ id, children, ...p }: { id: string } & React.ComponentProps<typeof Button>) => (
    <Button {...p} disabled={!!busy || p.disabled}>
      {busy === id && <Loader2 className="size-4 animate-spin" />}
      {children}
    </Button>
  );

  return (
    <Sheet open onOpenChange={(o) => !o && onClose()}>
      <SheetContent className="w-full overflow-y-auto sm:max-w-xl">
        <SheetHeader>
          <SheetTitle className="flex flex-wrap items-center gap-2">
            {F.label} <StatusPill status={post.status} label={STATUS_LABEL[post.status] ?? post.status} />
          </SheetTitle>
          {post.theme && <p className="text-sm text-muted-foreground">{post.theme}</p>}
        </SheetHeader>

        <div className="mt-4 space-y-5">
          <div className={cn("mx-auto", F.phone ? "w-56 rounded-[2rem] border-[6px] border-foreground/80 p-1" : "w-full max-w-sm")}>
            <div className={cn("relative overflow-hidden bg-muted", F.aspect, F.phone ? "rounded-[1.5rem]" : "rounded-lg")}>
              {post.status === "generating" ? (
                <div className="flex size-full flex-col items-center justify-center gap-2 text-sm text-muted-foreground">
                  <Loader2 className="size-5 animate-spin" /> Gerando mídia…
                </div>
              ) : media.length ? (
                <div className="flex size-full snap-x snap-mandatory overflow-x-auto">
                  {media.map((m) =>
                    m.type === "video" ? (
                      <video key={m.url} src={m.url} controls playsInline className="size-full shrink-0 snap-center object-cover" />
                    ) : (
                      <img key={m.url} src={m.url} alt="" className="size-full shrink-0 snap-center object-cover" />
                    ),
                  )}
                </div>
              ) : (
                <div className="flex size-full items-center justify-center p-4 text-center text-sm text-muted-foreground">Sem mídia ainda</div>
              )}
            </div>
          </div>
          {media.length > 1 && <p className="text-center text-xs text-muted-foreground">{media.length} itens · deslize para ver</p>}

          <div className="flex flex-wrap justify-center gap-2">
            <B id="gen" variant="outline" size="sm" onClick={() => run("gen", () => fns.gen({ data: { workspaceId, postId: post.id, provider: "auto" } }), "Mídia gerada.")}>
              <RefreshCw className="size-4" /> Regenerar mídia
            </B>
            <B id="upload" variant="outline" size="sm" onClick={() => fileRef.current?.click()}>
              <Upload className="size-4" /> Enviar minha própria
            </B>
            <input ref={fileRef} type="file" accept="image/*,video/mp4" className="hidden" onChange={(e) => e.target.files?.[0] && upload(e.target.files[0])} />
          </div>

          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <Label>Legenda</Label>
              <span className={cn("text-xs", caption.length > 2200 ? "text-destructive" : "text-muted-foreground")}>{caption.length}/2.200</span>
            </div>
            <Textarea rows={7} value={caption} onChange={(e) => setCaption(e.target.value.slice(0, 2200))} />
            <B id="cap" variant="ghost" size="sm" onClick={() => run("cap", () => fns.cap({ data: { workspaceId, postId: post.id, engine: "auto" } }), "Legenda reescrita.")}>
              <RefreshCw className="size-4" /> Reescrever legenda
            </B>
          </div>

          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <Label>Hashtags</Label>
              <span className="text-xs text-muted-foreground">{tags.length}/30</span>
            </div>
            <div className="flex flex-wrap gap-1.5">
              {tags.map((t) => (
                <span key={t} className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-xs">
                  #{t}
                  <button aria-label={`Remover ${t}`} onClick={() => setTags(tags.filter((x) => x !== t))}><X className="size-3" /></button>
                </span>
              ))}
            </div>
            <div className="flex gap-2">
              <Input placeholder="nova hashtag" value={tag} onChange={(e) => setTag(e.target.value)} onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), addTag())} />
              <B
                id="tags"
                variant="outline"
                size="sm"
                onClick={() =>
                  run("tags", () => fns.cap({ data: { workspaceId, postId: post.id, engine: "auto", instructions: "Mantenha a legenda exatamente igual; gere hashtags novas." } }), "Hashtags renovadas.")
                }
              >
                Regenerar hashtags
              </B>
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5"><Label>CTA</Label><Input value={cta} onChange={(e) => setCta(e.target.value)} /></div>
            <div className="space-y-1.5"><Label>Data e hora</Label><Input type="datetime-local" value={when} onChange={(e) => setWhen(e.target.value)} /></div>
          </div>

          <div className="flex flex-wrap gap-2 border-t border-border pt-4">
            <B id="save" variant="outline" onClick={save}>Salvar</B>
            <B id="approve" variant="secondary" onClick={() => run("approve", () => fns.approve({ data: { workspaceId, postId: post.id } }), "Post aprovado.")}>Aprovar</B>
            <B
              id="schedule"
              disabled={!when}
              onClick={() => run("schedule", () => fns.schedule({ data: { workspaceId, postId: post.id, scheduledAt: new Date(when).toISOString() } }), "Post agendado.")}
            >
              Agendar
            </B>
            <B id="publish" onClick={() => run("publish", () => fns.publish({ data: { workspaceId, postId: post.id } }), "Publicado.")}>Publicar agora</B>
            <B
              id="reject"
              variant="ghost"
              onClick={() => {
                const reason = window.prompt("Motivo do cancelamento:");
                if (reason) run("reject", () => fns.reject({ data: { workspaceId, postId: post.id, reason } }), "Post cancelado.");
              }}
            >
              Cancelar post
            </B>
          </div>
          {post.ig_permalink && (
            <a href={post.ig_permalink} target="_blank" rel="noreferrer" className="text-sm text-primary underline">Ver no Instagram</a>
          )}

          <Accordion type="single" collapsible>
            <AccordionItem value="err">
              <AccordionTrigger>Último erro da Meta</AccordionTrigger>
              <AccordionContent>
                <p className={cn("text-sm", post.last_error ? "text-destructive" : "text-muted-foreground")}>{post.last_error ?? "Nenhum erro."}</p>
              </AccordionContent>
            </AccordionItem>
            <AccordionItem value="log">
              <AccordionTrigger>Log de geração</AccordionTrigger>
              <AccordionContent>
                <div className="space-y-1 font-mono text-xs text-muted-foreground">
                  {(post.ai_generation_log ?? []).slice().reverse().map((l: any, i: number) => (
                    <p key={i}>{new Date(l.at).toLocaleString("pt-BR")} · {l.step} · {l.provider ?? l.file ?? ""}</p>
                  ))}
                  {!(post.ai_generation_log ?? []).length && <p>Sem registros.</p>}
                </div>
              </AccordionContent>
            </AccordionItem>
          </Accordion>
        </div>
      </SheetContent>
    </Sheet>
  );
}
