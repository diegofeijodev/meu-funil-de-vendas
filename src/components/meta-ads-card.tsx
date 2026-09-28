import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";
import { Section, StatusPill } from "@/components/ui-bits";
import { Button } from "@/components/ui/button";
import { useWorkspace } from "@/lib/workspace";
import { metaAdsStatus, metaAdsTest } from "@/lib/meta-ads.functions";

const STEPS = [
  "Em developers.facebook.com, crie um app do tipo Business (Empresa) e anote o ID do app e a Chave secreta (Configurações > Básico).",
  "No app, adicione o produto Marketing API.",
  "No Business Manager (business.facebook.com) > Configurações do negócio > Usuários do sistema, crie um usuário do sistema Administrador.",
  "Dê a esse usuário acesso à sua conta de anúncios, à Página do Facebook e à conta do Instagram (Atribuir ativos, controle total).",
  "Clique em Gerar token, escolha o app, validade Nunca e marque: ads_management, ads_read, business_management, pages_show_list, pages_read_engagement, pages_manage_ads, leads_retrieval, instagram_basic.",
  "Guarde no cofre do app: META_APP_ID, META_APP_SECRET, META_SYSTEM_USER_TOKEN, META_AD_ACCOUNT_ID (act_...), META_PAGE_ID e, se quiser, META_INSTAGRAM_ACCOUNT_ID.",
  "Volte aqui e clique em Testar conexão. Ao ficar Conectado, a publicação de campanhas aprovadas vai para a Meta de verdade (sempre pausada até você ativar).",
];

export function MetaAdsCard() {
  const { workspaceId } = useWorkspace();
  const status = useServerFn(metaAdsStatus);
  const test = useServerFn(metaAdsTest);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<Awaited<ReturnType<typeof metaAdsTest>> | null>(null);

  const { data } = useQuery({
    queryKey: ["meta-ads-status", workspaceId],
    enabled: !!workspaceId,
    queryFn: () => status({ data: { workspaceId: workspaceId! } }),
  });

  const runTest = async () => {
    if (!workspaceId) return;
    setBusy(true);
    try {
      const r = await test({ data: { workspaceId } });
      setResult(r);
      if (r.ok) toast.success("Conexão com a Meta funcionando.");
      else toast.error(r.error ?? "Não foi possível conectar na Meta.");
    } catch {
      toast.error("Não foi possível testar agora.");
    } finally {
      setBusy(false);
    }
  };

  const connected = result ? result.ok : false;
  const pill = result ? (result.ok ? "connected" : "failed") : data?.configured ? "pending" : "disconnected";
  const label = result ? (result.ok ? "Conectado" : "Erro") : data?.configured ? "Configurado — teste a conexão" : "Desconectado";

  return (
    <Section title="Meta Ads (API oficial)" description="Publicação de campanhas, envio de criativos e resultados direto pela Marketing API da Meta.">
      <div className="rounded-lg border border-border bg-surface/50 p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <h3 className="font-medium">Meta Ads</h3>
            <StatusPill status={pill} label={label} />
          </div>
          <Button onClick={runTest} disabled={busy || !workspaceId}>
            {busy && <Loader2 className="mr-2 size-4 animate-spin" />}
            Testar conexão
          </Button>
        </div>

        {data && !data.configured && (
          <p className="mt-3 text-sm text-muted-foreground">
            Faltam no cofre: <span className="font-medium text-foreground">{data.missing.join(", ")}</span>. Enquanto isso, a publicação continua simulada.
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

        <details className="mt-4 text-sm">
          <summary className="cursor-pointer font-medium">Passo a passo para conectar</summary>
          <ol className="mt-2 list-decimal space-y-1.5 pl-5 text-muted-foreground">
            {STEPS.map((s) => <li key={s}>{s}</li>)}
          </ol>
          <p className="mt-2 text-xs text-muted-foreground">
            Leads de formulário: em CRM &gt; Integrações, conecte o Meta Lead Ads, copie a URL do webhook e o token de verificação e cole no app da Meta (Webhooks &gt; Page &gt; leadgen).
          </p>
        </details>
      </div>
    </Section>
  );
}
