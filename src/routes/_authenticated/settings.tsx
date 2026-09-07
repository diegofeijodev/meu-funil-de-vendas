import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useWorkspace, logActivity } from "@/lib/workspace";
import { PageHeader, Section, StatusPill } from "@/components/ui-bits";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ROLE_LABELS } from "@/lib/labels";
import { shortDate } from "@/lib/format";

export const Route = createFileRoute("/_authenticated/settings")({
  head: () => ({
    meta: [
      { title: "Configurações · AI Marketing OS" },
      { name: "description", content: "Workspace, perfil, papéis do time e registro de atividades." },
      { property: "og:title", content: "Configurações · AI Marketing OS" },
      { property: "og:description", content: "Controle de acesso por workspace com papéis." },
    ],
  }),
  component: Settings,
});

function Settings() {
  const { workspaceId, workspaceName, role, user } = useWorkspace();
  const qc = useQueryClient();
  const [wsName, setWsName] = useState("");
  const [fullName, setFullName] = useState("");

  useEffect(() => {
    setWsName(workspaceName);
  }, [workspaceName]);

  const { data } = useQuery({
    queryKey: ["settings", workspaceId],
    enabled: !!workspaceId,
    queryFn: async () => {
      const [members, profile, ws] = await Promise.all([
        supabase.from("workspace_members").select("*").eq("workspace_id", workspaceId!),
        supabase.from("profiles").select("*").eq("id", user?.id ?? "").maybeSingle(),
        supabase.from("workspaces").select("*").eq("id", workspaceId!).maybeSingle(),
      ]);
      const ids = (members.data ?? []).map((m) => m.user_id);
      const profiles = ids.length
        ? (await supabase.from("profiles").select("*").in("id", ids)).data ?? []
        : [];
      return { members: members.data ?? [], profiles, profile: profile.data, workspace: ws.data };
    },
  });

  useEffect(() => {
    if (data?.profile) setFullName(data.profile.full_name ?? "");
  }, [data?.profile]);

  const isOwner = role === "owner" || role === "admin";

  const saveWorkspace = async () => {
    if (!workspaceId) return;
    const { error } = await supabase.from("workspaces").update({ name: wsName }).eq("id", workspaceId);
    if (error) {
      toast.error(error.message);
      return;
    }
    await logActivity(workspaceId, "workspace.updated", "workspace", { name: wsName });
    qc.invalidateQueries();
    toast.success("Workspace atualizado.");
  };

  const saveProfile = async () => {
    if (!user) return;
    const { error } = await supabase.from("profiles").update({ full_name: fullName }).eq("id", user.id);
    if (error) {
      toast.error(error.message);
      return;
    }
    qc.invalidateQueries({ queryKey: ["settings", workspaceId] });
    toast.success("Perfil atualizado.");
  };

  return (
    <>
      <PageHeader title="Configurações" subtitle="Workspace, perfil e permissões do time." />

      <div className="space-y-6">
        <Section title="Workspace">
          <div className="flex flex-wrap items-end gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="wn">Nome</Label>
              <Input id="wn" className="w-72" value={wsName} onChange={(e) => setWsName(e.target.value)} disabled={!isOwner} />
            </div>
            {isOwner && <Button onClick={saveWorkspace}>Salvar</Button>}
            <div className="ml-auto text-sm text-muted-foreground">
              Plano: <span className="text-foreground">{data?.workspace?.plan ?? "free"}</span>
            </div>
          </div>
        </Section>

        <Section title="Seu perfil">
          <div className="flex flex-wrap items-end gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="fn">Nome completo</Label>
              <Input id="fn" className="w-72" value={fullName} onChange={(e) => setFullName(e.target.value)} />
            </div>
            <Button onClick={saveProfile}>Salvar</Button>
            <div className="ml-auto text-sm text-muted-foreground">
              {user?.email} · papel <span className="text-foreground">{ROLE_LABELS[role ?? "viewer"]}</span>
            </div>
          </div>
        </Section>

        <Section
          title="Time e permissões"
          description="Owner e Admin editam tudo. Marketing cria e edita conteúdo. Viewer apenas visualiza."
        >
          <div className="space-y-2 text-sm">
            {(data?.members ?? []).map((m) => {
              const p = data?.profiles.find((x) => x.id === m.user_id);
              return (
                <div key={m.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border/60 px-4 py-2.5">
                  <div>
                    <p>{p?.full_name ?? "Membro"}</p>
                    <p className="text-xs text-muted-foreground">{p?.email}</p>
                  </div>
                  <div className="flex items-center gap-3 text-xs text-muted-foreground">
                    <span>desde {shortDate(m.created_at)}</span>
                    <StatusPill status={m.role === "viewer" ? "paused" : "approved"} label={ROLE_LABELS[m.role] ?? m.role} />
                  </div>
                </div>
              );
            })}
          </div>
        </Section>

        <Section title="Segurança dos dados">
          <p className="text-sm text-muted-foreground">
            Cada workspace é isolado no banco: todas as tabelas exigem que você seja membro do workspace para ler ou escrever.
            Todas as ações relevantes ficam registradas no audit log, disponível na página de Aprovações.
          </p>
        </Section>
      </div>
    </>
  );
}
