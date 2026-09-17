import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { Lead, Stage } from "@/lib/crm";

export function usePipelines(workspaceId: string | null) {
  return useQuery({
    queryKey: ["crm-pipelines", workspaceId],
    enabled: !!workspaceId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("crm_pipelines")
        .select("id, name, is_default")
        .eq("workspace_id", workspaceId!)
        .order("created_at");
      if (error) throw error;
      return data ?? [];
    },
  });
}

export function useStages(workspaceId: string | null, pipelineId: string | null) {
  return useQuery({
    queryKey: ["crm-stages", workspaceId, pipelineId],
    enabled: !!workspaceId && !!pipelineId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("crm_stages")
        .select("id, name, color, position, sla_hours, is_won, is_lost, pipeline_id")
        .eq("workspace_id", workspaceId!)
        .eq("pipeline_id", pipelineId!)
        .order("position");
      if (error) throw error;
      return (data ?? []) as Stage[];
    },
  });
}

export function useLeads(workspaceId: string | null, pipelineId: string | null) {
  return useQuery({
    queryKey: ["crm-leads", workspaceId, pipelineId],
    enabled: !!workspaceId,
    queryFn: async () => {
      let q = supabase
        .from("crm_leads")
        .select("*")
        .eq("workspace_id", workspaceId!)
        .order("created_at", { ascending: false });
      if (pipelineId) q = q.eq("pipeline_id", pipelineId);
      const { data, error } = await q;
      if (error) throw error;
      return (data ?? []) as unknown as Lead[];
    },
  });
}

export function useMembers(workspaceId: string | null) {
  return useQuery({
    queryKey: ["crm-members", workspaceId],
    enabled: !!workspaceId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("workspace_members")
        .select("user_id, role, profiles:user_id(id, full_name, email)")
        .eq("workspace_id", workspaceId!);
      if (error) return [] as { user_id: string; role: string; label: string }[];
      return (data ?? []).map((m) => {
        const p = (m as unknown as { profiles: { full_name: string | null; email: string | null } | null }).profiles;
        return {
          user_id: m.user_id as string,
          role: m.role as string,
          label: p?.full_name || p?.email || "Usuário",
        };
      });
    },
  });
}
