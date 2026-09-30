import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Link } from "@tanstack/react-router";
import { toast } from "sonner";
import { Instagram, Loader2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import {
  connectInstagramAccount,
  listInstagramOptions,
  disconnectInstagramAccount,
  syncInstagramHistory,
} from "@/lib/instagram/instagram.functions";
import { Section, StatCard, StatusPill, SandboxBadge, EmptyState } from "@/components/ui-bits";
import { Button } from "@/components/ui/button";
import { IgAutopilotPanel } from "./autopilot-panel";
import {
  FORMATS,
  STATUS_LABEL,
  MediaThumb,
  fmtDateTime,
  fmtNum,
  useIgAccount,
  type IgPost,
} from "./shared";

export function IgOverview({
  workspaceId,
  posts,
  onOpen,
}: {
  workspaceId: string;
  posts: IgPost[];
  onOpen: (id: string) => void;
}) {
  const qc = useQueryClient();
  const { data: account, isLoading } = useIgAccount(workspaceId);
  const connect = useServerFn(connectInstagramAccount);
  const list = useServerFn(listInstagramOptions);
  const disconnect = useServerFn(disconnectInstagramAccount);
  const sync = useServerFn(syncInstagramHistory);
  const [picking, setPicking] = useState(false);
  const imp = useMutation({
    mutationFn: () => sync({ data: { workspaceId } }),
    onSuccess: (r) => {
      qc.invalidateQueries({ queryKey: ["ig-posts", workspaceId] });
      qc.invalidateQueries({ queryKey: ["ig-metrics", workspaceId] });
      toast.success(`${r.imported} post(s) novo(s) importado(s) · resultados de ${r.metrics} atualizados.`);
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Não foi possível importar."),
  });
  const opts = useMutation({ mutationFn: () => list({ data: { workspaceId } }) });
  const loadOptions = () => {
    setPicking(true);
    opts.mutate();
  };
  const m = useMutation({
    mutationFn: (pageId: string) => connect({ data: { workspaceId, pageId } }),
    onSuccess: (r) => {
      qc.invalidateQueries({ queryKey: ["ig-account", workspaceId] });
      if (r.ok) {
        setPicking(false);
        qc.invalidateQueries({ queryKey: ["ig-posts", workspaceId] });
        qc.invalidateQueries({ queryKey: ["ig-metrics", workspaceId] });
        toast.success(`Instagram @${r.username} conectado.`);
      } else toast.error(r.error);
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Não foi possível conectar."),
  });
  const dis = useMutation({
    mutationFn: () => disconnect({ data: { workspaceId } }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["ig-account", workspaceId] });
      toast.success("Instagram desconectado.");
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Não foi possível desconectar."),
  });

  const since = Date.now() - 30 * 86400e3;
  const { data: metrics } = useQuery({
    queryKey: ["ig-metrics", workspaceId],
    queryFn: async () => {
      const { data } = await supabase
        .from("ig_post_metrics")
        .select("*")
        .eq("workspace_id", workspaceId)
        .order("collected_at", { ascending: false });
      return data ?? [];
    },
  });
  const latest = new Map<string, any>();
  for (const r of metrics ?? []) if (!latest.has(r.post_id)) latest.set(r.post_id, r);
  const recent = posts.filter((p) => p.published_at && new Date(p.published_at).getTime() >= since);
  const recentIds = new Set(recent.map((p) => p.id));
  const sum = (k: string) =>
    [...latest.values()]
      .filter((r) => recentIds.has(r.post_id))
      .reduce((a, r) => a + (r[k] ?? 0), 0);
  const attempted = posts.filter(
    (p) =>
      ["published", "failed"].includes(p.status) &&
      new Date(p.published_at ?? p.created_at).getTime() >= since,
  );
  const failRate = attempted.length
    ? (attempted.filter((p) => p.status === "failed").length / attempted.length) * 100
    : 0;

  const week = Date.now() + 7 * 86400e3;
  const queue = posts
    .filter(
      (p) =>
        p.scheduled_at && ["scheduled", "approved", "pending_approval", "ready"].includes(p.status),
    )
    .filter((p) => {
      const t = new Date(p.scheduled_at!).getTime();
      return t >= Date.now() - 3600e3 && t <= week;
    });

  const err = account?.status === "error";

  return (
    <div className="space-y-6">
      <Section
        title="Conta conectada"
        actions={account?.status !== "connected" ? <SandboxBadge /> : undefined}
      >
        {isLoading ? (
          <div className="h-16 animate-pulse rounded-lg bg-muted" />
        ) : (
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              {account?.profile_picture_url ? (
                <img
                  src={account.profile_picture_url}
                  alt=""
                  className="size-12 rounded-full object-cover"
                />
              ) : (
                <div className="flex size-12 items-center justify-center rounded-full bg-muted text-muted-foreground">
                  <Instagram className="size-5" />
                </div>
              )}
              <div>
                <p className="font-semibold">
                  {account?.username ? `@${account.username}` : "Nenhuma conta conectada"}
                </p>
                <div className="mt-1">
                  <StatusPill
                    status={account?.status ?? "disconnected"}
                    label={
                      account?.status === "connected" ? "Conectado" : err ? "Erro" : "Desconectado"
                    }
                  />
                </div>
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button onClick={loadOptions} disabled={opts.isPending || m.isPending}>
                {(opts.isPending || m.isPending) && <Loader2 className="size-4 animate-spin" />}
                {account?.status === "connected" ? "Trocar conta" : "Conectar Instagram"}
              </Button>
              {account?.status === "connected" && (
                <Button variant="outline" onClick={() => imp.mutate()} disabled={imp.isPending}>
                  {imp.isPending && <Loader2 className="size-4 animate-spin" />}
                  Importar histórico
                </Button>
              )}
              {account && (
                <Button
                  variant="outline"
                  onClick={() => {
                    if (confirm("Desconectar esta conta do Instagram? Os posts ficam salvos, mas nada será publicado até conectar outra.")) dis.mutate();
                  }}
                  disabled={dis.isPending}
                >
                  {dis.isPending && <Loader2 className="size-4 animate-spin" />}
                  Desconectar
                </Button>
              )}
            </div>
          </div>
        )}
        {picking && (
          <div className="mt-4 space-y-2 rounded-lg border border-border p-3">
            <p className="text-sm font-medium">Escolha qual conta do Instagram usar nesta empresa:</p>
            {(opts.data?.options ?? []).length === 0 && (
              <p className="text-sm text-muted-foreground">
                {opts.data?.ok === false ? opts.data.error : "Nenhuma Página encontrada. Dê acesso às Páginas ao usuário do sistema no Business Manager."}
              </p>
            )}
            {(opts.data?.options ?? []).map((o) => (
              <button
                key={o.pageId}
                disabled={!o.igUserId || m.isPending}
                onClick={() => m.mutate(o.pageId)}
                className="flex w-full items-center gap-3 rounded-lg border border-border p-2 text-left hover:bg-muted/40 disabled:opacity-50"
              >
                {o.picture ? (
                  <img src={o.picture} alt="" className="size-9 rounded-full object-cover" />
                ) : (
                  <div className="flex size-9 items-center justify-center rounded-full bg-muted"><Instagram className="size-4" /></div>
                )}
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium">{o.username ? `@${o.username}` : "Sem Instagram profissional vinculado"}</p>
                  <p className="text-xs text-muted-foreground">Página: {o.pageName}</p>
                </div>
                {account?.ig_user_id === o.igUserId && <span className="text-xs text-primary">Atual</span>}
              </button>
            ))}
            <Button variant="ghost" size="sm" onClick={() => setPicking(false)}>Cancelar</Button>
          </div>
        )}
        {err && account?.last_error && (
          <div className="mt-4 rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-sm">
            <p className="text-destructive">{account.last_error}</p>
            <Link to="/integrations" className="mt-1 inline-block text-primary underline">
              Revisar credenciais da Meta em Integrações
            </Link>
          </div>
        )}
        {!account?.status || account.status === "disconnected" ? (
          <p className="mt-3 text-sm text-muted-foreground">
            Sem conta conectada, as publicações são simuladas. Clique em Conectar Instagram e escolha a conta.
            Aparecem as contas profissionais ligadas às Páginas que o usuário do sistema da Meta acessa (credenciais em{" "}
            <Link to="/integrations" className="text-primary underline">
              Integrações
            </Link>
            ).
          </p>
        ) : null}
      </Section>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
        <StatCard label="Publicados (30d)" value={fmtNum(recent.length)} />
        <StatCard label="Alcance total" value={fmtNum(sum("reach"))} />
        <StatCard label="Salvamentos" value={fmtNum(sum("saves"))} />
        <StatCard label="Plays de Reels" value={fmtNum(sum("plays"))} tone="accent" />
        <StatCard
          label="Taxa de falha"
          value={`${failRate.toFixed(0)}%`}
          tone={failRate > 10 ? "negative" : "default"}
        />
      </div>

      <IgAutopilotPanel workspaceId={workspaceId} />

      <Section title="Fila dos próximos 7 dias">
        {queue.length === 0 ? (
          <EmptyState
            title="Nada na fila"
            description="Gere um calendário na aba Estratégia e agende os posts aprovados."
          />
        ) : (
          <div className="space-y-2">
            {queue.map((p) => {
              const Icon = FORMATS[p.format]?.icon;
              return (
                <button
                  key={p.id}
                  onClick={() => onOpen(p.id)}
                  className="flex w-full items-center gap-3 rounded-lg border border-border p-2 text-left hover:bg-muted/40"
                >
                  <MediaThumb post={p} className="size-12 shrink-0" />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">{p.theme ?? p.caption ?? "Post"}</p>
                    <p className="flex items-center gap-1 text-xs text-muted-foreground">
                      {Icon && <Icon className="size-3" />} {FORMATS[p.format]?.label} ·{" "}
                      {fmtDateTime(p.scheduled_at)}
                    </p>
                  </div>
                  <StatusPill status={p.status} label={STATUS_LABEL[p.status] ?? p.status} />
                </button>
              );
            })}
          </div>
        )}
      </Section>
    </div>
  );
}
