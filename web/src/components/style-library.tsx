"use client";

import { useId, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { ChevronDown } from "lucide-react";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Switch } from "@/components/ui/switch";
import { LIBRARY_TEXT, libraryLine, libraryState, unrecognizedLine } from "@/lib/style-refs";
import { updateBrand } from "@/modules/brands/infrastructure/brands.api";
import { useFeatures } from "@/modules/features/infrastructure/features.api";
import { apiErrorMessage } from "@/modules/shared/infrastructure/http";
import { getStyleLibrary } from "@/modules/style-refs/infrastructure/style-refs.api";

/** "Seleção do Meu Funil" na aba Guia visual da Marca (ui.md §3; P11). Só aparece com `features.style_library`. */
export function StyleLibrary({ workspaceId, brandId, canEdit }: { workspaceId: string; brandId: string; canEdit: boolean }) {
  const qc = useQueryClient();
  const features = useFeatures(workspaceId);
  const on = features.data?.style_library === true;
  const key = ["style-library", workspaceId, brandId];
  const questionId = useId();
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(false);
  const { data } = useQuery({
    queryKey: key,
    enabled: on,
    retry: false,
    queryFn: () => getStyleLibrary(workspaceId, brandId),
  });

  if (!on || !data) return null;

  const patch = async (body: Record<string, unknown>) => {
    setBusy(true);
    try {
      await updateBrand(workspaceId, brandId, body);
      await Promise.all([qc.invalidateQueries({ queryKey: key }), qc.invalidateQueries({ queryKey: ["brand", brandId] })]);
    } catch (e) {
      toast.error(apiErrorMessage(e, "Não foi possível salvar."));
    } finally {
      setBusy(false);
    }
  };

  const disabled = !canEdit || busy;
  const state = libraryState(data);
  const resolved = !!data.segment && data.segment_source !== "none";
  const toggleId = `style-library-toggle-${brandId}`;
  const radioValue = data.segment_source === "none" ? "none" : (data.segment ?? "");

  return (
    <div className="space-y-4 border-t border-border pt-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <Label htmlFor={toggleId} className="text-sm font-medium">{LIBRARY_TEXT.toggle}</Label>
          <p className="text-xs text-muted-foreground">{LIBRARY_TEXT.toggleHint}</p>
        </div>
        <Switch
          id={toggleId}
          checked={data.enabled}
          disabled={disabled}
          onCheckedChange={(v) => void patch({ style_library_enabled: v })}
          className="mt-0.5"
        />
      </div>
      <p className="text-sm text-muted-foreground" aria-live="polite">{LIBRARY_TEXT[state]}</p>

      {resolved ? (
        <div className="space-y-2">
          <p className="text-sm">{libraryLine(data.segment_label ?? data.segment!, data.count)}</p>
          {data.descriptions.length > 0 && (
            <Collapsible open={open} onOpenChange={setOpen}>
              <CollapsibleTrigger className="flex min-h-11 items-center gap-1 text-sm font-medium text-primary">
                {LIBRARY_TEXT.seeDescriptions}
                <ChevronDown className={`size-4 transition-transform ${open ? "rotate-180" : ""}`} aria-hidden />
              </CollapsibleTrigger>
              <CollapsibleContent>
                <ul className="list-disc space-y-1 pl-5 text-sm text-muted-foreground">
                  {data.descriptions.map((d, i) => (
                    <li key={i}>{d}</li>
                  ))}
                </ul>
              </CollapsibleContent>
            </Collapsible>
          )}
        </div>
      ) : null}

      {!resolved && (
        <div className="space-y-2">
          <p id={questionId} className="text-sm">{unrecognizedLine(data.brand_segment)}</p>
          <RadioGroup
              value={radioValue}
              onValueChange={(v) => void patch({ style_library_segment: v })}
              disabled={disabled}
              aria-labelledby={questionId}
              className="gap-0"
            >
              {data.options.map((o) => (
                <div key={o.id} className="flex min-h-11 items-center gap-3">
                  <RadioGroupItem value={o.id} id={`sl-${brandId}-${o.id}`} className="size-5" />
                  <Label htmlFor={`sl-${brandId}-${o.id}`} className="flex min-h-11 flex-1 cursor-pointer items-center text-sm font-normal">
                    {o.label}
                  </Label>
                </div>
              ))}
              <div className="flex min-h-11 items-center gap-3">
                <RadioGroupItem value="none" id={`sl-${brandId}-none`} className="size-5" />
                <Label htmlFor={`sl-${brandId}-none`} className="flex min-h-11 flex-1 cursor-pointer items-center text-sm font-normal">
                  {LIBRARY_TEXT.none}
                </Label>
              </div>
            </RadioGroup>
        </div>
      )}
    </div>
  );
}
