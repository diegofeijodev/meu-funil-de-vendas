import { useQuery } from "@tanstack/react-query";
import { z } from "zod";
import { api } from "@/modules/shared/infrastructure/http";

/** O que está liberado para a empresa (`GET /v1/workspaces/:id/features`): fonte única, em vez de adivinhar por 404. */
const featuresSchema = z.object({
  campaign_intake: z.boolean().default(false),
  campaign_pilot: z.boolean().default(false),
  style_refs_pinterest: z.boolean().default(false),
  vacancy_stories: z.boolean().default(false),
});
export type WorkspaceFeatures = z.infer<typeof featuresSchema>;

const ALL_OFF: WorkspaceFeatures = { campaign_intake: false, campaign_pilot: false, style_refs_pinterest: false, vacancy_stories: false };

/** API antiga (sem a rota) ou erro: tudo desligado — a tela cai no caminho de hoje, sem mensagem de erro. */
export async function getFeatures(ws: string): Promise<WorkspaceFeatures> {
  try {
    const { data } = await api.get(`/v1/workspaces/${ws}/features`);
    return featuresSchema.parse(data);
  } catch {
    return ALL_OFF;
  }
}

export function useFeatures(ws: string | null | undefined) {
  return useQuery({ queryKey: ["features", ws], enabled: !!ws, queryFn: () => getFeatures(ws!), staleTime: 60_000 });
}
