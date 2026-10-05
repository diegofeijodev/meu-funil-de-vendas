"use client";

import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@/lib/server-fn";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";
import { Section, StatusPill } from "@/components/ui-bits";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useWorkspace } from "@/lib/workspace";
import { metaAdsStatus, metaAdsTest, metaAdsSaveCredentials, metaListAssets, metaLoginUrl, metaSaveApp, metaSaveAssets } from "@/lib/meta-ads.functions";
import { HowTo } from "@/components/how-to";
import { apiErrorMessage } from "@/modules/shared/infrastructure/http";

const STEPS = [
  { text: "Crie um app do tipo Empresa (Business) e anote o ID do app e a Chave secreta (Configurações > Básico):", link: { label: "Painel de apps da Meta", url: "https://developers.facebook.com/apps" } },
  "No app, adicione os produtos Marketing API e Login do Facebook para Empresas. Em Login do Facebook > Configurações, cadastre a URL de redirecionamento mostrada abaixo.",
  "Caminho recomendado: salve o ID e a chave do app, clique em Entrar com Facebook, autorize e escolha a conta de anúncios, a Página e o Instagram.",
  { text: "Caminho alternativo (token que não vence): crie um usuário do sistema Administrador e atribua a conta de anúncios, a Página e o Instagram:", link: { label: "Usuários do sistema", url: "https://business.facebook.com/settings/system-users" } },
  "Gere o token com validade Nunca e as permissões: ads_management, ads_read, business_management, pages_show_list, pages_read_engagement, pages_manage_ads, pages_manage_metadata, leads_retrieval, instagram_basic, instagram_content_publish e instagram_manage_insights.",
  "O ID da conta de anúncios aparece no Gerenciador de Anúncios (act_123...). Cole tudo no formulário de credenciais e salve.",
  "Clique em Testar conexão. Conectado, as campanhas aprovadas são publicadas de verdade na Meta (sempre pausadas até você ativar).",
  "Para gerenciar contas de clientes fora do seu Business, o app precisa de Acesso avançado (revisão do app pela Meta).",
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
      toast.error(apiErrorMessage(e, "Não foi possível salvar agora."));
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
            Faltam credenciais: <span className="font-medium text-foreground">{(data.missing ?? []).join(", ")}</span>. Sem elas não é possível publicar na Meta.
          </p>
        )}

        {result && !result.ok && <p className="mt-3 text-sm text-destructive">{result.error}</p>}

        {result && result.ok && connected && (
          <dl className="mt-4 grid gap-4 text-sm md:grid-cols-4">
            <div>
              <dt className="text-xs uppercase tracking-wider text-muted-foreground">Conta de anúncios</dt>
              <dd>{result.account?.name}</dd>
              <dd className="text-xs text-muted-foreground">{result.account?.id}</dd>
            </div>
            <div>
              <dt className="text-xs uppercase tracking-wider text-muted-foreground">Situação</dt>
              <dd>{result.account?.status} · {result.account?.currency} · {result.account?.timezone}</dd>
            </div>
            <div>
              <dt className="text-xs uppercase tracking-wider text-muted-foreground">Página</dt>
              <dd>{result.page?.name ?? "Sem acesso à página"}</dd>
            </div>
            <div>
              <dt className="text-xs uppercase tracking-wider text-muted-foreground">Instagram</dt>
              <dd>{result.instagram?.username ? `@${result.instagram.username}` : "Não informado"}</dd>
            </div>
          </dl>
        )}

        {data?.tokenExpiresAt && <TokenExpiry expiresAt={data.tokenExpiresAt} />}

        <div className="mt-4">
          <HowTo
            title="Passo a passo para conectar"
            defaultOpen={!data?.configured}
            steps={STEPS}
            references={[
              { label: "Marketing API", url: "https://developers.facebook.com/docs/marketing-apis" },
              { label: "Login do Facebook para Empresas", url: "https://developers.facebook.com/docs/facebook-login/facebook-login-for-business" },
            ]}
          />
        </div>

        {canEdit && workspaceId && <FacebookLogin workspaceId={workspaceId} redirectUri={data?.redirectUri} onDone={() => qc.invalidateQueries({ queryKey: ["meta-ads-status", workspaceId] })} />}

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

function TokenExpiry({ expiresAt }: { expiresAt: string }) {
  const days = Math.ceil((new Date(expiresAt).getTime() - Date.now()) / 86400e3);
  const tone = days <= 7 ? "text-destructive" : days <= 15 ? "text-amber-500" : "text-muted-foreground";
  return (
    <p className={`mt-3 text-sm ${tone}`}>
      {days <= 0
        ? "O login com Facebook venceu: clique em Entrar com Facebook de novo."
        : `Login com Facebook vence em ${days} dia(s) (${new Date(expiresAt).toLocaleDateString("pt-BR")}). ${days <= 15 ? "Entre de novo para renovar." : ""}`}
    </p>
  );
}

/** 5.4 Entrar com Facebook: salva o app, faz o login e escolhe conta de anúncios, Página e Instagram. */
function FacebookLogin({ workspaceId, redirectUri, onDone }: { workspaceId: string; redirectUri?: string; onDone: () => void }) {
  const saveApp = useServerFn(metaSaveApp);
  const loginUrl = useServerFn(metaLoginUrl);
  const listAssets = useServerFn(metaListAssets);
  const saveAssets = useServerFn(metaSaveAssets);
  const [app, setApp] = useState({ appId: "", appSecret: "" });
  const [assets, setAssets] = useState<Awaited<ReturnType<typeof metaListAssets>> | null>(null);
  const [pick, setPick] = useState({ adAccountId: "", pageId: "" });
  const [busy, setBusy] = useState<string | null>(null);
  // Lido só no navegador (evita diferença entre a renderização do servidor e a do cliente).
  const [{ origin, justConnected, loginError }, setLoc] = useState({ origin: "", justConnected: false, loginError: null as string | null });
  useEffect(() => {
    const q = new URLSearchParams(window.location.search);
    setLoc({ origin: window.location.origin, justConnected: q.get("meta") === "conectado", loginError: q.get("meta_erro") });
  }, []);

  const act = async (key: string, fn: () => Promise<void>) => {
    setBusy(key);
    try {
      await fn();
    } catch (e) {
      toast.error(apiErrorMessage(e, "Não foi possível concluir."));
    } finally {
      setBusy(null);
    }
  };
  const loadAssets = () =>
    act("assets", async () => {
      const a = await listAssets({ data: { workspaceId } });
      setAssets(a);
      setPick({ adAccountId: a.adAccounts[0]?.id ?? "", pageId: a.pages[0]?.id ?? "" });
    });
  const page = assets?.pages.find((p) => p.id === pick.pageId);
  const sel = "h-9 w-full rounded-md border border-input bg-background px-3 text-sm";

  return (
    <div className="mt-4 rounded-lg border border-primary/30 bg-primary/5 p-4">
      <p className="text-sm font-medium">Entrar com Facebook (recomendado)</p>
      <p className="mt-1 text-xs text-muted-foreground">
        URL de redirecionamento para cadastrar no app: <code>{redirectUri ?? "…"}</code>
      </p>
      {loginError && <p className="mt-2 text-sm text-destructive">O login não foi concluído: {loginError}</p>}
      <div className="mt-3 grid gap-3 md:grid-cols-[1fr_1fr_auto]">
        <Input placeholder="ID do app" value={app.appId} onChange={(e) => setApp({ ...app, appId: e.target.value })} />
        <Input type="password" placeholder="Chave secreta do app" value={app.appSecret} onChange={(e) => setApp({ ...app, appSecret: e.target.value })} />
        <Button
          variant="outline"
          disabled={!!busy || app.appId.trim().length < 4 || app.appSecret.trim().length < 8}
          onClick={() =>
            act("app", async () => {
              await saveApp({ data: { workspaceId, ...app } });
              setApp({ appId: "", appSecret: "" });
              toast.success("App salvo. Agora clique em Entrar com Facebook.");
              onDone();
            })
          }
        >
          Salvar app
        </Button>
      </div>
      <div className="mt-3 flex flex-wrap gap-2">
        <Button
          disabled={!!busy}
          onClick={() =>
            act("login", async () => {
              const { url } = await loginUrl({ data: { workspaceId, origin } });
              window.location.href = url;
            })
          }
        >
          Entrar com Facebook
        </Button>
        <Button variant="outline" disabled={!!busy} onClick={loadAssets}>
          {justConnected ? "Escolher conta, Página e Instagram" : "Carregar contas do login"}
        </Button>
      </div>
      {assets && (
        <div className="mt-4 grid gap-3 md:grid-cols-3">
          <div>
            <Label className="text-xs">Conta de anúncios</Label>
            <select className={sel} value={pick.adAccountId} onChange={(e) => setPick({ ...pick, adAccountId: e.target.value })}>
              {assets.adAccounts.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name} ({a.id}){a.active ? "" : " · inativa"}
                </option>
              ))}
            </select>
          </div>
          <div>
            <Label className="text-xs">Página</Label>
            <select className={sel} value={pick.pageId} onChange={(e) => setPick({ ...pick, pageId: e.target.value })}>
              {assets.pages.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </div>
          <div>
            <Label className="text-xs">Instagram</Label>
            <p className="pt-2 text-sm">{page?.instagramUsername ? `@${page.instagramUsername}` : "Nenhum ligado a esta Página"}</p>
          </div>
          <Button
            className="md:col-span-3"
            disabled={!!busy || !pick.adAccountId || !pick.pageId}
            onClick={() =>
              act("save-assets", async () => {
                await saveAssets({ data: { workspaceId, ...pick, instagramId: page?.instagramId ?? null } });
                toast.success("Conta, Página e Instagram salvos. Clique em Testar conexão.");
                onDone();
              })
            }
          >
            Salvar escolha
          </Button>
        </div>
      )}
    </div>
  );
}
