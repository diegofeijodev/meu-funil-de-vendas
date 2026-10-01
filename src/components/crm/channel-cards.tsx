import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Copy, KeyRound, Link2, RefreshCw, RotateCcw, Unplug } from "lucide-react";
import { Section, StatusPill } from "@/components/ui-bits";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { HowTo } from "@/components/how-to";
import { fullDate } from "@/lib/format";
import {
  channelSecretsStatus,
  disconnectIntegration,
  listFailedEvents,
  reprocessEvent,
  saveChannelSecret,
  saveIntegration,
  testIntegration,
} from "@/lib/crm-integrations.functions";

export type ChannelIntegration = {
  id: string;
  kind: string;
  provider: string;
  status: string;
  config: Record<string, unknown>;
  webhook_token: string;
  verify_token: string;
  last_event_at: string | null;
  last_error: string | null;
};

type CardProps = {
  integration: ChannelIntegration | null;
  origin: string;
  workspaceId: string | null;
  canEdit: boolean;
  onDone: () => void;
};

const STATUS_LABEL: Record<string, string> = {
  disconnected: "Desconectado",
  connecting: "Conectando",
  connected: "Conectado",
  expired: "Expirado",
  error: "Erro",
};

function Status({ status }: { status: string }) {
  return <StatusPill status={status} label={STATUS_LABEL[status] ?? status} />;
}

export function CopyRow({ label, value }: { label: string; value: string }) {
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

function useRunner(workspaceId: string | null, onDone: () => void) {
  const [busy, setBusy] = useState(false);
  const run = async (fn: () => Promise<unknown>) => {
    if (!workspaceId) return;
    setBusy(true);
    try {
      await fn();
      onDone();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Algo deu errado. Tente novamente.");
    } finally {
      setBusy(false);
    }
  };
  return { busy, run };
}

/** Credencial do canal guardada no servidor desta empresa (o valor nunca volta para a tela). */
export function SecretField({
  workspaceId,
  secretKey,
  label,
  canEdit,
}: {
  workspaceId: string | null;
  secretKey: "WHATSAPP_CLOUD_TOKEN" | "ZAPI_TOKEN" | "EVOLUTION_API_KEY" | "RESEND_API_KEY" | "CALCOM_API_KEY";
  label: string;
  canEdit: boolean;
}) {
  const qc = useQueryClient();
  const save = useServerFn(saveChannelSecret);
  const status = useServerFn(channelSecretsStatus);
  const [value, setValue] = useState("");
  const { data } = useQuery({
    queryKey: ["channel-secrets", workspaceId],
    enabled: !!workspaceId,
    queryFn: () => status({ data: { workspaceId: workspaceId! } }),
  });
  const state = data?.[secretKey];
  return (
    <div>
      <label className="text-xs uppercase tracking-wider text-muted-foreground">
        {label}{" "}
        <span className="normal-case">
          {state === "empresa" ? "· salva nesta empresa" : state === "servidor" ? "· usando a global do servidor" : state === "faltando" ? "· não configurada" : ""}
        </span>
      </label>
      <div className="mt-1 flex gap-2">
        <Input type="password" placeholder={state && state !== "faltando" ? "•••••••• (cole outra para trocar)" : "Cole aqui"} value={value} onChange={(e) => setValue(e.target.value)} disabled={!canEdit} />
        <Button
          variant="outline"
          disabled={!canEdit || value.trim().length < 8}
          onClick={async () => {
            try {
              await save({ data: { workspaceId: workspaceId!, key: secretKey, value } });
              setValue("");
              qc.invalidateQueries({ queryKey: ["channel-secrets", workspaceId] });
              toast.success("Credencial salva no servidor.");
            } catch (e) {
              toast.error(e instanceof Error ? e.message : "Não foi possível salvar.");
            }
          }}
        >
          <KeyRound className="size-4" /> Salvar
        </Button>
      </div>
    </div>
  );
}

function Footer({ integration, extra }: { integration: ChannelIntegration; extra?: React.ReactNode }) {
  return (
    <div className="mt-5 space-y-3 border-t border-border pt-4">
      {extra}
      <p className="text-xs text-muted-foreground">
        Último evento: {integration.last_event_at ? fullDate(integration.last_event_at) : "nenhum ainda"}
      </p>
      {integration.last_error && <p className="text-xs text-destructive">Último erro: {integration.last_error}</p>}
    </div>
  );
}

function Actions({
  workspaceId,
  kind,
  provider,
  config,
  integration,
  canEdit,
  busy,
  run,
}: {
  workspaceId: string | null;
  kind: "instagram" | "site_form" | "email" | "calendar";
  provider: "meta" | "site" | "resend" | "calcom";
  config: Record<string, unknown>;
  integration: ChannelIntegration | null;
  canEdit: boolean;
  busy: boolean;
  run: (fn: () => Promise<unknown>) => Promise<void>;
}) {
  const save = useServerFn(saveIntegration);
  const test = useServerFn(testIntegration);
  const disconnect = useServerFn(disconnectIntegration);
  return (
    <div className="mt-4 flex flex-wrap gap-2">
      <Button
        disabled={!canEdit || busy}
        onClick={() =>
          run(async () => {
            await save({ data: { workspaceId: workspaceId!, kind, provider, config, ...(kind === "site_form" ? { status: "connected" as const } : {}) } });
            toast.success("Configuração salva.");
          })
        }
      >
        <Link2 className="size-4" /> Salvar
      </Button>
      {kind !== "site_form" && (
        <Button
          variant="outline"
          disabled={!canEdit || busy || !integration}
          onClick={() =>
            run(async () => {
              const res = (await test({ data: { workspaceId: workspaceId!, kind } })) as { ok: boolean; missing: string[]; error?: string };
              if (res.ok) toast.success("Conectado e testado.");
              else if (res.missing.length) toast.error(`Faltam credenciais: ${res.missing.join(", ")}`);
              else toast.error(res.error ?? "Falha ao validar a conexão.");
            })
          }
        >
          <RefreshCw className="size-4" /> Testar conexão
        </Button>
      )}
      {integration && integration.status !== "disconnected" && (
        <Button
          variant="ghost"
          disabled={!canEdit || busy}
          onClick={() =>
            run(async () => {
              await disconnect({ data: { workspaceId: workspaceId!, kind } });
              toast.success("Desconectado.");
            })
          }
        >
          <Unplug className="size-4" /> Desconectar
        </Button>
      )}
    </div>
  );
}

/* ------------------------------- INSTAGRAM ------------------------------- */

export function InstagramCard({ integration, origin, workspaceId, canEdit, onDone }: CardProps) {
  const { busy, run } = useRunner(workspaceId, onDone);
  const [keywords, setKeywords] = useState<{ word: string; dm: string; publicReply: string }[]>([]);
  const [aiReply, setAiReply] = useState(false);
  useEffect(() => {
    const cfg = (integration?.config ?? {}) as { keywords?: { word: string; dm: string; publicReply?: string | null }[]; aiReplyComments?: boolean };
    setKeywords((cfg.keywords ?? []).map((k) => ({ word: k.word, dm: k.dm, publicReply: k.publicReply ?? "" })));
    setAiReply(!!cfg.aiReplyComments);
  }, [integration]);
  const config = { keywords: keywords.filter((k) => k.word.trim() && k.dm.trim()), aiReplyComments: aiReply };
  const webhookUrl = integration ? `${origin}/api/public/webhooks/instagram/${integration.webhook_token}` : "";

  return (
    <Section title="Instagram: Direct e comentários" description="Cada conversa ou comentário vira lead, entra na caixa de entrada e o SDR responde no Direct.">
      <div className="mb-4 flex items-start justify-between gap-3">
        <p className="text-sm text-muted-foreground">Usa a Página e o token da Meta salvos em Integrações (Meta Ads).</p>
        <Status status={integration?.status ?? "disconnected"} />
      </div>
      <HowTo
        steps={[
          { text: "No app da Meta, adicione o produto Webhooks e o objeto Instagram:", link: { label: "Painel de apps", url: "https://developers.facebook.com/apps" } },
          "Clique em Salvar aqui embaixo para gerar a URL e o verify token; cole os dois no objeto Instagram e assine os campos messages e comments.",
          "Dê ao token as permissões instagram_basic, instagram_manage_messages, instagram_manage_comments, pages_manage_metadata e pages_messaging.",
          "No Instagram do cliente: Configurações → Mensagens → permitir acesso a mensagens por ferramentas conectadas.",
          "Clique em Testar conexão: o app valida o token e inscreve a Página no app automaticamente.",
          "Para contas de clientes (fora do seu Business), o app precisa passar pela revisão da Meta (Acesso avançado).",
        ]}
        references={[
          { label: "Mensagens do Instagram (Meta)", url: "https://developers.facebook.com/docs/messenger-platform/instagram" },
          { label: "Plataforma do Instagram", url: "https://developers.facebook.com/docs/instagram-platform" },
        ]}
      />

      <div className="mt-4 space-y-3">
        <div className="flex items-center gap-2">
          <Switch checked={aiReply} disabled={!canEdit} onCheckedChange={setAiReply} />
          <span className="text-sm">Responder qualquer comentário com DM escrita pelo SDR</span>
        </div>
        <p className="text-sm font-medium">Palavra-chave no comentário → DM automática</p>
        {keywords.map((k, i) => (
          <div key={i} className="grid gap-2 rounded-md border border-border/60 p-2 md:grid-cols-[140px_1fr]">
            <Input placeholder="QUERO" value={k.word} disabled={!canEdit} onChange={(e) => setKeywords(keywords.map((x, j) => (j === i ? { ...x, word: e.target.value } : x)))} />
            <Textarea rows={2} placeholder="Mensagem no Direct (ex.: Oi! Aqui está o link: ...)" value={k.dm} disabled={!canEdit} onChange={(e) => setKeywords(keywords.map((x, j) => (j === i ? { ...x, dm: e.target.value } : x)))} />
            <span className="text-xs text-muted-foreground md:col-start-1">Resposta pública (opcional)</span>
            <div className="flex gap-2">
              <Input placeholder="Te mandei no direct!" value={k.publicReply} disabled={!canEdit} onChange={(e) => setKeywords(keywords.map((x, j) => (j === i ? { ...x, publicReply: e.target.value } : x)))} />
              <Button variant="ghost" disabled={!canEdit} onClick={() => setKeywords(keywords.filter((_, j) => j !== i))}>
                Remover
              </Button>
            </div>
          </div>
        ))}
        <Button size="sm" variant="outline" disabled={!canEdit} onClick={() => setKeywords([...keywords, { word: "", dm: "", publicReply: "" }])}>
          Adicionar palavra-chave
        </Button>
      </div>

      <Actions workspaceId={workspaceId} kind="instagram" provider="meta" config={config} integration={integration} canEdit={canEdit} busy={busy} run={run} />
      {integration && (
        <Footer
          integration={integration}
          extra={
            <>
              <CopyRow label="URL do webhook (objeto Instagram)" value={webhookUrl} />
              <CopyRow label="Verify token" value={integration.verify_token} />
            </>
          }
        />
      )}
    </Section>
  );
}

/* ------------------------------ SITE FORM -------------------------------- */

export function SiteFormCard({ integration, origin, workspaceId, canEdit, onDone }: CardProps) {
  const { busy, run } = useRunner(workspaceId, onDone);
  const [cfg, setCfg] = useState({
    title: "Fale com a gente",
    subtitle: "Deixe seus dados que entramos em contato.",
    button: "Quero ser atendido",
    thanks: "Recebemos seus dados! Em breve entraremos em contato.",
    redirect_url: "",
    privacy_url: "",
    color: "#4F46E5",
    ask_phone: true,
    ask_message: false,
  });
  useEffect(() => {
    if (integration) setCfg((c) => ({ ...c, ...(integration.config as Partial<typeof c>) }));
  }, [integration]);
  const formUrl = integration ? `${origin}/api/public/forms/${integration.webhook_token}` : "";
  const embed = integration ? `<script src="${origin}/api/public/forms/embed/${integration.webhook_token}"></script>` : "";
  const field = (key: keyof typeof cfg, label: string, placeholder = "") => (
    <div>
      <label className="text-xs uppercase tracking-wider text-muted-foreground">{label}</label>
      <Input value={String(cfg[key] ?? "")} placeholder={placeholder} disabled={!canEdit} onChange={(e) => setCfg({ ...cfg, [key]: e.target.value })} />
    </div>
  );
  return (
    <Section title="Formulário do site" description="Link pronto e código para colar no site. O lead chega com UTM, origem e já entra na cadência da origem “site”.">
      <div className="mb-4 flex justify-end">
        <Status status={integration?.status ?? "disconnected"} />
      </div>
      <HowTo
        steps={[
          "Preencha os textos e clique em Salvar: o formulário fica pronto na hora.",
          "Para usar como página: copie o Link do formulário e coloque em botões, bio do Instagram ou anúncios.",
          "Para colocar dentro do site (WordPress, Wix, Webflow, Elementor): copie o Código para colar e cole num bloco de HTML personalizado.",
          "Ferramentas externas (RD Station, Typeform, Elementor Forms): configure um webhook POST para o Link do formulário com os campos name, email e phone.",
          "Proteção contra spam já vem ligada: campo isca, tempo mínimo de preenchimento e limite de 5 envios a cada 10 minutos por IP.",
          "Crie uma cadência com gatilho Origem = site em CRM → Cadências para responder na hora.",
        ]}
      />
      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        {field("title", "Título")}
        {field("button", "Texto do botão")}
        {field("subtitle", "Subtítulo")}
        {field("thanks", "Mensagem de obrigado")}
        {field("redirect_url", "Redirecionar para (opcional)", "https://seusite.com.br/obrigado")}
        {field("privacy_url", "Política de privacidade (opcional)", "https://seusite.com.br/privacidade")}
        {field("color", "Cor do botão", "#4F46E5")}
      </div>
      <div className="mt-3 flex flex-wrap gap-4">
        <label className="flex items-center gap-2 text-sm">
          <Switch checked={cfg.ask_phone} disabled={!canEdit} onCheckedChange={(v) => setCfg({ ...cfg, ask_phone: v })} /> Pedir WhatsApp
        </label>
        <label className="flex items-center gap-2 text-sm">
          <Switch checked={cfg.ask_message} disabled={!canEdit} onCheckedChange={(v) => setCfg({ ...cfg, ask_message: v })} /> Pedir mensagem
        </label>
      </div>
      <Actions workspaceId={workspaceId} kind="site_form" provider="site" config={cfg} integration={integration} canEdit={canEdit} busy={busy} run={run} />
      {integration && (
        <Footer
          integration={integration}
          extra={
            <>
              <CopyRow label="Link do formulário (também recebe POST de ferramentas externas)" value={formUrl} />
              <CopyRow label="Código para colar no site" value={embed} />
              <a href={formUrl} target="_blank" rel="noopener noreferrer" className="text-sm text-primary underline">
                Abrir o formulário
              </a>
            </>
          }
        />
      )}
    </Section>
  );
}

/* --------------------------------- EMAIL --------------------------------- */

export function EmailCard({ integration, workspaceId, canEdit, onDone }: CardProps) {
  const { busy, run } = useRunner(workspaceId, onDone);
  const [cfg, setCfg] = useState({ from_name: "", from_email: "", reply_to: "" });
  useEffect(() => {
    if (integration) setCfg((c) => ({ ...c, ...(integration.config as Partial<typeof c>) }));
  }, [integration]);
  return (
    <Section title="E-mail (Resend)" description="Passos de e-mail das cadências e e-mail avulso na tela do lead, com link de descadastro.">
      <div className="mb-4 flex justify-end">
        <Status status={integration?.status ?? "disconnected"} />
      </div>
      <HowTo
        steps={[
          { text: "Crie uma conta no Resend e adicione o domínio da empresa:", link: { label: "Domínios do Resend", url: "https://resend.com/domains" } },
          "Copie os registros DNS (SPF, DKIM) para o provedor do domínio e espere o status Verificado.",
          { text: "Gere uma chave de API com permissão de envio:", link: { label: "Chaves do Resend", url: "https://resend.com/api-keys" } },
          "Cole a chave abaixo, preencha o remetente com um e-mail desse domínio, salve e clique em Testar conexão.",
          "Nas cadências, os passos de E-mail passam a ser enviados de verdade (sem e-mail configurado, viram tarefa).",
        ]}
        references={[{ label: "Documentação do Resend", url: "https://resend.com/docs" }]}
      />
      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        <SecretField workspaceId={workspaceId} secretKey="RESEND_API_KEY" label="Chave da API do Resend" canEdit={canEdit} />
        <div>
          <label className="text-xs uppercase tracking-wider text-muted-foreground">Nome do remetente</label>
          <Input value={cfg.from_name} disabled={!canEdit} onChange={(e) => setCfg({ ...cfg, from_name: e.target.value })} />
        </div>
        <div>
          <label className="text-xs uppercase tracking-wider text-muted-foreground">E-mail do remetente</label>
          <Input value={cfg.from_email} placeholder="contato@suaempresa.com.br" disabled={!canEdit} onChange={(e) => setCfg({ ...cfg, from_email: e.target.value })} />
        </div>
        <div>
          <label className="text-xs uppercase tracking-wider text-muted-foreground">Responder para (opcional)</label>
          <Input value={cfg.reply_to} disabled={!canEdit} onChange={(e) => setCfg({ ...cfg, reply_to: e.target.value })} />
        </div>
      </div>
      <Actions workspaceId={workspaceId} kind="email" provider="resend" config={cfg} integration={integration} canEdit={canEdit} busy={busy} run={run} />
      {integration && <Footer integration={integration} />}
    </Section>
  );
}

/* -------------------------------- CALENDAR -------------------------------- */

export function CalendarCard({ integration, workspaceId, canEdit, onDone }: CardProps) {
  const { busy, run } = useRunner(workspaceId, onDone);
  const [cfg, setCfg] = useState({ event_type_id: "" });
  useEffect(() => {
    if (integration) setCfg((c) => ({ ...c, ...(integration.config as Partial<typeof c>) }));
  }, [integration]);
  return (
    <Section title="Agenda (Cal.com)" description="O SDR oferece horários livres reais e confirma a reunião na agenda, com convite por e-mail.">
      <div className="mb-4 flex justify-end">
        <Status status={integration?.status ?? "disconnected"} />
      </div>
      <HowTo
        steps={[
          { text: "Crie uma conta no Cal.com e conecte o Google Agenda ou Outlook do responsável:", link: { label: "Cal.com", url: "https://app.cal.com" } },
          "Crie um tipo de evento (ex.: Reunião de 30 min) e copie o número dele (aparece na URL ao editar o evento).",
          { text: "Gere uma chave de API:", link: { label: "Chaves de API do Cal.com", url: "https://app.cal.com/settings/developer/api-keys" } },
          "Cole a chave e o ID do tipo de evento abaixo, salve e clique em Testar conexão.",
          "O SDR passa a oferecer horários livres e pede o e-mail do lead antes de reservar.",
        ]}
        references={[{ label: "API do Cal.com", url: "https://cal.com/docs" }]}
      />
      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        <SecretField workspaceId={workspaceId} secretKey="CALCOM_API_KEY" label="Chave da API do Cal.com" canEdit={canEdit} />
        <div>
          <label className="text-xs uppercase tracking-wider text-muted-foreground">ID do tipo de evento</label>
          <Input value={cfg.event_type_id} disabled={!canEdit} onChange={(e) => setCfg({ event_type_id: e.target.value.replace(/\D/g, "") })} />
        </div>
      </div>
      <Actions workspaceId={workspaceId} kind="calendar" provider="calcom" config={cfg} integration={integration} canEdit={canEdit} busy={busy} run={run} />
      {integration && <Footer integration={integration} />}
    </Section>
  );
}

/* ------------------------------ FAILED EVENTS ----------------------------- */

const SOURCE_LABEL: Record<string, string> = {
  meta_leadgen: "Formulário da Meta",
  whatsapp_message: "WhatsApp",
  instagram: "Instagram",
};

export function FailedEventsCard({ workspaceId, canEdit }: { workspaceId: string | null; canEdit: boolean }) {
  const list = useServerFn(listFailedEvents);
  const retry = useServerFn(reprocessEvent);
  const qc = useQueryClient();
  const [busy, setBusy] = useState<string | null>(null);
  const { data } = useQuery({
    queryKey: ["crm-failed-events", workspaceId],
    enabled: !!workspaceId && canEdit,
    queryFn: () => list({ data: { workspaceId: workspaceId! } }),
  });
  if (!canEdit) return null;
  return (
    <Section title="Eventos com falha" description="Leads e mensagens que chegaram mas não foram processados. Corrija a causa e reprocesse.">
      {!data?.length ? (
        <p className="text-sm text-muted-foreground">Nenhuma falha. Tudo que chegou foi processado.</p>
      ) : (
        <div className="space-y-2">
          {data.map((ev) => (
            <div key={ev.id as string} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border p-2 text-sm">
              <div>
                <span className="font-medium">{SOURCE_LABEL[ev.source as string] ?? ev.source}</span>{" "}
                <span className="text-xs text-muted-foreground">{fullDate(ev.created_at as string)}</span>
                <p className="text-xs text-destructive">{ev.error_message as string}</p>
              </div>
              <Button
                size="sm"
                variant="outline"
                disabled={busy === ev.id}
                onClick={async () => {
                  setBusy(ev.id as string);
                  try {
                    await retry({ data: { workspaceId: workspaceId!, eventId: ev.id as string } });
                    toast.success("Reprocessado com sucesso.");
                  } catch (e) {
                    toast.error(e instanceof Error ? e.message : "Falhou de novo.");
                  } finally {
                    setBusy(null);
                    qc.invalidateQueries({ queryKey: ["crm-failed-events", workspaceId] });
                  }
                }}
              >
                <RotateCcw className="size-4" /> Reprocessar
              </Button>
            </div>
          ))}
        </div>
      )}
    </Section>
  );
}
