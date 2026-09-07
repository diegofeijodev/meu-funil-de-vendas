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

export const metaMockProvider: AdsProvider = {
  id: "meta",
  label: "Meta Marketing API (sandbox)",
  sandbox: true,
  async publish(req, onStep) {
    if (!req.approved) {
      throw new Error(
        "Publicação bloqueada: a campanha precisa de aprovação humana antes de ir ao ar.",
      );
    }
    const steps: PublishStep[] = [
      {
        key: "campaign",
        label: "Criar campanha na Meta",
        status: "pending",
        detail: `${req.campaignName} · objetivo ${req.objective}`,
      },
      {
        key: "adset",
        label: "Criar conjunto de anúncios",
        status: "pending",
        detail: `R$ ${req.dailyBudget}/dia · ${req.placements.join(", ") || "placements automáticos"}`,
      },
      {
        key: "creative",
        label: "Enviar criativos",
        status: "pending",
        detail: `${req.creatives.length} criativo(s) enviados`,
      },
      {
        key: "ad",
        label: "Criar anúncios",
        status: "pending",
        detail: `UTM: ${req.utm || "não definida"}`,
      },
      { key: "activate", label: "Ativar", status: "pending", detail: "Status: ACTIVE (sandbox)" },
    ];

    for (const step of steps) {
      await new Promise((r) => setTimeout(r, 550));
      step.status = "done";
      onStep?.(steps.map((s) => ({ ...s })));
    }
    return steps;
  },
};
