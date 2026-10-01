/**
 * Abstração do publicador de mídia paga / social.
 * Fluxo obrigatório: Draft -> Aprovação humana -> Campaign -> Ad Set -> Creative -> Ad -> Active.
 * Nenhum passo externo acontece sem aprovação explícita.
 */
export type PublishStep = {
  key: string;
  label: string;
  status: "pending" | "done" | "failed";
  detail: string;
};

export type PublishRequest = {
  campaignName: string;
  objective: string;
  dailyBudget: number;
  targeting: Record<string, unknown>;
  placements: string[];
  creatives: { id: string; title: string }[];
  primaryText: string;
  utm: string;
  approved: boolean;
};

export interface AdsProvider {
  id: string;
  label: string;
  sandbox: boolean;
  publish(req: PublishRequest, onStep?: (steps: PublishStep[]) => void): Promise<PublishStep[]>;
}
