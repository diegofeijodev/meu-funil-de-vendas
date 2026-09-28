import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";
import { Section, StatusPill } from "@/components/ui-bits";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useWorkspace } from "@/lib/workspace";
import { metaAdsStatus, metaAdsTest, metaAdsSaveCredentials } from "@/lib/meta-ads.functions";

const STEPS = [
  "Acesse developers.facebook.com e crie um app do tipo Empresa (Business). Em Configurações > Básico, anote o ID do app e a Chave secreta do app.",
  "Ainda no app, clique em Adicionar produto e ative a Marketing API.",
  "Abra business.facebook.com > Configurações do negócio > Usuários > Usuários do sistema e crie um usuário do sistema com função Administrador.",
  "Nesse usuário, clique em Atribuir ativos e dê controle total sobre: sua conta de anúncios, sua Página do Facebook e sua conta do Instagram.",
  "Clique em Gerar novo token, escolha o app criado, validade Nunca, e marque as permissões: ads_management, ads_read, business_management, pages_show_list, pages_read_engagement, pages_manage_ads, leads_retrieval e instagram_basic. Copie o token gerado.",
  "O ID da conta de anúncios aparece no Gerenciador de Anúncios (formato act_123456789). O ID da Página está em Sobre > Transparência da página, ou em Configurações do negócio > Contas > Páginas.",
  "Cole tudo no formulário abaixo e clique em Salvar credenciais. Os valores vão direto para o cofre do servidor — nunca ficam visíveis nem salvos no navegador.",
  "Clique em Testar conexão. Ao ficar Conectado, as campanhas aprovadas passam a ser publicadas de verdade na Meta (sempre pausadas até você ativar).",
];

const EMPTY = { appId: "", appSecret: "", systemUserToken: "", adAccountId: "", pageId: "", instagramId: "" };

export function MetaAdsCard() {
  const { workspaceId, canEdit } = useWorkspace();
  const qc = useQueryClient();
  const status = useServerFn(metaAdsStatus);
  const test = useServerFn(metaAdsTest);
  const save = useServerFn(metaAdsSaveCredentials);
  const [busy, setBusy] = useState<"test" | "save" | null>(null);
  const [result, setResult] = useState<Awaited<ReturnType<typeof metaAdsTest>> | null>(null);
  const [form, setForm] = useState(EMPTY);

  const { data } = useQuery({
    queryKey: ["meta-ads-status", workspaceId],
    enabled: !!workspaceId,
    queryFn: () => status({ data: { workspaceId: workspaceId! } }),
  });

  const runTest = async () => {
    if (!workspaceId) return;
    setBusy("test");
    try {
      const r = await test({ data: { workspaceId } });
      setResult(r);
      if (r.ok) toast.success("Conexão com a Meta funcionando.");
      else toast.error(r.error ?? "Não foi possível conectar na Meta.");
    } catch {
      toast.error("Não foi possível testar agora.");
    } finally {
      setBusy(null);
    }
  };

  const runSave = async () => {
    if (!workspaceId) return;
    setBusy("save");
    try {
      const r = await save({ data: { workspaceId, ...form, instagramId: form.instagramId || null } });
      setForm(EMPTY);
      await qc.invalidateQueries({ queryKey: ["meta-ads-status", workspaceId] });
      if (r.configured) toast.success("Credenciais salvas no cofre. Clique em Testar conexão.");
      else toast.info(`Salvo, mas ainda faltam: ${r.missing.join(", ")}.`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Não foi possível salvar agora.");
    } finally {
      setBusy(null);
    }
  };

  const connected = result ? result.ok : false;
  const pill = result ? (result.ok ? "connected" : "failed") : data?.configured ? "pending" : "disconnected";
  const label = result ? (result.ok ? "Conectado" : "Erro") : data?.configured ? "Configurado — teste a conexão" : "Desconectado";

  const field = (key: keyof typeof EMPTY, labelText: string, placeholder: string, secret = false, optional = false) => (
    <div>
      <Label className="text-xs">
        {labelText} {optional && <span className="text-muted-foreground">(opcional)</span>}
      </Label>
      <Input
        type={secret ? "password" : "text"}
        value={form[key]}
        placeholder={placeholder}
        disabled={!canEdit}
        autoComplete="off"
        onChange={(e) => setForm((f) => ({ ...f, [key]: e.target.value }))}
      />
    </div>
  );

  return (
    <Section title="Meta Ads (API oficial)" description="Publicação de campanhas, envio de criativos e resultados direto pela Marketing API da Meta.">
      <div className="rounded-lg border border-border bg-surface/50 p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <h3 className="font-medium">Meta Ads</h3>
            <StatusPill status={pill} label={label} />
          </div>
          <Button onClick={runTest} disabled={busy !== null || !workspaceId}>
            {busy === "test" && <Loader2 className="mr-2 size-4 animate-spin" />}
            Testar conexão
          </Button>
        </div>

        {data && !data.configured && (
          <p className="mt-3 text-sm text-muted-foreground">
            Faltam credenciais: <span className="font-medium text-foreground">{data.missing.join(", ")}</span>. Enquanto isso, a publicação continua simulada.
          </p>
        )}

        {result && !result.ok && <p className="mt-3 text-sm text-destructive">{result.error}</p>}

        {result && result.ok && connected && (
          <dl className="mt-4 grid gap-4 text-sm md:grid-cols-4">
            <div>
              <dt className="text-xs uppercase tracking-wider text-muted-foreground">Conta de anúncios</dt>
              <dd>{result.account.name}</dd>
              <dd className="text-xs text-muted-foreground">{result.account.id}</dd>
            </div>
            <div>
              <dt className="text-xs uppercase tracking-wider text-muted-foreground">Situação</dt>
              <dd>{result.account.status} · {result.account.currency} · {result.account.timezone}</dd>
            </div>
            <div>
              <dt className="text-xs uppercase tracking-wider text-muted-foreground">Página</dt>
              <dd>{result.page.name ?? "Sem acesso à página"}</dd>
            </div>
            <div>
              <dt className="text-xs uppercase tracking-wider text-muted-foreground">Instagram</dt>
              <dd>{result.instagram?.username ? `@${result.instagram.username}` : "Não informado"}</dd>
            </div>
          </dl>
        )}

        <details className="mt-4 rounded-lg border border-border/60 bg-background/40 p-3 text-sm" open={!data?.configured}>
          <summary className="cursor-pointer font-medium">Passo a passo para conectar</summary>
          <ol className="mt-2 list-decimal space-y-1.5 pl-5 text-muted-foreground">
            {STEPS.map((s) => <li key={s}>{s}</li>)}
          </ol>
          <p className="mt-2 text-xs text-muted-foreground">
            Leads de formulário: em CRM &gt; Integrações, conecte o Meta Lead Ads, copie a URL do webhook e o token de verificação e cole no app da Meta (Webhooks &gt; Page &gt; leadgen).
          </p>
        </details>

        {canEdit && (
          <div className="mt-4 rounded-lg border border-border/60 bg-background/40 p-4">
            <p className="text-sm font-medium">Credenciais da Meta</p>
            <p className="mt-1 text-xs text-muted-foreground">
              Preenchidas, elas vão direto para o cofre do servidor e nunca mais aparecem aqui. Para trocar, basta salvar de novo.
            </p>
            <div className="mt-3 grid gap-3 md:grid-cols-2">
              {field("appId", "ID do app", "Ex.: 1234567890123456")}
              {field("appSecret", "Chave secreta do app", "Configurações > Básico do app", true)}
              {field("systemUserToken", "Token do usuário do sistema", "Gerado no Business Manager (validade Nunca)", true)}
              {field("adAccountId", "ID da conta de anúncios", "act_123456789")}
              {field("pageId", "ID da Página do Facebook", "Ex.: 123456789")}
              {field("instagramId", "ID da conta do Instagram", "Ex.: 1784...", false, true)}
            </div>
            <Button className="mt-4" onClick={runSave} disabled={busy !== null}>
              {busy === "save" && <Loader2 className="mr-2 size-4 animate-spin" />}
              Salvar credenciais
            </Button>
          </div>
        )}
      </div>
    </Section>
  );
}
