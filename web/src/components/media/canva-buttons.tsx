"use client";

import { useState } from "react";
import { useServerFn } from "@/lib/server-fn";
import { toast } from "sonner";
import { Palette } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { canvaImportDesign, canvaListDesigns, canvaSendAsset } from "@/lib/creative/canva.functions";

/** Envia as mídias escolhidas para os uploads do Canva da empresa. */
export function SendToCanvaButton({ workspaceId, assetIds, disabled }: { workspaceId: string; assetIds: string[]; disabled?: boolean }) {
  const send = useServerFn(canvaSendAsset);
  const [busy, setBusy] = useState(false);
  return (
    <Button
      size="sm"
      variant="outline"
      disabled={disabled || busy || !assetIds.length}
      onClick={async () => {
        setBusy(true);
        let ok = 0;
        const errors: string[] = [];
        for (const id of assetIds) {
          try {
            await send({ data: { workspaceId, assetId: id } });
            ok++;
          } catch (e) {
            errors.push(e instanceof Error ? e.message : "falhou");
          }
        }
        setBusy(false);
        if (ok) toast.success(`${ok} mídia(s) enviada(s) para Uploads no Canva. Abra o Canva para editar.`);
        if (errors.length) toast.error(errors[0]!);
      }}
    >
      <Palette className="size-4" /> {busy ? "Enviando..." : "Enviar ao Canva"}
    </Button>
  );
}

/** Lista os designs do Canva e traz o escolhido (PNG ou MP4) para a biblioteca. */
export function ImportFromCanvaButton({ workspaceId, onImported }: { workspaceId: string; onImported: () => void }) {
  const list = useServerFn(canvaListDesigns);
  const importDesign = useServerFn(canvaImportDesign);
  const [open, setOpen] = useState(false);
  const [designs, setDesigns] = useState<{ id: string; title: string; thumbnail: string | null }[] | null>(null);
  const [query, setQuery] = useState("");
  const [manual, setManual] = useState("");
  const [busy, setBusy] = useState<string | null>(null);

  const load = async () => {
    setBusy("list");
    try {
      setDesigns(await list({ data: { workspaceId, query: query || null } }));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Não foi possível listar os designs.");
    } finally {
      setBusy(null);
    }
  };
  const pick = async (designId: string, title?: string) => {
    setBusy(designId);
    try {
      await importDesign({ data: { workspaceId, designId, title: title ?? null } });
      toast.success("Design importado para a biblioteca.");
      onImported();
      setOpen(false);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Não foi possível importar.");
    } finally {
      setBusy(null);
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        setOpen(v);
        if (v && !designs) void load();
      }}
    >
      <DialogTrigger asChild>
        <Button variant="outline">
          <Palette className="size-4" /> Importar do Canva
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Importar design do Canva</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div className="flex gap-2">
            <Input placeholder="Buscar pelo nome do design" value={query} onChange={(e) => setQuery(e.target.value)} />
            <Button variant="outline" disabled={busy === "list"} onClick={load}>
              Buscar
            </Button>
          </div>
          <div className="grid max-h-80 gap-2 overflow-y-auto sm:grid-cols-3">
            {(designs ?? []).map((d) => (
              <button
                key={d.id}
                type="button"
                disabled={!!busy}
                onClick={() => pick(d.id, d.title)}
                className="rounded-lg border border-border p-2 text-left text-xs hover:bg-secondary disabled:opacity-50"
              >
                {d.thumbnail && <img src={d.thumbnail} alt={d.title} className="mb-1 aspect-square w-full rounded object-cover" />}
                {busy === d.id ? "Importando..." : d.title}
              </button>
            ))}
            {designs && !designs.length && <p className="text-sm text-muted-foreground">Nenhum design encontrado.</p>}
          </div>
          <div className="flex gap-2 border-t border-border pt-3">
            <Input placeholder="Ou cole o link ou ID do design" value={manual} onChange={(e) => setManual(e.target.value)} />
            <Button disabled={!manual.trim() || !!busy} onClick={() => pick(manual.trim())}>
              Importar
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">Precisa do Canva conectado em Integrações. Imagens vêm em PNG; vídeos em MP4.</p>
        </div>
      </DialogContent>
    </Dialog>
  );
}
