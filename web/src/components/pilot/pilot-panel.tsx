"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Link } from "@/lib/router";
import { blockerView, creditsLine, nextIdempotencyKey, raiseCapTo, STEP_LABEL, stepStatusText, type PilotStepName } from "@/lib/pilot-text";
import {
  approvePilot, cancelPilot, createPilot, estimatePilot, resumePilot, usePilot, type PilotOptions, type PilotRun,
} from "@/modules/campaign-pilot/infrastructure/pilot.api";
import { apiErrorMessage } from "@/modules/shared/infrastructure/http";
import { PilotAdjust } from "./pilot-adjust";

/** A montagem do anúncio na Meta pelo piloto chega na Fatia 4; até lá o anúncio continua pelo "Publicar na Meta" de sempre. */
const PILOT_META_READY = false;
const MAX_PIECES = 10;
const RUN_STEPS: PilotStepName[] = ["copies", "instagram", "creatives", "meta"];
const WEEKDAYS = ["dom", "seg", "ter", "qua", "qui", "sex", "sáb"];

type Props = {
  workspaceId: string;
  campaign: { id: string; status: string; start_date?: string | null; end_date?: string | null };
  strategy: unknown;
  creatives: { id: string; title: string; preview_url?: string | null }[];
  canEdit: boolean;
  canManage: boolean;
  onChanged: () => void;
};

const ddmm = (iso?: string | null) => (iso ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}` : "");
const br = (n: number) => String(Math.round(n * 100) / 100).replace(".", ",");
const hm = (iso: string) => new Date(iso).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit", timeZone: "America/Sao_Paulo" });
const dateHour = (iso: string) => new Date(iso).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit", timeZone: "America/Sao_Paulo" });

/** Painel do estrategista (doc de UI, B e C): Pacote para aprovar uma vez, depois o Andamento com o que precisa da pessoa. */
export function PilotPanel({ workspaceId, campaign, strategy, creatives, canEdit, canManage, onChanged }: Props) {
  const qc = useQueryClient();
  const { data: run, isPending } = usePilot(workspaceId, campaign.id, true);
  const [busy, setBusy] = useState<string | null>(null);
  const key = useRef<string>(nextIdempotencyKey());
  const set = (r: PilotRun | null) => qc.setQueryData(["pilot", workspaceId, campaign.id], r);
  const act = async (name: string, fn: () => Promise<PilotRun>, ok?: string) => {
    setBusy(name);
    try {
      set(await fn());
      if (ok) toast.success(ok);
      onChanged();
    } catch (e) {
      toast.error(apiErrorMessage(e, "Não deu certo agora. Tente de novo."));
      void qc.invalidateQueries({ queryKey: ["pilot", workspaceId, campaign.id] });
    } finally {
      setBusy(null);
    }
  };

  // Peças novas prontas: o detalhe recarrega para as miniaturas e a aba de criativos mostrarem o que chegou.
  const doneCount = run?.summary?.counts.done ?? 0;
  const seen = useRef(doneCount);
  useEffect(() => {
    if (doneCount !== seen.current) { seen.current = doneCount; onChanged(); }
  }, [doneCount, onChanged]);

  if (isPending) return <section className="panel mb-6 p-5"><Skeleton className="h-24 w-full" /></section>;

  if (!run) {
    if (!canEdit || campaign.status === "finished") return null;
    return (
      <section aria-labelledby="pilot-title" className="panel mb-6 p-5">
        <h2 id="pilot-title" className="text-base font-semibold">O estrategista pode conduzir esta campanha</h2>
        <p className="mt-1 text-sm text-muted-foreground">Ele monta o plano, você aprova uma vez, e ele faz os textos, programa o Instagram e cria as artes e o vídeo.</p>
        <Button className="mt-3 h-11 sm:h-9" disabled={busy === "create"} onClick={() => void act("create", () => createPilot(workspaceId, campaign.id, key.current))}>
          {busy === "create" ? "Começando…" : "Deixar o estrategista conduzir"}
        </Button>
      </section>
    );
  }

  if (run.status === "planning") {
    return <PlanningView run={run} {...{ workspaceId, campaign, strategy, canEdit, canManage, busy, act }} />;
  }
  return <ProgressView run={run} {...{ workspaceId, campaign, creatives, canEdit, busy, act }} />;
}

type Act = (name: string, fn: () => Promise<PilotRun>, ok?: string) => Promise<void>;

function PlanningView({
  run, workspaceId, campaign, strategy, canEdit, canManage, busy, act,
}: { run: PilotRun; workspaceId: string; campaign: Props["campaign"]; strategy: unknown; canEdit: boolean; canManage: boolean; busy: string | null; act: Act }) {
  const st = run.steps.strategy;
  const [options, setOptions] = useState<PilotOptions | null>(run.suggested_options);
  const [adjusting, setAdjusting] = useState(false);
  useEffect(() => { if (!options && run.suggested_options) setOptions(run.suggested_options); }, [options, run.suggested_options]);
  const est = useQuery({
    queryKey: ["pilot-estimate", workspaceId, campaign.id, options],
    enabled: !!options && st?.status === "done" && canEdit,
    queryFn: () => estimatePilot(workspaceId, campaign.id, options!),
  });

  if (st?.status === "failed" || (st?.status === "blocked")) {
    return (
      <section aria-labelledby="pilot-title" className="panel mb-6 p-5">
        <h2 id="pilot-title" className="text-base font-semibold">O plano do estrategista</h2>
        <p role="alert" className="mt-1 text-sm">Não conseguimos montar o plano agora. Seu pedido está salvo nesta campanha.{st.error ? ` (${st.error})` : ""}</p>
        {canEdit && (
          <Button className="mt-3 h-11 sm:h-9" disabled={busy === "retry"} onClick={() => void act("retry", () => resumePilot(workspaceId, campaign.id, run.id, { action: "retry" }))}>
            Tentar de novo
          </Button>
        )}
      </section>
    );
  }
  if (st?.status !== "done" || !options) {
    return (
      <section aria-labelledby="pilot-title" className="panel mb-6 p-5">
        <h2 id="pilot-title" className="text-base font-semibold">O plano do estrategista</h2>
        <p role="status" className="mt-1 text-sm text-muted-foreground">Montando o plano. Leva até 1 minuto. Pode fechar a tela: ele continua sozinho.</p>
        <Skeleton className="mt-3 h-16 w-full" />
      </section>
    );
  }

  const s = (strategy ?? {}) as { big_idea?: string; mensagem_principal?: string; angulos_detalhados?: { nome?: string }[] };
  const angles = (s.angulos_detalhados ?? []).map((a) => a?.nome).filter(Boolean).slice(0, options.max_angles) as string[];
  const ig = options.instagram;
  const images = options.max_angles * options.images_per_angle;
  const e = est.data;
  const firstBlock = e?.blockers[0];

  return (
    <section aria-labelledby="pilot-title" className="panel mb-6 p-5 pb-24 sm:pb-5">
      <h2 id="pilot-title" className="text-base font-semibold">O plano do estrategista</h2>
      <p className="text-sm text-muted-foreground">Confira e aprove uma vez só.</p>

      <div className="mt-4 space-y-4 text-sm">
        <div>
          <h3 className="font-semibold">A ideia</h3>
          {s.big_idea && <p className="mt-1">“{s.big_idea}”</p>}
          {s.mensagem_principal && <p className="text-muted-foreground">{s.mensagem_principal}</p>}
          {angles.length > 0 && <p className="mt-1">{angles.length} {angles.length === 1 ? "jeito" : "jeitos"} de falar: {angles.join(" · ")}</p>}
        </div>
        <div className="border-t pt-3">
          <h3 className="font-semibold">No Instagram</h3>
          {ig.enabled ? (
            <p className="mt-1">
              {ig.weekdays.map((d) => WEEKDAYS[d]).join(", ")} · {[...ig.times, ...ig.story_times].join(", ")} · de {ddmm(campaign.start_date)} a {ddmm(campaign.end_date)}.{" "}
              {ig.mode === "approval" ? "Você aprova cada post antes." : "Posta sozinho depois da revisão automática."}
            </p>
          ) : (
            <p className="mt-1 text-muted-foreground">Instagram desligado neste pacote.</p>
          )}
        </div>
        <div className="border-t pt-3">
          <h3 className="font-semibold">Artes do anúncio</h3>
          <p className="mt-1">
            {images} {images === 1 ? "arte" : "artes"}{options.videos ? ` + ${options.videos} ${options.videos === 1 ? "vídeo vertical" : "vídeos verticais"}` : ""}. Ficam na campanha para você aprovar.
          </p>
          {!PILOT_META_READY && <p className="text-muted-foreground">O anúncio na Meta continua com você, pelo “Publicar na Meta” de sempre: nada é gasto lá sem o seu clique.</p>}
        </div>
        <div className="border-t pt-3">
          <h3 className="font-semibold">Custo de criação no Meu Funil</h3>
          {e ? (
            <details className="mt-1">
              <summary className="min-h-11 cursor-pointer sm:min-h-0">Até {br(e.estimate.total)} créditos · Ver a conta</summary>
              <ul className="mt-2 space-y-1">
                {e.estimate.items.map((i) => <li key={i.label}>{i.label}: {i.formula} = {br(i.value)}</li>)}
                <li className="font-medium">Teto desta campanha = {br(options.max_credits)}</li>
              </ul>
              <p className="mt-2 text-xs text-muted-foreground">De onde vem: {e.estimate.items[0]?.source}. Textos, plano e leitura das referências não gastam créditos.</p>
              {e.estimate.instagram && (
                <p className="mt-1 text-xs text-muted-foreground">{e.estimate.instagram.label}: {e.estimate.instagram.formula} = {br(e.estimate.instagram.value)} créditos.</p>
              )}
              <p className="mt-1 text-xs text-muted-foreground">Com chave de IA própria, quem cobra é a OpenAI/Google na sua conta, não o Meu Funil.</p>
            </details>
          ) : (
            <p className="mt-1 text-muted-foreground">{est.isFetching ? "Recalculando…" : "—"}</p>
          )}
        </div>
        {e && e.blockers.length > 0 && (
          <div id="pilot-blockers" tabIndex={-1} role="status" className="rounded-md border border-amber-500/50 bg-amber-500/5 p-3 outline-none">
            <p className="font-semibold">Antes de começar</p>
            <ul className="mt-1 list-disc pl-5">{e.blockers.map((b) => <li key={b.code}>{b.message}</li>)}</ul>
          </div>
        )}
      </div>

      {canEdit ? (
        <div className="fixed inset-x-0 bottom-0 z-20 border-t bg-background p-3 sm:static sm:mt-5 sm:border-0 sm:bg-transparent sm:p-0">
          <div className="flex flex-col gap-2 sm:flex-row">
            <Button
              className="h-11 sm:h-9"
              disabled={busy === "approve" || !e || run.strategy_version == null}
              onClick={() => {
                if (!e?.can_approve) { document.getElementById("pilot-blockers")?.focus(); return; }
                void act("approve", () => approvePilot(workspaceId, campaign.id, run.id, { strategy_version: run.strategy_version!, options }), "O estrategista começou.").then(() =>
                  setTimeout(() => document.getElementById("pilot-progress")?.focus(), 50),
                );
              }}
            >
              {busy === "approve" ? "Começando…" : e && !e.can_approve ? `Falta ${e.blockers.length === 1 ? "1 coisa" : `${e.blockers.length} coisas`} para começar` : "Aprovar e começar"}
            </Button>
            <Button variant="outline" className="h-11 sm:h-9" onClick={() => setAdjusting(true)}>Ajustar</Button>
          </div>
          {firstBlock && <span className="sr-only">{firstBlock.message}</span>}
        </div>
      ) : (
        <p className="mt-4 text-sm text-muted-foreground">Só quem edita a campanha pode começar.</p>
      )}
      <PilotAdjust open={adjusting} onOpenChange={setAdjusting} value={options} canManage={canManage} maxPieces={MAX_PIECES} onSave={(o) => { setOptions(o); setAdjusting(false); }} />
    </section>
  );
}

function ProgressView({
  run, workspaceId, campaign, creatives, canEdit, busy, act,
}: { run: PilotRun; workspaceId: string; campaign: Props["campaign"]; creatives: Props["creatives"]; canEdit: boolean; busy: string | null; act: Act }) {
  const [cancelIg, setCancelIg] = useState(false);
  const stopped = run.status === "blocked" || run.status === "failed";
  const slots = run.steps.creatives?.slots ?? [];
  const done = slots.filter((x) => x.status === "done").length;
  const max = run.max_credits ?? 0;
  const thumb = new Map(creatives.map((c) => [c.id, c]));
  const needs = (["strategy", ...RUN_STEPS] as PilotStepName[])
    .map((n) => ({ n, s: run.steps[n] }))
    .filter((x) => x.s && (x.s.status === "blocked" || x.s.status === "failed"));
  const active = run.status === "running" || run.status === "blocked";
  const pendingImgs = slots.filter((x) => x.status === "pending").length;

  const doAction = (kind: string) => {
    if (kind === "raise_cap") return act("raise_cap", () => resumePilot(workspaceId, campaign.id, run.id, { action: "raise_cap", max_credits: raiseCapTo(max) }));
    if (kind === "proceed_partial") return act("proceed_partial", () => resumePilot(workspaceId, campaign.id, run.id, { action: "proceed_partial" }));
    return act("retry", () => resumePilot(workspaceId, campaign.id, run.id, { action: "retry" }));
  };

  return (
    <section aria-labelledby="pilot-progress" className="panel mb-6 p-5">
      {needs.length > 0 && (
        <div role="status" aria-live="polite" className="mb-4 rounded-md border border-amber-500/50 bg-amber-500/5 p-3 text-sm">
          <p className="font-semibold">Precisa de você ({needs.length})</p>
          {needs.map(({ n, s }) => {
            const isCurrent = stopped && (run.current_step ?? "strategy") === n;
            const v = blockerView(s!.error_code, s!.error ?? "", { canEdit: canEdit && isCurrent, maxCredits: max, done, total: slots.length });
            return (
              <div key={n} className="mt-2">
                <p><span className="font-medium">{STEP_LABEL[n]}:</span> {v.message}</p>
                <div className="mt-2 flex flex-wrap gap-2">
                  {v.actions.map((a) =>
                    a.kind === "integrations" ? (
                      <Button key={a.kind} asChild variant="outline" className="h-11 sm:h-9"><Link to="/integrations">{a.label}</Link></Button>
                    ) : (
                      <Button key={a.kind} className="h-11 sm:h-9" disabled={!!busy} onClick={() => void doAction(a.kind)}>{a.label}</Button>
                    ),
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      <div className="flex items-baseline justify-between gap-2">
        <h2 id="pilot-progress" tabIndex={-1} className="text-base font-semibold outline-none">Andamento</h2>
        <span className="text-xs text-muted-foreground">atualizado às {hm(new Date().toISOString())}</span>
      </div>
      <ol className="mt-3 space-y-3 text-sm">
        <li>✓ Plano aprovado{run.approved_at ? ` · ${dateHour(run.approved_at)}` : ""}</li>
        {RUN_STEPS.map((n) => {
          const s = run.steps[n];
          if (!s) return null;
          return (
            <li key={n}>
              <p><span className="font-medium">{STEP_LABEL[n]}</span> · {stepStatusText(s)}</p>
              {n === "creatives" && slots.length > 0 && (
                <>
                  <ul className="mt-2 flex flex-wrap gap-2" aria-label={`${done} de ${slots.length} peças prontas`}>
                    {slots.map((x) => {
                      const c = x.creative_id ? thumb.get(x.creative_id) : undefined;
                      return (
                        <li key={x.slot} className="flex h-14 w-14 items-center justify-center overflow-hidden rounded border bg-muted text-xs text-muted-foreground">
                          {c?.preview_url && x.kind === "image" ? <img src={c.preview_url} alt={c.title} className="h-full w-full object-cover" /> : x.kind === "video" ? (x.status === "done" ? "▶" : "◐") : x.status === "failed" ? "✕" : ""}
                        </li>
                      );
                    })}
                  </ul>
                  {s.status === "running" && pendingImgs > 0 && (
                    <p className="mt-1 text-xs text-muted-foreground">Fazemos uma peça a cada 5 minutos: as {pendingImgs} que faltam levam uns {pendingImgs * 5} minutos. Pode fechar a tela.</p>
                  )}
                </>
              )}
            </li>
          );
        })}
      </ol>
      {max > 0 && <p className="mt-3 text-xs text-muted-foreground">{creditsLine(run.spent_credits, max, done)}</p>}
      {run.status === "done" && (
        <p role="status" className="mt-3 text-sm font-medium">
          Tudo pronto: textos, Instagram e artes.{!PILOT_META_READY && " Para anunciar, aprove as artes e use “Publicar na Meta” como sempre."}
        </p>
      )}
      {run.status === "cancelled" && (
        <p className="mt-3 text-sm text-muted-foreground">Estrategista parado. O que ficou pronto continua na campanha.</p>
      )}
      {run.status === "failed" && needs.length === 0 && <p className="mt-3 text-sm">✕ Parou com erro.</p>}

      {canEdit && active && (
        <AlertDialog>
          <AlertDialogTrigger asChild>
            <button type="button" className="mt-4 min-h-11 text-sm text-muted-foreground underline sm:min-h-0">Parar o estrategista</button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Parar o estrategista?</AlertDialogTitle>
              <AlertDialogDescription>O que já ficou pronto continua na campanha.</AlertDialogDescription>
            </AlertDialogHeader>
            {run.steps.instagram?.status === "done" && (
              <label className="flex min-h-11 items-center gap-2 text-sm">
                <input type="checkbox" checked={cancelIg} onChange={(e) => setCancelIg(e.target.checked)} />
                Cancelar também os posts programados do Instagram
              </label>
            )}
            <AlertDialogFooter>
              <AlertDialogCancel className="h-11 sm:h-9">Continuar trabalhando</AlertDialogCancel>
              <AlertDialogAction className="h-11 sm:h-9" onClick={() => void act("cancel", () => cancelPilot(workspaceId, campaign.id, run.id, cancelIg), "Estrategista parado.")}>
                Parar o estrategista
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      )}
    </section>
  );
}
