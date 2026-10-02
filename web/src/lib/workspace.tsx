"use client";

import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/modules/shared/infrastructure/http";
import type { AuthUser } from "@/modules/auth/domain/auth.types";
import { getStoredWorkspaceId, storeWorkspaceId } from "@/modules/auth/infrastructure/auth.storage";

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

  useEffect(() => {
    if (!memberships.length) return;
    const stored = getStoredWorkspaceId();
    const valid = memberships.find((m) => m.workspace_id === stored);
    setSelected((cur) => cur ?? valid?.workspace_id ?? memberships[0]?.workspace_id ?? null);
  }, [memberships]);

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
