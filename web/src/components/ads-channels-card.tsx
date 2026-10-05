"use client";

import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@/lib/server-fn";
import { toast } from "sonner";
import { Section, StatusPill } from "@/components/ui-bits";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { HowTo } from "@/components/how-to";
import { useWorkspace } from "@/lib/workspace";
import { adsChannelLoginUrl, adsChannelsStatus, listAdsChannelAccounts, saveAdsChannelApp } from "@/lib/ads/channels.functions";
import { apiErrorMessage } from "@/modules/shared/infrastructure/http";

type Channel = "google" | "tiktok";

const CFG: Record<
  Channel,
  {
    title: string;
    fields: { key: string; label: string; secret?: boolean; optional?: boolean }[];
    accountKey: string;
    steps: Parameters<typeof HowTo>[0]["steps"];
    refs: { label: string; url: string }[];
  }
> = {
  google: {
    title: "Google Ads",
    fields: [
      { key: "GOOGLE_ADS_CLIENT_ID", label: "ID do cliente OAuth" },
      { key: "GOOGLE_ADS_CLIENT_SECRET", label: "Chave secreta do cliente OAuth", secret: true },
      { key: "GOOGLE_ADS_DEVELOPER_TOKEN", label: "Token de desenvolvedor", secret: true },
      { key: "GOOGLE_ADS_LOGIN_CUSTOMER_ID", label: "ID da conta administradora (MCC)", optional: true },
    ],
    accountKey: "GOOGLE_ADS_CUSTOMER_ID",
    steps: [
      { text: "Na conta de administrador do Google Ads, abra o Centro de API e peça o token de desenvolvedor (acesso básico):", link: { label: "Google Ads", url: "https://ads.google.com" } },
      { text: "No Google Cloud, ative a Google Ads API e crie um ID do cliente OAuth do tipo Aplicativo da Web:", link: { label: "Credenciais do Google Cloud", url: "https://console.cloud.google.com/apis/credentials" } },
      "Em URIs de redirecionamento autorizados, cadastre a URL mostrada abaixo.",
      "Cole ID do cliente, chave secreta e token de desenvolvedor, salve e clique em Entrar com Google.",
      "Volte aqui, carregue as contas e escolha a conta do Google Ads da empresa.",
      "Na campanha (aba Anúncios e regras) crie a campanha de Pesquisa pausada ou ligue uma existente.",
    ],
    refs: [
      { label: "Google Ads API", url: "https://developers.google.com/google-ads/api/docs/start" },
      { label: "Token de desenvolvedor", url: "https://developers.google.com/google-ads/api/docs/api-policy/developer-token" },
    ],
  },
  tiktok: {
    title: "TikTok Ads",
    fields: [
      { key: "TIKTOK_APP_ID", label: "App ID" },
      { key: "TIKTOK_APP_SECRET", label: "Secret do app", secret: true },
    ],
    accountKey: "TIKTOK_ADVERTISER_ID",
    steps: [
      { text: "Crie uma conta de desenvolvedor e um app no TikTok API for Business (permissões de Ads Management e Reporting):", link: { label: "TikTok for Business Developers", url: "https://business-api.tiktok.com/portal" } },
      "Cadastre como URL de redirecionamento a URL mostrada abaixo e espere a aprovação do app.",
      "Cole App ID e Secret, salve e clique em Entrar com TikTok; autorize a conta de anúncios.",
      "Volte aqui, carregue as contas e escolha a conta de anúncios da empresa.",
      "Na campanha, crie a campanha de vídeo desativada (usa os vídeos aprovados) ou ligue uma existente.",
    ],
    refs: [{ label: "Documentação da API for Business", url: "https://business-api.tiktok.com/portal/docs" }],
  },
};

/** 2.8 / 2.9 Conexão do Google Ads e do TikTok Ads por empresa. */
export function AdsChannelsCard() {
  const { workspaceId, role } = useWorkspace();
  const status = useServerFn(adsChannelsStatus);
  const { data } = useQuery({
    queryKey: ["ads-channels", workspaceId],
    enabled: !!workspaceId,
    queryFn: () => status({ data: { workspaceId: workspaceId! } }),
  });
  const canManage = role === "owner" || role === "admin";
  const [notice, setNotice] = useState<{ ok: boolean; text: string } | null>(null);
  useEffect(() => {
    const q = new URLSearchParams(window.location.search);
    const ok = q.get("ads");
    const err = q.get("ads_erro");
    if (ok) setNotice({ ok: true, text: `Login no ${ok === "google" ? "Google Ads" : "TikTok Ads"} concluído. Agora carregue as contas e escolha a da empresa.` });
    else if (err) setNotice({ ok: false, text: `O login não foi concluído: ${err}` });
  }, []);
  return (
    <Section title="Google Ads e TikTok Ads" description="Outros canais de mídia paga da empresa: login, resultados diários e campanhas criadas pausadas.">
      {notice && (
        <p className={`mb-3 rounded-md border px-3 py-2 text-sm ${notice.ok ? "border-success/40 text-success" : "border-destructive/40 text-destructive"}`}>{notice.text}</p>
      )}
      <div className="grid gap-4 xl:grid-cols-2">
        {(["google", "tiktok"] as Channel[]).map((ch) => (
          <ChannelBox key={ch} channel={ch} missing={data?.[ch] ?? null} redirectUri={data?.redirectUris?.[ch]} canManage={canManage} workspaceId={workspaceId} />
        ))}
      </div>
    </Section>
  );
}

function ChannelBox({ channel, missing, redirectUri, canManage, workspaceId }: { channel: Channel; missing: string[] | null; redirectUri?: string; canManage: boolean; workspaceId: string | null }) {
  const cfg = CFG[channel];
  const qc = useQueryClient();
  const save = useServerFn(saveAdsChannelApp);
  const login = useServerFn(adsChannelLoginUrl);
  const list = useServerFn(listAdsChannelAccounts);
  const [values, setValues] = useState<Record<string, string>>({});
  const [accounts, setAccounts] = useState<{ id: string; name: string }[] | null>(null);
  const [account, setAccount] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const refresh = () => qc.invalidateQueries({ queryKey: ["ads-channels", workspaceId] });
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
  const connected = missing !== null && missing.length === 0;
  return (
    <div className="rounded-lg border border-border bg-surface/50 p-4">
      <div className="mb-3 flex items-center justify-between gap-2">
        <h3 className="font-medium">{cfg.title}</h3>
        <StatusPill status={connected ? "connected" : "disconnected"} label={connected ? "Conectado" : "Desconectado"} />
      </div>
      {missing && missing.length > 0 && <p className="mb-3 text-xs text-muted-foreground">Falta: {missing.join(", ")}.</p>}
      <HowTo steps={cfg.steps} references={cfg.refs} />
      <p className="mt-2 text-xs text-muted-foreground">
        URL de redirecionamento: <code>{redirectUri ?? "…"}</code>
      </p>
      {canManage && workspaceId && (
        <div className="mt-3 space-y-2">
          {cfg.fields.map((f) => (
            <Input
              key={f.key}
              type={f.secret ? "password" : "text"}
              placeholder={`${f.label}${f.optional ? " (opcional)" : ""}`}
              value={values[f.key] ?? ""}
              onChange={(e) => setValues({ ...values, [f.key]: e.target.value })}
            />
          ))}
          <div className="flex flex-wrap gap-2">
            <Button
              size="sm"
              variant="outline"
              disabled={!!busy || !Object.values(values).some((v) => v.trim())}
              onClick={() =>
                act("save", async () => {
                  await save({ data: { workspaceId, channel, values } });
                  setValues({});
                  toast.success("Salvo no cofre do servidor.");
                  refresh();
                })
              }
            >
              Salvar app
            </Button>
            <Button
              size="sm"
              disabled={!!busy}
              onClick={() =>
                act("login", async () => {
                  const { url } = await login({ data: { workspaceId, channel, origin: window.location.origin } });
                  window.location.href = url;
                })
              }
            >
              Entrar com {channel === "google" ? "Google" : "TikTok"}
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={!!busy}
              onClick={() =>
                act("list", async () => {
                  const a = await list({ data: { workspaceId, channel } });
                  setAccounts(a);
                  setAccount(a[0]?.id ?? "");
                })
              }
            >
              Carregar contas
            </Button>
          </div>
          {accounts && (
            <div className="flex gap-2">
              <select className="h-9 flex-1 rounded-md border border-input bg-background px-3 text-sm" value={account} onChange={(e) => setAccount(e.target.value)}>
                {accounts.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name} ({a.id})
                  </option>
                ))}
              </select>
              <Button
                size="sm"
                disabled={!account || !!busy}
                onClick={() =>
                  act("account", async () => {
                    await save({ data: { workspaceId, channel, values: { [cfg.accountKey]: account } } });
                    toast.success("Conta escolhida.");
                    refresh();
                  })
                }
              >
                Usar esta conta
              </Button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
