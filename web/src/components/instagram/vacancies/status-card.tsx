"use client";

import { useState, type ReactNode } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { AlertTriangle, CircleAlert } from "lucide-react";
import { Link, useNavigate } from "@/lib/router";
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
import { cn } from "@/lib/utils";
import {
  INSTAGRAM_DISCONNECTED,
  aiErrorWantsIntegrations,
  dayLine,
  disableDialogText,
  dmLabel,
  hhLabel,
  pollLine,
  pollStale,
  sinceLabel,
  staleNotice,
} from "@/lib/vacancy-stories";
import { apiErrorMessage } from "@/modules/shared/infrastructure/http";
import {
  disableVacancies,
  enableVacancies,
  vacancySettingsKey,
  type VacancySettings,
} from "@/modules/vacancy-stories/infrastructure/vacancy-stories.api";

function Notice({ tone, children, action }: { tone: "warn" | "error"; children: ReactNode; action?: ReactNode }) {
  const Icon = tone === "error" ? CircleAlert : AlertTriangle;
  return (
    <div
      className={cn(
        "flex flex-col gap-3 rounded-lg border p-3 text-sm sm:flex-row sm:items-center",
        tone === "error" ? "border-destructive/40 bg-destructive/10" : "border-warning/40 bg-warning/10",
      )}
    >
      <Icon className="size-4 shrink-0" aria-hidden />
      <p className="flex-1">{children}</p>
      {action}
    </div>
  );
}

/** Cartão de situação: interruptor com diálogos, resumo do dia e avisos (vitrine, Instagram, IA). */
export function VacanciesStatusCard({ workspaceId, settings, canManage }: { workspaceId: string; settings: VacancySettings; canManage: boolean }) {
  const qc = useQueryClient();
  const navigate = useNavigate({ from: "/instagram" });
  const [dialog, setDialog] = useState<"enable" | "disable" | null>(null);
  const s = settings;
  const conta = s.instagram.username ? `@${s.instagram.username}` : "conectado";

  const refreshAll = () => {
    qc.invalidateQueries({ queryKey: vacancySettingsKey(workspaceId) });
    qc.invalidateQueries({ queryKey: ["ig-pending-badge", workspaceId] });
  };

  const enable = useMutation({
    mutationFn: () => enableVacancies(workspaceId),
    onSuccess: (view) => {
      qc.setQueryData(vacancySettingsKey(workspaceId), view);
      refreshAll();
      setDialog(null);
      toast.success("Stories das vagas ligados.");
    },
    onError: (e) => {
      setDialog(null);
      toast.error(apiErrorMessage(e, "Não conseguimos ligar agora. Tente de novo."));
    },
  });
  const disable = useMutation({
    mutationFn: () => disableVacancies(workspaceId),
    onSuccess: () => {
      refreshAll();
      setDialog(null);
      toast.success("Stories das vagas desligados.");
    },
    onError: (e) => {
      setDialog(null);
      toast.error(apiErrorMessage(e, "Não conseguimos desligar agora. Tente de novo."));
    },
  });

  const now = new Date();
  const stale = pollStale(s, now);

  return (
    <section className="panel space-y-4 p-5" aria-labelledby="vac-status-title">
      <div className="flex items-start gap-3">
        {/* Alvo de toque de 44 px em volta do interruptor de 36x20 (WCAG 2.2). */}
        <label htmlFor="vac-switch" className="flex size-11 shrink-0 cursor-pointer items-center justify-center">
        <Switch
          id="vac-switch"
          checked={s.enabled}
          disabled={!canManage || enable.isPending || disable.isPending}
          onCheckedChange={() => setDialog(s.enabled ? "disable" : "enable")}
          aria-describedby="vac-status-text"
        />
        </label>
        <div className="min-w-0 space-y-1">
          <h2 id="vac-status-title" className="text-base font-semibold">
            <label htmlFor="vac-switch">Postar as vagas do Freela nos stories</label>
          </h2>
          {/* Sem aria-live aqui: a cada 30 s a linha da consulta muda e o leitor de tela repetiria tudo. Avisos têm a sua região. */}
          <div id="vac-status-text" className="space-y-1 text-sm text-muted-foreground">
            {s.enabled ? (
              <>
                <p className="font-medium text-foreground">
                  {s.auto_publish ? "Ligado · posta sozinho depois da conferência" : "Ligado · você aprova cada story antes"}
                </p>
                <p>{dayLine(s)}</p>
                <p>{pollLine(s)}</p>
                {s.enabled_at && (
                  <p>
                    Ligado desde {dmLabel(s.enabled_at)} às {hhLabel(s.enabled_at)}. Vagas publicadas antes disso não entram.
                  </p>
                )}
              </>
            ) : (
              <p>Desligado. Nenhuma vaga vira story agora.</p>
            )}
            {!canManage && <p>Só o dono ou um administrador pode ligar ou desligar.</p>}
          </div>
        </div>
      </div>

      <div className="space-y-2" aria-live="polite">
        {s.enabled && stale && <Notice tone="warn">{staleNotice(s, now)}</Notice>}
        {s.enabled && !s.instagram.connected && (
          <Notice
            tone="error"
            action={
              <Button variant="outline" className="h-11" onClick={() => navigate({ search: { tab: "overview" } })}>
                Reconectar Instagram
              </Button>
            }
          >
            {INSTAGRAM_DISCONNECTED}
          </Notice>
        )}
        {s.enabled && s.ai_error && (
          <Notice
            tone="error"
            action={
              // Só erro de chave/crédito se resolve em Integrações; o "não devolveu uma arte" tenta de novo sozinho.
              aiErrorWantsIntegrations(s.ai_error) ? (
                <Button asChild variant="outline" className="h-11">
                  <Link to="/integrations">Abrir Integrações</Link>
                </Button>
              ) : undefined
            }
          >
            {s.ai_error}
            {s.ai_error_at ? ` Nenhum story novo está sendo criado ${sinceLabel(s.ai_error_at, now)}.` : ""}
          </Notice>
        )}
      </div>

      <AlertDialog open={dialog === "enable"} onOpenChange={(o) => !o && setDialog(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Ligar os stories das vagas?</AlertDialogTitle>
            <AlertDialogDescription>
              A partir de agora, cada vaga nova do Freela vira um story no Instagram {conta}. Vagas publicadas antes de agora não entram.{" "}
              {s.auto_publish
                ? "Os stories vão ao ar sozinhos, depois que o sistema confere função, valor, data, horário e cidade."
                : "Cada story espera sua aprovação antes de ir ao ar."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className="gap-2">
            <AlertDialogCancel className="h-11">Agora não</AlertDialogCancel>
            <AlertDialogAction
              className="h-11"
              disabled={enable.isPending}
              onClick={(e) => {
                e.preventDefault();
                enable.mutate();
              }}
            >
              Ligar
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={dialog === "disable"} onOpenChange={(o) => !o && setDialog(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Desligar os stories das vagas?</AlertDialogTitle>
            <AlertDialogDescription>{disableDialogText(s.counts)}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className="gap-2">
            <AlertDialogCancel className="h-11">Manter ligado</AlertDialogCancel>
            <AlertDialogAction
              className="h-11"
              disabled={disable.isPending}
              onClick={(e) => {
                e.preventDefault();
                disable.mutate();
              }}
            >
              Desligar
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  );
}
