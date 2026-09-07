import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import type { User } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";

export type Membership = {
  workspace_id: string;
  role: string;
  workspaces: { id: string; name: string; slug: string; plan: string } | null;
};

type Ctx = {
  user: User | null;
  memberships: Membership[];
  workspaceId: string | null;
  workspaceName: string;
  role: string;
  canEdit: boolean;
  setWorkspaceId: (id: string) => void;
  loading: boolean;
};

const WorkspaceContext = createContext<Ctx | null>(null);
const STORAGE_KEY = "aimos.workspace";

export function WorkspaceProvider({ user, children }: { user: User | null; children: ReactNode }) {
  const [selected, setSelected] = useState<string | null>(null);

  const { data: memberships = [], isLoading } = useQuery({
    queryKey: ["memberships", user?.id],
    enabled: !!user,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("workspace_members")
        .select("workspace_id, role, workspaces(id, name, slug, plan)")
        .order("created_at", { ascending: true });
      if (error) throw error;
      return (data ?? []) as unknown as Membership[];
    },
  });

  useEffect(() => {
    if (!memberships.length) return;
    const stored = typeof window !== "undefined" ? window.localStorage.getItem(STORAGE_KEY) : null;
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
        window.localStorage.setItem(STORAGE_KEY, id);
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

export async function logActivity(
  workspaceId: string,
  action: string,
  entityType: string,
  metadata: Record<string, unknown> = {},
) {
  const { data } = await supabase.auth.getUser();
  await supabase.from("activity_logs").insert({
    workspace_id: workspaceId,
    actor_id: data.user?.id ?? null,
    action,
    entity_type: entityType,
    metadata: metadata as never,
  });
}
