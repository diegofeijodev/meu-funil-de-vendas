import { useQuery } from "@tanstack/react-query";
import { listLeads, listMembers, listPipelines, listStages } from "@/modules/crm/infrastructure/crm.api";

export function usePipelines(workspaceId: string | null) {
  return useQuery({
    queryKey: ["crm-pipelines", workspaceId],
    enabled: !!workspaceId,
    queryFn: () => listPipelines(workspaceId!),
  });
}

export function useStages(workspaceId: string | null, pipelineId: string | null) {
  return useQuery({
    queryKey: ["crm-stages", workspaceId, pipelineId],
    enabled: !!workspaceId && !!pipelineId,
    queryFn: () => listStages(workspaceId!, pipelineId!),
  });
}

export function useLeads(workspaceId: string | null, pipelineId: string | null) {
  return useQuery({
    queryKey: ["crm-leads", workspaceId, pipelineId],
    enabled: !!workspaceId,
    queryFn: () => listLeads(workspaceId!, pipelineId),
  });
}

export function useMembers(workspaceId: string | null) {
  return useQuery({
    queryKey: ["crm-members", workspaceId],
    enabled: !!workspaceId,
    queryFn: () => listMembers(workspaceId!),
  });
}
