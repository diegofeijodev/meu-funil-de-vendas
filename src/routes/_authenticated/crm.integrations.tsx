import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Copy, RefreshCw, Link2, Unplug, DownloadCloud } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useWorkspace } from "@/lib/workspace";
import { PageHeader, Section, StatusPill } from "@/components/ui-bits";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/routes/_authenticated/crm.index";
import { fullDate } from "@/lib/format";
import {
  saveIntegration,
  testIntegration,
  disconnectIntegration,
  loadMetaFormFields,
  syncWhatsAppTemplates,
  importMetaCostsNow,
} from "@/lib/crm-integrations.functions";

export const Route = createFileRoute("/_authenticated/crm/integrations")({
  head: () => ({
    meta: [
      { title: "CRM · Integrações · AI Marketing OS" },
      { name: "description", content: "Conecte Meta Lead Ads e WhatsApp por workspace e acompanhe o status." },
      { property: "og:title", content: "CRM · Integrações" },
      { property: "og:description", content: "Webhooks, mapeamento de formulários e provedores de WhatsApp." },
    ],
  }),
  component: CrmIntegrations,
});

const STATUS_LABEL: Record<string, string> = {
  disconnected: "Desconectado",
  connecting: "Conectando",
  connected: "Conectado",
  expired: "Expirado",
  error: "Erro",
};

const LEAD_FIELDS = [
  { value: "", label: "Ignorar" },
  { value: "name", label: "Nome" },
  { value: "phone", label: "Telefone" },
  { value: "email", label: "E-mail" },
  { value: "city", label: "Cidade" },
];

type Integration = {
  id: string;
  kind: "meta_lead_ads" | "whatsapp";
  provider: string;
  status: string;
  config: Record<string, string>;
  field_mapping: Record<string, string>;
  webhook_token: string;
  verify_token: string;
  last_event_at: string | null;
  last_error: string | null;
};

function CrmIntegrations() {
  const { workspaceId, workspaceName, canEdit } = useWorkspace();
  const qc = useQueryClient();
  const [origin, setOrigin] = useState("");
  useEffect(() => setOrigin(window.location.origin), []);

  const { data: integrations } = useQuery({
    queryKey: ["crm-integrations", workspaceId],
    enabled: !!workspaceId,
    queryFn: async () => {
      const { data } = await supabase.from("crm_integrations").select("*").eq("workspace_id", workspaceId!);
      return (data ?? []) as unknown as Integration[];
    },
  });

  const meta = integrations?.find((i) => i.kind === "meta_lead_ads") ?? null;
  const whatsapp = integrations?.find((i) => i.kind === "whatsapp") ?? null;
  const refresh = () => qc.invalidateQueries({ queryKey: ["crm-integrations", workspaceId] });

  return (
    <div>
      <PageHeader
        title="Integrações do CRM"
        subtitle={`Configuração exclusiva do workspace ${workspaceName}. Credenciais ficam guardadas no servidor.`}
      />
      {!canEdit && (
        <p className="mb-4 rounded-lg border border-border bg-card p-3 text-sm text-muted-foreground">
          Seu perfil pode ver o status, mas apenas donos e administradores alteram integrações.
        </p>
      )}
      <div className="grid gap-5 xl:grid-cols-2">
        <MetaCard integration={meta} origin={origin} workspaceId={workspaceId} canEdit={canEdit} onDone={refresh} />
        <WhatsAppCard integration={whatsapp} origin={origin} workspaceId={workspaceId} canEdit={canEdit} onDone={refresh} />
      </div>
    </div>
  );
}

function Header({ title, description, status }: { title: string; description: string; status: string }) {
  return (
    <div className="mb-4 flex items-start justify-between gap-3">
      <div>
        <p className="font-semibold">{title}</p>
        <p className="text-sm text-muted-foreground">{description}</p>
      </div>
      <StatusPill status={status} label={STATUS_LABEL[status] ?? status} />
    </div>
  );
}

function CopyField({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <label className="text-xs uppercase tracking-wider text-muted-foreground">{label}</label>
      <div className="mt-1 flex gap-2">
        <Input readOnly value={value} className="font-mono text-xs" />
        <Button
          variant="outline"
          size="icon"
          onClick={() => {
            navigator.clipboard.writeText(value);
            toast.success("Copiado.");
          }}
        >
          <Copy className="size-4" />
        </Button>
      </div>
    </div>
  );
}

/* ------------------------------ META LEAD ADS --------------------------- */

function MetaCard({
  integration,
  origin,
  workspaceId,
  canEdit,
  onDone,
}: {
  integration: Integration | null;
  origin: string;
  workspaceId: string | null;
  canEdit: boolean;
  onDone: () => void;
}) {
  const save = useServerFn(saveIntegration);
  const test = useServerFn(testIntegration);
  const disconnect = useServerFn(disconnectIntegration);
  const loadFields = useServerFn(loadMetaFormFields);
  const importCosts = useServerFn(importMetaCostsNow);

  const [config, setConfig] = useState({ page_id: "", form_id: "", ad_account_id: "", pixel_id: "" });
  const [mapping, setMapping] = useState<Record<string, string>>({});
  const [formFields, setFormFields] = useState<{ key: string; label: string }[]>([]);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (integration) {
      setConfig((c) => ({ ...c, ...(integration.config ?? {}) }));
      setMapping(integration.field_mapping ?? {});
    }
  }, [integration]);

  const run = async (fn: () => Promise<unknown>) => {
    if (!workspaceId) return;
    setBusy(true);
    try {
      await fn();
      onDone();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Algo deu errado. Tente novamente.");
    } finally {
      setBusy(false);
    }
  };

  const webhookUrl = integration ? `${origin}/api/public/webhooks/meta/leadgen/${integration.webhook_token}` : "";

  return (
    <Section title="Meta Lead Ads" description="Recebe leads dos formulários, importa custos e envia conversões.">
      <Header
        title="Formulários e custos da Meta"
        description="Webhook de leadgen, CPL por campanha e eventos de qualificação."
        status={integration?.status ?? "disconnected"}
      />

      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <label className="text-xs uppercase tracking-wider text-muted-foreground">ID da página</label>
          <Input value={config.page_id} onChange={(e) => setConfig({ ...config, page_id: e.target.value })} disabled={!canEdit} />
        </div>
        <div>
          <label className="text-xs uppercase tracking-wider text-muted-foreground">ID do formulário</label>
          <Input value={config.form_id} onChange={(e) => setConfig({ ...config, form_id: e.target.value })} disabled={!canEdit} />
        </div>
        <div>
          <label className="text-xs uppercase tracking-wider text-muted-foreground">Conta de anúncios (act_...)</label>
          <Input value={config.ad_account_id} onChange={(e) => setConfig({ ...config, ad_account_id: e.target.value })} disabled={!canEdit} />
        </div>
        <div>
          <label className="text-xs uppercase tracking-wider text-muted-foreground">Pixel (Conversions API)</label>
          <Input value={config.pixel_id} onChange={(e) => setConfig({ ...config, pixel_id: e.target.value })} disabled={!canEdit} />
        </div>
      </div>

      <div className="mt-4 flex flex-wrap gap-2">
        <Button
          disabled={!canEdit || busy}
          onClick={() =>
            run(async () => {
              await save({ data: { workspaceId: workspaceId!, kind: "meta_lead_ads", provider: "meta", config, fieldMapping: mapping } });
              toast.success("Configuração salva.");
            })
          }
        >
          <Link2 className="size-4" /> Salvar
        </Button>
        <Button
          variant="outline"
          disabled={!canEdit || busy || !integration}
          onClick={() =>
            run(async () => {
              const res = await test({ data: { workspaceId: workspaceId!, kind: "meta_lead_ads" } });
              if (res.ok) toast.success("Integração conectada.");
              else if (res.missing.length) toast.error(`Faltam credenciais: ${res.missing.join(", ")}`);
              else toast.error("Falha ao validar a integração.");
            })
          }
        >
          <RefreshCw className="size-4" /> Testar conexão
        </Button>
        <Button
          variant="outline"
          disabled={!canEdit || busy || !integration}
          onClick={() =>
            run(async () => {
              const res = await importCosts({ data: { workspaceId: workspaceId! } });
              toast.success(`${res.imported} dias de custo importados.`);
            })
          }
        >
          <DownloadCloud className="size-4" /> Importar custos agora
        </Button>
        {integration && (
          <Button
            variant="ghost"
            disabled={!canEdit || busy}
            onClick={() =>
              run(async () => {
                await disconnect({ data: { workspaceId: workspaceId!, kind: "meta_lead_ads" } });
                toast.success("Integração desconectada.");
              })
            }
          >
            <Unplug className="size-4" /> Desconectar
          </Button>
        )}
      </div>

      {integration && (
        <div className="mt-5 space-y-3 border-t border-border pt-4">
          <CopyField label="URL do webhook (cole na Meta)" value={webhookUrl} />
          <CopyField label="Verify token" value={integration.verify_token} />
          <p className="text-xs text-muted-foreground">
            Último evento: {integration.last_event_at ? fullDate(integration.last_event_at) : "nenhum ainda"}
          </p>
          {integration.last_error && <p className="text-xs text-destructive">Último erro: {integration.last_error}</p>}
        </div>
      )}

      {integration && (
        <div className="mt-5 border-t border-border pt-4">
          <div className="mb-3 flex items-center justify-between">
            <p className="text-sm font-medium">Mapeamento dos campos do formulário</p>
            <Button
              size="sm"
              variant="outline"
              disabled={!canEdit || busy || !config.form_id}
              onClick={() =>
                run(async () => {
                  const res = await loadFields({ data: { workspaceId: workspaceId!, formId: config.form_id } });
                  setFormFields(res.fields);
                  toast.success(`${res.fields.length} campos carregados.`);
                })
              }
            >
              Carregar campos
            </Button>
          </div>
          <div className="space-y-2">
            {formFields.map((f) => (
              <div key={f.key} className="grid grid-cols-2 items-center gap-2">
                <span className="truncate text-sm">{f.label}</span>
                <Select value={mapping[f.key] ?? ""} onChange={(v) => setMapping({ ...mapping, [f.key]: v })}>
                  {LEAD_FIELDS.map((o) => (
                    <option key={o.value} value={o.value}>{o.label}</option>
                  ))}
                </Select>
              </div>
            ))}
            {!formFields.length && (
              <p className="text-sm text-muted-foreground">
                Carregue os campos do formulário para associá-los ao lead. Sem mapeamento, nome, telefone, e-mail e cidade
                são reconhecidos automaticamente.
              </p>
            )}
          </div>
        </div>
      )}
    </Section>
  );
}

/* --------------------------------- WHATSAPP ------------------------------ */

function WhatsAppCard({
  integration,
  origin,
  workspaceId,
  canEdit,
  onDone,
}: {
  integration: Integration | null;
  origin: string;
  workspaceId: string | null;
  canEdit: boolean;
  onDone: () => void;
}) {
  const save = useServerFn(saveIntegration);
  const test = useServerFn(testIntegration);
  const disconnect = useServerFn(disconnectIntegration);
  const syncTemplates = useServerFn(syncWhatsAppTemplates);

  const [provider, setProvider] = useState("whatsapp_cloud");
  const [config, setConfig] = useState({ phone_number_id: "", waba_id: "", base_url: "", instance: "" });
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (integration) {
      setProvider(integration.provider);
      setConfig((c) => ({ ...c, ...(integration.config ?? {}) }));
    }
  }, [integration]);

  const { data: templates } = useQuery({
    queryKey: ["crm-wa-templates", workspaceId],
    enabled: !!workspaceId,
    queryFn: async () => {
      const { data } = await supabase
        .from("crm_wa_templates")
        .select("name, language, status, body_preview")
        .eq("workspace_id", workspaceId!)
        .order("name");
      return data ?? [];
    },
  });

  const run = async (fn: () => Promise<unknown>) => {
    if (!workspaceId) return;
    setBusy(true);
    try {
      await fn();
      onDone();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Algo deu errado. Tente novamente.");
    } finally {
      setBusy(false);
    }
  };

  const official = provider === "whatsapp_cloud";
  const webhookUrl = integration ? `${origin}/api/public/webhooks/whatsapp/${integration.webhook_token}` : "";

  return (
    <Section title="WhatsApp" description="Escolha o provedor deste workspace: API oficial da Meta, Z-API ou Evolution.">
      <Header
        title="Conversas de WhatsApp"
        description="Recebimento, envio, status de entrega e janela de 24 horas."
        status={integration?.status ?? "disconnected"}
      />

      <div className="space-y-3">
        <div>
          <label className="text-xs uppercase tracking-wider text-muted-foreground">Provedor</label>
          <Select value={provider} onChange={setProvider}>
            <option value="whatsapp_cloud">WhatsApp Cloud API (oficial)</option>
            <option value="zapi">Z-API</option>
            <option value="evolution">Evolution API</option>
          </Select>
        </div>

        {official ? (
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label className="text-xs uppercase tracking-wider text-muted-foreground">Phone number ID</label>
              <Input value={config.phone_number_id} onChange={(e) => setConfig({ ...config, phone_number_id: e.target.value })} disabled={!canEdit} />
            </div>
            <div>
              <label className="text-xs uppercase tracking-wider text-muted-foreground">WABA ID</label>
              <Input value={config.waba_id} onChange={(e) => setConfig({ ...config, waba_id: e.target.value })} disabled={!canEdit} />
            </div>
          </div>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label className="text-xs uppercase tracking-wider text-muted-foreground">URL base da instância</label>
              <Input value={config.base_url} onChange={(e) => setConfig({ ...config, base_url: e.target.value })} disabled={!canEdit} />
            </div>
            {provider === "evolution" && (
              <div>
                <label className="text-xs uppercase tracking-wider text-muted-foreground">Instância</label>
                <Input value={config.instance} onChange={(e) => setConfig({ ...config, instance: e.target.value })} disabled={!canEdit} />
              </div>
            )}
          </div>
        )}
      </div>

      <div className="mt-4 flex flex-wrap gap-2">
        <Button
          disabled={!canEdit || busy}
          onClick={() =>
            run(async () => {
              await save({
                data: {
                  workspaceId: workspaceId!,
                  kind: "whatsapp",
                  provider: provider as "whatsapp_cloud" | "zapi" | "evolution",
                  config,
                },
              });
              toast.success("Configuração salva.");
            })
          }
        >
          <Link2 className="size-4" /> Salvar
        </Button>
        <Button
          variant="outline"
          disabled={!canEdit || busy || !integration}
          onClick={() =>
            run(async () => {
              const res = await test({ data: { workspaceId: workspaceId!, kind: "whatsapp" } });
              if (res.ok) toast.success("WhatsApp conectado.");
              else if (res.missing.length) toast.error(`Faltam credenciais: ${res.missing.join(", ")}`);
              else toast.error("Falha ao validar a conexão.");
            })
          }
        >
          <RefreshCw className="size-4" /> Testar conexão
        </Button>
        {official && (
          <Button
            variant="outline"
            disabled={!canEdit || busy || !integration}
            onClick={() =>
              run(async () => {
                const res = await syncTemplates({ data: { workspaceId: workspaceId! } });
                toast.success(`${res.count} templates sincronizados.`);
              })
            }
          >
            <DownloadCloud className="size-4" /> Sincronizar templates
          </Button>
        )}
        {integration && (
          <Button
            variant="ghost"
            disabled={!canEdit || busy}
            onClick={() =>
              run(async () => {
                await disconnect({ data: { workspaceId: workspaceId!, kind: "whatsapp" } });
                toast.success("WhatsApp desconectado.");
              })
            }
          >
            <Unplug className="size-4" /> Desconectar
          </Button>
        )}
      </div>

      {integration && (
        <div className="mt-5 space-y-3 border-t border-border pt-4">
          <CopyField label="URL do webhook" value={webhookUrl} />
          {official && <CopyField label="Verify token" value={integration.verify_token} />}
          <p className="text-xs text-muted-foreground">
            Último evento: {integration.last_event_at ? fullDate(integration.last_event_at) : "nenhum ainda"}
          </p>
          {integration.last_error && <p className="text-xs text-destructive">Último erro: {integration.last_error}</p>}
        </div>
      )}

      {official && !!templates?.length && (
        <div className="mt-5 border-t border-border pt-4">
          <p className="mb-2 text-sm font-medium">Templates aprovados</p>
          <div className="space-y-1">
            {templates.map((t) => (
              <div key={`${t.name}-${t.language}`} className="flex items-center justify-between rounded-lg border border-border p-2 text-sm">
                <span className="truncate">
                  {t.name} <span className="text-xs text-muted-foreground">({t.language})</span>
                </span>
                <StatusPill status={t.status === "APPROVED" ? "connected" : "error"} label={t.status} />
              </div>
            ))}
          </div>
        </div>
      )}
    </Section>
  );
}
