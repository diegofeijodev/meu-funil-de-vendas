"use client";

import { useEffect } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Check, Eye, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { previewProgress, sampleLine } from "@/lib/vacancy-stories";
import { apiErrorMessage } from "@/modules/shared/infrastructure/http";
import {
  startVacancyPreview,
  vacancySettingsKey,
  type VacancySettings,
} from "@/modules/vacancy-stories/infrastructure/vacancy-stories.api";

const SAMPLE_KEYS = ["funcao", "valor", "dia", "horario", "cidade"] as const;

/** A vaga da prévia vem solta (`passthrough`); só vira frase se os cinco campos forem texto. */
function sampleOf(v: Record<string, unknown> | null) {
  if (!v || !SAMPLE_KEYS.every((k) => typeof v[k] === "string")) return null;
  return v as Record<(typeof SAMPLE_KEYS)[number], string>;
}

/** "Gerar prévia com uma vaga real": custo, andamento (sai da tela e volta), resultado com a conferência. */
export function PreviewCard({ workspaceId, settings, canEdit }: { workspaceId: string; settings: VacancySettings; canEdit: boolean }) {
  const qc = useQueryClient();
  const p = settings.preview;
  const running = p.status === "running";
  const key = vacancySettingsKey(workspaceId);

  // Enquanto cria, consulta a cada 3 s (o refresh normal é de 30 s).
  useEffect(() => {
    if (!running) return;
    const id = setInterval(() => qc.invalidateQueries({ queryKey: key }), 3000);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [running, workspaceId, qc]);

  const start = useMutation({
    mutationFn: () => startVacancyPreview(workspaceId),
    onSuccess: () => qc.invalidateQueries({ queryKey: key }),
    onError: (e) => {
      toast.error(apiErrorMessage(e, "Não conseguimos gerar a prévia agora. Tente de novo."));
      qc.invalidateQueries({ queryKey: key }); // 409: já existe uma, mostra o andamento
    },
  });

  const sample = sampleOf(p.vacancy);
  const never = !p.run_id;

  return (
    <div className="space-y-3">
      <div>
        <h3 className="text-sm font-semibold">Prévia</h3>
        <p className="mt-1 text-sm text-muted-foreground">
          Não posta nada. Usa a vaga mais recente do Freela. Gasta de 1 a 3 imagens da chave da empresa.
        </p>
      </div>
      <Button className="h-11" disabled={!canEdit || running || start.isPending} onClick={() => start.mutate()}>
        <Eye /> Gerar prévia com uma vaga real
      </Button>

      {never && !settings.enabled && (
        <p className="text-sm text-muted-foreground">Arte modelo salva. Gere uma prévia antes de ligar, para ver se a IA segue o seu modelo.</p>
      )}

      <div aria-live="polite" className="space-y-1">
        {running && (
          <>
            <p className="text-sm font-medium motion-safe:animate-pulse">{previewProgress(p)}</p>
            <p className="text-sm text-muted-foreground">
              Criando a prévia… costuma levar de 1 a 3 minutos. Pode sair desta tela, ela fica salva aqui.
            </p>
          </>
        )}
        {p.status === "failed" && (
          <p role="alert" className="rounded-md border border-destructive/40 bg-destructive/10 p-2 text-sm">
            {p.error ?? "Não conseguimos criar a prévia. Tente de novo em alguns minutos."}
          </p>
        )}
      </div>

      {p.status === "done" && p.media_url && (
        <div className="space-y-3">
          {p.sample && sample && <p className="text-sm text-muted-foreground">{sampleLine(sample)}</p>}
          <div className="relative aspect-[9/16] w-full max-w-[280px] overflow-hidden rounded-lg border border-border bg-muted">
            <img
              src={p.media_url}
              alt={sample ? `Story: ${sample.funcao}, ${sample.valor}, ${sample.dia}, ${sample.horario}, ${sample.cidade}` : "Story de prévia"}
              className="size-full object-cover"
            />
            <span className="absolute left-2 top-2 rounded bg-black/70 px-2 py-1 text-xs font-semibold text-white">PRÉVIA · não foi postada</span>
          </div>
          {p.used_fallback && (
            <p className="text-sm text-muted-foreground">
              Versão de reserva: a IA errou nas 3 tentativas, então o sistema escreveu os textos por cima de uma foto. Os textos estão certos; o
              visual é mais simples.
            </p>
          )}
          {p.checks.length > 0 && (
            <table className="w-full max-w-md text-left text-sm">
              <caption className="pb-1 text-left text-sm font-medium">Confira com a vaga</caption>
              <tbody>
                {p.checks.map((c) => (
                  <tr key={c.key} className="border-t border-border">
                    <th scope="row" className="py-2 pr-3 font-medium">{c.label}</th>
                    <td className="py-2">
                      {c.ok ? (
                        <span className="inline-flex items-center gap-1"><Check className="size-4" aria-hidden /> confere</span>
                      ) : (
                        <span className="inline-flex items-center gap-1"><X className="size-4" aria-hidden /> diferente{c.read ? `: a arte diz ${c.read}` : ""}</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}
    </div>
  );
}
