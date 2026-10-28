"use client";

import { useState, type ReactNode } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { AlertTriangle, ChevronDown, Minus, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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
import {
  CITIES_EMPTY,
  autoPublishOffToast,
  autoPublishSummary,
  capWarning,
  settingsSummary,
  sameCities,
  weeklyFallbackWarning,
  windowError,
  windowHint,
} from "@/lib/vacancy-stories";
import { apiErrorMessage } from "@/modules/shared/infrastructure/http";
import {
  patchVacancySettings,
  setVacancyAutoPublish,
  vacancySettingsKey,
  type VacancySettings,
  type VacancySettingsPatch,
} from "@/modules/vacancy-stories/infrastructure/vacancy-stories.api";
import { TemplateCard } from "./template-card";
import { PreviewCard } from "./preview-card";
import { vacancyListKey } from "./use-story-actions";

const LEADS = [
  { value: 60, label: "1 h" },
  { value: 120, label: "2 h" },
  { value: 240, label: "4 h" },
  { value: 360, label: "6 h" },
] as const;

const VENDORS = [
  { value: "openai", label: "OpenAI (recomendado): erra menos letras e números" },
  { value: "gemini", label: "Gemini: já sai no tamanho exato do story" },
] as const;

type Edits = VacancySettingsPatch;
const FIELDS: (keyof Edits)[] = ["cities", "daily_cap", "window_start", "window_end", "min_lead_minutes", "vendor"];

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

function Field({ title, hint, children, error }: { title: string; hint?: ReactNode; children: ReactNode; error?: string | null }) {
  return (
    <fieldset className="space-y-2 border-t border-border pt-4">
      <legend className="text-sm font-semibold">{title}</legend>
      {children}
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
    </fieldset>
  );
}

/** Opção de rádio/caixa com linha de pelo menos 44 px de altura. */
function Option({ type, name, checked, onChange, disabled, children }: {
  type: "radio" | "checkbox";
  name?: string;
  checked: boolean;
  onChange: () => void;
  disabled?: boolean;
  children: ReactNode;
}) {
  return (
    <label className="flex min-h-11 cursor-pointer items-center gap-3 text-sm has-[:disabled]:cursor-not-allowed has-[:disabled]:opacity-60">
      <input type={type} name={name} checked={checked} onChange={onChange} disabled={disabled} className="size-5 shrink-0 accent-primary" />
      <span>{children}</span>
    </label>
  );
}

/**
 * "Ajustes" (fechado, com o resumo de 1 linha). Formulário com estado controlado: guarda só os campos mexidos (`edits`); o resto
 * segue o servidor. "Postar sozinho"/"Eu aprovo" valem na hora (diálogo); o resto só no "Salvar ajustes".
 */
export function VacanciesSettingsPanel({ workspaceId, settings, canEdit, canManage }: {
  workspaceId: string;
  settings: VacancySettings;
  canEdit: boolean;
  canManage: boolean;
}) {
  const qc = useQueryClient();
  const key = vacancySettingsKey(workspaceId);
  const [open, setOpen] = useState(!!settings.template && !settings.enabled && !settings.preview.run_id);
  const [edits, setEdits] = useState<Edits>({});
  const [autoDialog, setAutoDialog] = useState(false);
  const s = settings;

  const value = <K extends keyof Edits>(k: K) => (k in edits ? edits[k] : s[k]) as NonNullable<Edits[K]>;
  const set = <K extends keyof Edits>(k: K, v: NonNullable<Edits[K]>) => {
    if (save.isError) save.reset(); // nova edição depois da falha: o botão volta a "Salvar ajustes"
    setEdits((e) => {
      const next = { ...e, [k]: v };
      if (k === "cities" ? sameCities(v as string[], s.cities) : same(v, s[k])) delete next[k]; // voltou ao valor salvo: não conta como mudança
      return next;
    });
  };

  const cities = value("cities");
  const start = value("window_start");
  const end = value("window_end");
  const cap = value("daily_cap");
  const winErr = windowError(start, end);
  const dirty = FIELDS.some((f) => f in edits);

  const save = useMutation({
    mutationFn: () => patchVacancySettings(workspaceId, edits),
    onSuccess: (view) => {
      qc.setQueryData(key, view);
      setEdits({});
      toast.success("Ajustes salvos.");
    },
    // Os ajustes digitados ficam em `edits`; a barra mostra o erro e o "Tentar de novo".
  });

  const auto = useMutation({
    mutationFn: (v: boolean) => setVacancyAutoPublish(workspaceId, v),
    onSuccess: (view) => {
      qc.setQueryData(key, view);
      setAutoDialog(false);
      if (!view.auto_publish) {
        // A1: os prontos que ninguém aprovou voltaram para "Para aprovar" — lista, Aprovações e selo do menu mudam.
        toast.success(autoPublishOffToast(view.moved_to_approval));
        qc.invalidateQueries({ queryKey: vacancyListKey(workspaceId) });
        qc.invalidateQueries({ queryKey: ["ig-posts", workspaceId] });
        qc.invalidateQueries({ queryKey: ["ig-pending-badge", workspaceId] });
      }
    },
    onError: (e) => {
      setAutoDialog(false);
      toast.error(apiErrorMessage(e, "Não conseguimos mudar isso agora. Tente de novo."));
    },
  });

  // Cidades: as das vagas recentes + as já salvas que sumiram da lista (continuam marcadas).
  const known = new Set(s.recent_cities.map((c) => c.city));
  const options = [...s.recent_cities, ...s.cities.filter((c) => !known.has(c)).map((city) => ({ city, count: null as number | null }))];
  const toggleCity = (city: string) => set("cities", cities.includes(city) ? cities.filter((c) => c !== city) : [...cities, city]);

  const summary = settingsSummary(s);
  const weekly = weeklyFallbackWarning(s.week);
  const warn = capWarning(cap);
  const outcomes = autoPublishSummary(s.recent_outcomes);
  const disabled = !canEdit;

  return (
    <div className="space-y-4">
    {weekly && (
      <p className="flex items-start gap-2 rounded-lg border border-warning/40 bg-warning/10 p-3 text-sm" role="status">
        <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden /> {weekly}
      </p>
    )}
    <section className="panel" aria-labelledby="vac-settings-title">
      <h2 id="vac-settings-title" className="m-0">
        <button
          type="button"
          className="flex min-h-14 w-full items-center gap-3 p-5 text-left"
          aria-expanded={open}
          aria-controls="vac-settings-body"
          onClick={() => setOpen((o) => !o)}
        >
          <span className="min-w-0 flex-1">
            <span className="block text-base font-semibold">Ajustes</span>
            <span className="block text-sm font-normal text-muted-foreground">{summary}</span>
          </span>
          <ChevronDown className={`size-5 shrink-0 motion-safe:transition-transform ${open ? "rotate-180" : ""}`} aria-hidden />
        </button>
      </h2>

      {open && (
        <div id="vac-settings-body" className="space-y-4 px-5 pb-0">
          {s.template && (
            <>
              <TemplateCard workspaceId={workspaceId} settings={s} canEdit={canEdit} />
              <PreviewCard workspaceId={workspaceId} settings={s} canEdit={canEdit} />
            </>
          )}

          <Field title="Cidades" hint="Só vagas dessas cidades viram story.">
            <Option type="checkbox" checked={cities.length === 0} disabled={disabled} onChange={() => set("cities", [])}>
              Todas as cidades
            </Option>
            {options.length > 0 ? (
              <p className="text-xs text-muted-foreground">Cidades das vagas recentes</p>
            ) : (
              <p className="text-xs text-muted-foreground">{CITIES_EMPTY}</p>
            )}
            {options.map((c) => (
              <Option key={c.city} type="checkbox" checked={cities.includes(c.city)} disabled={disabled} onChange={() => toggleCity(c.city)}>
                {c.city}
                {c.count !== null && <span className="text-muted-foreground"> ({c.count})</span>}
              </Option>
            ))}
          </Field>

          <Field
            title="Horário para postar"
            hint={windowHint(start)}
            error={winErr}
          >
            <div className="flex items-center gap-2 text-sm">
              <label htmlFor="vac-win-start">Das</label>
              <Input id="vac-win-start" type="time" className="h-11 w-32" value={start} disabled={disabled} aria-invalid={!!winErr}
                aria-label="Início do horário para postar"
                onChange={(e) => set("window_start", e.target.value)} />
              <label htmlFor="vac-win-end">às</label>
              <Input id="vac-win-end" type="time" className="h-11 w-32" value={end} disabled={disabled} aria-invalid={!!winErr}
                aria-label="Fim do horário para postar"
                onChange={(e) => set("window_end", e.target.value)} />
            </div>
          </Field>

          <Field
            title="Máximo de stories de vagas por dia"
            hint="O Instagram aceita até 25 publicações por dia na conta, somando os posts normais. As vagas que passarem do máximo ficam para o dia seguinte, se ainda não tiverem começado."
          >
            <div className="flex items-center gap-3">
              <Button type="button" variant="outline" size="icon" className="size-11" aria-label="Diminuir" disabled={disabled || cap <= 1}
                onClick={() => set("daily_cap", Math.max(1, cap - 1))}>
                <Minus />
              </Button>
              <output className="min-w-8 text-center text-lg font-semibold tabular-nums" aria-live="polite">{cap}</output>
              <Button type="button" variant="outline" size="icon" className="size-11" aria-label="Aumentar" disabled={disabled || cap >= 20}
                onClick={() => set("daily_cap", Math.min(20, cap + 1))}>
                <Plus />
              </Button>
            </div>
            {warn && <p className="text-sm font-medium" role="status">{warn}</p>}
          </Field>

          <Field
            title="Só postar vagas que começam daqui a pelo menos"
            hint={`Vaga em cima da hora não dá tempo de alguém ver o story e se candidatar.${s.auto_publish ? "" : " Conte também o tempo que você leva para aprovar."}`}
          >
            <div className="flex flex-wrap gap-x-5">
              {LEADS.map((l) => (
                <Option key={l.value} type="radio" name="vac-lead" checked={value("min_lead_minutes") === l.value} disabled={disabled}
                  onChange={() => set("min_lead_minutes", l.value)}>
                  {l.label}
                </Option>
              ))}
            </div>
          </Field>

          <Field title="Quem desenha a arte" hint="Usa a chave da empresa em Integrações. Cada story gasta de 1 a 3 imagens; se cair na reserva, mais 1.">
            {VENDORS.map((v) => (
              <Option key={v.value} type="radio" name="vac-vendor" checked={value("vendor") === v.value} disabled={disabled}
                onChange={() => set("vendor", v.value)}>
                {v.label}
              </Option>
            ))}
          </Field>

          <Field title="Antes de ir ao ar" hint={canManage ? "Vale na hora, sem precisar salvar." : "Só o dono ou um administrador muda isso."}>
            <Option type="radio" name="vac-auto" checked={!s.auto_publish} disabled={!canManage || auto.isPending}
              onChange={() => auto.mutate(false)}>
              Eu aprovo cada story <span className="text-muted-foreground">(recomendado nas primeiras semanas)</span>
            </Option>
            <Option type="radio" name="vac-auto" checked={s.auto_publish} disabled={!canManage || auto.isPending}
              onChange={() => setAutoDialog(true)}>
              Postar sozinho
            </Option>
          </Field>

          {/* Barra fixa no pé da tela: só fica ativa quando algo mudou. */}
          <div className="sticky bottom-0 -mx-5 flex flex-col gap-2 border-t border-border bg-card px-5 py-3 sm:flex-row sm:items-center">
            {save.isError && (
              <p role="alert" className="flex-1 text-sm text-destructive">
                Não conseguimos salvar. Seus ajustes continuam aqui. Toque em Tentar de novo.
              </p>
            )}
            <Button className="h-11 sm:ml-auto" disabled={!canEdit || !dirty || !!winErr || save.isPending} onClick={() => save.mutate()}>
              {save.isPending ? "Salvando…" : save.isError ? "Tentar de novo" : "Salvar ajustes"}
            </Button>
          </div>
        </div>
      )}

      <AlertDialog open={autoDialog} onOpenChange={(o) => !o && !auto.isPending && setAutoDialog(false)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Postar sem sua aprovação?</AlertDialogTitle>
            <AlertDialogDescription>
              Os próximos stories vão ao ar sem passar por você. O sistema continua conferindo função, valor, data, horário e cidade; se a IA
              errar 3 vezes, usa a versão de reserva, com os textos escritos pelo sistema.{outcomes ? ` ${outcomes}` : ""}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className="gap-2">
            <AlertDialogCancel className="h-11">Continuar aprovando</AlertDialogCancel>
            <AlertDialogAction
              className="h-11"
              disabled={auto.isPending}
              onClick={(e) => {
                e.preventDefault(); // fecha só quando a API responder
                auto.mutate(true);
              }}
            >
              Postar sozinho
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
    </div>
  );
}
