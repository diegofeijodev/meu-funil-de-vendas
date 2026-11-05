"use client";

import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, Loader2, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Section } from "@/components/ui-bits";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Link, useNavigate } from "@/lib/router";
import { useWorkspace } from "@/lib/workspace";
import { confirmNameMatches, deletionSummary, inheritorsWarning, nextWorkspaceAfterDelete } from "@/lib/workspace-deletion";
import { deleteWorkspace, fetchDeletionPreview } from "@/modules/settings/infrastructure/settings.api";
import { apiErrorCode, apiErrorMessage } from "@/modules/shared/infrastructure/http";

/** Configurações → "Zona de perigo": apagar a empresa (só o dono; contrato §31). A página só monta isto para `role === "owner"`. */
export function DeleteWorkspaceCard() {
  const { workspaceId, workspaceName, memberships, setWorkspaceId } = useWorkspace();
  const [open, setOpen] = useState(false);

  return (
    <Section title="Zona de perigo" description="Apagar a empresa tira do app tudo o que é dela, de uma vez. Não dá para desfazer.">
      <Button variant="destructive" className="w-full sm:w-auto" onClick={() => setOpen(true)} disabled={!workspaceId}>
        <Trash2 className="mr-2 size-4" aria-hidden />
        Apagar esta empresa
      </Button>
      {workspaceId && (
        <DeleteWorkspaceDialog
          key={workspaceId}
          open={open}
          onOpenChange={setOpen}
          workspaceId={workspaceId}
          workspaceName={workspaceName}
          memberships={memberships}
          setWorkspaceId={setWorkspaceId}
        />
      )}
    </Section>
  );
}

function DeleteWorkspaceDialog({
  open,
  onOpenChange,
  workspaceId,
  workspaceName,
  memberships,
  setWorkspaceId,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  workspaceId: string;
  workspaceName: string;
  memberships: { workspace_id: string }[];
  setWorkspaceId: (id: string) => void;
}) {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [typed, setTyped] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const preview = useQuery({
    queryKey: ["workspace-deletion-preview", workspaceId],
    enabled: open,
    queryFn: () => fetchDeletionPreview(workspaceId),
    staleTime: 0,
    retry: 1,
  });
  const p = preview.data;
  const name = p?.workspace.name ?? workspaceName;
  const blocked = !!p?.blockers.length;
  const canDelete = !!p && !blocked && confirmNameMatches(typed, name) && !busy;

  const close = (next: boolean) => {
    if (busy) return;
    onOpenChange(next);
    if (!next) {
      setTyped("");
      setError(null);
    }
  };

  const confirm = async () => {
    if (!canDelete) return;
    setBusy(true);
    setError(null);
    const next = nextWorkspaceAfterDelete(memberships, workspaceId);
    try {
      await deleteWorkspace(workspaceId, typed);
    } catch (e) {
      setBusy(false);
      setError(apiErrorMessage(e, "Não foi possível apagar a empresa. Tente de novo."));
      // Bloqueio novo (alguém ligou uma campanha depois de abrir o diálogo): recarrega a lista do que impede.
      if (apiErrorCode(e) !== "NAME_MISMATCH") void preview.refetch();
      return;
    }
    // Fecha e troca a empresa no mesmo render, ANTES de recarregar: nenhuma consulta (nem a prévia desta tela) volta a pedir a
    // empresa apagada, e o diálogo não reabre já apontando para a próxima.
    setBusy(false);
    onOpenChange(false);
    if (next) setWorkspaceId(next);
    qc.removeQueries({ queryKey: ["workspace-deletion-preview", workspaceId] });
    await qc.invalidateQueries({ queryKey: ["memberships"] });
    void qc.invalidateQueries();
    toast.success("Empresa apagada");
    navigate({ to: "/overview" });
  };

  const summary = p ? deletionSummary(p.counts) : [];
  const heirs = p ? inheritorsWarning(p) : null;

  return (
    <AlertDialog open={open} onOpenChange={close}>
      <AlertDialogContent className="max-h-[90dvh] overflow-y-auto">
        <AlertDialogHeader>
          <AlertDialogTitle className="break-words">Apagar a empresa &quot;{name}&quot;?</AlertDialogTitle>
          <AlertDialogDescription asChild>
            <div className="space-y-3 text-left text-sm text-muted-foreground">
              {preview.isLoading ? (
                <p className="flex items-center gap-2" role="status">
                  <Loader2 className="size-4 animate-spin" aria-hidden />
                  Conferindo o que será apagado...
                </p>
              ) : preview.isError ? (
                <div className="space-y-2" role="alert">
                  <p className="text-destructive">{apiErrorMessage(preview.error, "Não foi possível conferir o que será apagado.")}</p>
                  <Button variant="outline" size="sm" onClick={() => void preview.refetch()}>
                    Tentar de novo
                  </Button>
                </div>
              ) : p ? (
                <>
                  {summary.length ? (
                    <div>
                      <p>Vai junto, e não volta:</p>
                      <ul className="mt-1 list-disc space-y-1 pl-5">
                        {summary.map((line) => (
                          <li key={line}>{line}</li>
                        ))}
                      </ul>
                    </div>
                  ) : (
                    <p>A empresa está vazia: não tem marcas, campanhas, posts, contatos nem conexões.</p>
                  )}
                  {heirs && (
                    <p className="rounded-md border border-amber-500/50 bg-amber-500/5 p-3 text-foreground">
                      <AlertTriangle className="mr-1.5 inline size-4 -translate-y-px text-amber-600" aria-hidden />
                      {heirs}
                    </p>
                  )}
                  {blocked ? (
                    <div className="space-y-2 rounded-md border border-destructive/50 bg-destructive/5 p-3 text-foreground" role="alert">
                      <p className="font-medium">Ainda não dá para apagar:</p>
                      {p.blockers.map((b) => (
                        <div key={b.code} className="space-y-1">
                          <p>{b.message}</p>
                          {b.items && b.items.length > 0 && (
                            <ul className="space-y-1 pl-1">
                              {b.items.map((it) => (
                                <li key={it.id}>
                                  <Link to="/campaigns/$id" params={{ id: it.id }} className="text-primary underline underline-offset-2" onClick={() => close(false)}>
                                    Abrir a campanha {it.name}
                                  </Link>
                                </li>
                              ))}
                            </ul>
                          )}
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="font-medium text-foreground">Isso não pode ser desfeito.</p>
                  )}
                </>
              ) : null}
            </div>
          </AlertDialogDescription>
        </AlertDialogHeader>

        {p && !blocked && (
          <div className="space-y-1.5">
            <Label htmlFor="confirm-workspace-name" className="break-words">
              Digite o nome da empresa para confirmar: <span className="font-semibold">{name}</span>
            </Label>
            <Input
              id="confirm-workspace-name"
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && void confirm()}
              autoComplete="off"
              autoCapitalize="off"
              spellCheck={false}
              disabled={busy}
              className="w-full"
            />
          </div>
        )}
        {error && (
          <p className="text-sm text-destructive" role="alert">
            {error}
          </p>
        )}

        <AlertDialogFooter className="gap-2 sm:gap-0">
          <AlertDialogCancel disabled={busy}>Não apagar</AlertDialogCancel>
          {!blocked && (
            <Button variant="destructive" disabled={!canDelete} onClick={() => void confirm()}>
              {busy ? "Apagando..." : "Apagar a empresa"}
            </Button>
          )}
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
