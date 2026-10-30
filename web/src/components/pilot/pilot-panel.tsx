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
import {
  blockerView, creditsLine, MAX_TRIES, nextIdempotencyKey, raiseCapTo, SOFT_BLOCKS, STEP_LABEL, stepStatus, type IconText, type PilotStepName,
} from "@/lib/pilot-text";
import {
  approvePilot, cancelPilot, createPilot, estimatePilot, resumePilot, usePilot, type PilotOptions, type PilotRun, type PilotSlot,
} from "@/modules/campaign-pilot/infrastructure/pilot.api";
import { apiErrorCode, apiErrorMessage } from "@/modules/shared/infrastructure/http";
import { PilotAdjust } from "./pilot-adjust";

/** Fatia 4: o piloto monta o anúncio PAUSADO na Meta; ligar é na conferência ("Pronto para ligar"). */
const PILOT_META_READY = true;
const MAX_PIECES = 10;
const RUN_STEPS: PilotStepName[] = PILOT_META_READY ? ["copies", "instagram", "creatives", "meta"] : ["copies", "instagram", "creatives"];
const WEEKDAYS = ["dom", "seg", "ter", "qua", "qui", "sex", "sáb"];
const IMG = 1.5;
const VID = 12;

type Props = {
  workspaceId: string;
  campaign: {
    id: string; status: string; start_date?: string | null; end_date?: string | null; budget_daily?: number | string | null; landing_url?: string | null;
    audience?: Record<string, unknown> | null; meta_campaign_id?: string | null; meta_delivery_status?: string | null;
  };
  strategy: unknown;
  strategyVersion: number | null;
  creatives: { id: string; title: string; preview_url?: string | null }[];
  canEdit: boolean;
  canManage: boolean;
  onChanged: () => void;
  onOpenTab: (tab: string) => void;
  /** Abre a conferência "Pronto para ligar" (a mesma do "Ativar na Meta" do cabeçalho). */
  onGoLive: () => void;
};
type Act = (name: string, fn: () => Promise<PilotRun>, opts?: { ok?: string; focus?: string }) => Promise<void>;

const ddmm = (iso?: string | null) => (iso ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}` : "");
const br = (n: number) => String(Math.round(n * 100) / 100).replace(".", ",");
const hm = (d: Date | string | number) => new Date(d).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit", timeZone: "America/Sao_Paulo" }).replace(":", "h");
const dateHour = (iso: string) => new Date(iso).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit", timeZone: "America/Sao_Paulo" });
const hours = (ts: string[]) => ts.map((t) => (t.endsWith(":00") ? `${Number(t.slice(0, 2))}h` : t.replace(":", "h"))).join(" e ");
const Icon = ({ v }: { v: IconText }) => <><span aria-hidden="true">{v.icon}</span> {v.text}</>;

/** Painel do estrategista (doc de UI, B e C; revisão do designer de 30/10): Plano para aprovar uma vez, depois o Andamento. */
export function PilotPanel(props: Props) {
  const { workspaceId, campaign, canEdit, onChanged } = props;
  const qc = useQueryClient();
  const q = usePilot(workspaceId, campaign.id, true);
  const run = q.data;
  const [busy, setBusy] = useState<string | null>(null);
  const key = useRef<string>(nextIdempotencyKey());

  const act: Act = async (name, fn, opts = {}) => {
    setBusy(name);
    try {
      qc.setQueryData(["pilot", workspaceId, campaign.id], await fn());
      if (opts.ok) toast.success(opts.ok);
      onChanged();
      if (opts.focus) setTimeout(() => document.getElementById(opts.focus!)?.focus(), 50);
    } catch (e) {
      const code = apiErrorCode(e);
      if (code === "STRATEGY_CHANGED" || code === "CONFLICT") {
        toast.info(apiErrorMessage(e, "O plano mudou. Confira de novo."));
        onChanged();
      } else {
        toast.error(apiErrorMessage(e, "Não conseguimos salvar. Verifique a conexão e toque em Tentar de novo."));
      }
      void qc.invalidateQueries({ queryKey: ["pilot", workspaceId, campaign.id] });
    } finally {
      setBusy(null);
    }
  };

  // Plano pronto ou peça nova pronta: o detalhe recarrega (a ideia, as miniaturas e a aba de criativos mostram o que chegou).
  const marker = `${run?.steps.strategy?.status ?? ""}:${run?.summary?.counts.done ?? 0}`;
  const seen = useRef(marker);
  useEffect(() => {
    if (marker !== seen.current) { seen.current = marker; onChanged(); }
  }, [marker, onChanged]);

  // Parado ou com erro: o "Começar de novo" usa uma chave nova (a antiga devolveria a execução parada).
  useEffect(() => {
    if (run && (run.status === "cancelled" || run.status === "failed")) key.current = nextIdempotencyKey();
  }, [run?.id, run?.status]); // eslint-disable-line react-hooks/exhaustive-deps -- só muda quando a execução ou o status mudam

  const start = (label: string) => (
    <Button className="mt-3 h-11 lg:h-9" disabled={busy === "create"} onClick={() => { const k = key.current; void act("create", () => createPilot(workspaceId, campaign.id, k)); }}>
      {busy === "create" ? "Começando…" : label}
    </Button>
  );

  if (q.isPending) return <section className="panel mb-6 p-5"><Skeleton className="h-24 w-full" /></section>;
  if (q.isError) {
    return (
      <section className="panel mb-6 p-5">
        <p role="alert" className="text-sm">Não conseguimos ver o andamento do estrategista agora. Verifique a conexão e toque em Tentar de novo.</p>
        <Button variant="outline" className="mt-3 h-11 lg:h-9" onClick={() => void q.refetch()}>Tentar de novo</Button>
      </section>
    );
  }

  if (!run) {
    if (!canEdit || campaign.status === "finished") return null;
    return (
      <section aria-labelledby="pilot-title" className="panel mb-6 p-5">
        <h2 id="pilot-title" className="text-base font-semibold">O estrategista pode conduzir esta campanha</h2>
        <p className="mt-1 text-sm text-muted-foreground">Ele monta o plano, você aprova uma vez, e ele faz os textos, programa o Instagram e cria as artes e o vídeo.</p>
        {start("Deixar o estrategista conduzir")}
      </section>
    );
  }

  const restart = () => {
    if (!canEdit || campaign.status === "finished") return null;
    return (
      <div className="mt-3">
        <p className="text-sm text-muted-foreground">Ele monta um plano novo; o que ficou pronto continua na campanha.</p>
        {start("Começar de novo com o estrategista")}
      </div>
    );
  };

  if (run.approved_at == null && run.status !== "cancelled") return <PlanningView run={run} {...props} busy={busy} act={act} />;
  return <ProgressView run={run} {...props} busy={busy} act={act} updatedAt={q.dataUpdatedAt} restart={restart} />;
}

function PlanningView({
  run, workspaceId, campaign, strategy, strategyVersion, canEdit, canManage, busy, act,
}: Props & { run: PilotRun; busy: string | null; act: Act }) {
  const st = run.steps.strategy;
  const [options, setOptions] = useState<PilotOptions | null>(run.suggested_options);
  const [capTouched, setCapTouched] = useState(false);
  const [adjusting, setAdjusting] = useState(false);
  useEffect(() => { if (!options && run.suggested_options) setOptions(run.suggested_options); }, [options, run.suggested_options]);
  const est = useQuery({
    queryKey: ["pilot-estimate", workspaceId, campaign.id, options],
    enabled: !!options && st?.status === "done" && canEdit,
    queryFn: () => estimatePilot(workspaceId, campaign.id, options!),
  });
  // O teto acompanha a conta até a pessoa mexer nele (assim o plano não nasce para parar no meio).
  const total = est.data?.estimate.total;
  useEffect(() => {
    if (!capTouched && options && total != null && total > 0 && total <= 500 && options.max_credits !== total) setOptions({ ...options, max_credits: Math.ceil(total) });
  }, [capTouched, options, total]);

  const failed = run.status === "blocked" || run.status === "failed" || st?.status === "failed";
  if (failed) {
    const v = blockerView(st?.error_code ?? "STEP_FAILED", st?.error ?? "", { canEdit, step: "strategy", spent: 0, remaining: 0, done: 0 });
    return (
      <section aria-labelledby="pilot-title" className="panel mb-6 p-5">
        <h2 id="pilot-title" className="text-base font-semibold">O plano do estrategista</h2>
        <div role="alert" className="mt-1 text-sm">
          <p>Não conseguimos montar o plano agora. Seu pedido está salvo nesta campanha.</p>
          {st?.error && <p className="text-muted-foreground">Motivo: {st.error}</p>}
        </div>
        <div className="mt-3 flex flex-wrap gap-2">
          {v.actions.map((a) =>
            a.kind === "integrations" ? (
              <Button key={a.kind} asChild variant="outline" className="h-11 lg:h-9"><Link to="/integrations">{a.label}</Link></Button>
            ) : (
              <Button key={a.kind} className="h-11 lg:h-9" disabled={!!busy} onClick={() => void act("retry", () => resumePilot(workspaceId, campaign.id, run.id, { action: "retry" }))}>
                {a.label}
              </Button>
            ),
          )}
        </div>
      </section>
    );
  }

  const s = (strategy ?? null) as { big_idea?: string; mensagem_principal?: string; angulos_detalhados?: { nome?: string }[] } | null;
  if (st?.status !== "done" || !options || !s?.big_idea) {
    const retrying = (st?.attempts ?? 0) > 0;
    return (
      <section aria-labelledby="pilot-title" className="panel mb-6 p-5">
        <h2 id="pilot-title" className="text-base font-semibold">O plano do estrategista</h2>
        <p role="status" className="mt-1 text-sm text-muted-foreground">
          {st?.status === "done"
            ? "Carregando o plano…"
            : retrying
              ? `Está demorando mais que o normal. Tentamos de novo sozinhos${run.next_run_at ? ` às ${hm(run.next_run_at)}` : " em alguns minutos"} (tentativa ${(st?.attempts ?? 0) + 1} de ${MAX_TRIES}). Pode fechar a tela.`
              : "Montando o plano. Leva até 1 minuto. Pode fechar a tela: ele continua sozinho."}
        </p>
        <Skeleton className="mt-3 h-16 w-full" />
      </section>
    );
  }

  const angles = (s.angulos_detalhados ?? []).map((a) => a?.nome).filter(Boolean).slice(0, options.max_angles) as string[];
  const ig = options.instagram;
  const images = options.max_angles * options.images_per_angle;
  const e = est.data;
  const capLow = e && options.max_credits < e.estimate.total;
  const approve = () => {
    if (!e?.can_approve) { document.getElementById("pilot-blockers")?.focus(); return; }
    const version = strategyVersion ?? run.strategy_version!;
    // Dono/admin aprova o anúncio junto (um toque); marketing começa e o pedido fica em Approvals.
    const approveNow = canManage && options.meta.enabled;
    void act("approve", () => approvePilot(workspaceId, campaign.id, run.id, { strategy_version: version, options, approve_now: approveNow }), { ok: "O estrategista começou.", focus: "pilot-progress" });
  };
  const adjust = (
    <Button variant="link" className="h-11 px-0 lg:h-auto" onClick={() => setAdjusting(true)} disabled={!canEdit}>Ajustar</Button>
  );

  return (
    <section aria-labelledby="pilot-title" className="panel mb-6 p-5">
      <h2 id="pilot-title" className="text-base font-semibold">O plano do estrategista</h2>
      <p className="text-sm text-muted-foreground">Confira e aprove uma vez só.</p>

      <div className="mt-4 space-y-4 text-sm">
        <div>
          <h3 className="font-semibold">A ideia</h3>
          <p className="mt-1">“{s.big_idea}”</p>
          {s.mensagem_principal && <p className="text-muted-foreground">{s.mensagem_principal}</p>}
          {angles.length > 0 && <p className="mt-1">{angles.length} {angles.length === 1 ? "jeito" : "jeitos"} de falar: {angles.join(" · ")}</p>}
        </div>
        <div className="border-t pt-3">
          <div className="flex items-center justify-between gap-2"><h3 className="font-semibold">No Instagram (sem custo de Meta)</h3>{canEdit && adjust}</div>
          {ig.enabled ? (
            <p className="mt-1">
              {ig.weekdays.map((d) => WEEKDAYS[d]).join(", ")}
              {ig.times.length > 0 && ` · posts às ${hours(ig.times)}`}
              {ig.story_times.length > 0 && `, stories às ${hours(ig.story_times)}`}
              {campaign.end_date ? ` · de ${ddmm(campaign.start_date)} a ${ddmm(campaign.end_date)}.` : "."}{" "}
              {ig.mode === "approval" ? "Você aprova cada post antes." : "Posta sozinho depois da revisão automática."}
            </p>
          ) : (
            <p className="mt-1 text-muted-foreground">Instagram desligado neste plano.</p>
          )}
          {ig.enabled && !campaign.end_date && <p className="mt-1">A campanha não tem data de fim: os posts do Instagram não serão programados. Ponha a data no Briefing.</p>}
        </div>
        <div className="border-t pt-3">
          <div className="flex items-center justify-between gap-2"><h3 className="font-semibold">Artes do anúncio</h3>{canEdit && adjust}</div>
          <p className="mt-1">
            {images} {images === 1 ? "arte" : "artes"} ({options.max_angles} {options.max_angles === 1 ? "jeito" : "jeitos"} de falar × {options.images_per_angle})
            {options.videos ? ` + ${options.videos} ${options.videos === 1 ? "vídeo vertical" : "vídeos verticais"}` : ""}. Cada arte sai em {options.variations}{" "}
            {options.variations === 1 ? "versão" : "versões"} e a revisão automática fica com a melhor.
          </p>
          {!PILOT_META_READY && (
            <p className="text-muted-foreground">O anúncio na Meta continua com você: depois das artes, toque em Solicitar aprovação e, aprovado, em Publicar na Meta. Nada é gasto lá sem o seu clique.</p>
          )}
        </div>
        {PILOT_META_READY && options.meta.enabled && <AdBlock campaign={campaign} />}
        <div className="border-t pt-3">
          <h3 className="font-semibold">Custo de criação no Meu Funil</h3>
          {!canEdit ? (
            <p className="mt-1 text-muted-foreground">O custo aparece para quem edita a campanha.</p>
          ) : est.isError ? (
            <div className="mt-1">
              <p role="alert">Não conseguimos calcular o custo agora. Verifique a conexão e toque em Tentar de novo.</p>
              <Button variant="outline" className="mt-2 h-11 lg:h-9" onClick={() => void est.refetch()}>Tentar de novo</Button>
            </div>
          ) : e ? (
            <details className="mt-1">
              <summary className="min-h-11 cursor-pointer lg:min-h-0">Até {br(e.estimate.total)} créditos · teto {br(options.max_credits)} · Ver a conta</summary>
              <ul className="mt-2 space-y-1">
                {e.estimate.items.map((i) => <li key={i.label}>{i.label}: {i.formula} = {br(i.value)}</li>)}
                <li className="font-medium">Total = {br(e.estimate.total)} · teto desta campanha = {br(options.max_credits)}</li>
              </ul>
              <p className="mt-2">De onde vem: {e.estimate.items[0]?.source}. Textos, plano e leitura das referências não gastam créditos.</p>
              {e.estimate.instagram && <p className="mt-1">{e.estimate.instagram.label}: {e.estimate.instagram.formula} = {br(e.estimate.instagram.value)} créditos.</p>}
              <p className="mt-1">Com chave de IA própria, quem cobra é a OpenAI/Google na sua conta, não o Meu Funil.</p>
            </details>
          ) : (
            <p className="mt-1 text-muted-foreground">Calculando o custo…</p>
          )}
          {capLow && <p className="mt-1">A conta deste plano dá {br(e.estimate.total)} créditos e o teto está em {br(options.max_credits)}: o estrategista vai parar antes de terminar.</p>}
        </div>
        {e && e.blockers.length > 0 && (
          <div id="pilot-blockers" tabIndex={-1} role="status" className="rounded-md border border-amber-500/50 bg-amber-500/5 p-3 focus-visible:ring-2 focus-visible:ring-ring">
            <h3 className="font-semibold">Antes de começar</h3>
            <ul className="mt-1 list-disc pl-5">{e.blockers.map((b) => <li key={b.code}>{b.message}</li>)}</ul>
            {e.blockers.some((b) => b.action === "adjust") && canEdit && adjust}
          </div>
        )}
      </div>

      {canEdit ? (
        <div className="sticky bottom-0 -mx-5 mt-5 border-t bg-background px-5 pt-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))] lg:static lg:mx-0 lg:border-0 lg:bg-transparent lg:px-0 lg:pb-0">
          <Button className="h-11 w-full lg:h-9 lg:w-auto" disabled={busy === "approve" || !e} onClick={approve}>
            {busy === "approve"
              ? "Começando…"
              : !e
                ? "Calculando o custo…"
                : !e.can_approve
                  ? `Falta ${e.blockers.length === 1 ? "1 coisa" : `${e.blockers.length} coisas`} para começar`
                  : canManage || !options.meta.enabled ? "Aprovar e começar" : "Começar e pedir aprovação do anúncio"}
          </Button>
          <p className="mt-1 text-sm text-muted-foreground">
            {!canManage && options.meta.enabled
              ? "Textos, artes e Instagram começam agora. O anúncio espera o dono ou um admin aprovar em Approvals."
              : "Nada é gasto na Meta até você ligar o anúncio."}
          </p>
        </div>
      ) : (
        <p className="mt-4 text-sm text-muted-foreground">Só quem edita a campanha pode começar.</p>
      )}
      <PilotAdjust
        open={adjusting}
        onOpenChange={setAdjusting}
        value={options}
        canManage={canManage}
        maxPieces={MAX_PIECES}
        onSave={(o, touched) => { setOptions(o); if (touched) setCapTouched(true); setAdjusting(false); }}
      />
    </section>
  );
}

function slotLabel(x: PilotSlot) {
  const state = x.status === "done" ? "pronta" : x.status === "failed" ? "falhou" : x.status === "pending" ? "na fila" : x.status === "skipped" ? "pulada" : "fazendo";
  return `${x.kind === "video" ? "Vídeo" : "Arte"} ${x.slot}: ${state}`;
}

function ProgressView({
  run, workspaceId, campaign, creatives, canEdit, canManage, busy, act, updatedAt, restart, onOpenTab, onGoLive,
}: Props & { run: PilotRun; busy: string | null; act: Act; updatedAt: number; restart: () => React.ReactNode }) {
  const [cancelIg, setCancelIg] = useState(false);
  const stopped = run.status === "blocked" || run.status === "failed";
  const cancelled = run.status === "cancelled";
  const slots = run.steps.creatives?.slots ?? [];
  const done = slots.filter((x) => x.status === "done").length;
  const max = run.max_credits ?? 0;
  const variations = ((run.options ?? {}) as { variations?: number }).variations ?? 3;
  // Mesma conta do servidor para uma nova rodada das peças que falharam (imagem = versões × 1,5 + 1,5; vídeo = 12).
  const roundCost = slots.filter((x) => x.status === "failed").reduce((a, x) => a + (x.kind === "video" ? VID : variations * IMG + IMG), 0);
  const thumb = new Map(creatives.map((c) => [c.id, c]));
  const needs = (["strategy", "copies", "instagram", "creatives", "meta"] as PilotStepName[])
    .map((n) => ({ n, s: run.steps[n] }))
    .filter((x) => x.s && (x.s.status === "blocked" || x.s.status === "failed") && !SOFT_BLOCKS.has(x.s.error_code ?? ""));
  const active = run.status === "running" || run.status === "blocked";
  const pending = slots.filter((x) => x.status === "pending").length;

  const doAction = (kind: string) => {
    const opts = { focus: "pilot-progress" };
    if (kind === "raise_cap") return act("raise_cap", () => resumePilot(workspaceId, campaign.id, run.id, { action: "raise_cap", max_credits: raiseCapTo(run.spent_credits, run.remaining_credits) }), opts);
    if (kind === "proceed_partial") return act("proceed_partial", () => resumePilot(workspaceId, campaign.id, run.id, { action: "proceed_partial" }), opts);
    return act("retry", () => resumePilot(workspaceId, campaign.id, run.id, { action: "retry" }), opts);
  };

  return (
    <section aria-labelledby="pilot-progress" className="panel mb-6 p-5">
      <div role="status" aria-live="polite">
        {needs.length > 0 && (
          <div className="mb-4 rounded-md border border-amber-500/50 bg-amber-500/5 p-3 text-sm">
            <h3 className="font-semibold">Precisa de você ({needs.length})</h3>
            {needs.map(({ n, s }) => {
              // Etapa corrente parada, ou esperando sozinha (aprovação, Meta): as ações valem; bloqueio antigo de outra etapa é só aviso.
              const isCurrent = (run.current_step ?? "strategy") === n && (stopped || s!.status === "blocked");
              const v = blockerView(s!.error_code, s!.error ?? "", { canEdit: canEdit && isCurrent, canManage, step: n, spent: run.spent_credits, remaining: run.remaining_credits, done, roundCost });
              return (
                <div key={n} className="mt-2">
                  <p><span className="font-medium">{STEP_LABEL[n]}:</span> {v.message}</p>
                  {!canEdit && <p className="text-muted-foreground">Quem edita a campanha resolve isso.</p>}
                  <div className="mt-2 flex flex-wrap gap-2">
                    {v.actions.map((a) =>
                      a.kind === "integrations" || a.kind === "approvals" ? (
                        <Button key={a.kind} asChild variant="outline" className="h-11 lg:h-9">
                          <Link to={a.kind === "integrations" ? "/integrations" : "/approvals"}>{a.label}</Link>
                        </Button>
                      ) : a.kind === "briefing" || a.kind === "creatives" ? (
                        <Button key={a.kind} variant="outline" className="h-11 lg:h-9" onClick={() => onOpenTab(a.kind === "briefing" ? "briefing" : "criativos")}>{a.label}</Button>
                      ) : (
                        <Button key={a.kind} className="h-11 lg:h-9" disabled={!!busy} onClick={() => void doAction(a.kind)}>{a.label}</Button>
                      ),
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      <div className="flex items-baseline justify-between gap-2">
        <h2 id="pilot-progress" tabIndex={-1} className="text-base font-semibold outline-none focus-visible:ring-2 focus-visible:ring-ring">Andamento</h2>
        {updatedAt > 0 && <span className="text-sm text-muted-foreground">atualizado às {hm(updatedAt)}</span>}
      </div>
      <ol className="mt-3 space-y-3 text-sm">
        <li><span aria-hidden="true">✓</span> Plano aprovado{run.approved_at ? ` · ${dateHour(run.approved_at)}` : ""}</li>
        {RUN_STEPS.map((n) => {
          const s = run.steps[n];
          if (!s) return null;
          return (
            <li key={n}>
              <p><span className="font-medium">{STEP_LABEL[n]}</span> · <Icon v={stepStatus(s, { cancelled })} /></p>
              {n === "instagram" && s.error_code === "NO_IG_PLAN" && canEdit && (
                <Button variant="link" className="h-11 px-0 lg:h-auto" onClick={() => onOpenTab("estrategia")}>Criar o plano do Instagram na aba Estratégia</Button>
              )}
              {n === "instagram" && s.error_code === "IG_NOT_SCHEDULED" && canEdit && (
                <Button variant="link" className="h-11 px-0 lg:h-auto" onClick={() => onOpenTab("briefing")}>Ver o briefing da campanha</Button>
              )}
              {n === "creatives" && slots.length > 0 && (
                <>
                  <ul className="mt-2 flex flex-wrap gap-2">
                    {slots.map((x) => {
                      const c = x.creative_id ? thumb.get(x.creative_id) : undefined;
                      return (
                        <li key={x.slot} className="flex h-14 w-14 items-center justify-center overflow-hidden rounded border bg-muted text-sm text-muted-foreground">
                          <span className="sr-only">{slotLabel(x)}</span>
                          {c?.preview_url && x.kind === "image" ? (
                            <img src={c.preview_url} alt="" className="h-full w-full object-cover" />
                          ) : (
                            <span aria-hidden="true">{x.kind === "video" ? (x.status === "done" ? "▶" : "◐") : x.status === "failed" ? "✕" : ""}</span>
                          )}
                        </li>
                      );
                    })}
                  </ul>
                  {s.status === "running" && pending > 0 && (
                    <p className="mt-1 text-sm text-muted-foreground">Fazemos uma peça a cada 5 minutos: as {pending} que faltam levam uns {pending * 5} minutos. Pode fechar a tela.</p>
                  )}
                  {done > 0 && (
                    <Button variant="link" className="h-11 px-0 lg:h-auto" onClick={() => onOpenTab("criativos")}>Ver e aprovar as artes</Button>
                  )}
                </>
              )}
            </li>
          );
        })}
      </ol>
      {max > 0 && <p className="mt-3 text-sm text-muted-foreground">{creditsLine(run.spent_credits, max)}</p>}
      {run.status === "done" && PILOT_META_READY && campaign.meta_campaign_id && (
        <div role="status" className="mt-3 text-sm">
          {campaign.meta_delivery_status === "ACTIVE" ? (
            <p className="font-medium"><span aria-hidden="true">●</span> No ar. Os resultados aparecem aqui a cada 3 horas.</p>
          ) : (
            <>
              <p className="font-medium"><span aria-hidden="true">✓</span> Tudo pronto. O anúncio está montado na Meta e desligado.</p>
              {canManage ? (
                <Button className="mt-2 h-11 w-full lg:h-9 lg:w-auto" onClick={onGoLive}>Conferir e ligar o anúncio</Button>
              ) : (
                <p className="mt-1">Só o dono ou um admin liga o anúncio. Avise quem aprova.</p>
              )}
            </>
          )}
        </div>
      )}
      {run.status === "done" && !(PILOT_META_READY && campaign.meta_campaign_id) && (
        <div role="status" className="mt-3 text-sm">
          <p className="font-medium">Tudo pronto: textos, Instagram e artes.</p>
          {!PILOT_META_READY && (
            <p className="mt-1">
              Para anunciar: 1) aprove as artes que vão para o anúncio; 2) toque em Solicitar aprovação (o dono ou um admin aprova em Approvals); 3) toque em
              Publicar na Meta: o anúncio é montado desligado.
            </p>
          )}
        </div>
      )}
      {cancelled && <p id="pilot-stopped" tabIndex={-1} className="mt-3 text-sm outline-none">Estrategista parado. O que ficou pronto continua na campanha.</p>}
      {run.status === "failed" && needs.length === 0 && <p className="mt-3 text-sm"><span aria-hidden="true">✕</span> Parou com erro.</p>}
      {(cancelled || run.status === "failed") && restart()}

      {canEdit && active && (
        <AlertDialog>
          <AlertDialogTrigger asChild>
            <button type="button" className="mt-4 min-h-11 text-sm text-muted-foreground underline lg:min-h-0">Parar o estrategista</button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Parar o estrategista?</AlertDialogTitle>
              <AlertDialogDescription>
                O que já ficou pronto continua na campanha. As peças que faltam não serão feitas. Para retomar, toque depois em Começar de novo.
              </AlertDialogDescription>
            </AlertDialogHeader>
            {run.steps.instagram?.status === "done" && (
              <label className="flex min-h-11 items-center gap-2 text-sm">
                <input type="checkbox" checked={cancelIg} onChange={(e) => setCancelIg(e.target.checked)} />
                Cancelar também os posts programados do Instagram
              </label>
            )}
            <AlertDialogFooter>
              <AlertDialogCancel className="h-11 lg:h-9">Continuar trabalhando</AlertDialogCancel>
              <AlertDialogAction className="h-11 lg:h-9" onClick={() => void act("cancel", () => cancelPilot(workspaceId, campaign.id, run.id, cancelIg), { ok: "Estrategista parado.", focus: "pilot-stopped" })}>
                Parar o estrategista
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      )}
    </section>
  );
}

/** Bloco "Anúncio pago na Meta" do plano (doc de UI, B1): o que vai rodar, com a conta da verba. Falta de destino/verba já aparece aqui. */
function AdBlock({ campaign }: { campaign: Props["campaign"] }) {
  const aud = (campaign.audience ?? {}) as { persona?: string; localizacao?: string };
  const daily = Number(campaign.budget_daily ?? 0);
  const days = campaign.start_date && campaign.end_date ? Math.round((Date.parse(campaign.end_date) - Date.parse(campaign.start_date)) / 86_400_000) + 1 : null;
  const money = (n: number) => n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
  return (
    <div className="border-t pt-3">
      <h3 className="font-semibold">Anúncio pago na Meta</h3>
      <p className="mt-1">Fica montado e <strong>desligado</strong>: não gasta nada até você ligar.</p>
      <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
        {aud.persona && (<><dt className="text-muted-foreground">Para quem</dt><dd>{aud.persona}</dd></>)}
        <dt className="text-muted-foreground">Onde</dt><dd>{aud.localizacao || "Falta a região da campanha."}</dd>
        {days != null && (<><dt className="text-muted-foreground">Quando</dt><dd>{ddmm(campaign.start_date)} a {ddmm(campaign.end_date)} ({days} dias)</dd></>)}
        <dt className="text-muted-foreground">Quanto</dt>
        <dd>{daily > 0 ? (days != null ? `${money(daily)}/dia × ${days} dias = até cerca de ${money(daily * days)}, cobrados pela Meta` : `${money(daily)} por dia`) : "Falta dizer quanto gastar por dia."}</dd>
        <dt className="text-muted-foreground">Quem clicar</dt><dd className="break-all">{campaign.landing_url || "Falta dizer para onde vai quem clicar."}</dd>
      </dl>
    </div>
  );
}

