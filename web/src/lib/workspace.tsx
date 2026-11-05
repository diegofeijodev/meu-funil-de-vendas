"use client";

import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/modules/shared/infrastructure/http";
import type { AuthUser } from "@/modules/auth/domain/auth.types";
import { getStoredWorkspaceId, storeWorkspaceId } from "@/modules/auth/infrastructure/auth.storage";
import { isForbidden, pickWorkspaceId } from "@/lib/workspace-selection";

export type Membership = {
  workspace_id: string;
  role: string;
  workspaces: { id: string; name: string; slug: string; plan: string } | null;
};

type Ctx = {
  user: AuthUser | null;
  memberships: Membership[];
  workspaceId: string | null;
  workspaceName: string;
  role: string;
  canEdit: boolean;
  setWorkspaceId: (id: string) => void;
  loading: boolean;
};

const WorkspaceContext = createContext<Ctx | null>(null);

export function WorkspaceProvider({ user, children }: { user: AuthUser | null; children: ReactNode }) {
  const [selected, setSelected] = useState<string | null>(null);

  const { data: memberships = [], isLoading } = useQuery({
    queryKey: ["memberships", user?.id],
    enabled: !!user,
    queryFn: async () => {
      // `workspace_members(workspace_id, role, workspaces(...))`, mais antigo primeiro (contrato §3).
      const { data } = await api.get<Membership[]>("/v1/workspaces");
      return data ?? [];
    },
  });

  // A escolhida (ou a salva no navegador) só vale se ainda está na lista: empresa apagada em outra aba, ou de que a pessoa saiu,
  // cai para a primeira e o navegador guarda a troca (as telas não ficam pedindo a empresa que não existe).
  useEffect(() => {
    if (!memberships.length) return;
    const stored = getStoredWorkspaceId();
    const next = pickWorkspaceId(memberships, selected, stored);
    if (next !== selected) setSelected(next);
    // Só regrava quando o que estava guardado/escolhido deixou de valer (nada guardado continua nada guardado).
    const stale = (id: string | null) => !!id && !memberships.some((m) => m.workspace_id === id);
    if (next && (stale(stored) || stale(selected))) storeWorkspaceId(next);
  }, [memberships, selected]);

  // 403 numa leitura (ex.: a empresa foi apagada em outra aba): reconfere a lista uma vez; com ela atualizada a tela troca de empresa
  // e para de pedir a apagada. A própria lista fica de fora (sem laço).
  const qc = useQueryClient();
  useEffect(
    () =>
      qc.getQueryCache().subscribe((event) => {
        if (event.type !== "updated" || event.action.type !== "error") return;
        if (event.query.queryKey[0] === "memberships" || !isForbidden(event.action.error)) return;
        void qc.invalidateQueries({ queryKey: ["memberships"] });
      }),
    [qc],
  );

  const value = useMemo<Ctx>(() => {
    const current = memberships.find((m) => m.workspace_id === selected) ?? memberships[0] ?? null;
    const role = current?.role ?? "viewer";
    return {
      user,
      memberships,
      workspaceId: current?.workspace_id ?? null,
      workspaceName: current?.workspaces?.name ?? "Workspace",
      role,
      canEdit: role !== "viewer",
      loading: isLoading,
      setWorkspaceId: (id: string) => {
        setSelected(id);
        storeWorkspaceId(id);
      },
    };
  }, [memberships, selected, user, isLoading]);

  return <WorkspaceContext.Provider value={value}>{children}</WorkspaceContext.Provider>;
}

export function useWorkspace() {
  const ctx = useContext(WorkspaceContext);
  if (!ctx) throw new Error("useWorkspace precisa estar dentro de WorkspaceProvider");
  return ctx;
}

/**
 * No protótipo o navegador gravava `activity_logs` direto. Agora a API registra
 * a atividade no servidor (mesmas strings de `action`) dentro de cada rota que
 * muda algo; esta função fica só para as telas portadas compilarem 1:1.
 */
export async function logActivity(
  workspaceId: string,
  action: string,
  entityType: string,
  metadata: Record<string, unknown> = {},
): Promise<void> {
  void [workspaceId, action, entityType, metadata];
  /* no-op: auditoria server-side (docs/inventory/web.md §8.5.3) */
}
