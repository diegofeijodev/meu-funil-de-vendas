"use client";

import { useCallback, useEffect, useId, useRef, useState, type ReactNode } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { AlertTriangle, CircleAlert } from "lucide-react";
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
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Switch } from "@/components/ui/switch";
import { StyleRefRow } from "@/components/style-ref-row";
import { StyleRefsPanel } from "@/components/style-refs-panel";
import { fullDate } from "@/lib/format";
import { Link } from "@/lib/router";
import { useWorkspace } from "@/lib/workspace";
import { cn } from "@/lib/utils";
import {
  SELECTION_TEXT,
  allSelectionSourcesFailed,
  branchConsequence,
  branchSubmitLabel,
  branchToast,
  removedToast,
  selectionPollInterval,
  selectionSignature,
  selectionState,
  visibleRefs,
} from "@/lib/style-refs";
import { updateBrand } from "@/modules/brands/infrastructure/brands.api";
import { useFeatures } from "@/modules/features/infrastructure/features.api";
import { apiErrorMessage } from "@/modules/shared/infrastructure/http";
import { getStyleLibrary, listStyleRefs, removeStyleRef, type StyleRef } from "@/modules/style-refs/infrastructure/style-refs.api";

/** Estados em que a linha do ramo, o contador e as listas da seleção fazem sentido (ui.md §3.3: 6 a 12). */
const BRANCH_STATES = ["6", "7", "7b", "8", "8b", "9", "10", "10b", "10c", "11", "12"];
const NONE = "none";

const actionBtn = "h-11 w-full sm:w-auto";

/**
 * Corpo da seção "Estilo das artes" na Marca: o painel das próprias referências e, abaixo, o bloco "Seleção do Meu Funil".
 * A região viva é uma só (ui.md §3.7): recebe as frases do painel; o bloco não anuncia nada além disso (os avisos dele são toasts).
 */
export function StyleArtsBody({ workspaceId, brandId, canEdit }: { workspaceId: string; brandId: string; canEdit: boolean }) {
  const [live, setLive] = useState("");
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const announce = useCallback((msg: string) => {
    // Limpa antes: a mesma frase duas vezes seguidas precisa mudar o DOM para ser anunciada de novo.
    setLive("");
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setLive(msg), 100);
  }, []);
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );
  return (
    <>
      <p aria-live="polite" className="sr-only">
        {live}
      </p>
      <StyleRefsPanel workspaceId={workspaceId} brandId={brandId} campaignId={null} canEdit={canEdit} selection="below" announce={announce} />
      <StyleSelection workspaceId={workspaceId} brandId={brandId} canEdit={canEdit} />
    </>
  );
}

function StateLine({ tone, id, children }: { tone: "muted" | "error" | "warning"; id: string; children: ReactNode }) {
  if (tone === "muted") {
    return (
      <p id={id} tabIndex={-1} className="whitespace-pre-line text-sm text-muted-foreground outline-none">
        {children}
      </p>
    );
  }
  const Icon = tone === "error" ? CircleAlert : AlertTriangle;
  return (
    <div className={cn("flex items-start gap-2 rounded-lg border p-3 text-sm", tone === "error" ? "border-destructive/40 bg-destructive/10" : "border-warning/40 bg-warning/10")}>
      <Icon className="mt-0.5 size-4 shrink-0" aria-hidden />
      <p id={id} tabIndex={-1} className="flex-1 whitespace-pre-line outline-none">
        {children}
      </p>
    </div>
  );
}

/** "Seleção do Meu Funil" na aba Guia visual da Marca (ui.md §3). Só aparece com `features.style_library`. */
export function StyleSelection({ workspaceId, brandId, canEdit }: { workspaceId: string; brandId: string; canEdit: boolean }) {
  const qc = useQueryClient();
  const { role } = useWorkspace();
  const isAdmin = role === "owner" || role === "admin";
  const features = useFeatures(workspaceId);
  const on = features.data?.style_library === true;
  const listKey = ["style-refs", workspaceId, brandId, null];
  const viewKey = ["style-library", workspaceId, brandId];
  const expId = useId();
  const stateId = useId();
  const pickId = useId();
  const toggleNameId = useId();
  const toggleId = `style-selection-toggle-${brandId}`;

  const [justChanged, setJustChanged] = useState(false);
  const justRef = useRef(false);
  const pollStart = useRef<number | null>(null);
  const markChanged = () => {
    justRef.current = true;
    pollStart.current = Date.now();
    setJustChanged(true);
  };
  const [pending, setPending] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);
  const [hidden, setHidden] = useState<ReadonlySet<string>>(new Set());
  const [expanded, setExpanded] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [picked, setPicked] = useState<string | null>(null);
  const [confirmOff, setConfirmOff] = useState(false);
  const pickerRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const failedRef = useRef(false);
  const [focusState, setFocusState] = useState(false);
  const panelId = useId();
  const prevSig = useRef<string | null>(null);

  // Mesma consulta e mesma chave do painel das próprias: a lista é buscada uma vez só.
  const list = useQuery({ queryKey: listKey, enabled: on, queryFn: () => listStyleRefs(workspaceId, brandId, null) });
  const selSources = (list.data?.sources ?? []).filter((s) => s.origin === "selection" && !hidden.has(s.id));
  const selRefs = (list.data?.refs ?? []).filter((r) => r.origin === "selection" && !hidden.has(r.id));
  const allFailed = allSelectionSourcesFailed(selSources);

  const view = useQuery({
    queryKey: viewKey,
    enabled: on,
    retry: false,
    queryFn: () => getStyleLibrary(workspaceId, brandId),
    // Estados 10b/11/12 com leitura: confere a cada 10 s por até 10 min (ui.md §3.7).
    refetchInterval: (q) => {
      const v = q.state.data;
      if (!v) return false;
      const ctx = { loading: false, error: false, canEdit, isAdmin, justChanged: justRef.current, allSourcesFailed: failedRef.current };
      const st = selectionState(v, ctx);
      if (selectionPollInterval(st.id, v.reading, 0) === false) {
        return false;
      }
      // O relógio dos 10 min é armado no efeito abaixo; aqui só se lê.
      return selectionPollInterval(st.id, v.reading, pollStart.current === null ? 0 : Date.now() - pollStart.current);
    },
  });
  const v = view.data;

  // A lista só é refeita quando count, reading ou sources_count mudam (refazer renova as URLs das miniaturas).
  const sig = v ? selectionSignature(v) : null;
  useEffect(() => {
    if (sig === null) return;
    if (prevSig.current !== null && prevSig.current !== sig) void qc.invalidateQueries({ queryKey: listKey });
    prevSig.current = sig;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sig]);

  const state = selectionState(v, {
    loading: view.isLoading,
    error: view.isError && !view.data,
    canEdit,
    isAdmin,
    justChanged,
    allSourcesFailed: allFailed,
  });
  const enabled = pending ?? v?.enabled ?? false;
  const firstChoice = state.id === "5" || state.id === "5b";
  const showPicker = canEdit && !!v && (firstChoice || pickerOpen);
  const current: string | null = !v ? null : v.segment_source === "none" ? NONE : v.segment;
  const labelOf = (id: string): string => (id === NONE ? SELECTION_TEXT.noneOption : (v?.options.find((o) => o.id === id)?.label ?? id));
  const inSelection = list.data?.limits.in_selection ?? v?.count ?? 0;
  const hasRefs = selRefs.length > 0 || inSelection > 0;
  const paused = (v?.own_ready ?? 0) >= 4;

  // Foco: ao abrir pelo botão, na opção marcada; ao fechar, de volta no botão.
  useEffect(() => {
    failedRef.current = allFailed;
  }, [allFailed]);
  // Relógio da conferência: arma quando o estado pede conferência, zera quando deixa de pedir.
  const pollWanted = selectionPollInterval(state.id, v?.reading ?? 0, 0) !== false;
  useEffect(() => {
    if (!pollWanted) pollStart.current = null;
    else pollStart.current ??= Date.now();
  }, [pollWanted]);
  // Esconder na hora vale até a lista refeita chegar sem aquelas ids.
  useEffect(() => {
    if (hidden.size === 0 || !list.data) return;
    const present = new Set([...list.data.refs.map((r) => r.id), ...list.data.sources.map((x) => x.id)]);
    if (![...hidden].some((id) => present.has(id))) setHidden(new Set());
  }, [list.data, hidden]);
  // Depois da primeira escolha a lista some: o foco vai para a linha de estado em vez de se perder.
  useEffect(() => {
    if (focusState && !showPicker) {
      document.getElementById(stateId)?.focus();
      setFocusState(false);
    }
  }, [focusState, showPicker, stateId]);

  const wasOpen = useRef(false);
  useEffect(() => {
    if (pickerOpen && !wasOpen.current) {
      const box = pickerRef.current;
      (box?.querySelector<HTMLElement>('[role="radio"][data-state="checked"]') ?? box?.querySelector<HTMLElement>('[role="radio"]'))?.focus();
    }
    if (!pickerOpen && wasOpen.current) triggerRef.current?.focus();
    wasOpen.current = pickerOpen;
  }, [pickerOpen]);

  if (!on) return null;

  const refreshAll = async () => {
    await Promise.all([
      qc.invalidateQueries({ queryKey: viewKey }),
      qc.invalidateQueries({ queryKey: listKey }),
      qc.invalidateQueries({ queryKey: ["brand", brandId] }),
    ]);
  };
  /** Some na hora com as da seleção que estavam na tela (a API apaga em segundo plano). */
  const hideCurrentSelection = () =>
    setHidden((h) => new Set([...h, ...(list.data?.refs ?? []).filter((r) => r.origin === "selection").map((r) => r.id), ...(list.data?.sources ?? []).filter((s) => s.origin === "selection").map((s) => s.id)]));

  const setEnabled = async (next: boolean) => {
    if (busy || !canEdit) return;
    setBusy(true);
    setPending(next);
    const hadRefs = hasRefs;
    try {
      await updateBrand(workspaceId, brandId, { style_library_enabled: next });
      if (next) {
        markChanged();
        toast.success(SELECTION_TEXT.onToast);
      } else {
        hideCurrentSelection();
        toast.success(hadRefs ? SELECTION_TEXT.offWithRefsToast : SELECTION_TEXT.offToast);
      }
      await refreshAll();
    } catch {
      toast.error(SELECTION_TEXT.toggleError);
    } finally {
      setPending(null);
      setBusy(false);
    }
  };

  const requestToggle = (next: boolean) => {
    if (!canEdit || busy) return;
    if (!next && inSelection > 0) setConfirmOff(true);
    else void setEnabled(next);
  };

  const openPicker = () => {
    setPicked(current);
    setPickerOpen(true);
  };
  const closePicker = () => setPickerOpen(false);

  const submitBranch = async () => {
    if (!picked || busy || !canEdit) return;
    setBusy(true);
    const hadRefs = hasRefs;
    try {
      await updateBrand(workspaceId, brandId, { style_library_segment: picked });
      if (!firstChoice && hadRefs) hideCurrentSelection();
      markChanged();
      toast.success(branchToast({ picked, pickedLabel: labelOf(picked), first: firstChoice, hadRefs }));
      setPickerOpen(false);
      setPicked(null);
      if (firstChoice) setFocusState(true);
      await refreshAll();
    } catch {
      // A lista continua aberta, com a opção marcada.
      toast.error(SELECTION_TEXT.branchError);
    } finally {
      setBusy(false);
    }
  };

  const removeRef = async (r: StyleRef) => {
    try {
      await removeStyleRef(workspaceId, brandId, r.id);
      await qc.invalidateQueries({ queryKey: listKey });
      toast.success(removedToast(r));
    } catch (e) {
      toast.error(apiErrorMessage(e, "Não foi possível remover."));
    }
  };

  const consequence = picked && current ? branchConsequence({ picked, current, pickedLabel: labelOf(picked), count: inSelection }) : null;
  const showBranchLine = !!v && enabled && BRANCH_STATES.includes(state.id);
  const shown = visibleRefs(selRefs, expanded);
  const loaded = !!v;
  const options = [...(v?.options ?? []), { id: NONE, label: SELECTION_TEXT.noneOption }];
  const pickerLabelledBy = firstChoice ? stateId : pickId;

  return (
    <div className="space-y-4 border-t border-border pt-4">
      <h3 className="text-base font-semibold">{SELECTION_TEXT.title}</h3>
      <p id={expId} className="text-sm text-muted-foreground">
        {SELECTION_TEXT.explanation}
      </p>

      {loaded && (
        <>
          <div
            className={cn("flex min-h-11 items-center justify-between gap-3 rounded-lg border border-border p-3", canEdit && !busy ? "cursor-pointer" : "cursor-not-allowed opacity-80")}
            onClick={(e) => {
              if ((e.target as HTMLElement).closest("button")) return;
              requestToggle(!enabled);
            }}
          >
            <div className="min-w-0">
              <span id={toggleNameId} className="text-sm font-medium">
                {SELECTION_TEXT.toggle}
              </span>
              <p className="text-sm text-muted-foreground">{SELECTION_TEXT.toggleHint}</p>
            </div>
            <Switch
              id={toggleId}
              checked={enabled}
              disabled={!canEdit || busy}
              aria-labelledby={toggleNameId}
              aria-describedby={`${expId} ${stateId}`}
              onCheckedChange={requestToggle}
            />
          </div>
          {!canEdit && <p className="text-sm text-muted-foreground">{SELECTION_TEXT.viewerNote}</p>}
        </>
      )}

      <StateLine tone={state.tone} id={stateId}>
        {state.text}
      </StateLine>

      {state.action === "retry" && (
        <Button variant="outline" className={actionBtn} onClick={() => void view.refetch()}>
          {SELECTION_TEXT.retry}
        </Button>
      )}
      {state.action === "integrations" && (
        <Button asChild variant="outline" className={actionBtn}>
          <Link to="/integrations">{SELECTION_TEXT.openIntegrations}</Link>
        </Button>
      )}
      {state.action === "choose" && (
        <Button ref={triggerRef} variant="outline" className={actionBtn} aria-expanded={pickerOpen} aria-controls={panelId} onClick={pickerOpen ? closePicker : openPicker}>
          {SELECTION_TEXT.chooseBranch}
        </Button>
      )}

      {showBranchLine && v && (
        <div className="space-y-3">
          <p className="text-sm">{v.segment_source === "chosen" ? SELECTION_TEXT.branchChosen(v.segment_label ?? "") : SELECTION_TEXT.branchAuto(v.segment_label ?? "")}</p>
          {canEdit && (
            <Button ref={triggerRef} variant="outline" className={actionBtn} aria-expanded={pickerOpen} aria-controls={panelId} onClick={pickerOpen ? closePicker : openPicker}>
              {SELECTION_TEXT.changeBranch}
            </Button>
          )}
          {v.count > 0 && <p className="text-sm">{SELECTION_TEXT.counter(v.count)}</p>}
        </div>
      )}

      {showPicker && (
        <div ref={pickerRef} id={panelId} className="space-y-3 rounded-lg border border-border p-3">
          {pickerOpen && !firstChoice && (
            <p id={pickId} className="text-sm font-medium">
              {SELECTION_TEXT.pickQuestion}
            </p>
          )}
          <RadioGroup value={picked ?? ""} onValueChange={setPicked} disabled={busy} aria-labelledby={pickerLabelledBy} className="gap-0">
            {options.map((o) => (
              <div key={o.id} className="flex min-h-11 items-center gap-3">
                <RadioGroupItem value={o.id} id={`ss-${brandId}-${o.id}`} className="size-5" />
                <Label htmlFor={`ss-${brandId}-${o.id}`} className="flex min-h-11 flex-1 cursor-pointer items-center text-sm font-normal">
                  {o.label}
                  {!firstChoice && o.id === current ? SELECTION_TEXT.currentSuffix : ""}
                </Label>
              </div>
            ))}
          </RadioGroup>
          {consequence && <p className="text-sm text-muted-foreground">{consequence}</p>}
          <div className="flex flex-col gap-2 sm:flex-row">
            <Button className={actionBtn} disabled={busy || !picked || picked === current} onClick={() => void submitBranch()}>
              {branchSubmitLabel(picked ?? "")}
            </Button>
            {!firstChoice && (
              <Button variant="outline" className={actionBtn} disabled={busy} onClick={closePicker}>
                {SELECTION_TEXT.cancel}
              </Button>
            )}
          </div>
        </div>
      )}

      {enabled && !!selSources.length && (
        <div className="space-y-2">
          <h4 className="text-sm font-medium">{SELECTION_TEXT.sourcesTitle}</h4>
          <ul className="space-y-2">
            {selSources.map((s) => (
              <li key={s.id} className="space-y-1 rounded-lg border border-border p-3 text-sm">
                <a href={s.url} target="_blank" rel="noreferrer" className="font-medium underline-offset-2 hover:underline">
                  {s.title ?? SELECTION_TEXT.folderFallbackTitle}
                </a>
                <p className="text-sm text-muted-foreground">{SELECTION_TEXT.folderLabel}</p>
                <p className="text-sm text-muted-foreground">{s.last_synced_at ? `Atualizada em ${fullDate(s.last_synced_at)}` : "Aguardando a primeira leitura"}</p>
                {s.last_error && (
                  <p className="flex items-start gap-1.5 text-sm text-destructive">
                    <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
                    <span>{SELECTION_TEXT.folderError}</span>
                  </p>
                )}
                <p className="text-sm text-muted-foreground">{SELECTION_TEXT.folderHelp}</p>
              </li>
            ))}
          </ul>
        </div>
      )}

      {enabled && !!selRefs.length && (
        <div className="space-y-2">
          <h4 className="text-sm font-medium">{SELECTION_TEXT.refsTitle}</h4>
          <ul className="space-y-3">
            {shown.map((r) => (
              <StyleRefRow key={r.id} item={r} canEdit={canEdit} onRemove={(x) => void removeRef(x)} selection paused={paused} />
            ))}
          </ul>
          {!expanded && selRefs.length > shown.length && (
            <Button variant="outline" className={actionBtn} onClick={() => setExpanded(true)}>
              {SELECTION_TEXT.seeAll(selRefs.length)}
            </Button>
          )}
        </div>
      )}

      <AlertDialog open={confirmOff} onOpenChange={setConfirmOff}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{SELECTION_TEXT.offTitle}</AlertDialogTitle>
            <AlertDialogDescription>{SELECTION_TEXT.offQuestion(inSelection)}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{SELECTION_TEXT.offCancel}</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                setConfirmOff(false);
                void setEnabled(false);
              }}
            >
              {SELECTION_TEXT.offConfirm}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
