"use client";

import { Section } from "@/components/ui-bits";

type Camp = {
  id: string;
  status: string;
  google_campaign_id?: string | null;
  google_status?: string | null;
  tiktok_campaign_id?: string | null;
  tiktok_status?: string | null;
};

/**
 * PLACEHOLDER (Task 3): a aba "Anúncios e regras" já monta este painel; o conteúdo real (a mesma campanha no
 * Google Ads e no TikTok Ads) é portado na tarefa de Meta Ads/Google/TikTok, que substitui este arquivo
 * mantendo a assinatura `{ campaign, canEdit, canManage }`.
 */
export function CampaignChannels({ campaign }: { campaign: Camp; canEdit: boolean; canManage: boolean }) {
  return (
    <Section title="Google Ads e TikTok Ads" description="Publique a mesma campanha em outros canais.">
      <p className="text-sm text-muted-foreground" data-campaign={campaign.id}>
        Disponível em breve nesta versão.
      </p>
    </Section>
  );
}
