"use client";

import { Button } from "@/components/ui/button";
import { refOrigin, refScope, refStateText, removeLabel } from "@/lib/style-refs";
import type { StyleRef } from "@/modules/style-refs/infrastructure/style-refs.api";

/** Uma referência de estilo: miniatura, origem e alcance, estado e [Remover] (ui.md §2 e §3.6). Usada no painel, na campanha e no bloco da Seleção. */
export function StyleRefRow({
  item,
  canEdit,
  onRemove,
  selection = false,
  paused = false,
}: {
  item: StyleRef;
  canEdit: boolean;
  onRemove: (r: StyleRef) => void;
  /** Referência da Seleção do Meu Funil: usa os textos de estado dela. */
  selection?: boolean;
  /** Seleção em pausa (estado 6): "Guardada: …". */
  paused?: boolean;
}) {
  return (
    <li className="rounded-lg border border-border p-3">
      <div className="flex gap-3">
        {item.image_url ? (
          <img src={item.image_url} alt="" className="size-16 shrink-0 rounded-md object-cover" loading="lazy" />
        ) : (
          <div className="size-16 shrink-0 rounded-md bg-muted" />
        )}
        <div className="min-w-0 flex-1 space-y-1 text-sm">
          <p className="text-sm text-muted-foreground">
            {refOrigin(item)} · {refScope(item)}
          </p>
          <p className={item.status === "failed" && !selection ? "text-destructive" : undefined}>{refStateText(item, { selection, paused })}</p>
        </div>
      </div>
      {canEdit && (
        <Button variant="ghost" size="sm" className="mt-2 h-11" aria-label={removeLabel(item)} onClick={() => onRemove(item)}>
          Remover
        </Button>
      )}
    </li>
  );
}
