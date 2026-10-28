"use client";

import { useRef } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { ImagePlus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { LANDSCAPE_WARNING, templateFileError, templateTextsWarning } from "@/lib/vacancy-stories";
import { apiErrorMessage } from "@/modules/shared/infrastructure/http";
import {
  uploadVacancyTemplate,
  vacancySettingsKey,
  type VacancySettings,
} from "@/modules/vacancy-stories/infrastructure/vacancy-stories.api";

/**
 * Envio da arte modelo (compartilhado com a primeira vez): confere tipo e tamanho no navegador com os textos da API e avisa
 * quando a arte está deitada. `pick(file)` abre o envio; `input` é o `<input type="file">` escondido que o botão aciona.
 */
export function useTemplateUpload(workspaceId: string) {
  const qc = useQueryClient();
  const input = useRef<HTMLInputElement>(null);
  const mutation = useMutation({
    mutationFn: (file: File) => uploadVacancyTemplate(workspaceId, file),
    onSuccess: (res) => {
      qc.setQueryData(vacancySettingsKey(workspaceId), res);
      toast.success("Arte modelo salva. Gere uma prévia para ver como fica com uma vaga de verdade.");
      if (res.warning === "landscape") toast.warning(LANDSCAPE_WARNING);
    },
    onError: (e) => toast.error(apiErrorMessage(e, "Não conseguimos enviar a arte modelo.")),
  });
  const pick = (file: File) => {
    const erro = templateFileError(file);
    if (erro) toast.error(erro);
    else mutation.mutate(file);
  };
  const fileInput = (
    <input
      ref={input}
      type="file"
      accept="image/png,image/jpeg"
      className="sr-only"
      tabIndex={-1}
      aria-label="Arte modelo (PNG ou JPG)"
      onChange={(e) => {
        const f = e.target.files?.[0];
        e.target.value = "";
        if (f) pick(f);
      }}
    />
  );
  return { isPending: mutation.isPending, open: () => input.current?.click(), fileInput };
}

/** Arte modelo nos Ajustes: miniatura, avisos (deitada; sem textos lidos — I5) e "Trocar arte modelo". */
export function TemplateCard({ workspaceId, settings, canEdit }: { workspaceId: string; settings: VacancySettings; canEdit: boolean }) {
  const upload = useTemplateUpload(workspaceId);
  const t = settings.template;
  const semTextos = templateTextsWarning(t);
  return (
    <div className="space-y-3">
      <div>
        <h3 className="text-sm font-semibold">Arte modelo</h3>
        <p className="mt-1 text-sm text-muted-foreground">
          A IA segue o estilo desta arte em todo story: cores, letras e posição dos cartões. Os textos são trocados pelos da vaga.
        </p>
      </div>
      <div className="flex items-start gap-4">
        <div className="aspect-[9/16] w-20 shrink-0 overflow-hidden rounded-md border border-border bg-muted">
          {t?.url && <img src={t.url} alt="Arte modelo atual" className="size-full object-cover" />}
        </div>
        <div className="min-w-0 space-y-2">
          {upload.fileInput}
          <Button variant="outline" className="h-11" disabled={!canEdit || upload.isPending} onClick={upload.open}>
            <ImagePlus /> {upload.isPending ? "Enviando…" : t ? "Trocar arte modelo" : "Enviar arte modelo"}
          </Button>
          {t?.landscape && <p className="rounded-md border border-warning/40 bg-warning/10 p-2 text-sm">{LANDSCAPE_WARNING}</p>}
          {semTextos && <p className="rounded-md border border-warning/40 bg-warning/10 p-2 text-sm">{semTextos}</p>}
          {!canEdit && <p className="text-xs text-muted-foreground">Só quem pode editar troca a arte modelo.</p>}
        </div>
      </div>
    </div>
  );
}
