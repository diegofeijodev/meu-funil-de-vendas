"use client";

import { useEffect, useRef, useState } from "react";
import { Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { brl } from "@/lib/format";
import { parseMoneyInput } from "@/lib/money-input";
import { cn } from "@/lib/utils";
import { isFreeRegion, RegionPicker, splitCityUf } from "@/components/region-picker";
import {
  intakeCampaign,
  type CampaignIntake,
  type GeoTargetInput,
  type NewCampaignInput,
} from "@/modules/campaigns/infrastructure/campaigns.api";
import { apiErrorMessage } from "@/modules/shared/infrastructure/http";

const MAX = 4000;
const PLACEHOLDER =
  "Quero uma campanha para cadastros de bares e restaurantes de Jundiaí por 30 dias, oferecendo a primeira contratação gratuita.";
const BUDGETS = ["20", "30", "50"] as const;
const OFFER_KINDS = [
  { key: "taxa", label: "A taxa do serviço", what: "A taxa do serviço" },
  { key: "diaria", label: "A diária do profissional", what: "A diária do profissional" },
  { key: "ambas", label: "As duas", what: "A taxa e a diária (a contratação inteira)" },
  { key: "outro", label: "Escrever", what: "" },
] as const;
type OfferKind = "" | (typeof OFFER_KINDS)[number]["key"];

const ddmmyyyy = (ymd: string) => ymd.split("-").reverse().join("/");
const round2 = (n: number) => Math.round(n * 100) / 100;
const isHttpUrl = (v: string) => {
  try {
    const u = new URL(v.trim());
    return (u.protocol === "http:" || u.protocol === "https:") && !!u.hostname;
  } catch {
    return false;
  }
};

type Props = {
  workspaceId: string;
  brands: { id: string; name: string }[];
  brandId: string;
  onBrandChange: (id: string) => void;
  busy: boolean;
  onCreate: (input: NewCampaignInput) => void;
  onEditDetails: (input: NewCampaignInput) => void;
  onUseForm: () => void;
};

/** "Conte o que você quer" → "Entendi" com até 3 perguntas (verba → destino → oferta) e a cidade (ux §A, Fatia 1). */
export function IntakePanel({ workspaceId, brands, brandId, onBrandChange, busy, onCreate, onEditDetails, onUseForm }: Props) {
  const [text, setText] = useState("");
  const [textError, setTextError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [aiError, setAiError] = useState<string | null>(null);
  const [res, setRes] = useState<CampaignIntake | null>(null);

  const [budget, setBudget] = useState("");
  const [budgetOther, setBudgetOther] = useState("");
  const [landing, setLanding] = useState("");
  const [offerKind, setOfferKind] = useState<OfferKind>("");
  const [offerText, setOfferText] = useState("");
  const [offerUntil, setOfferUntil] = useState("");
  const [newOnly, setNewOnly] = useState<boolean | null>(null);
  // Região: a cidade que o estrategista entendeu, com +20 km (igual a hoje); a pessoa confere na lista da Meta e escolhe o raio.
  const [geo, setGeo] = useState<GeoTargetInput | null>(null);
  // País inteiro ou várias cidades ("Jundiaí e Campinas"): fica como texto e o publicar confere cada cidade na Meta.
  const [regionText, setRegionText] = useState<string | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const headingRef = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    if (res) headingRef.current?.focus();
  }, [res]);

  const send = async () => {
    const t = text.trim();
    if (!t) {
      setTextError("Conte em uma ou duas frases o que você quer.");
      document.getElementById("intake-text")?.focus();
      return;
    }
    if (t.length > MAX) {
      setTextError(`Ficou longo demais (${t.length.toLocaleString("pt-BR")} de 4.000 letras). Corte um pouco.`);
      return;
    }
    setTextError(null);
    setAiError(null);
    setLoading(true);
    try {
      const r = await intakeCampaign(workspaceId, brandId, t);
      setRes(r);
      setBudget("");
      setBudgetOther("");
      setLanding(r.draft.landing_url ?? "");
      setOfferKind("");
      setOfferText("");
      setOfferUntil(r.draft.end_date);
      setNewOnly(null);
      const loc = r.draft.audience.localizacao.trim();
      if (isFreeRegion(loc)) {
        setRegionText(loc);
        setGeo(null);
      } else {
        setRegionText(null);
        const place = splitCityUf(loc);
        setGeo(place.name ? { type: "city", name: place.name, uf: place.uf, meta_key: null, radius_km: 20 } : null);
      }
      setErrors({});
    } catch (e) {
      setAiError(`${apiErrorMessage(e, "Não conseguimos ler o pedido agora.")} Seu texto continua aqui.`);
    } finally {
      setLoading(false);
    }
  };

  const need = (field: CampaignIntake["missing"][number]["field"]) => !!res?.missing.some((m) => m.field === field);
  const question = (field: CampaignIntake["missing"][number]["field"]) => res?.missing.find((m) => m.field === field);

  const dailyValue = (): number | null => {
    if (!res) return null;
    if (!need("budget_daily")) return res.draft.budget_daily;
    const v = budget === "outro" ? parseMoneyInput(budgetOther) : Number(budget);
    return v > 0 ? v : null;
  };
  const landingValue = () => (need("landing_url") ? landing.trim() : (res?.draft.landing_url ?? ""));
  const offerWhat = () => (offerKind === "outro" ? offerText.trim() : (OFFER_KINDS.find((k) => k.key === offerKind)?.what ?? ""));
  // Quem se interessa vai para uma página: o anúncio busca cliques no link (o formulário da Meta fica em "Ver/ajustar").
  const toTraffic = !!res && res.draft.objective === "leads";

  const buildInput = (): NewCampaignInput => {
    const d = res!.draft;
    const daily = dailyValue();
    const total = need("budget_daily") ? (daily ? round2(daily * res!.days) : null) : (d.budget_total ?? (daily ? round2(daily * res!.days) : null));
    return {
      brand_id: brandId,
      name: d.name,
      objective: toTraffic ? "traffic" : d.objective,
      offer_product: d.offer_product,
      offer_price: null,
      offer_promise: d.offer_promise,
      landing_url: landingValue(),
      start_date: d.start_date,
      end_date: d.end_date,
      audience: { ...d.audience, localizacao: regionText !== null ? regionText.trim() : geo ? (geo.uf ? `${geo.name}, ${geo.uf}` : geo.name) : "" },
      geo_targets: regionText === null && geo ? [geo] : [],
      budget_total: total,
      budget_daily: daily,
      goal_leads: d.goal_leads,
      goal_sales: null,
      avg_ticket: null,
      margin_percent: null,
      max_cac: null,
      formats: d.formats,
      intake_text: d.intake_text,
      offer_terms: need("offer_terms") && offerWhat() && offerUntil && newOnly !== null ? { what: offerWhat(), valid_until: offerUntil, new_only: newOnly } : null,
    };
  };

  /** "Ver/ajustar": o formulário não tem as condições da oferta, então elas são respondidas aqui antes (o servidor exige). */
  const editDetails = () => {
    if (need("offer_terms") && !(offerWhat() && offerUntil && newOnly !== null)) {
      setErrors({ "q-offer": "Antes de abrir os detalhes, diga o que é grátis, até quando vale e se é só para empresa nova." });
      document.getElementById("q-offer")?.focus();
      return;
    }
    onEditDetails(buildInput());
  };

  const create = () => {
    const errs: Record<string, string> = {};
    if (need("budget_daily") && !dailyValue()) errs["q-budget"] = "Escolha quanto gastar por dia.";
    if (need("landing_url") && !isHttpUrl(landing)) errs["q-landing"] = "Cole o link da página, começando com https://.";
    if (need("offer_terms")) {
      if (!offerWhat()) errs["q-offer"] = "Diga o que é grátis ou oferecido.";
      else if (!offerUntil) errs["q-offer-until"] = "Informe até quando a oferta vale.";
      else if (newOnly === null) errs["q-offer-new"] = "Responda se vale só para empresa nova.";
    }
    if (regionText !== null) {
      if (regionText.trim().length < 2) errs["q-city"] = "Escreva a cidade (ex.: Jundiaí, SP).";
    } else if ((geo?.name.length ?? 0) < 2) errs["q-city"] = "Escreva a cidade (ex.: Jundiaí, SP).";
    else if (geo?.radius_km != null && (geo.radius_km < 17 || geo.radius_km > 80)) errs["q-city"] = "A Meta aceita de 17 a 80 km em volta de uma cidade.";
    setErrors(errs);
    const first = Object.keys(errs)[0];
    if (first) {
      document.getElementById(first)?.focus();
      return;
    }
    onCreate(buildInput());
  };

  const daily = dailyValue();
  const chip = (active: boolean) =>
    cn(
      "min-h-11 rounded-lg border px-3 py-2 text-sm transition-colors",
      active ? "border-primary bg-primary/10 text-primary" : "border-border hover:bg-surface",
    );
  const fieldError = (id: string) =>
    errors[id] ? (
      <p id={`${id}-err`} role="alert" className="text-sm text-destructive">
        {errors[id]}
      </p>
    ) : null;

  return (
    <div className="panel space-y-5 p-4 sm:p-6">
      {brands.length > 1 && (
        <div className="space-y-1.5">
          <Label htmlFor="intake-brand">Marca</Label>
          <select
            id="intake-brand"
            className="h-11 w-full rounded-md border border-input bg-background px-3 text-sm sm:h-9"
            value={brandId}
            onChange={(e) => onBrandChange(e.target.value)}
          >
            {brands.map((b) => (
              <option key={b.id} value={b.id}>{b.name}</option>
            ))}
          </select>
        </div>
      )}

      <div className="space-y-1.5">
        <Label htmlFor="intake-text" className="text-base font-semibold">Conte o que você quer</Label>
        <p id="intake-help" className="text-sm text-muted-foreground">O que quer, para quem, onde, por quanto tempo e a oferta.</p>
        <Textarea
          id="intake-text"
          rows={6}
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={PLACEHOLDER}
          aria-describedby={textError ? "intake-help intake-text-err" : "intake-help"}
          aria-invalid={!!textError}
          className="min-h-36"
        />
        {text.length > 3500 && (
          <p className={cn("text-xs", text.length > MAX ? "text-destructive" : "text-muted-foreground")}>
            {text.length.toLocaleString("pt-BR")} de 4.000 letras
          </p>
        )}
        {textError && (
          <p id="intake-text-err" role="alert" className="text-sm text-destructive">{textError}</p>
        )}
        <p className="text-xs text-muted-foreground">
          Prefere áudio? Toque no microfone do teclado ou cole a transcrição de um áudio do WhatsApp.
        </p>
      </div>

      {aiError && (
        <div role="alert" className="rounded-lg border border-destructive/40 bg-destructive/5 p-3 text-sm">
          <p>{aiError}</p>
          <div className="mt-2 flex flex-wrap gap-2">
            <Button variant="outline" size="sm" className="h-11 sm:h-8" onClick={() => void send()}>Tentar de novo</Button>
            <Button variant="ghost" size="sm" onClick={onUseForm}>Preencher formulário ›</Button>
          </div>
        </div>
      )}

      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-sm text-muted-foreground">
          Prefere ir campo a campo?{" "}
          <Button variant="link" className="h-11 px-0 sm:h-auto" onClick={onUseForm}>
            Preencher formulário ›
          </Button>
        </p>
        <Button className="h-11 sm:h-9" variant={res ? "outline" : "default"} onClick={() => void send()} disabled={loading}>
          <Sparkles className="mr-2 size-4" />
          {loading ? "Lendo o seu pedido…" : res ? "Mandar de novo" : "Mandar para o estrategista"}
        </Button>
      </div>

      {loading && <div className="h-40 animate-pulse rounded-lg bg-muted" aria-hidden="true" />}

      {res && !loading && (
        <section className="space-y-5 border-t border-border pt-5" aria-labelledby="intake-understood">
          <div className="space-y-1">
            <h2 id="intake-understood" ref={headingRef} tabIndex={-1} className="text-lg font-semibold outline-none">
              Entendi
            </h2>
            <p className="text-sm">{res.summary}</p>
          </div>

          {(res.assumptions.length > 0 || toTraffic) && (
            <div className="space-y-1">
              <p className="text-sm font-medium">Considerei que</p>
              <ul className="list-disc space-y-1 pl-5 text-sm text-muted-foreground">
                {res.assumptions.map((a, i) => (
                  <li key={`${a.field}-${i}`}>{a.text}</li>
                ))}
                {toTraffic && (
                  <li>Quem se interessar vai para a sua página: o anúncio busca cliques no link. Para usar o formulário da Meta, abra Ver/ajustar.</li>
                )}
              </ul>
            </div>
          )}

          {res.missing.length > 0 && (
            <p className="text-sm font-medium">
              {res.missing.length === 1 ? "Falta 1 resposta" : `Faltam ${res.missing.length} respostas`}
            </p>
          )}

          {need("budget_daily") && (
            <fieldset className="space-y-2" aria-describedby={errors["q-budget"] ? "q-budget-err" : undefined}>
              <legend className="text-sm font-medium">{question("budget_daily")?.question}</legend>
              <div className="flex flex-wrap gap-2">
                {BUDGETS.map((b, i) => (
                  <button key={b} id={i === 0 ? "q-budget" : undefined} type="button" aria-pressed={budget === b} className={chip(budget === b)} onClick={() => setBudget(b)}>
                    R$ {b}
                  </button>
                ))}
                <button type="button" aria-pressed={budget === "outro"} className={chip(budget === "outro")} onClick={() => setBudget("outro")}>
                  Outro
                </button>
              </div>
              {budget === "outro" && (
                <Input
                  inputMode="decimal"
                  aria-label="Valor por dia em reais"
                  placeholder="Ex.: 40"
                  value={budgetOther}
                  onChange={(e) => setBudgetOther(e.target.value)}
                  className="sm:w-40"
                />
              )}
              {daily && (
                <p className="text-sm text-muted-foreground">
                  {brl(daily)} por dia × {res.days} dias = até cerca de {brl(round2(daily * res.days))} no período.
                </p>
              )}
              {fieldError("q-budget")}
            </fieldset>
          )}

          {need("landing_url") && (
            <div className="space-y-2">
              <Label htmlFor="q-landing">{question("landing_url")?.question}</Label>
              <p className="text-xs text-muted-foreground">O link da página para onde o anúncio leva (ex.: a página de cadastro).</p>
              <Input
                id="q-landing"
                type="url"
                inputMode="url"
                placeholder="https://"
                value={landing}
                onChange={(e) => setLanding(e.target.value)}
                aria-invalid={!!errors["q-landing"]}
                aria-describedby={errors["q-landing"] ? "q-landing-err" : undefined}
              />
              {question("landing_url")?.suggestion && landing.trim() !== question("landing_url")?.suggestion && (
                <Button variant="outline" size="sm" className="h-auto min-h-11 whitespace-normal break-all text-left" onClick={() => setLanding(question("landing_url")!.suggestion!)}>
                  Usar o último link: {question("landing_url")!.suggestion}
                </Button>
              )}
              {fieldError("q-landing")}
            </div>
          )}

          {need("offer_terms") && (
            <fieldset className="space-y-3">
              <legend className="text-sm font-medium">{question("offer_terms")?.question}</legend>
              <p className="text-xs text-muted-foreground">
                A oferta anunciada vale como promessa: o estrategista só promete o que estiver escrito aqui.
              </p>
              <div className="flex flex-wrap gap-2">
                {OFFER_KINDS.map((k, i) => (
                  <button key={k.key} id={i === 0 ? "q-offer" : undefined} type="button" aria-pressed={offerKind === k.key} className={chip(offerKind === k.key)} onClick={() => setOfferKind(k.key)}>
                    {k.label}
                  </button>
                ))}
              </div>
              {offerKind === "outro" && (
                <Input aria-label="O que é grátis ou oferecido" placeholder="Ex.: a 1ª vaga inteira, com cupom liberado depois do cadastro" value={offerText} onChange={(e) => setOfferText(e.target.value)} maxLength={200} />
              )}
              {fieldError("q-offer")}
              <div className="space-y-1.5">
                <Label htmlFor="q-offer-until">Vale até</Label>
                <Input id="q-offer-until" type="date" value={offerUntil} onChange={(e) => setOfferUntil(e.target.value)} className="sm:w-48" />
                {fieldError("q-offer-until")}
              </div>
              <div className="space-y-1.5">
                <p className="text-sm">Só para empresa nova?</p>
                <div className="flex gap-2">
                  <button id="q-offer-new" type="button" aria-pressed={newOnly === true} className={chip(newOnly === true)} onClick={() => setNewOnly(true)}>Sim</button>
                  <button type="button" aria-pressed={newOnly === false} className={chip(newOnly === false)} onClick={() => setNewOnly(false)}>Não</button>
                </div>
                {fieldError("q-offer-new")}
              </div>
            </fieldset>
          )}

          {regionText !== null ? (
            <div className="space-y-1.5">
              <Label htmlFor="q-city">Região</Label>
              <Input
                id="q-city"
                value={regionText}
                onChange={(e) => setRegionText(e.target.value)}
                aria-invalid={!!errors["q-city"]}
                aria-describedby={errors["q-city"] ? "q-city-help q-city-err" : "q-city-help"}
              />
              <p id="q-city-help" className="text-xs text-muted-foreground">
                {/^\s*(o\s+)?(brasil|todo\s+o\s+pa[ií]s|nacional)/i.test(regionText)
                  ? "O anúncio aparece no Brasil inteiro. Para limitar, escreva as cidades separadas por ponto e vírgula (ex.: Jundiaí, SP; Campinas, SP)."
                  : "Cada cidade é conferida na Meta ao publicar, com até 20 km em volta. Se alguma não for achada, o anúncio não é montado e avisamos qual."}
              </p>
              <Button
                variant="link"
                className="h-auto px-0"
                onClick={() => {
                  const place = splitCityUf(regionText.split(/;|,|\se\s/)[0] ?? "");
                  setGeo(place.name ? { type: "city", name: place.name, uf: place.uf, meta_key: null, radius_km: 20 } : null);
                  setRegionText(null);
                }}
              >
                Usar só {splitCityUf(regionText.split(/;|,|\se\s/)[0] ?? "").name || "uma cidade"} e escolher na lista ›
              </Button>
              {fieldError("q-city")}
            </div>
          ) : (
            <RegionPicker key={res.draft.intake_text} workspaceId={workspaceId} value={geo} onChange={setGeo} inputId="q-city" error={errors["q-city"]} />
          )}

          <p className="text-xs text-muted-foreground">
            Período: {ddmmyyyy(res.draft.start_date)} a {ddmmyyyy(res.draft.end_date)} ({res.days} dias). Nada vai para o Instagram ou para a Meta sem você conferir.
          </p>

          <div className="sticky bottom-0 -mx-4 flex flex-col-reverse gap-2 border-t border-border bg-background px-4 py-3 sm:static sm:mx-0 sm:flex-row sm:items-center sm:justify-between sm:border-0 sm:bg-transparent sm:px-0 sm:py-0">
            <Button variant="link" className="justify-start px-0" onClick={editDetails}>
              Ver/ajustar todos os detalhes ›
            </Button>
            <Button className="h-11 sm:h-9" onClick={create} disabled={busy}>
              {busy ? "Criando a campanha…" : "Criar campanha"}
            </Button>
          </div>
        </section>
      )}
    </div>
  );
}
