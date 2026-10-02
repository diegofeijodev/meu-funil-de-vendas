"use client";

import { Section } from "@/components/ui-bits";

/**
 * PLACEHOLDER (Task 3): configurações de anúncios (público, destino, regras automáticas) são portadas na tarefa
 * de Meta Ads, que substitui este arquivo mantendo a assinatura abaixo.
 */
export function CampaignAdsSettings(props: {
  campaign: { id: string; objective: string; ads_config: unknown; automation_rules: unknown; meta_campaign_id: string | null };
  workspaceId: string;
  canEdit: boolean;
  canManage: boolean;
  hasStrategyAudiences: boolean;
}) {
  void props;
  return (
    <Section title="Configurações dos anúncios" description="Públicos, destino e regras automáticas da Meta.">
      <p className="text-sm text-muted-foreground">Disponível em breve nesta versão.</p>
    </Section>
  );
}
