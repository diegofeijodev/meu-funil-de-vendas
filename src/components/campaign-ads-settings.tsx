import { useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Section } from "@/components/ui-bits";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  CTA_OPTIONS,
  PLACEMENTS,
  readAdsConfig,
  readRules,
  type AdsConfig,
  type AutomationRules,
} from "@/lib/meta/ads-config";
import { listMetaAudiences, saveCampaignAdsSettings, syncCrmCustomerAudience } from "@/lib/meta/ads-ops.functions";

type Audience = { id: string; name: string; subtype: string; size: number | null };

const numOrNull = (v: string) => (v.trim() === "" ? null : Number(v.replace(",", ".")));

/** Configuração da publicação na Meta (2.4–2.6) e regras automáticas (2.3) de uma campanha. */
export function CampaignAdsSettings({
  campaign,
  workspaceId,
  canEdit,
  canManage,
  hasStrategyAudiences,
}: {
  campaign: { id: string; objective: string; ads_config: unknown; automation_rules: unknown; meta_campaign_id: string | null };
  workspaceId: string;
  canEdit: boolean;
  canManage: boolean;
  hasStrategyAudiences: boolean;
}) {
  const qc = useQueryClient();
  const save = useServerFn(saveCampaignAdsSettings);
  const loadAudiences = useServerFn(listMetaAudiences);
  const syncCrm = useServerFn(syncCrmCustomerAudience);
  const [cfg, setCfg] = useState<AdsConfig>(() => readAdsConfig(campaign.ads_config));
  const [rules, setRules] = useState<AutomationRules>(() => readRules(campaign.automation_rules));
  const [privacyUrl, setPrivacyUrl] = useState<string>(
    ((campaign.ads_config ?? {}) as { privacyUrl?: string | null }).privacyUrl ?? "",
  );
  const [audiences, setAudiences] = useState<Audience[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const published = !!campaign.meta_campaign_id;
  const isLeads = campaign.objective === "leads";

  const fetchAudiences = async () => {
    setBusy("aud");
    try {
      setAudiences(await loadAudiences({ data: { workspaceId } }));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Não foi possível carregar os públicos da Meta.");
    } finally {
      setBusy(null);
    }
  };

  const crmAudience = async (onlyWon: boolean) => {
    setBusy(onlyWon ? "crm-won" : "crm-all");
    try {
      const r = await syncCrm({ data: { workspaceId, onlyWon } });
      toast.success(`Público atualizado na Meta com ${r.uploaded} contatos do CRM.`);
      await fetchAudiences();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Não foi possível criar o público.");
    } finally {
      setBusy(null);
    }
  };

  const submit = async () => {
    if (isLeads && !privacyUrl.trim()) {
      toast.error("Campanhas de leads precisam do link da política de privacidade para o formulário instantâneo.");
      return;
    }
    setBusy("save");
    try {
      await save({
        data: {
          campaignId: campaign.id,
          adsConfig: cfg as unknown as Record<string, unknown>,
          rules: rules as unknown as Record<string, unknown>,
          privacyUrl: privacyUrl.trim() || null,
        },
      });
      qc.invalidateQueries({ queryKey: ["campaign", campaign.id] });
      toast.success("Configuração salva.");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Não foi possível salvar.");
    } finally {
      setBusy(null);
    }
  };

  const toggleIn = (list: string[], id: string) => (list.includes(id) ? list.filter((x) => x !== id) : [...list, id]);
  const select = "h-9 w-full rounded-md border border-input bg-background px-3 text-sm";

  return (
    <div className="space-y-6">
      <Section
        title="Como os anúncios vão para a Meta"
        description={
          published
            ? "A campanha já foi publicada: mudanças aqui valem para as regras automáticas e para uma nova publicação."
            : "Defina estrutura, chamada, posicionamentos e públicos antes de publicar. Tudo é criado pausado."
        }
      >
        <div className="grid gap-4 md:grid-cols-2">
          <div className="space-y-1.5">
            <Label>Estrutura</Label>
            <select className={select} value={cfg.structure} disabled={!canEdit} onChange={(e) => setCfg({ ...cfg, structure: e.target.value as AdsConfig["structure"] })}>
              <option value="single">1 conjunto com todos os criativos</option>
              <option value="per_audience">1 conjunto por público da estratégia</option>
              <option value="per_angle">Teste A/B: 1 conjunto por ângulo (verba igual)</option>
            </select>
            {cfg.structure === "per_angle" && (
              <p className="text-xs text-muted-foreground">Cada ângulo recebe os criativos marcados com ele no Estúdio. Compare o CPL por ângulo depois.</p>
            )}
          </div>
          <div className="space-y-1.5">
            <Label>Botão (CTA)</Label>
            <select className={select} value={cfg.cta} disabled={!canEdit} onChange={(e) => setCfg({ ...cfg, cta: e.target.value })}>
              {Object.entries(CTA_OPTIONS).map(([k, v]) => (
                <option key={k} value={k}>{v}</option>
              ))}
            </select>
          </div>
          {isLeads && (
            <div className="space-y-1.5 md:col-span-2">
              <Label>Link da política de privacidade (obrigatório no formulário instantâneo)</Label>
              <Input placeholder="https://seusite.com.br/privacidade" value={privacyUrl} disabled={!canEdit} onChange={(e) => setPrivacyUrl(e.target.value)} />
            </div>
          )}
        </div>

        <div className="mt-5 space-y-2">
          <div className="flex items-center gap-2">
            <Switch checked={cfg.placements === "auto"} disabled={!canEdit} onCheckedChange={(v) => setCfg({ ...cfg, placements: v ? "auto" : ["instagram_feed", "instagram_stories", "instagram_reels", "facebook_feed"] })} />
            <span className="text-sm">Posicionamentos automáticos (Advantage+), recomendado</span>
          </div>
          {cfg.placements !== "auto" && (
            <div className="flex flex-wrap gap-2">
              {Object.entries(PLACEMENTS).map(([k, p]) => {
                const list = cfg.placements === "auto" ? [] : cfg.placements;
                const on = list.includes(k);
                return (
                  <button
                    key={k}
                    type="button"
                    disabled={!canEdit}
                    onClick={() => setCfg({ ...cfg, placements: toggleIn(list, k) })}
                    className={`rounded-full border px-3 py-1 text-xs ${on ? "border-primary/40 bg-primary/15 text-primary" : "border-border text-muted-foreground"}`}
                  >
                    {p.label}
                  </button>
                );
              })}
            </div>
          )}
          <div className="flex items-center gap-2">
            <Switch checked={cfg.advantageAudience} disabled={!canEdit} onCheckedChange={(v) => setCfg({ ...cfg, advantageAudience: v })} />
            <span className="text-sm">Público Advantage+ (a Meta pode expandir além dos interesses)</span>
          </div>
          <div className="flex items-center gap-2">
            <Switch checked={cfg.carousel} disabled={!canEdit} onCheckedChange={(v) => setCfg({ ...cfg, carousel: v })} />
            <span className="text-sm">Juntar as imagens aprovadas num anúncio carrossel</span>
          </div>
          <div className="flex items-center gap-2">
            <Switch checked={cfg.useStrategyAudiences} disabled={!canEdit || !hasStrategyAudiences} onCheckedChange={(v) => setCfg({ ...cfg, useStrategyAudiences: v })} />
            <span className="text-sm">
              Usar os interesses dos públicos da estratégia{!hasStrategyAudiences ? " (gere a estratégia com IA primeiro)" : ""}
            </span>
          </div>
        </div>

        <div className="mt-5 space-y-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <Label>Públicos personalizados da conta</Label>
            <div className="flex flex-wrap gap-2">
              <Button size="sm" variant="outline" onClick={fetchAudiences} disabled={busy === "aud"}>
                {audiences ? "Atualizar lista" : "Carregar públicos da Meta"}
              </Button>
              {canManage && (
                <>
                  <Button size="sm" variant="outline" onClick={() => crmAudience(false)} disabled={busy === "crm-all"}>
                    Criar público com leads do CRM
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => crmAudience(true)} disabled={busy === "crm-won"}>
                    Criar público com clientes (ganhos)
                  </Button>
                </>
              )}
            </div>
          </div>
          {audiences && audiences.length === 0 && <p className="text-sm text-muted-foreground">Nenhum público personalizado nesta conta de anúncios.</p>}
          {audiences && audiences.length > 0 && (
            <div className="space-y-1.5 rounded-md border border-border/60 p-3 text-sm">
              {audiences.map((a) => (
                <div key={a.id} className="flex flex-wrap items-center justify-between gap-2">
                  <span>
                    {a.name} <span className="text-xs text-muted-foreground">({a.subtype}{a.size ? ` · ~${a.size.toLocaleString("pt-BR")}` : ""})</span>
                  </span>
                  <div className="flex gap-3 text-xs">
                    <label className="flex items-center gap-1">
                      <input type="checkbox" disabled={!canEdit} checked={cfg.customAudienceIds.includes(a.id)} onChange={() => setCfg({ ...cfg, customAudienceIds: toggleIn(cfg.customAudienceIds, a.id) })} />
                      Incluir
                    </label>
                    <label className="flex items-center gap-1">
                      <input type="checkbox" disabled={!canEdit} checked={cfg.excludeAudienceIds.includes(a.id)} onChange={() => setCfg({ ...cfg, excludeAudienceIds: toggleIn(cfg.excludeAudienceIds, a.id) })} />
                      Excluir
                    </label>
                    <label className="flex items-center gap-1">
                      <input type="radio" name="lal" disabled={!canEdit} checked={cfg.lookalikeSourceId === a.id} onChange={() => setCfg({ ...cfg, lookalikeSourceId: a.id })} />
                      Base do semelhante 1%
                    </label>
                  </div>
                </div>
              ))}
              {cfg.lookalikeSourceId && (
                <button type="button" className="text-xs text-primary underline" onClick={() => setCfg({ ...cfg, lookalikeSourceId: null })}>
                  Não criar público semelhante
                </button>
              )}
            </div>
          )}
          <p className="text-xs text-muted-foreground">
            Campanhas de remarketing sem público escolhido ganham automaticamente um público de visitantes do site (pixel, 30 dias).
          </p>
        </div>
      </Section>

      <Section
        title="Regras automáticas"
        description="Rodam todo dia às 9h40 com os resultados reais. Cada ação fica registrada em AI Insights."
      >
        <div className="mb-4 flex items-center gap-2">
          <Switch checked={rules.enabled} disabled={!canEdit} onCheckedChange={(v) => setRules({ ...rules, enabled: v })} />
          <span className="text-sm">Ligar regras automáticas nesta campanha</span>
        </div>
        <div className="grid gap-4 md:grid-cols-3">
          <div className="space-y-1.5">
            <Label>Pausar anúncio com CPL acima de (R$)</Label>
            <Input inputMode="decimal" value={rules.maxCpl ?? ""} disabled={!canEdit} onChange={(e) => setRules({ ...rules, maxCpl: numOrNull(e.target.value) })} />
          </div>
          <div className="space-y-1.5">
            <Label>…depois de gastar pelo menos (R$)</Label>
            <Input inputMode="decimal" value={rules.minSpendToJudge} disabled={!canEdit} onChange={(e) => setRules({ ...rules, minSpendToJudge: Number(e.target.value.replace(",", ".")) || 0 })} />
            <p className="text-xs text-muted-foreground">Também pausa se gastar isso sem nenhum lead. Nunca pausa o último anúncio do conjunto.</p>
          </div>
          <div className="space-y-1.5">
            <Label>Aumentar verba se CPL (3 dias) abaixo de (R$)</Label>
            <Input inputMode="decimal" value={rules.scaleBelowCpl ?? ""} disabled={!canEdit} onChange={(e) => setRules({ ...rules, scaleBelowCpl: numOrNull(e.target.value) })} />
          </div>
          <div className="space-y-1.5">
            <Label>Aumento por dia (%)</Label>
            <Input inputMode="numeric" value={rules.scaleStepPct} disabled={!canEdit} onChange={(e) => setRules({ ...rules, scaleStepPct: Number(e.target.value) || 20 })} />
          </div>
          <div className="space-y-1.5">
            <Label>Teto de verba por conjunto (R$/dia)</Label>
            <Input inputMode="decimal" value={rules.maxDailyBudget ?? ""} disabled={!canEdit} onChange={(e) => setRules({ ...rules, maxDailyBudget: numOrNull(e.target.value) })} />
          </div>
        </div>
      </Section>

      {canEdit && (
        <Button onClick={submit} disabled={busy === "save"}>
          {busy === "save" ? "Salvando..." : "Salvar configuração e regras"}
        </Button>
      )}
    </div>
  );
}
