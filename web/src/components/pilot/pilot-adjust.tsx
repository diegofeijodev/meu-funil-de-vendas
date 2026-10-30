"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Drawer, DrawerContent, DrawerDescription, DrawerFooter, DrawerHeader, DrawerTitle } from "@/components/ui/drawer";
import { Input } from "@/components/ui/input";
import type { PilotOptions } from "@/modules/campaign-pilot/infrastructure/pilot.api";

const WEEKDAYS = ["dom", "seg", "ter", "qua", "qui", "sex", "sáb"];
const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;
const parseTimes = (s: string) => s.split(/[,\s]+/).map((x) => x.trim()).filter(Boolean);

function Stepper({ label, hint, value, min, max, step = 1, onChange }: { label: string; hint?: string; value: number; min: number; max: number; step?: number; onChange: (n: number) => void }) {
  return (
    <div className="flex items-center justify-between gap-3 py-2">
      <div>
        <p className="text-sm font-medium">{label}</p>
        {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
      </div>
      <div className="flex items-center gap-2" role="group" aria-label={label}>
        <Button type="button" variant="outline" className="h-11 w-11 lg:h-9 lg:w-9" aria-label={`Menos: ${label}`} disabled={value <= min} onClick={() => onChange(Math.max(min, value - step))}>−</Button>
        <span className="w-8 text-center text-sm tabular-nums" aria-live="polite">{value}</span>
        <Button type="button" variant="outline" className="h-11 w-11 lg:h-9 lg:w-9" aria-label={`Mais: ${label}`} disabled={value >= max} onClick={() => onChange(Math.min(max, value + step))}>+</Button>
      </div>
    </div>
  );
}

/** "Ajustar" do pacote (doc de UI, B): uma folha de baixo, sem drawer dentro de drawer. Ao salvar, o pacote é recalculado pelo servidor. */
export function PilotAdjust({
  open, onOpenChange, value, canManage, maxPieces, onSave,
}: { open: boolean; onOpenChange: (o: boolean) => void; value: PilotOptions; canManage: boolean; maxPieces: number; onSave: (o: PilotOptions, capTouched: boolean) => void }) {
  const [o, setO] = useState<PilotOptions>(value);
  const [times, setTimes] = useState(value.instagram.times.join(", "));
  const [storyTimes, setStoryTimes] = useState(value.instagram.story_times.join(", "));
  const [capTouched, setCapTouched] = useState(false);
  const [timesTouched, setTimesTouched] = useState(false);
  const set = (patch: Partial<PilotOptions>) => setO((p) => ({ ...p, ...patch }));
  const ig = (patch: Partial<PilotOptions["instagram"]>) => setO((p) => ({ ...p, instagram: { ...p.instagram, ...patch } }));
  const pieces = o.max_angles * o.images_per_angle + o.videos;
  const badTimes = [...parseTimes(times), ...parseTimes(storyTimes)].some((t) => !HHMM.test(t));
  const noTimes = o.instagram.enabled && !parseTimes(times).length && !parseTimes(storyTimes).length;

  return (
    <Drawer open={open} onOpenChange={(v) => { if (v) { setO(value); setTimes(value.instagram.times.join(", ")); setStoryTimes(value.instagram.story_times.join(", ")); setCapTouched(false); setTimesTouched(false); } onOpenChange(v); }}>
      <DrawerContent>
        <div className="mx-auto w-full max-w-lg overflow-y-auto px-4" style={{ maxHeight: "70vh" }}>
          <DrawerHeader className="px-0">
            <DrawerTitle>Ajustar o plano</DrawerTitle>
            <DrawerDescription>Quantas peças o estrategista faz e como o Instagram anda. O custo é recalculado ao salvar. Os ajustes valem até você aprovar; se sair desta tela, voltam ao sugerido.</DrawerDescription>
          </DrawerHeader>

          <h3 className="mt-2 text-sm font-semibold">Artes do anúncio</h3>
          <Stepper label="Jeitos de falar" hint="jeitos diferentes de falar da oferta" value={o.max_angles} min={1} max={5} onChange={(n) => set({ max_angles: n })} />
          <Stepper label="Artes por jeito" value={o.images_per_angle} min={1} max={3} onChange={(n) => set({ images_per_angle: n })} />
          <Stepper label="Versões de cada arte" hint="a revisão automática fica com a melhor" value={o.variations} min={1} max={3} onChange={(n) => set({ variations: n })} />
          <Stepper label="Vídeos verticais" value={o.videos} min={0} max={2} onChange={(n) => set({ videos: n })} />
          <Stepper label="Teto de créditos" hint={capTouched ? "o estrategista para antes de passar" : "acompanha a conta até você mexer"} value={o.max_credits} min={6} max={500} step={6} onChange={(n) => { setCapTouched(true); set({ max_credits: n }); }} />
          {pieces > maxPieces && <p role="alert" className="text-sm text-destructive">No máximo {maxPieces} peças por campanha (agora: {pieces}).</p>}

          <h3 className="mt-4 text-sm font-semibold">Instagram</h3>
          <label className="flex min-h-11 items-center gap-2 text-sm">
            <input type="checkbox" checked={o.instagram.enabled} onChange={(e) => ig({ enabled: e.target.checked })} />
            Programar posts no Instagram durante a campanha
          </label>
          {o.instagram.enabled && (
            <div className="space-y-3 pb-2">
              <fieldset>
                <legend className="text-sm">Dias</legend>
                <div className="mt-1 flex flex-wrap gap-2">
                  {WEEKDAYS.map((d, i) => {
                    const on = o.instagram.weekdays.includes(i);
                    return (
                      <Button key={d} type="button" variant={on ? "default" : "outline"} className="h-11 min-w-11 lg:h-9" aria-pressed={on}
                        onClick={() => ig({ weekdays: on ? o.instagram.weekdays.filter((x) => x !== i) : [...o.instagram.weekdays, i].sort() })}>
                        {d}
                      </Button>
                    );
                  })}
                </div>
                {o.instagram.weekdays.length === 0 && <p role="alert" className="mt-1 text-sm text-destructive">Escolha pelo menos um dia.</p>}
              </fieldset>
              <label className="block text-sm">
                Horários dos posts (ex.: 11:00, 18:00)
                <Input className="h-11 lg:h-9" value={times} onChange={(e) => setTimes(e.target.value)} onBlur={() => setTimesTouched(true)} inputMode="text" />
              </label>
              <label className="block text-sm">
                Horários dos stories (ex.: 12:00)
                <Input className="h-11 lg:h-9" value={storyTimes} onChange={(e) => setStoryTimes(e.target.value)} onBlur={() => setTimesTouched(true)} inputMode="text" />
              </label>
              {timesTouched && badTimes && <p role="alert" className="text-sm text-destructive">Use horas no formato 18:00.</p>}
              {noTimes && <p role="alert" className="text-sm text-destructive">Informe ao menos um horário.</p>}
              <fieldset className="space-y-1">
                <legend className="text-sm">Antes de postar</legend>
                <label className="flex min-h-11 items-center gap-2 text-sm">
                  <input type="radio" name="ig-mode" checked={o.instagram.mode === "approval"} onChange={() => ig({ mode: "approval" })} />
                  Eu aprovo cada post antes (recomendado na 1ª campanha)
                </label>
                <label className={`flex min-h-11 items-center gap-2 text-sm ${canManage ? "" : "opacity-60"}`}>
                  <input type="radio" name="ig-mode" disabled={!canManage} checked={o.instagram.mode === "publish"} onChange={() => ig({ mode: "publish" })} />
                  Posta sozinho depois da revisão automática{canManage ? "" : " (só o dono ou um admin)"}
                </label>
              </fieldset>
            </div>
          )}
        </div>
        <DrawerFooter className="mx-auto w-full max-w-lg">
          <Button
            className="h-11 lg:h-9"
            disabled={pieces > maxPieces || badTimes || noTimes || o.instagram.weekdays.length === 0}
            onClick={() => onSave({ ...o, instagram: { ...o.instagram, times: parseTimes(times), story_times: parseTimes(storyTimes) } }, capTouched)}
          >
            Salvar
          </Button>
          <Button variant="outline" className="h-11 lg:h-9" onClick={() => onOpenChange(false)}>Cancelar</Button>
        </DrawerFooter>
      </DrawerContent>
    </Drawer>
  );
}
