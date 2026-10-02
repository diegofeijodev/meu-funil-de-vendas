"use client";

import { useNavigate } from "@/lib/router";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { Sparkles } from "lucide-react";
import { createCampaign, createCopy } from "@/modules/campaigns/infrastructure/campaigns.api";
import { listBrands } from "@/modules/brands/infrastructure/brands.api";
import { apiErrorMessage } from "@/modules/shared/infrastructure/http";
import { useWorkspace } from "@/lib/workspace";
import { PageHeader } from "@/components/ui-bits";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { OBJECTIVES, FORMATS } from "@/lib/labels";
import { generateCopySmart, type CampaignBrief, type BrandContext } from "@/lib/ai/agents";
import { useServerFn } from "@/lib/server-fn";
import { generateCampaignStrategy } from "@/lib/ai/strategist.functions";
import { cn } from "@/lib/utils";
import { HowTo } from "@/components/how-to";
import { GUIDES } from "@/lib/guides";

const STEPS = ["Objetivo", "Oferta", "Público", "Verba e metas", "Formatos"];

export function NewCampaign() {
  const { workspaceId } = useWorkspace();
  const navigate = useNavigate();
  const runStrategy = useServerFn(generateCampaignStrategy);
  const [step, setStep] = useState(0);
  const [busy, setBusy] = useState(false);

  const [brandId, setBrandId] = useState("");
  const [name, setName] = useState("");
  const [objective, setObjective] = useState("leads");
  const [offer, setOffer] = useState({ product: "", price: "", promise: "", landing: "" });
  const [dates, setDates] = useState({ start: "", end: "" });
  const [audience, setAudience] = useState({ persona: "", idade: "25-45", localizacao: "", interesses: "", tipo: "B2C" });
  const [budget, setBudget] = useState({ total: "", daily: "", leads: "", sales: "", ticket: "", margin: "", cac: "" });
  const [formats, setFormats] = useState<string[]>(["static_image", "video"]);

  const { data: brands = [] } = useQuery({
    queryKey: ["brands-min", workspaceId],
    enabled: !!workspaceId,
    // `brands select *` order name
    queryFn: async () => (await listBrands(workspaceId!)).sort((a, b) => a.name.localeCompare(b.name, "pt-BR")),
  });

  const brand = brands.find((b) => b.id === brandId) ?? brands[0];

  const canNext = () => {
    if (step === 0) return !!(brand && name.trim());
    if (step === 1) return !!offer.product.trim();
    if (step === 2) return !!audience.persona.trim();
    if (step === 3) return !!budget.total && !!budget.daily;
    return formats.length > 0;
  };

  const finish = async () => {
    if (!workspaceId || !brand) return;
    setBusy(true);
    try {
      const brief: CampaignBrief = {
        name,
        objective,
        offer_product: offer.product,
        offer_price: offer.price ? Number(offer.price) : null,
        offer_promise: offer.promise,
        landing_url: offer.landing,
        start_date: dates.start || null,
        end_date: dates.end || null,
        audience,
        budget_total: budget.total ? Number(budget.total) : null,
        budget_daily: budget.daily ? Number(budget.daily) : null,
        goal_leads: budget.leads ? Number(budget.leads) : null,
        goal_sales: budget.sales ? Number(budget.sales) : null,
        avg_ticket: budget.ticket ? Number(budget.ticket) : null,
        margin_percent: budget.margin ? Number(budget.margin) : null,
        max_cac: budget.cac ? Number(budget.cac) : null,
        formats,
      };

      const campaign = await createCampaign(workspaceId, {
        brand_id: brand.id,
        name,
        objective,
        offer_product: offer.product,
        offer_price: offer.price ? Number(offer.price) : null,
        offer_promise: offer.promise,
        landing_url: offer.landing,
        start_date: dates.start || null,
        end_date: dates.end || null,
        audience,
        budget_total: budget.total ? Number(budget.total) : null,
        budget_daily: budget.daily ? Number(budget.daily) : null,
        goal_leads: budget.leads ? Number(budget.leads) : null,
        goal_sales: budget.sales ? Number(budget.sales) : null,
        avg_ticket: budget.ticket ? Number(budget.ticket) : null,
        margin_percent: budget.margin ? Number(budget.margin) : null,
        max_cac: budget.cac ? Number(budget.cac) : null,
        formats,
      });

      // Estrategista (IA real) → estratégia v1; depois a copy segue a estratégia.
      let strategyOk = true;
      try {
        await runStrategy({ data: { campaignId: campaign.id } });
      } catch (e) {
        strategyOk = false;
        toast.warning(`Estratégia não gerada: ${e instanceof Error ? e.message : "erro"}. Gere de novo na campanha.`);
      }
      try {
        const { content: copy, engine } = await generateCopySmart(workspaceId!, brand as BrandContext, brief, 0, {
          campaignId: campaign.id,
        });
        await createCopy(workspaceId, campaign.id, copy);
        toast.message(`Copy gerada com ${engine}.`);
      } catch (e) {
        toast.warning(`Copy não gerada: ${e instanceof Error ? e.message : "erro"}. Gere de novo na campanha.`);
      }

      if (strategyOk) toast.success("Campanha criada com estratégia gerada pela IA.");
      navigate({ to: "/campaigns/$id", params: { id: campaign.id } });
    } catch (e) {
      toast.error(apiErrorMessage(e) || "Não foi possível criar a campanha");
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <PageHeader
        title="Nova campanha"
        subtitle="Responda o briefing e os agentes montam estratégia e copies automaticamente."
      />
      <div className="mb-6">
        <HowTo title={GUIDES.campaignNew.title} steps={GUIDES.campaignNew.steps} references={GUIDES.campaignNew.references ?? []} />
      </div>

      <div className="mb-6 flex flex-wrap gap-2">
        {STEPS.map((s, i) => (
          <div
            key={s}
            className={cn(
              "rounded-full border px-3 py-1 text-xs font-medium",
              i === step
                ? "border-primary/40 bg-primary/15 text-primary"
                : i < step
                  ? "border-success/30 bg-success/10 text-success"
                  : "border-border text-muted-foreground",
            )}
          >
            {i + 1}. {s}
          </div>
        ))}
      </div>

      <div className="panel space-y-5 p-6">
        {step === 0 && (
          <>
            <div className="space-y-1.5">
              <Label>Marca</Label>
              <select
                className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
                value={brand?.id ?? ""}
                onChange={(e) => setBrandId(e.target.value)}
              >
                {brands.map((b) => (
                  <option key={b.id} value={b.id}>{b.name}</option>
                ))}
              </select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="cname">Nome da campanha</Label>
              <Input id="cname" value={name} onChange={(e) => setName(e.target.value)} placeholder="Ex.: Black Friday — Captação de leads" />
            </div>
            <div className="space-y-2">
              <Label>Objetivo</Label>
              <div className="flex flex-wrap gap-2">
                {Object.entries(OBJECTIVES).map(([k, v]) => (
                  <button
                    key={k}
                    type="button"
                    onClick={() => setObjective(k)}
                    className={cn(
                      "rounded-lg border px-3 py-2 text-sm transition-colors",
                      objective === k ? "border-primary bg-primary/10 text-primary" : "border-border hover:bg-surface",
                    )}
                  >
                    {v}
                  </button>
                ))}
              </div>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="sd">Início</Label>
                <Input id="sd" type="date" value={dates.start} onChange={(e) => setDates({ ...dates, start: e.target.value })} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="ed">Fim</Label>
                <Input id="ed" type="date" value={dates.end} onChange={(e) => setDates({ ...dates, end: e.target.value })} />
              </div>
            </div>
          </>
        )}

        {step === 1 && (
          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="op">Produto / serviço promovido</Label>
              <Input id="op" value={offer.product} onChange={(e) => setOffer({ ...offer, product: e.target.value })} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="opr">Preço (R$)</Label>
              <Input id="opr" type="number" value={offer.price} onChange={(e) => setOffer({ ...offer, price: e.target.value })} />
            </div>
            <div className="space-y-1.5 md:col-span-2">
              <Label htmlFor="opm">Promessa principal</Label>
              <Textarea id="opm" rows={2} value={offer.promise} onChange={(e) => setOffer({ ...offer, promise: e.target.value })} />
            </div>
            <div className="space-y-1.5 md:col-span-2">
              <Label htmlFor="ol">Landing page / destino</Label>
              <Input id="ol" value={offer.landing} onChange={(e) => setOffer({ ...offer, landing: e.target.value })} placeholder="https://" />
            </div>
          </div>
        )}

        {step === 2 && (
          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-1.5 md:col-span-2">
              <Label htmlFor="ap">Persona alvo</Label>
              <Textarea id="ap" rows={2} value={audience.persona} onChange={(e) => setAudience({ ...audience, persona: e.target.value })} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="ai">Faixa etária</Label>
              <Input id="ai" value={audience.idade} onChange={(e) => setAudience({ ...audience, idade: e.target.value })} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="al">Localização</Label>
              <Input id="al" value={audience.localizacao} onChange={(e) => setAudience({ ...audience, localizacao: e.target.value })} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="ain">Interesses</Label>
              <Input id="ain" value={audience.interesses} onChange={(e) => setAudience({ ...audience, interesses: e.target.value })} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="at">B2B ou B2C</Label>
              <select
                id="at"
                className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
                value={audience.tipo}
                onChange={(e) => setAudience({ ...audience, tipo: e.target.value })}
              >
                <option value="B2C">B2C</option>
                <option value="B2B">B2B</option>
              </select>
            </div>
          </div>
        )}

        {step === 3 && (
          <div className="grid gap-4 md:grid-cols-3">
            {[
              { k: "total", l: "Verba total (R$)" },
              { k: "daily", l: "Verba diária (R$)" },
              { k: "leads", l: "Meta de leads" },
              { k: "sales", l: "Meta de vendas" },
              { k: "ticket", l: "Ticket médio (R$)" },
              { k: "margin", l: "Margem (%)" },
              { k: "cac", l: "CAC máximo aceitável (R$)" },
            ].map((f) => (
              <div key={f.k} className="space-y-1.5">
                <Label htmlFor={f.k}>{f.l}</Label>
                <Input
                  id={f.k}
                  type="number"
                  value={budget[f.k as keyof typeof budget]}
                  onChange={(e) => setBudget({ ...budget, [f.k]: e.target.value })}
                />
              </div>
            ))}
          </div>
        )}

        {step === 4 && (
          <div className="space-y-3">
            <Label>Formatos desejados</Label>
            <div className="flex flex-wrap gap-2">
              {Object.entries(FORMATS).map(([k, v]) => (
                <button
                  key={k}
                  type="button"
                  onClick={() => setFormats((f) => (f.includes(k) ? f.filter((x) => x !== k) : [...f, k]))}
                  className={cn(
                    "rounded-lg border px-3 py-2 text-sm transition-colors",
                    formats.includes(k) ? "border-primary bg-primary/10 text-primary" : "border-border hover:bg-surface",
                  )}
                >
                  {v}
                </button>
              ))}
            </div>
            <p className="text-sm text-muted-foreground">
              Ao finalizar, o Agente Estrategista e o Copy Engine geram o plano e os textos. Nada é publicado sem sua aprovação.
            </p>
          </div>
        )}

        <div className="flex items-center justify-between border-t border-border pt-4">
          <Button variant="ghost" onClick={() => (step === 0 ? navigate({ to: "/campaigns" }) : setStep(step - 1))}>
            {step === 0 ? "Cancelar" : "Voltar"}
          </Button>
          {step < STEPS.length - 1 ? (
            <Button onClick={() => setStep(step + 1)} disabled={!canNext()}>
              Continuar
            </Button>
          ) : (
            <Button onClick={finish} disabled={!canNext() || busy}>
              <Sparkles className="mr-2 size-4" />
              {busy ? "Gerando estratégia..." : "Gerar campanha com IA"}
            </Button>
          )}
        </div>
      </div>
    </>
  );
}
