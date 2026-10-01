import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Loader2, Sparkles, X } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { generateContentCalendar, suggestPillars } from "@/lib/instagram/instagram.functions";
import { Section, StatusPill } from "@/components/ui-bits";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Progress } from "@/components/ui/progress";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";

type Form = {
  id?: string;
  name: string;
  brand_id: string | null;
  objective: string;
  tone_of_voice: string;
  audience: string;
  content_pillars: string[];
  freq: { feed: number; carousel: number; reels: number; stories: number };
  times: string;
  days: number[];
  hashtags: string;
  cta_default: string;
  requires_approval: boolean;
  auto_publish: boolean;
};

const EMPTY: Form = {
  name: "Plano de conteúdo",
  brand_id: null,
  objective: "",
  tone_of_voice: "",
  audience: "",
  content_pillars: [],
  freq: { feed: 2, carousel: 1, reels: 2, stories: 5 },
  times: "09:00, 12:30, 19:00",
  days: [0, 1, 2, 3, 4, 5, 6],
  hashtags: "",
  cta_default: "",
  requires_approval: true,
  auto_publish: false,
};

const STEPS = ["Marca e objetivo", "Pilares", "Frequência", "Hashtags e regras"];

export function IgStrategy({ workspaceId }: { workspaceId: string }) {
  const qc = useQueryClient();
  const [step, setStep] = useState(0);
  const [f, setF] = useState<Form>(EMPTY);
  const [chip, setChip] = useState("");
  const [progress, setProgress] = useState<number | null>(null);
  const suggest = useServerFn(suggestPillars);
  const generate = useServerFn(generateContentCalendar);

  const { data: brands = [] } = useQuery({
    queryKey: ["brands-lite", workspaceId],
    queryFn: async () =>
      (await supabase.from("brands").select("id, name").eq("workspace_id", workspaceId)).data ?? [],
  });
  const { data: plans = [], isLoading } = useQuery({
    queryKey: ["ig-plans", workspaceId],
    queryFn: async () =>
      (
        await supabase
          .from("ig_content_plans")
          .select("*")
          .eq("workspace_id", workspaceId)
          .order("created_at", { ascending: false })
      ).data ?? [],
  });

  const load = (p: any) => {
    const fr = p.posting_frequency ?? {};
    setF({
      id: p.id,
      name: p.name,
      brand_id: p.brand_id,
      objective: p.objective ?? "",
      tone_of_voice: p.tone_of_voice ?? "",
      audience: p.hashtag_strategy?.audience ?? "",
      content_pillars: p.content_pillars ?? [],
      freq: {
        feed: fr.feed_image ?? fr.feed ?? 0,
        carousel: fr.feed_carousel ?? 0,
        reels: fr.reels ?? 0,
        stories: fr.stories ?? 0,
      },
      times: (p.preferred_times ?? []).join(", "),
      days: p.posting_days ?? [0, 1, 2, 3, 4, 5, 6],
      hashtags: p.hashtag_strategy?.notes ?? "",
      cta_default: p.cta_default ?? "",
      requires_approval: p.requires_approval,
      auto_publish: p.auto_publish,
    });
    setStep(0);
  };

  const save = async () => {
    const row = {
      workspace_id: workspaceId,
      name: f.name || "Plano de conteúdo",
      brand_id: f.brand_id,
      objective: f.objective,
      tone_of_voice: f.tone_of_voice,
      content_pillars: f.content_pillars,
      posting_frequency: {
        feed_image: f.freq.feed,
        feed_carousel: f.freq.carousel,
        feed: f.freq.feed + f.freq.carousel,
        reels: f.freq.reels,
        stories: f.freq.stories,
      },
      preferred_times: f.times
        .split(",")
        .map((t) => t.trim())
        .filter(Boolean),
      posting_days: f.days.length ? f.days : [0, 1, 2, 3, 4, 5, 6],
      hashtag_strategy: { notes: f.hashtags, audience: f.audience },
      cta_default: f.cta_default,
      requires_approval: f.requires_approval,
      auto_publish: f.auto_publish,
      status: "active",
    };
    const q = f.id
      ? supabase.from("ig_content_plans").update(row).eq("id", f.id).select("id").single()
      : supabase.from("ig_content_plans").insert(row).select("id").single();
    const { data, error } = await q;
    if (error) throw error;
    setF((x) => ({ ...x, id: data.id }));
    qc.invalidateQueries({ queryKey: ["ig-plans", workspaceId] });
    return data.id as string;
  };

  const sug = useMutation({
    mutationFn: () =>
      suggest({
        data: {
          workspaceId,
          brandId: f.brand_id,
          objective: f.objective,
          tone: f.tone_of_voice,
          audience: f.audience,
        },
      }),
    onSuccess: (r) => {
      setF((x) => ({
        ...x,
        content_pillars: Array.from(new Set([...x.content_pillars, ...r.pillars])),
      }));
      toast.success("A IA sugeriu 5 pilares.");
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Falha ao sugerir."),
  });

  const gen = useMutation({
    mutationFn: async (weeks: number) => {
      setProgress(10);
      const id = await save();
      const timer = setInterval(
        () => setProgress((p) => (p === null ? p : Math.min(92, p + 4))),
        1500,
      );
      try {
        return await generate({ data: { workspaceId, planId: id, weeks, engine: "auto" } });
      } finally {
        clearInterval(timer);
      }
    },
    onSuccess: (r) => {
      setProgress(100);
      setTimeout(() => setProgress(null), 800);
      qc.invalidateQueries({ queryKey: ["ig-posts", workspaceId] });
      toast.success(`${r.created} posts criados no calendário.`);
    },
    onError: (e) => {
      setProgress(null);
      toast.error(e instanceof Error ? e.message : "Falha ao gerar o calendário.");
    },
  });

  const addChip = () => {
    const v = chip.trim();
    if (v && !f.content_pillars.includes(v))
      setF({ ...f, content_pillars: [...f.content_pillars, v] });
    setChip("");
  };

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_280px]">
      <Section
        title="Plano de conteúdo"
        description="Defina a estratégia e a IA monta o calendário."
      >
        <ol className="mb-6 grid grid-cols-2 gap-2 sm:grid-cols-4">
          {STEPS.map((s, i) => (
            <li key={s}>
              <button
                onClick={() => setStep(i)}
                className={cn(
                  "w-full rounded-lg border px-3 py-2 text-left text-xs",
                  i === step
                    ? "border-primary bg-primary/10 text-foreground"
                    : "border-border text-muted-foreground",
                )}
              >
                <span className="font-semibold">{i + 1}.</span> {s}
              </button>
            </li>
          ))}
        </ol>

        {step === 0 && (
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5 sm:col-span-2">
              <Label>Nome do plano</Label>
              <Input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} />
            </div>
            <div className="space-y-1.5">
              <Label>Marca</Label>
              <Select
                value={f.brand_id ?? "none"}
                onValueChange={(v) => setF({ ...f, brand_id: v === "none" ? null : v })}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">Sem marca</SelectItem>
                  {brands.map((b: any) => (
                    <SelectItem key={b.id} value={b.id}>
                      {b.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Objetivo</Label>
              <Input
                placeholder="Ex.: gerar leads para consultoria"
                value={f.objective}
                onChange={(e) => setF({ ...f, objective: e.target.value })}
              />
            </div>
            <div className="space-y-1.5">
              <Label>Tom de voz</Label>
              <Input
                placeholder="Ex.: próximo, direto, bem-humorado"
                value={f.tone_of_voice}
                onChange={(e) => setF({ ...f, tone_of_voice: e.target.value })}
              />
            </div>
            <div className="space-y-1.5">
              <Label>Público</Label>
              <Input
                placeholder="Ex.: donos de pequenas empresas em SP"
                value={f.audience}
                onChange={(e) => setF({ ...f, audience: e.target.value })}
              />
            </div>
          </div>
        )}

        {step === 1 && (
          <div className="space-y-4">
            <div className="flex flex-wrap gap-2">
              {f.content_pillars.map((p) => (
                <span
                  key={p}
                  className="inline-flex items-center gap-1 rounded-full border border-border bg-muted px-3 py-1 text-sm"
                >
                  {p}
                  <button
                    aria-label={`Remover ${p}`}
                    onClick={() =>
                      setF({ ...f, content_pillars: f.content_pillars.filter((x) => x !== p) })
                    }
                  >
                    <X className="size-3" />
                  </button>
                </span>
              ))}
              {f.content_pillars.length === 0 && (
                <p className="text-sm text-muted-foreground">Nenhum pilar ainda.</p>
              )}
            </div>
            <div className="flex flex-col gap-2 sm:flex-row">
              <Input
                placeholder="Adicionar pilar e Enter"
                value={chip}
                onChange={(e) => setChip(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), addChip())}
              />
              <Button variant="outline" onClick={() => sug.mutate()} disabled={sug.isPending}>
                {sug.isPending ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <Sparkles className="size-4" />
                )}{" "}
                IA sugere 5
              </Button>
            </div>
          </div>
        )}

        {step === 2 && (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
              {(
                [
                  ["feed", "Feed"],
                  ["carousel", "Carrossel"],
                  ["reels", "Reels"],
                  ["stories", "Stories"],
                ] as const
              ).map(([k, l]) => (
                <div key={k} className="space-y-1.5">
                  <Label>{l} / semana</Label>
                  <Input
                    type="number"
                    min={0}
                    max={21}
                    value={f.freq[k]}
                    onChange={(e) =>
                      setF({ ...f, freq: { ...f.freq, [k]: Number(e.target.value) } })
                    }
                  />
                </div>
              ))}
            </div>
            <div className="space-y-1.5">
              <Label>Horários preferidos (separados por vírgula)</Label>
              <Input value={f.times} onChange={(e) => setF({ ...f, times: e.target.value })} />
            </div>
            <div className="space-y-1.5">
              <Label>Dias da semana em que o piloto publica</Label>
              <div className="flex flex-wrap gap-1.5">
                {["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"].map((d, i) => (
                  <button
                    key={d}
                    type="button"
                    onClick={() =>
                      setF({ ...f, days: f.days.includes(i) ? f.days.filter((x) => x !== i) : [...f.days, i].sort() })
                    }
                    className={`h-8 w-11 rounded-md border text-xs ${f.days.includes(i) ? "border-primary bg-primary/15 text-primary" : "border-border text-muted-foreground"}`}
                  >
                    {d}
                  </button>
                ))}
              </div>
              <p className="text-xs text-muted-foreground">
                Para um período específico (hoje, uma data, 15 dias…), use Programar com IA na aba Calendário.
              </p>
            </div>
          </div>
        )}

        {step === 3 && (
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label>Estratégia de hashtags</Label>
              <Textarea
                placeholder="Ex.: 5 de nicho, 5 amplas, 3 locais (#saopaulo)…"
                value={f.hashtags}
                onChange={(e) => setF({ ...f, hashtags: e.target.value })}
              />
            </div>
            <div className="space-y-1.5">
              <Label>CTA padrão</Label>
              <Input
                placeholder="Ex.: Chame no direct"
                value={f.cta_default}
                onChange={(e) => setF({ ...f, cta_default: e.target.value })}
              />
            </div>
            <label className="flex items-center justify-between rounded-lg border border-border p-3 text-sm">
              Exigir aprovação antes de publicar
              <Switch
                checked={f.requires_approval}
                onCheckedChange={(v) => setF({ ...f, requires_approval: v })}
              />
            </label>
            <label className="flex items-center justify-between rounded-lg border border-border p-3 text-sm">
              Publicação automática
              <Switch
                checked={f.auto_publish}
                onCheckedChange={(v) => setF({ ...f, auto_publish: v })}
              />
            </label>
          </div>
        )}

        <div className="mt-6 flex flex-wrap items-center justify-between gap-2 border-t border-border pt-4">
          <div className="flex gap-2">
            <Button variant="ghost" disabled={step === 0} onClick={() => setStep(step - 1)}>
              Voltar
            </Button>
            {step < 3 && (
              <Button variant="outline" onClick={() => setStep(step + 1)}>
                Próximo
              </Button>
            )}
          </div>
          <div className="flex flex-wrap gap-2">
            <Button
              variant="outline"
              onClick={() =>
                save().then(
                  () => toast.success("Plano salvo."),
                  (e) => toast.error(e.message),
                )
              }
            >
              Salvar plano
            </Button>
            <Button onClick={() => gen.mutate(2)} disabled={gen.isPending}>
              Gerar calendário de 2 semanas
            </Button>
            <Button variant="secondary" onClick={() => gen.mutate(4)} disabled={gen.isPending}>
              4 semanas
            </Button>
          </div>
        </div>
        {progress !== null && (
          <div className="mt-4 space-y-1">
            <Progress value={progress} />
            <p className="text-xs text-muted-foreground">
              A IA está montando o calendário… isso leva até 1 minuto.
            </p>
          </div>
        )}
      </Section>

      <Section title="Planos salvos">
        {isLoading ? (
          <div className="h-20 animate-pulse rounded-lg bg-muted" />
        ) : plans.length === 0 ? (
          <p className="text-sm text-muted-foreground">Nenhum plano ainda.</p>
        ) : (
          <div className="space-y-2">
            <Button
              size="sm"
              variant="ghost"
              className="w-full"
              onClick={() => {
                setF(EMPTY);
                setStep(0);
              }}
            >
              + Novo plano
            </Button>
            {plans.map((p: any) => (
              <button
                key={p.id}
                onClick={() => load(p)}
                className={cn(
                  "w-full rounded-lg border p-3 text-left text-sm hover:bg-muted/40",
                  f.id === p.id ? "border-primary" : "border-border",
                )}
              >
                <p className="font-medium">{p.name}</p>
                <div className="mt-1 flex items-center gap-2">
                  <StatusPill
                    status={p.status}
                    label={
                      p.status === "active"
                        ? "Ativo"
                        : p.status === "paused"
                          ? "Pausado"
                          : "Rascunho"
                    }
                  />
                  {p.auto_publish && (
                    <span className="text-xs text-primary">Piloto automático</span>
                  )}
                  {p.status === "paused" && (
                    <span
                      role="button"
                      className="ml-auto text-xs text-primary underline"
                      onClick={async (e) => {
                        e.stopPropagation();
                        const { error } = await supabase
                          .from("ig_content_plans")
                          .update({ status: "active" })
                          .eq("id", p.id);
                        if (error) toast.error(error.message);
                        else {
                          toast.success("Plano reativado.");
                          qc.invalidateQueries();
                        }
                      }}
                    >
                      Reativar
                    </span>
                  )}
                </div>
              </button>
            ))}
          </div>
        )}
      </Section>

      {(() => {
        const cur = plans.find((p: any) => p.id === f.id) as any;
        const notes = Array.isArray(cur?.ai_notes) ? [...cur.ai_notes].reverse() : [];
        if (!cur) return null;
        return (
          <Section
            title="Notas do agente de otimização"
            description="Toda segunda a IA revisa os últimos 14 dias e ajusta horários e pilares."
          >
            {notes.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                Ainda sem ajustes. A primeira análise acontece na segunda-feira, com pelo menos 3
                posts publicados.
              </p>
            ) : (
              <div className="space-y-3">
                {notes.slice(0, 6).map((n: any, i: number) => (
                  <div key={i} className="rounded-lg border border-border p-3 text-sm">
                    <p className="text-xs text-muted-foreground">
                      {new Date(n.at).toLocaleString("pt-BR", {
                        dateStyle: "short",
                        timeStyle: "short",
                      })}{" "}
                      · {n.posts_analyzed} posts
                    </p>
                    <p className="mt-1">{n.summary}</p>
                    {n.pillar_weights && (
                      <div className="mt-2 flex flex-wrap gap-1">
                        {Object.entries(n.pillar_weights).map(([k, v]: any) => (
                          <span key={k} className="rounded-full bg-muted px-2 py-0.5 text-xs">
                            {k}: {Math.round(v * 100)}%
                          </span>
                        ))}
                      </div>
                    )}
                    {n.preferred_times?.after && (
                      <p className="mt-2 text-xs text-muted-foreground">
                        Horários: {JSON.stringify(n.preferred_times.before)} →{" "}
                        {JSON.stringify(n.preferred_times.after)}
                      </p>
                    )}
                  </div>
                ))}
              </div>
            )}
          </Section>
        );
      })()}
    </div>
  );
}
