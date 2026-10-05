"use client";

import { useState } from "react";
import { Loader2, Trophy, Wand2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { TEXT_LAYOUTS, type TextLayout, type Variation } from "@/lib/creative/visual-style";
import { cn } from "@/lib/utils";

/** Variações lado a lado com a nota do crítico visual. */
export function VariationsGrid({ variations }: { variations: Variation[] }) {
  if (!variations.length) return null;
  return (
    <div className="grid grid-cols-3 gap-2">
      {variations.map((v) => (
        <div
          key={v.assetId}
          className={cn(
            "overflow-hidden rounded-md border",
            v.winner ? "border-primary ring-2 ring-primary/40" : "border-border",
          )}
        >
          <img src={v.url} alt="Variação" className="aspect-square w-full bg-muted object-cover" />
          <div className="space-y-0.5 p-1.5">
            <p className="flex items-center gap-1 text-xs font-semibold">
              {v.winner && <Trophy className="size-3 text-primary" />}
              {v.score ? `${v.score.total}/50` : "sem nota"}
            </p>
            {v.score?.motivo && (
              <p className="line-clamp-3 text-[10px] leading-tight text-muted-foreground" title={v.score.motivo}>
                {v.score.motivo}
              </p>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}

export function LayoutSelect({ value, onChange }: { value: TextLayout; onChange: (v: TextLayout) => void }) {
  return (
    <select
      className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
      value={value}
      onChange={(e) => onChange(e.target.value as TextLayout)}
    >
      {Object.entries(TEXT_LAYOUTS).map(([k, v]) => (
        <option key={k} value={k}>
          {v}
        </option>
      ))}
    </select>
  );
}

/** Editor de post do Instagram: prompt visual editável, layout, variações e ajuste. */
export function ArtDirectionPanel({
  prompt: initialPrompt,
  layout: initialLayout,
  variations,
  busy,
  showLayout = true,
  onSave,
  onAdjust,
}: {
  prompt: string;
  layout: TextLayout;
  variations: Variation[];
  busy?: boolean;
  showLayout?: boolean;
  onSave: (prompt: string, layout: TextLayout) => void;
  onAdjust: (adjust: string) => void;
}) {
  const [prompt, setPrompt] = useState(initialPrompt);
  const [layout, setLayout] = useState<TextLayout>(initialLayout);
  const [adjust, setAdjust] = useState("");
  return (
    <div className="space-y-3 rounded-lg border border-border/70 p-3">
      <p className="text-sm font-semibold">Direção de arte</p>
      <div className="space-y-1.5">
        <Label className="text-xs">Prompt visual em português (gerado pelo diretor de arte)</Label>
        <Textarea rows={4} value={prompt} onChange={(e) => setPrompt(e.target.value)} placeholder="Gerado na próxima criação de mídia." />
      </div>
      {showLayout && (
        <div className="space-y-1.5">
          <Label className="text-xs">Texto sobre a imagem</Label>
          <LayoutSelect value={layout} onChange={setLayout} />
        </div>
      )}
      <Button size="sm" variant="outline" onClick={() => onSave(prompt, layout)}>
        Salvar direção de arte
      </Button>
      <VariationsGrid variations={variations} />
      <div className="flex gap-2">
        <Input
          value={adjust}
          onChange={(e) => setAdjust(e.target.value)}
          placeholder='Ex.: "mais close no copo", "fundo mais escuro"'
          maxLength={300}
        />
        <Button size="sm" disabled={!adjust.trim() || busy} onClick={() => onAdjust(adjust.trim())}>
          {busy ? <Loader2 className="size-4 animate-spin" /> : <Wand2 className="size-4" />}
          Regenerar com ajuste
        </Button>
      </div>
    </div>
  );
}
