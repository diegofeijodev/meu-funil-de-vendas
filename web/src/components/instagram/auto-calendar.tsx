"use client";
/* eslint-disable @typescript-eslint/no-explicit-any -- porte 1:1 do protótipo: os jsonb de ig_posts/ig_content_plans chegam soltos */

import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@/lib/server-fn";
import { toast } from "sonner";
import { Bot, CalendarRange, Loader2, Plus, Sparkles, X } from "lucide-react";
import { listAutoRuns, listIgPlans } from "@/modules/instagram/infrastructure/instagram.api";
import { listBrands } from "@/modules/brands/infrastructure/brands.api";
import { listCampaigns } from "@/modules/campaigns/infrastructure/campaigns.api";
import {
  cancelAutoCalendar,
  createAutoCalendar,
  fillAutoCalendar,
  generateNextAutoMedia,
  previewAutoCalendar,
} from "@/lib/instagram/auto-calendar.functions";
import { useWorkspace } from "@/lib/workspace";
import { Section, StatusPill } from "@/components/ui-bits";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Checkbox } from "@/components/ui/checkbox";
import { Progress } from "@/components/ui/progress";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { FORMATS, useIgAccount } from "./shared";

const WEEK = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];
const MAIN_FORMATS = ["feed_image", "feed_carousel", "reel"] as const;

/** Data de hoje em São Paulo (AAAA-MM-DD). */
const todaySP = () => new Date(Date.now() - 3 * 3600e3).toISOString().slice(0, 10);
const plusDays = (d: string, n: number) => {
  const x = new Date(`${d}T12:00:00Z`);
  x.setUTCDate(x.getUTCDate() + n);
  return x.toISOString().slice(0, 10);
};
const endOfMonth = (d: string) => {
  const x = new Date(`${d}T12:00:00Z`);
  return new Date(Date.UTC(x.getUTCFullYear(), x.getUTCMonth() + 1, 0, 12)).toISOString().slice(0, 10);
};
const dayLabel = (iso: string) =>
  new Date(iso).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo", weekday: "short", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });

type Progress = { label: string; done: number; total: number } | null;

/** Calendário automático: a IA estrategista planeja o período, gera os criativos e a fila publica. */
export function IgAutoCalendar({ workspaceId, presetDate, onPresetUsed }: { workspaceId: string; presetDate?: string | null; onPresetUsed?: () => void }) {
  const qc = useQueryClient();
  const { role, canEdit } = useWorkspace();
  const canPublish = role === "owner" || role === "admin";
  const [open, setOpen] = useState(false);
  const [initial, setInitial] = useState<string | null>(null);
  const [progress, setProgress] = useState<Progress>(null);
  const fill = useServerFn(fillAutoCalendar);
  const media = useServerFn(generateNextAutoMedia);
  const cancel = useServerFn(cancelAutoCalendar);

  useEffect(() => {
    if (presetDate) {
      setInitial(presetDate);
      setOpen(true);
      onPresetUsed?.();
    }
  }, [presetDate, onPresetUsed]);

  const { data: runs = [] } = useQuery({
    queryKey: ["ig-auto-runs", workspaceId],
    refetchInterval: 30_000,
    queryFn: () => listAutoRuns(workspaceId),
  });

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ["ig-auto-runs", workspaceId] });
    qc.invalidateQueries({ queryKey: ["ig-posts", workspaceId] });
    qc.invalidateQueries({ queryKey: ["ig-autopilot-events", workspaceId] });
  };

  /** Estrategista escreve em lotes; depois gera já os criativos das próximas horas. */
  const drive = async (runId: string, total?: number) => {
    try {
      for (let guard = 0; guard < 40; guard++) {
        const r = await fill({ data: { runId } });
        setProgress({ label: "Estrategista planejando os conteúdos", done: r.filled, total: r.total || total || 1 });
        refresh();
        if (r.done) break;
        if (r.busy) await new Promise((res) => setTimeout(res, 4000));
      }
      let made = 0;
      for (let guard = 0; guard < 12; guard++) {
        setProgress({ label: "Gerando os criativos dos posts das próximas horas", done: made, total: made + 1 });
        const r = await media({ data: { runId, withinHours: 6 } });
        if (r.ok && !r.done) made++;
        refresh();
        if (r.done) {
          if (r.ok && made > 0) made++;
          break;
        }
      }
      toast.success("Programação pronta. Os demais criativos são gerados sozinhos antes de cada horário.");
    } catch (e) {
      toast.error(`${e instanceof Error ? e.message : "Falhou"} — o agendador continua em até 5 minutos.`);
    } finally {
      setProgress(null);
      refresh();
    }
  };

  return (
    <Section
      title="Programar com IA"
      description="Escolha o período, os dias e os horários: a estrategista cria os conteúdos, os criativos são gerados sozinhos e tudo é publicado na hora marcada — inclusive hoje."
      actions={
        canEdit ? (
          <Button
            onClick={() => {
              setInitial(null);
              setOpen(true);
            }}
            disabled={!!progress}
          >
            <Sparkles className="size-4" /> Nova programação
          </Button>
        ) : undefined
      }
    >
      {progress && (
        <div className="mb-4 space-y-2 rounded-lg border border-primary/40 p-3">
          <p className="flex items-center gap-2 text-sm">
            <Loader2 className="size-4 animate-spin" /> {progress.label} ({Math.min(progress.done, progress.total)}/{progress.total})
          </p>
          <Progress value={(progress.done / Math.max(progress.total, 1)) * 100} />
          <p className="text-xs text-muted-foreground">Pode fechar a página: o agendador termina sozinho.</p>
        </div>
      )}
      {!runs.length ? (
        <p className="text-sm text-muted-foreground">Nenhuma programação ainda. Clique em Nova programação ou no + de um dia do calendário.</p>
      ) : (
        <ul className="divide-y divide-border rounded-lg border border-border">
          {runs.map((r: any) => (
            <li key={r.id} className="flex flex-wrap items-start justify-between gap-3 p-3 text-sm">
              <div className="min-w-0 space-y-1">
                <p className="flex flex-wrap items-center gap-2 font-medium">
                  <CalendarRange className="size-4 text-primary" />
                  {new Date(`${r.start_date}T12:00:00Z`).toLocaleDateString("pt-BR", { timeZone: "UTC" })} a{" "}
                  {new Date(`${r.end_date}T12:00:00Z`).toLocaleDateString("pt-BR", { timeZone: "UTC" })}
                  <StatusPill status={runStatus(r.status)} label={RUN_LABEL[r.status] ?? r.status} />
                  {r.recurring && <span className="text-xs text-primary">repete toda semana{r.weeks > 1 ? ` · ${r.weeks} semanas` : ""}</span>}
                </p>
                <p className="text-xs text-muted-foreground">
                  {r.weekdays.length === 7 ? "Todos os dias" : r.weekdays.map((d: number) => WEEK[d]).join(", ")} ·{" "}
                  {[...r.times, ...r.story_times.map((t: string) => `${t} (story)`)].join(", ") || "o quanto antes"} ·{" "}
                  {r.mode === "publish" ? "publica sozinho" : "com aprovação"}
                </p>
                {r.focus && <p className="truncate text-xs text-muted-foreground">Foco: {r.focus}</p>}
                <p className="text-xs">
                  {r.counts.total} conteúdos · {r.counts.media} criativos · {r.counts.waiting > 0 && `${r.counts.waiting} aguardando aprovação · `}
                  {r.counts.scheduled} agendados · {r.counts.published} publicados
                  {r.counts.failed > 0 && <span className="text-destructive"> · {r.counts.failed} com falha</span>}
                </p>
                {r.last_error && <p className="text-xs text-destructive">Último erro: {r.last_error}</p>}
              </div>
              {canEdit && (
                <div className="flex gap-2">
                  {r.status === "planning" && (
                    <Button size="sm" variant="outline" disabled={!!progress} onClick={() => drive(r.id)}>
                      Continuar
                    </Button>
                  )}
                  {["planning", "active"].includes(r.status) || r.recurring ? (
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={async () => {
                        if (!confirm("Cancelar esta programação? Os posts ainda não publicados saem da fila.")) return;
                        try {
                          const res = await cancel({ data: { runId: r.id } });
                          toast.success(`Programação cancelada (${res.cancelled} posts retirados).`);
                          refresh();
                        } catch (e) {
                          toast.error(e instanceof Error ? e.message : "Falha ao cancelar.");
                        }
                      }}
                    >
                      <X className="size-4" /> Cancelar
                    </Button>
                  ) : null}
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
      <AutoCalendarDialog
        open={open}
        onOpenChange={setOpen}
        workspaceId={workspaceId}
        initialDate={initial}
        canPublish={canPublish}
        onCreated={(runId, total) => {
          setOpen(false);
          refresh();
          void drive(runId, total);
        }}
      />
    </Section>
  );
}

const RUN_LABEL: Record<string, string> = {
  planning: "Planejando",
  active: "Em andamento",
  done: "Concluída",
  cancelled: "Cancelada",
  failed: "Falhou",
};
const runStatus = (s: string) => (s === "active" ? "connected" : s === "planning" ? "generating" : s === "done" ? "published" : s === "failed" ? "error" : "disconnected");

function AutoCalendarDialog({
  open,
  onOpenChange,
  workspaceId,
  initialDate,
  canPublish,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  workspaceId: string;
  initialDate: string | null;
  canPublish: boolean;
  onCreated: (runId: string, total: number) => void;
}) {
  const create = useServerFn(createAutoCalendar);
  const preview = useServerFn(previewAutoCalendar);
  const { data: account } = useIgAccount(workspaceId);
  const { data: opts } = useQuery({
    queryKey: ["ig-auto-options", workspaceId],
    enabled: open,
    queryFn: async () => {
      const [plans, brands, camps] = await Promise.all([
        listIgPlans(workspaceId, { excludeArchived: true }),
        listBrands(workspaceId),
        listCampaigns(workspaceId),
      ]);
      return { plans: plans as any[], brands: brands as any[], campaigns: camps.slice(0, 30) as any[] };
    },
  });

  const today = todaySP();
  const [planId, setPlanId] = useState("");
  const [brandId, setBrandId] = useState("");
  const [campaignId, setCampaignId] = useState("");
  const [start, setStart] = useState(today);
  const [end, setEnd] = useState(plusDays(today, 6));
  const [weekdays, setWeekdays] = useState<number[]>([0, 1, 2, 3, 4, 5, 6]);
  const [times, setTimes] = useState<string[]>(["09:00", "12:00", "19:00"]);
  const [storyTimes, setStoryTimes] = useState<string[]>([]);
  const [formats, setFormats] = useState<string[]>(["feed_image", "feed_carousel", "reel"]);
  const [storyVideo, setStoryVideo] = useState(false);
  const [asap, setAsap] = useState(false);
  const [focus, setFocus] = useState("");
  const [mode, setMode] = useState<"publish" | "approval">(canPublish ? "publish" : "approval");
  const [recurring, setRecurring] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    const d = initialDate ?? today;
    setStart(d < today ? today : d);
    setEnd(initialDate ? (d < today ? today : d) : plusDays(today, 6));
    setMode(canPublish ? "publish" : "approval");
  }, [open, initialDate, today, canPublish]);
  useEffect(() => {
    if (!planId && opts?.plans.length) setPlanId(opts.plans.find((p) => p.status === "active")?.id ?? opts.plans[0].id);
    if (!opts?.plans.length && !brandId && opts?.brands.length) setBrandId(opts.brands[0].id);
  }, [opts, planId, brandId]);

  const allFormats = useMemo(
    () => [...formats, ...(storyTimes.length || (asap && !formats.length) ? [storyVideo ? "story_video" : "story_image"] : [])],
    [formats, storyTimes, storyVideo, asap],
  );
  const cfg = { startDate: start, endDate: end, weekdays, times, storyTimes, formats: allFormats as any, asap: asap && start === today };
  const { data: pv } = useQuery({
    queryKey: ["ig-auto-preview", JSON.stringify(cfg)],
    enabled: open && allFormats.length > 0,
    queryFn: () => preview({ data: cfg }),
  });

  const submit = async () => {
    setBusy(true);
    try {
      const r = await create({
        data: {
          workspaceId,
          planId: planId || null,
          brandId: planId ? null : brandId || null,
          campaignId: campaignId || null,
          ...cfg,
          focus,
          mode,
          recurring,
        },
      });
      toast.success(`Programação criada: ${r.total} posts.${r.skipped ? ` ${r.skipped} horário(s) que já passaram foram ignorados.` : ""}`);
      onCreated(r.runId, r.total);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Não foi possível criar.");
    } finally {
      setBusy(false);
    }
  };

  const range = (s: string, e: string) => {
    setStart(s);
    setEnd(e);
  };
  const toggle = <T,>(list: T[], v: T) => (list.includes(v) ? list.filter((x) => x !== v) : [...list, v]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Bot className="size-5 text-primary" /> Nova programação com IA
          </DialogTitle>
          <DialogDescription>A estrategista cria um conteúdo para cada horário; os criativos e a publicação são automáticos.</DialogDescription>
        </DialogHeader>

        <div className="space-y-5 text-sm">
          <Field label="Estratégia">
            <div className="grid gap-2 sm:grid-cols-2">
              <select className={sel} value={planId} onChange={(e) => setPlanId(e.target.value)}>
                <option value="">Criar plano automático pela marca</option>
                {opts?.plans.map((p) => (
                  <option key={p.id} value={p.id}>
                    Plano: {p.name}
                  </option>
                ))}
              </select>
              {!planId && (
                <select className={sel} value={brandId} onChange={(e) => setBrandId(e.target.value)}>
                  <option value="">Escolha a marca</option>
                  {opts?.brands.map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.name}
                    </option>
                  ))}
                </select>
              )}
              <select className={cn(sel, "sm:col-span-2")} value={campaignId} onChange={(e) => setCampaignId(e.target.value)}>
                <option value="">Sem campanha (conteúdo de marca)</option>
                {opts?.campaigns.map((c) => (
                  <option key={c.id} value={c.id}>
                    Seguir a estratégia da campanha: {c.name}
                  </option>
                ))}
              </select>
            </div>
          </Field>

          <Field label="Período">
            <div className="mb-2 flex flex-wrap gap-2">
              {[
                ["Só hoje", today, today],
                ["Hoje e amanhã", today, plusDays(today, 1)],
                ["Próximos 7 dias", today, plusDays(today, 6)],
                ["Próximos 15 dias", today, plusDays(today, 14)],
                ["Próximos 30 dias", today, plusDays(today, 29)],
                ["Até o fim do mês", today, endOfMonth(today)],
              ].map(([l, s, e]) => (
                <Button key={l} size="sm" variant={start === s && end === e ? "default" : "outline"} onClick={() => range(s!, e!)}>
                  {l}
                </Button>
              ))}
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Input type="date" className="w-40" min={today} value={start} onChange={(e) => setStart(e.target.value)} />
              <span>até</span>
              <Input type="date" className="w-40" min={start} value={end} onChange={(e) => setEnd(e.target.value)} />
            </div>
          </Field>

          <Field label="Dias da semana">
            <div className="flex flex-wrap gap-1.5">
              {WEEK.map((d, i) => (
                <button
                  key={d}
                  type="button"
                  onClick={() => setWeekdays(toggle(weekdays, i))}
                  className={cn("h-8 w-11 rounded-md border text-xs", weekdays.includes(i) ? "border-primary bg-primary/15 text-primary" : "border-border text-muted-foreground")}
                >
                  {d}
                </button>
              ))}
              <Button size="sm" variant="ghost" onClick={() => setWeekdays([0, 1, 2, 3, 4, 5, 6])}>
                Todos
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setWeekdays([1, 2, 3, 4, 5])}>
                Dias úteis
              </Button>
            </div>
          </Field>

          <Field label="Horários dos posts (feed, carrossel e Reels)">
            <TimeList value={times} onChange={setTimes} presets={["09:00", "12:00", "18:00", "19:00", "21:00"]} />
            <div className="mt-2 flex flex-wrap gap-3">
              {MAIN_FORMATS.map((f) => (
                <label key={f} className="flex items-center gap-1.5">
                  <Checkbox checked={formats.includes(f)} onCheckedChange={() => setFormats(toggle(formats, f))} />
                  {FORMATS[f]?.label}
                </label>
              ))}
            </div>
            <p className="mt-1 text-xs text-muted-foreground">Os formatos se revezam entre os horários e os dias. Vídeo a menos de 1 hora vira imagem para dar tempo.</p>
          </Field>

          <Field label="Horários dos stories (opcional)">
            <TimeList value={storyTimes} onChange={setStoryTimes} presets={["10:00", "14:00", "17:00", "20:00"]} />
            {storyTimes.length > 0 && (
              <label className="mt-2 flex items-center gap-1.5">
                <Checkbox checked={storyVideo} onCheckedChange={(v) => setStoryVideo(!!v)} /> Stories em vídeo (senão, imagem)
              </label>
            )}
          </Field>

          {start === today && (
            <label className="flex items-center gap-2">
              <Switch checked={asap} onCheckedChange={setAsap} /> Publicar um post hoje o quanto antes (em ~30 minutos)
            </label>
          )}

          <Field label="Foco do período (opcional)">
            <Textarea
              rows={2}
              value={focus}
              onChange={(e) => setFocus(e.target.value)}
              placeholder="Ex.: Semana do Consumidor — 20% de desconto até sexta; lançamento do produto X no sábado."
            />
          </Field>

          <Field label="Modo">
            <div className="grid gap-2 sm:grid-cols-2">
              <ModeCard
                active={mode === "publish"}
                disabled={!canPublish}
                title="Totalmente automático"
                text={canPublish ? "Gera os criativos e publica sozinho no horário." : "Só dono ou admin pode publicar sem aprovação."}
                onClick={() => setMode("publish")}
              />
              <ModeCard
                active={mode === "approval"}
                title="Com minha aprovação"
                text="Gera tudo e espera você aprovar. Sem aprovação até 10 min antes, passa para o dia seguinte."
                onClick={() => setMode("approval")}
              />
            </div>
            <label className="mt-3 flex items-center gap-2">
              <Switch checked={recurring} onCheckedChange={setRecurring} /> Repetir toda semana com estas configurações
            </label>
          </Field>

          {account?.status !== "connected" && (
            <p className="rounded-md border border-warning/40 p-2 text-xs text-warning">
              O Instagram desta empresa não está conectado: os conteúdos e criativos são criados, mas só serão publicados depois de conectar a conta em Visão geral.
            </p>
          )}

          <div className="rounded-lg border border-border p-3">
            {!pv ? (
              <p className="text-xs text-muted-foreground">Calculando os horários…</p>
            ) : !pv.ok ? (
              <p className="text-xs text-destructive">{pv.error}</p>
            ) : (
              <>
                <p className="font-medium">
                  {pv.total} post(s){pv.first ? ` · de ${dayLabel(pv.first)} a ${dayLabel(pv.last!)}` : ""}
                </p>
                {pv.skipped > 0 && <p className="text-xs text-muted-foreground">{pv.skipped} horário(s) de hoje já passaram ou estão a menos de 20 min e foram ignorados.</p>}
                <ul className="mt-2 max-h-32 space-y-0.5 overflow-y-auto text-xs text-muted-foreground">
                  {pv.slots.slice(0, 40).map((s) => (
                    <li key={s.index}>
                      {dayLabel(s.at)} · {FORMATS[s.format]?.label}
                    </li>
                  ))}
                  {pv.total > 40 && <li>… e mais {pv.total - 40}</li>}
                </ul>
              </>
            )}
          </div>

          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => onOpenChange(false)}>
              Fechar
            </Button>
            <Button onClick={submit} disabled={busy || !pv?.ok || !pv.total || (!planId && !brandId)}>
              {busy ? <Loader2 className="size-4 animate-spin" /> : <Sparkles className="size-4" />}
              Criar e {mode === "publish" ? "publicar automaticamente" : "gerar para aprovação"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

const sel = "h-9 w-full rounded-md border border-input bg-background px-3 text-sm";

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="mb-1.5 font-medium">{label}</p>
      {children}
    </div>
  );
}

function ModeCard({ active, disabled, title, text, onClick }: { active: boolean; disabled?: boolean; title: string; text: string; onClick: () => void }) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className={cn("rounded-lg border p-3 text-left disabled:opacity-50", active ? "border-primary bg-primary/10" : "border-border")}
    >
      <p className="font-medium">{title}</p>
      <p className="text-xs text-muted-foreground">{text}</p>
    </button>
  );
}

function TimeList({ value, onChange, presets }: { value: string[]; onChange: (v: string[]) => void; presets: string[] }) {
  const [t, setT] = useState("");
  const add = (x: string) => x && !value.includes(x) && onChange([...value, x].sort());
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-1.5">
        {value.map((x) => (
          <span key={x} className="flex items-center gap-1 rounded-full border border-primary/40 bg-primary/10 px-2 py-0.5 text-xs">
            {x}
            <button type="button" aria-label={`Remover ${x}`} onClick={() => onChange(value.filter((y) => y !== x))}>
              <X className="size-3" />
            </button>
          </span>
        ))}
        <Input type="time" className="h-8 w-28" value={t} onChange={(e) => setT(e.target.value)} />
        <Button size="sm" variant="outline" disabled={!t} onClick={() => (add(t), setT(""))}>
          <Plus className="size-3" /> Horário
        </Button>
      </div>
      <div className="flex flex-wrap gap-1">
        {presets
          .filter((p) => !value.includes(p))
          .map((p) => (
            <button key={p} type="button" className="rounded border border-dashed border-border px-1.5 text-xs text-muted-foreground hover:border-primary" onClick={() => add(p)}>
              + {p}
            </button>
          ))}
      </div>
    </div>
  );
}

