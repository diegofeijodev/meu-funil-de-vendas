"use client";

import { useEffect, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Check, Eye } from "lucide-react";
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
import { QR_TEXT, qrPreviewResult, qrStatusLine } from "@/lib/vacancy-stories";
import { apiErrorMessage } from "@/modules/shared/infrastructure/http";
import {
  setVacancyQr,
  startVacancyPreview,
  vacancySettingsKey,
  type VacancySettings,
} from "@/modules/vacancy-stories/infrastructure/vacancy-stories.api";

/** O rodapé (y 1500–1696) da arte 1080 × 1920 ampliado: fundo com a arte inteira na largura e deslocado até ele. */
const FOOTER_CROP = { aspectRatio: "1080 / 196", backgroundSize: "100% auto", backgroundPosition: `0 ${(1500 / (1920 - 196)) * 100}%` } as const;

/**
 * "Link da vaga na arte (QR code)" (UI 24/11 §2.5): vale na hora (fora do "Salvar ajustes"). O interruptor só destrava depois de uma prévia
 * com QR que o sistema conferiu (a API também recusa: 422); quem liga é o dono ou um administrador.
 */
export function QrCard({ workspaceId, settings, canEdit, canManage }: { workspaceId: string; settings: VacancySettings; canEdit: boolean; canManage: boolean }) {
  const qc = useQueryClient();
  const key = vacancySettingsKey(workspaceId);
  const s = settings;
  const p = s.preview;
  const running = p.status === "running";
  const result = qrPreviewResult({ status: p.status, sample: p.sample, qr: p.qr, vacancy: p.vacancy });
  const readOk = !!result?.ok;
  const [dialog, setDialog] = useState(false);

  // Prévia com QR em andamento: consulta a cada 3 s (como a prévia normal).
  useEffect(() => {
    if (!running || !p.qr) return;
    const id = setInterval(() => qc.invalidateQueries({ queryKey: key }), 3000);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [running, !!p.qr, workspaceId, qc]);

  const preview = useMutation({
    mutationFn: () => startVacancyPreview(workspaceId, { qr: true }),
    onSuccess: () => qc.invalidateQueries({ queryKey: key }),
    onError: (e) => {
      toast.error(apiErrorMessage(e, "Não conseguimos gerar a prévia agora. Tente de novo."));
      qc.invalidateQueries({ queryKey: key });
    },
  });
  const toggle = useMutation({
    mutationFn: (on: boolean) => setVacancyQr(workspaceId, on),
    onSuccess: (view, on) => {
      qc.setQueryData(key, view);
      setDialog(false);
      if (on) toast.success(QR_TEXT.toastOn);
      else toast.success(QR_TEXT.toastOff, { duration: 6000, action: { label: "Desfazer", onClick: () => toggle.mutate(true) } });
    },
    onError: (e) => {
      setDialog(false);
      toast.error(apiErrorMessage(e, QR_TEXT.error));
    },
  });

  const canSwitch = canManage && !toggle.isPending && (s.qr_enabled || readOk);
  const switchNote = !canManage ? QR_TEXT.noRole : !s.qr_enabled && !readOk ? QR_TEXT.locked : null;

  return (
    <fieldset className="space-y-3">
      <legend className="text-sm font-semibold">{QR_TEXT.title}</legend>
      <p className="text-sm text-muted-foreground">{qrStatusLine(s)}</p>

      {!s.qr_enabled && (
        <div className="text-sm">
          <p className="font-medium">Para ligar:</p>
          <ol className="mt-1 space-y-1">
            {QR_TEXT.steps.map((step, i) => (
              <li key={step} className="flex items-center gap-2">
                {i === 0 && readOk ? <Check className="size-4 text-success" aria-label="feito" /> : <span aria-hidden className="inline-block size-4 rounded-full border border-border" />}
                <span>{i + 1} {step}</span>
              </li>
            ))}
          </ol>
        </div>
      )}

      <div className="space-y-1">
        <Button className="h-11" variant="outline" disabled={!canEdit || running || preview.isPending} onClick={() => preview.mutate()}>
          <Eye aria-hidden /> {running && p.qr ? QR_TEXT.running : QR_TEXT.button}
        </Button>
        <p className="text-sm text-muted-foreground">{QR_TEXT.buttonHelp}</p>
      </div>

      <div aria-live="polite" className="space-y-2 text-sm">
        {running && p.qr && <p className="text-muted-foreground">{QR_TEXT.progress}</p>}
        {result && p.media_url && (
          <div className="space-y-2">
            {p.used_fallback && <p className="text-muted-foreground">{QR_TEXT.noAi}</p>}
            <div className="relative aspect-[9/16] w-full max-w-[280px] overflow-hidden rounded-lg border border-border bg-muted">
              <img src={p.media_url} alt="Prévia do story com o QR da vaga no rodapé" className="size-full object-cover" />
              <span className="absolute left-2 top-2 rounded bg-black/70 px-2 py-1 text-xs font-semibold text-white">PRÉVIA · não foi postada</span>
            </div>
            <p>{QR_TEXT.crop}</p>
            <div role="img" aria-label="Rodapé da prévia, ampliado" className="w-full max-w-xl rounded-md border border-border bg-no-repeat" style={{ ...FOOTER_CROP, backgroundImage: `url("${p.media_url}")` }} />
            <a href={p.media_url} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-11 items-center gap-1 font-medium underline-offset-4 hover:underline">
              {QR_TEXT.fullSize} <span aria-hidden>↗</span>
            </a>
          </div>
        )}
        {result && <p className={result.ok ? "font-medium" : "rounded-md border border-destructive/40 bg-destructive/10 p-2"}>{result.text}</p>}
        {result?.human && <p>{result.human}</p>}
      </div>

      <div className="flex items-start gap-3">
        <label htmlFor="vac-qr-switch" className="flex size-11 shrink-0 cursor-pointer items-center justify-center">
          <Switch
            id="vac-qr-switch"
            checked={s.qr_enabled}
            disabled={!canSwitch}
            onCheckedChange={(on) => (on ? setDialog(true) : toggle.mutate(false))}
            aria-describedby="vac-qr-help"
          />
        </label>
        <div className="min-w-0 space-y-1 text-sm">
          <label htmlFor="vac-qr-switch" className="font-medium">{QR_TEXT.switchLabel}</label>
          <p id="vac-qr-help" className="text-muted-foreground">
            {QR_TEXT.switchHelp}
            {switchNote ? ` ${switchNote}` : ""}
          </p>
        </div>
      </div>

      <AlertDialog open={dialog} onOpenChange={(o) => !o && !toggle.isPending && setDialog(false)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{QR_TEXT.dialogTitle}</AlertDialogTitle>
            <AlertDialogDescription>{QR_TEXT.dialogText}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className="gap-2">
            <AlertDialogCancel className="h-11">{QR_TEXT.dialogCancel}</AlertDialogCancel>
            <AlertDialogAction
              className="h-11"
              disabled={toggle.isPending}
              onClick={(e) => {
                e.preventDefault(); // fecha só quando a API responder
                toggle.mutate(true);
              }}
            >
              {QR_TEXT.dialogOk}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </fieldset>
  );
}
