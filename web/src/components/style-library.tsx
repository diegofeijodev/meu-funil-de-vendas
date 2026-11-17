"use client";

import { useId, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Switch } from "@/components/ui/switch";
import { SELECTION_TEXT, selectionState } from "@/lib/style-refs";
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
  const state = selectionState(data, { loading: false, error: false, canEdit, isAdmin: false, justChanged: false, allSourcesFailed: false });
  const resolved = !!data.segment && data.segment_source !== "none";
  const toggleId = `style-library-toggle-${brandId}`;
  const radioValue = data.segment_source === "none" ? "none" : (data.segment ?? "");

  return (
    <div className="space-y-4 border-t border-border pt-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <Label htmlFor={toggleId} className="text-sm font-medium">{SELECTION_TEXT.toggle}</Label>
          <p className="text-xs text-muted-foreground">{SELECTION_TEXT.toggleHint}</p>
        </div>
        <Switch
          id={toggleId}
          checked={data.enabled}
          disabled={disabled}
          onCheckedChange={(v) => void patch({ style_library_enabled: v })}
          className="mt-0.5"
        />
      </div>
      <p className="whitespace-pre-line text-sm text-muted-foreground">{state.text}</p>

      {resolved ? (
        <div className="space-y-2">
          <p className="text-sm">{SELECTION_TEXT.counter(data.count)}</p>
        </div>
      ) : null}

      {!resolved && (
        <div className="space-y-2">
          <p id={questionId} className="text-sm">{SELECTION_TEXT.pickQuestion}</p>
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
                  {SELECTION_TEXT.noneOption}
                </Label>
              </div>
            </RadioGroup>
        </div>
      )}
    </div>
  );
}
