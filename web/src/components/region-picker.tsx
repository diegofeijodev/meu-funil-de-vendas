"use client";

import { useEffect, useRef, useState } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import { searchGeo, type GeoTargetInput } from "@/modules/campaigns/infrastructure/campaigns.api";

const RADII = [20, 40, 80] as const;
type Item = { meta_key: string; name: string; uf: string | null };

/** "Jundiaí, SP" / "Jundiaí - SP" / "Jundiaí SP" → { name: "Jundiaí", uf: "SP" }. */
export function splitCityUf(text: string): { name: string; uf: string | null } {
  const m = /^(.*?)[\s,–-]+([A-Za-z]{2})\s*$/.exec(text.trim());
  return m ? { name: m[1]!.trim(), uf: m[2]!.toUpperCase() } : { name: text.trim(), uf: null };
}

export function regionSentence(t: GeoTargetInput | null): string {
  if (!t?.name) return "";
  return t.radius_km ? `${t.name} e cidades em volta, até ${t.radius_km} km do centro.` : `Só ${t.name}.`;
}

type Props = {
  workspaceId: string;
  value: GeoTargetInput | null;
  onChange: (v: GeoTargetInput | null) => void;
  inputId: string;
  error?: string | null;
};

/** Região da campanha (ux §A): cidade da Meta + raio "Só a cidade · +20 · +40 · +80 · Outra distância" (17 a 80 km). */
export function RegionPicker({ workspaceId, value, onChange, inputId, error }: Props) {
  const [query, setQuery] = useState(value ? (value.uf ? `${value.name}, ${value.uf}` : value.name) : "");
  const [items, setItems] = useState<Item[]>([]);
  const [searched, setSearched] = useState("");
  const [notConnected, setNotConnected] = useState<string | null>(null);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [other, setOther] = useState(value?.radius_km && !RADII.includes(value.radius_km as 20) ? String(value.radius_km) : "");
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const radius = value ? value.radius_km : 20;
  const radiusChoice = radius == null ? "only" : RADII.includes(radius as 20) && !other ? String(radius) : "other";

  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);

  const type = (text: string) => {
    setQuery(text);
    const { name, uf } = splitCityUf(text);
    onChange(name ? { type: "city", name, uf, meta_key: null, radius_km: radius } : null);
    if (timer.current) clearTimeout(timer.current);
    if (name.length < 3) {
      setItems([]);
      setSearched("");
      return;
    }
    timer.current = setTimeout(async () => {
      try {
        const r = await searchGeo(workspaceId, name);
        setSearchError(null);
        if ("error" in r) {
          setNotConnected(r.error.message);
          setItems([]);
        } else {
          setNotConnected(null);
          // Com a UF escrita, a cidade daquele estado vem primeiro.
          setItems(uf ? [...r.items].sort((a, b) => Number(b.uf === uf) - Number(a.uf === uf)) : r.items);
        }
        setSearched(name);
      } catch {
        setSearchError("Não deu para buscar na Meta agora. A cidade fica como você escreveu e é conferida ao publicar.");
        setItems([]);
      }
    }, 400);
  };

  const pick = (it: Item) => {
    setQuery(it.uf ? `${it.name}, ${it.uf}` : it.name);
    setItems([]);
    setSearched("");
    onChange({ type: "city", name: it.name, uf: it.uf, meta_key: it.meta_key, radius_km: radius });
  };

  const setRadius = (r: number | null) => value && onChange({ ...value, radius_km: r });
  const chip = (active: boolean) =>
    cn(
      "min-h-11 rounded-lg border px-3 py-2 text-sm transition-colors",
      active ? "border-primary bg-primary/10 text-primary" : "border-border hover:bg-surface",
    );
  const otherNum = Number(other);
  const otherInvalid = radiusChoice === "other" && other !== "" && !(Number.isInteger(otherNum) && otherNum >= 17 && otherNum <= 80);

  return (
    <div className="space-y-2">
      <Label htmlFor={inputId}>Região</Label>
      <Input
        id={inputId}
        value={query}
        onChange={(e) => type(e.target.value)}
        placeholder="Jundiaí, SP"
        autoComplete="off"
        aria-invalid={!!error}
        aria-describedby={`${inputId}-help${error ? ` ${inputId}-err` : ""}`}
      />
      <p id={`${inputId}-help`} className="text-xs text-muted-foreground">
        {notConnected ?? "Cidade e estado, como no endereço. Escolha na lista da Meta para não ter erro."}
      </p>
      {value?.meta_key && <p className="text-xs text-success">Cidade conferida na Meta: {value.name}{value.uf ? ` – ${value.uf}` : ""}.</p>}
      {items.length > 0 && (
        <div className="flex flex-col gap-1" role="group" aria-label="Cidades encontradas na Meta">
          {items.map((it) => (
            <button key={it.meta_key} type="button" className={cn(chip(false), "text-left")} onClick={() => pick(it)}>
              {it.name}{it.uf ? ` – ${it.uf}` : ""}
            </button>
          ))}
        </div>
      )}
      {!items.length && searched && !notConnected && !value?.meta_key && (
        <p className="text-sm text-muted-foreground">Não achamos “{searched}” nas cidades da Meta. Confira a escrita.</p>
      )}
      {searchError && <p className="text-xs text-muted-foreground">{searchError}</p>}

      {value?.name && (
        <fieldset className="space-y-2">
          <legend className="sr-only">Distância em volta da cidade</legend>
          <div className="flex flex-wrap gap-2">
            <button type="button" aria-pressed={radiusChoice === "only"} className={chip(radiusChoice === "only")} onClick={() => { setOther(""); setRadius(null); }}>
              Só a cidade
            </button>
            {RADII.map((r) => (
              <button key={r} type="button" aria-pressed={radiusChoice === String(r)} className={chip(radiusChoice === String(r))} onClick={() => { setOther(""); setRadius(r); }}>
                +{r} km
              </button>
            ))}
            <button type="button" aria-pressed={radiusChoice === "other"} className={chip(radiusChoice === "other")} onClick={() => { setOther(String(radius ?? 25)); setRadius(radius ?? 25); }}>
              Outra distância
            </button>
          </div>
          {radiusChoice === "other" && (
            <div className="space-y-1">
              <Input
                type="number"
                inputMode="numeric"
                min={17}
                max={80}
                aria-label="Distância em km (17 a 80)"
                value={other}
                onChange={(e) => {
                  setOther(e.target.value);
                  const n = Number(e.target.value);
                  if (Number.isInteger(n) && n >= 17 && n <= 80) setRadius(n);
                }}
                className="sm:w-32"
              />
              <p className={cn("text-xs", otherInvalid ? "text-destructive" : "text-muted-foreground")}>
                A Meta aceita de 17 a 80 km em volta de uma cidade.
              </p>
            </div>
          )}
          <p className="text-sm text-muted-foreground">{regionSentence(value)}</p>
        </fieldset>
      )}
      {error && (
        <p id={`${inputId}-err`} role="alert" className="text-sm text-destructive">{error}</p>
      )}
    </div>
  );
}
