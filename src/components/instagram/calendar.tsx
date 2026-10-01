import { useCallback, useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Bot, ChevronLeft, ChevronRight, Loader2, Plus, Sparkles } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { generatePostAssets, schedulePost } from "@/lib/instagram/instagram.functions";
import { Section, StatusPill, EmptyState } from "@/components/ui-bits";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { FORMATS, STATUS_LABEL, MediaThumb, type IgPost } from "./shared";
import { IgAutoCalendar } from "./auto-calendar";
import { useWorkspace } from "@/lib/workspace";

const DAY = 86400e3;
const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
const key = (d: Date) => `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;

export function IgCalendar({
  workspaceId,
  posts,
  onOpen,
}: {
  workspaceId: string;
  posts: IgPost[];
  onOpen: (id: string) => void;
}) {
  const qc = useQueryClient();
  const { canEdit } = useWorkspace();
  const [autoDay, setAutoDay] = useState<string | null>(null);
  const [view, setView] = useState<"week" | "month">("week");
  const [anchor, setAnchor] = useState(() => startOfDay(new Date()));
  const [fmt, setFmt] = useState("all");
  const [st, setSt] = useState("all");
  const [batch, setBatch] = useState<{
    done: number;
    total: number;
    current?: string | undefined;
  } | null>(null);
  const gen = useServerFn(generatePostAssets);
  const sched = useServerFn(schedulePost);

  const days = useMemo(() => {
    if (view === "week") {
      const s = new Date(anchor.getTime() - ((anchor.getDay() + 6) % 7) * DAY);
      return Array.from({ length: 7 }, (_, i) => new Date(s.getTime() + i * DAY));
    }
    const first = new Date(anchor.getFullYear(), anchor.getMonth(), 1);
    const s = new Date(first.getTime() - ((first.getDay() + 6) % 7) * DAY);
    return Array.from({ length: 42 }, (_, i) => new Date(s.getTime() + i * DAY));
  }, [view, anchor]);

  const filtered = posts.filter(
    (p) => (fmt === "all" || p.format === fmt) && (st === "all" || p.status === st),
  );
  const byDay = new Map<string, IgPost[]>();
  for (const p of filtered) {
    if (!p.scheduled_at) continue;
    const k = key(new Date(p.scheduled_at));
    byDay.set(k, [...(byDay.get(k) ?? []), p]);
  }
  const undated = filtered.filter((p) => !p.scheduled_at);

  const move = (n: number) =>
    setAnchor((a) =>
      view === "week"
        ? new Date(a.getTime() + n * 7 * DAY)
        : new Date(a.getFullYear(), a.getMonth() + n, 1),
    );

  const drop = async (postId: string, day: Date) => {
    const p = posts.find((x) => x.id === postId);
    if (!p) return;
    const old = p.scheduled_at ? new Date(p.scheduled_at) : new Date(day.getTime() + 9 * 3600e3);
    const next = new Date(
      day.getFullYear(),
      day.getMonth(),
      day.getDate(),
      old.getHours(),
      old.getMinutes(),
    );
    try {
      if (p.status === "scheduled")
        await sched({ data: { workspaceId, postId, scheduledAt: next.toISOString() } });
      else {
        const { error } = await supabase
          .from("ig_posts")
          .update({ scheduled_at: next.toISOString() })
          .eq("id", postId);
        if (error) throw error;
      }
      toast.success("Post reagendado.");
      qc.invalidateQueries({ queryKey: ["ig-posts", workspaceId] });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Falha ao reagendar.");
    }
  };

  const pending = posts.filter(
    (p) => (p.status === "idea" || p.status === "failed") && !p.media?.length,
  );
  const runBatch = async () => {
    setBatch({ done: 0, total: pending.length });
    let ok = 0;
    for (let i = 0; i < pending.length; i++) {
      const p = pending[i]!;
      setBatch({ done: i, total: pending.length, current: p.theme ?? FORMATS[p.format]?.label });
      try {
        const r = await gen({ data: { workspaceId, postId: p.id, provider: "auto" } });
        if (r.ok) ok++;
      } catch {
        /* segue com os próximos */
      }
      qc.invalidateQueries({ queryKey: ["ig-posts", workspaceId] });
    }
    setBatch(null);
    toast.success(`Criativos gerados: ${ok} de ${pending.length}.`);
  };

  const today = key(new Date());
  const clearAutoDay = useCallback(() => setAutoDay(null), []);
  const isoDay = (d: Date) =>
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  const past = (d: Date) => startOfDay(d).getTime() < startOfDay(new Date()).getTime();
  const title =
    view === "week"
      ? `${days[0]!.toLocaleDateString("pt-BR", { day: "2-digit", month: "short" })} – ${days[6]!.toLocaleDateString("pt-BR", { day: "2-digit", month: "short" })}`
      : anchor.toLocaleDateString("pt-BR", { month: "long", year: "numeric" });

  const Card = ({ p }: { p: IgPost }) => {
    const Icon = FORMATS[p.format]?.icon;
    return (
      <button
        draggable
        onDragStart={(e) => e.dataTransfer.setData("text/plain", p.id)}
        onClick={() => onOpen(p.id)}
        className="flex w-full cursor-grab items-center gap-2 rounded-md border border-border bg-card p-1.5 text-left hover:border-primary/50"
      >
        <MediaThumb post={p} className="size-9 shrink-0" />
        <div className="min-w-0 flex-1">
          <p className="flex items-center gap-1 text-[11px] text-muted-foreground">
            {Icon && <Icon className="size-3" />}
            {(p as IgPost & { automation?: string | null }).automation && (
              <Bot className="size-3 text-primary" aria-label="Programação automática" />
            )}
            {p.scheduled_at
              ? new Date(p.scheduled_at).toLocaleTimeString("pt-BR", {
                  hour: "2-digit",
                  minute: "2-digit",
                })
              : "—"}
          </p>
          <p className="truncate text-xs font-medium">{p.theme ?? "Post"}</p>
          <StatusPill status={p.status} label={STATUS_LABEL[p.status] ?? p.status} />
        </div>
      </button>
    );
  };

  return (
    <div className="space-y-4">
      <IgAutoCalendar workspaceId={workspaceId} presetDate={autoDay} onPresetUsed={clearAutoDay} />
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Button size="icon" variant="outline" onClick={() => move(-1)} aria-label="Anterior">
            <ChevronLeft className="size-4" />
          </Button>
          <Button size="icon" variant="outline" onClick={() => move(1)} aria-label="Próximo">
            <ChevronRight className="size-4" />
          </Button>
          <span className="text-sm font-semibold capitalize">{title}</span>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Select value={view} onValueChange={(v) => setView(v as "week" | "month")}>
            <SelectTrigger className="w-28">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="week">Semana</SelectItem>
              <SelectItem value="month">Mês</SelectItem>
            </SelectContent>
          </Select>
          <Select value={fmt} onValueChange={setFmt}>
            <SelectTrigger className="w-36">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todos formatos</SelectItem>
              {Object.entries(FORMATS).map(([k, v]) => (
                <SelectItem key={k} value={k}>
                  {v.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={st} onValueChange={setSt}>
            <SelectTrigger className="w-44">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todos status</SelectItem>
              {Object.entries(STATUS_LABEL).map(([k, v]) => (
                <SelectItem key={k} value={k}>
                  {v}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button onClick={runBatch} disabled={!!batch || pending.length === 0}>
            {batch ? <Loader2 className="size-4 animate-spin" /> : <Sparkles className="size-4" />}
            Gerar criativos pendentes ({pending.length})
          </Button>
        </div>
      </div>

      {batch && (
        <div className="panel space-y-2 p-4">
          <p className="text-sm">
            Gerando {batch.done + 1} de {batch.total}:{" "}
            <span className="text-muted-foreground">{batch.current}</span>
          </p>
          <Progress value={(batch.done / batch.total) * 100} />
        </div>
      )}

      {posts.length === 0 ? (
        <EmptyState
          title="Calendário vazio"
          description="Clique em Nova programação acima: escolha período, dias e horários e a IA cuida do resto."
        />
      ) : (
        <div className="overflow-x-auto">
          <div className={cn("grid min-w-[760px] grid-cols-7 gap-2")}>
            {["Seg", "Ter", "Qua", "Qui", "Sex", "Sáb", "Dom"].map((d) => (
              <div key={d} className="px-1 text-xs font-medium uppercase text-muted-foreground">
                {d}
              </div>
            ))}
            {days.map((d) => {
              const list = byDay.get(key(d)) ?? [];
              const out = view === "month" && d.getMonth() !== anchor.getMonth();
              return (
                <div
                  key={key(d)}
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={(e) => drop(e.dataTransfer.getData("text/plain"), d)}
                  className={cn(
                    "flex flex-col gap-1.5 rounded-lg border border-border p-1.5",
                    view === "week" ? "min-h-64" : "min-h-28",
                    out && "opacity-50",
                    key(d) === today && "border-primary/60",
                  )}
                >
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-muted-foreground">{d.getDate()}</span>
                    {canEdit && !past(d) && (
                      <button
                        type="button"
                        onClick={() => setAutoDay(isoDay(d))}
                        className="rounded p-0.5 text-muted-foreground hover:bg-primary/10 hover:text-primary"
                        aria-label="Programar posts com IA neste dia"
                        title="Programar posts com IA neste dia"
                      >
                        <Plus className="size-3.5" />
                      </button>
                    )}
                  </div>
                  {list.map((p) => (
                    <Card key={p.id} p={p} />
                  ))}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {undated.length > 0 && (
        <Section
          title={`Sem data (${undated.length})`}
          description="Arraste para um dia do calendário."
        >
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
            {undated.map((p) => (
              <Card key={p.id} p={p} />
            ))}
          </div>
        </Section>
      )}
    </div>
  );
}
