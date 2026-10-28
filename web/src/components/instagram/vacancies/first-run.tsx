"use client";

import { useRef } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { ImagePlus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { apiErrorMessage } from "@/modules/shared/infrastructure/http";
import { uploadVacancyTemplate } from "@/modules/vacancy-stories/infrastructure/vacancy-stories.api";

const STEPS = ["Envie a arte modelo", "Veja uma prévia", "Ligue"];

/** Primeira vez (sem arte modelo): passos, envio da arte e interruptor travado. */
export function VacanciesFirstRun({ workspaceId, canEdit }: { workspaceId: string; canEdit: boolean }) {
  const qc = useQueryClient();
  const input = useRef<HTMLInputElement>(null);

  const upload = useMutation({
    mutationFn: (file: File) => uploadVacancyTemplate(workspaceId, file),
    onSuccess: (res) => {
      qc.setQueryData(["vacancy-settings", workspaceId], res);
      toast.success("Arte modelo salva. Gere uma prévia para ver como fica com uma vaga de verdade.");
      if (res.warning === "landscape")
        toast.warning("Essa arte está deitada. Story é em pé: envie uma arte em pé para não sobrar faixa grande em cima e embaixo.");
    },
    onError: (e) => toast.error(apiErrorMessage(e, "Não conseguimos enviar a arte modelo.")),
  });

  return (
    <section className="panel space-y-5 p-5" aria-labelledby="vac-first-title">
      <div>
        <h2 id="vac-first-title" className="text-lg font-semibold">Vagas do Freela nos stories</h2>
        <p className="mt-1 text-sm text-muted-foreground">Cada vaga nova do Freela vira um story no estilo da sua arte modelo.</p>
      </div>
      <ol className="flex flex-col gap-2 text-sm sm:flex-row sm:gap-6">
        {STEPS.map((s, i) => (
          <li key={s} className="flex items-center gap-2">
            <span className="flex size-6 items-center justify-center rounded-full bg-primary text-xs font-semibold text-primary-foreground" aria-hidden>
              {i + 1}
            </span>
            {s}
          </li>
        ))}
      </ol>
      <div className="space-y-2">
        <input
          ref={input}
          type="file"
          accept="image/png,image/jpeg"
          className="sr-only"
          aria-label="Arte modelo (PNG ou JPG)"
          onChange={(e) => {
            const f = e.target.files?.[0];
            e.target.value = "";
            if (f) upload.mutate(f);
          }}
        />
        <Button className="h-11 w-full sm:w-auto" disabled={!canEdit || upload.isPending} onClick={() => input.current?.click()}>
          <ImagePlus /> {upload.isPending ? "Enviando…" : "Enviar arte modelo"}
        </Button>
        <p className="text-xs text-muted-foreground">PNG ou JPG, em pé.</p>
      </div>
      <div className="flex items-center gap-3 border-t border-border pt-4">
        <Switch id="vac-first-switch" checked={false} disabled aria-describedby="vac-first-hint" />
        <div>
          <label htmlFor="vac-first-switch" className="text-sm font-medium">Postar as vagas do Freela nos stories</label>
          <p id="vac-first-hint" className="text-xs text-muted-foreground">Envie a arte modelo para poder ligar.</p>
        </div>
      </div>
    </section>
  );
}
