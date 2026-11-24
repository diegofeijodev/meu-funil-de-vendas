"use client";

import { useEffect, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { AlertTriangle, Eye, Info } from "lucide-react";
import { Link } from "@/lib/router";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
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
  CLT_TEXT,
  cltDisableText,
  cltEnableText,
  cltPollLine,
  cltPollNotice,
  cltSinceLine,
  cltStatusLine,
  cltTodayLine,
  cltWhatEnters,
} from "@/lib/vacancy-clt";
import { previewProgress } from "@/lib/vacancy-stories";
import { apiErrorMessage } from "@/modules/shared/infrastructure/http";
import {
  disableCltVacancies,
  enableCltVacancies,
  startVacancyPreview,
  vacancySettingsKey,
  type VacancySettings,
} from "@/modules/vacancy-stories/infrastructure/vacancy-stories.api";
import { vacancyListKey } from "./use-story-actions";

/**
 * Cartão "Vagas fixas (CLT)" (UI 24/11 §4.2): interruptor próprio (dono/admin), situação, o que vai entrar, consulta e a prévia da arte
 * "Vaga fixa CLT" (o dono liga depois de ver). Só aparece quando a API manda o bloco `clt`.
 */
export function VacanciesCltCard({ workspaceId, settings, canEdit, canManage }: {
  workspaceId: string;
  settings: VacancySettings;
  canEdit: boolean;
  canManage: boolean;
}) {
  const qc = useQueryClient();
  const key = vacancySettingsKey(workspaceId);
  const [dialog, setDialog] = useState<"enable" | "disable" | null>(null);
  const s = settings;
  const c = s.clt!;
  const p = s.preview;
  const cltPreview = p.kind === "clt";
  const running = p.status === "running";

  useEffect(() => {
    if (!running || !cltPreview) return;
    const id = setInterval(() => qc.invalidateQueries({ queryKey: key }), 3000);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [running, cltPreview, workspaceId, qc]);

  const refresh = () => {
    qc.invalidateQueries({ queryKey: key });
    qc.invalidateQueries({ queryKey: vacancyListKey(workspaceId) });
    qc.invalidateQueries({ queryKey: ["ig-pending-badge", workspaceId] });
  };
  const enable = useMutation({
    mutationFn: () => enableCltVacancies(workspaceId),
    onSuccess: (view) => {
      qc.setQueryData(key, view);
      refresh();
      setDialog(null);
      toast.success(CLT_TEXT.enabledToast);
    },
    onError: (e) => {
      setDialog(null);
      toast.error(apiErrorMessage(e, CLT_TEXT.enableError));
    },
  });
  const disable = useMutation({
    mutationFn: () => disableCltVacancies(workspaceId),
    onSuccess: () => {
      refresh();
      setDialog(null);
      toast.success(CLT_TEXT.disabledToast);
    },
    onError: (e) => {
      setDialog(null);
      toast.error(apiErrorMessage(e, CLT_TEXT.disableError));
    },
  });
  const preview = useMutation({
    mutationFn: () => startVacancyPreview(workspaceId, { kind: "clt" }),
    onSuccess: () => qc.invalidateQueries({ queryKey: key }),
    onError: (e) => {
      toast.error(apiErrorMessage(e, "Não conseguimos gerar a prévia agora. Tente de novo."));
      qc.invalidateQueries({ queryKey: key });
    },
  });

  const notice = cltPollNotice(c, new Date());
  const since = cltSinceLine(c);
  const noBrand = !c.has_brand && !c.enabled;

  return (
    <section className="panel space-y-4 p-5" aria-labelledby="vac-clt-title" data-vac-section="clt">
      <div className="flex items-start gap-3">
        <label htmlFor="vac-clt-switch" className="flex size-11 shrink-0 cursor-pointer items-center justify-center">
          <Switch
            id="vac-clt-switch"
            checked={c.enabled}
            disabled={!canManage || noBrand || enable.isPending || disable.isPending}
            onCheckedChange={() => setDialog(c.enabled ? "disable" : "enable")}
            aria-describedby="vac-clt-text"
          />
        </label>
        <div className="min-w-0 space-y-1">
          <h2 id="vac-clt-title" className="text-base font-semibold">
            <label htmlFor="vac-clt-switch">{CLT_TEXT.switchLabel}</label>
          </h2>
          <div id="vac-clt-text" className="space-y-1 text-sm text-muted-foreground">
            <p className={c.enabled ? "font-medium text-foreground" : undefined}>{cltStatusLine(c, s.auto_publish)}</p>
            {c.enabled && (
              <>
                <p>{cltTodayLine(c)}</p>
                <p>{cltPollLine(c)}</p>
                {since && <p>{since}</p>}
              </>
            )}
            {!canManage && <p>{CLT_TEXT.noPermission}</p>}
          </div>
        </div>
      </div>

      {!c.enabled && (
        <div className="flex gap-2 rounded-lg border bg-muted/40 p-3 text-sm">
          <Info className="mt-0.5 size-4 shrink-0" aria-hidden />
          <p>
            <span className="font-medium">O que vai entrar: </span>
            {cltWhatEnters(c)}
          </p>
        </div>
      )}

      {noBrand && (
        <div className="flex flex-col gap-3 rounded-lg border border-warning/40 bg-warning/10 p-3 text-sm sm:flex-row sm:items-center">
          <p className="flex-1">{CLT_TEXT.noBrand}</p>
          <Button asChild className="h-11" variant="outline">
            <Link to="/brands">Abrir Marcas</Link>
          </Button>
        </div>
      )}

      {notice && (
        <p className="flex items-start gap-2 rounded-lg border border-warning/40 bg-warning/10 p-3 text-sm" role="status">
          <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden /> {notice}
        </p>
      )}

      <div className="space-y-2">
        <Button className="h-11" variant="outline" disabled={!canEdit || running || preview.isPending} onClick={() => preview.mutate()}>
          <Eye /> {CLT_TEXT.previewButton}
        </Button>
        <div aria-live="polite">
          {cltPreview && running && <p className="text-sm font-medium motion-safe:animate-pulse">{previewProgress(p)}</p>}
          {cltPreview && p.status === "failed" && (
            <p role="alert" className="rounded-md border border-destructive/40 bg-destructive/10 p-2 text-sm">
              {p.error ?? "Não conseguimos criar a prévia. Tente de novo em alguns minutos."}
            </p>
          )}
        </div>
        {cltPreview && p.status === "done" && p.media_url && (
          <div className="relative aspect-[9/16] w-full max-w-[280px] overflow-hidden rounded-lg border border-border bg-muted">
            <img src={p.media_url} alt="Prévia do story de vaga fixa" className="size-full object-cover" />
            <span className="absolute left-2 top-2 rounded bg-black/70 px-2 py-1 text-xs font-semibold text-white">PRÉVIA · não foi postada</span>
          </div>
        )}
      </div>

      <AlertDialog open={!!dialog} onOpenChange={(o) => !o && !enable.isPending && !disable.isPending && setDialog(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{dialog === "disable" ? CLT_TEXT.disableTitle : CLT_TEXT.enableTitle}</AlertDialogTitle>
            <AlertDialogDescription>
              {dialog === "disable" ? cltDisableText(c.counts) : cltEnableText(c, s.instagram.username, s.auto_publish)}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className="gap-2">
            <AlertDialogCancel className="h-11">{dialog === "disable" ? "Manter ligado" : "Agora não"}</AlertDialogCancel>
            <AlertDialogAction
              className="h-11"
              disabled={enable.isPending || disable.isPending}
              onClick={(e) => {
                e.preventDefault(); // fecha quando a API responder
                if (dialog === "disable") disable.mutate();
                else enable.mutate();
              }}
            >
              {dialog === "disable" ? "Desligar vagas fixas" : "Ligar vagas fixas"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  );
}
