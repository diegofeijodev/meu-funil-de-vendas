"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@/lib/server-fn";
import { toast } from "sonner";
import { CheckCircle2, Images, Loader2, TriangleAlert } from "lucide-react";
import { listMedia } from "@/modules/media/infrastructure/media.api";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { formatLabel, targetForIgFormat } from "@/lib/media/formats";
import { attachMediaToPost } from "@/lib/media/export.functions";
import { apiErrorMessage } from "@/modules/shared/infrastructure/http";

export type MediaAsset = {
  id: string;
  title: string;
  kind: "image" | "video";
  url: string | null;
  thumbnail_url: string | null;
  target_format: string;
  ig_ready: boolean;
  quality_report: { issues?: string[] } | null;
  width: number | null;
  height: number | null;
  duration_seconds: number | null;
};

/** Botão "Escolher da biblioteca" do editor de post do Instagram. */
export function PickFromLibrary({
  workspaceId,
  postId,
  igFormat,
  onDone,
}: {
  workspaceId: string;
  postId: string;
  igFormat: string;
  onDone: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [picked, setPicked] = useState<string[]>([]);
  const attach = useServerFn(attachMediaToPost);
  const target = targetForIgFormat(igFormat);
  const video = igFormat === "reel" || igFormat === "story_video";
  const multi = igFormat === "feed_carousel";

  const { data = [], isLoading } = useQuery({
    queryKey: ["media-picker", workspaceId, target, video],
    enabled: open,
    // `select … eq target_format, eq kind, neq status 'archived' order created_at desc limit 60`
    queryFn: async () =>
      (await listMedia(workspaceId, { format: target, kind: video ? "video" : "image", status: "active", sort: "new" }, 60)).assets as unknown as MediaAsset[],
  });

  const toggle = (a: MediaAsset) => {
    if (!a.ig_ready) {
      toast.error(
        `Esta mídia não está pronta para o Instagram: ${(a.quality_report?.issues ?? []).join(" ") || "sem validação."}`,
      );
      return;
    }
    setPicked((p) =>
      p.includes(a.id) ? p.filter((x) => x !== a.id) : multi ? [...p, a.id].slice(0, 10) : [a.id],
    );
  };

  const confirm = async () => {
    setBusy(true);
    try {
      await attach({ data: { workspaceId, postId, assetIds: picked } });
      toast.success("Mídia da biblioteca anexada ao post.");
      setOpen(false);
      setPicked([]);
      onDone();
    } catch (e) {
      toast.error(apiErrorMessage(e, "Não foi possível anexar a mídia."));
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <Button variant="outline" size="sm" onClick={() => setOpen(true)}>
        <Images className="size-4" /> Escolher da biblioteca
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle>Escolher da biblioteca</DialogTitle>
            <DialogDescription>
              Mostrando {video ? "vídeos" : "imagens"} no formato {formatLabel(target)}. Só mídias
              prontas para o Instagram podem ser usadas
              {multi ? " (até 10 no carrossel)" : ""}.
            </DialogDescription>
          </DialogHeader>
          {isLoading ? (
            <div className="flex justify-center py-12">
              <Loader2 className="size-5 animate-spin text-muted-foreground" />
            </div>
          ) : data.length === 0 ? (
            <p className="py-12 text-center text-sm text-muted-foreground">
              Nenhuma mídia neste formato ainda. Gere no Creative Studio ou envie na Biblioteca.
            </p>
          ) : (
            <div className="grid max-h-[60vh] grid-cols-2 gap-3 overflow-y-auto sm:grid-cols-4">
              {data.map((a) => (
                <button
                  key={a.id}
                  type="button"
                  onClick={() => toggle(a)}
                  className={cn(
                    "group relative overflow-hidden rounded-lg border text-left transition",
                    picked.includes(a.id) ? "border-primary ring-2 ring-primary" : "border-border",
                    !a.ig_ready && "opacity-60",
                  )}
                >
                  {a.kind === "video" ? (
                    <video
                      src={a.url ?? undefined}
                      muted
                      className="aspect-[9/16] w-full bg-muted object-cover"
                    />
                  ) : (
                    <img
                      src={a.thumbnail_url ?? a.url ?? ""}
                      alt={a.title}
                      className="aspect-square w-full bg-muted object-cover"
                    />
                  )}
                  <span className="absolute left-1.5 top-1.5">
                    {a.ig_ready ? (
                      <CheckCircle2 className="size-4 text-success" />
                    ) : (
                      <TriangleAlert className="size-4 text-destructive" />
                    )}
                  </span>
                  <p className="truncate px-2 py-1 text-xs">{a.title}</p>
                </button>
              ))}
            </div>
          )}
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setOpen(false)}>
              Cancelar
            </Button>
            <Button onClick={confirm} disabled={!picked.length || busy}>
              {busy && <Loader2 className="size-4 animate-spin" />} Usar {picked.length || ""}{" "}
              selecionada{picked.length > 1 ? "s" : ""}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
