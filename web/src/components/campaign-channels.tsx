"use client";

import { useState } from "react";
import { useServerFn } from "@/lib/server-fn";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Section, StatusPill } from "@/components/ui-bits";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { createExternalCampaign, linkExternalCampaign, setExternalCampaignStatus } from "@/lib/ads/channels.functions";
import { apiErrorMessage } from "@/modules/shared/infrastructure/http";

type Camp = {
  id: string;
  status: string;
  google_campaign_id?: string | null;
  google_status?: string | null;
  tiktok_campaign_id?: string | null;
  tiktok_status?: string | null;
};

/** 2.8 / 2.9 A mesma campanha no Google Ads (Pesquisa) e no TikTok Ads (vídeo). */
export function CampaignChannels({ campaign, canEdit, canManage }: { campaign: Camp; canEdit: boolean; canManage: boolean }) {
  const qc = useQueryClient();
  const create = useServerFn(createExternalCampaign);
  const link = useServerFn(linkExternalCampaign);
  const setStatus = useServerFn(setExternalCampaignStatus);
  const [busy, setBusy] = useState<string | null>(null);
  const [ids, setIds] = useState({ google: "", tiktok: "" });
  const [log, setLog] = useState<{ label: string; status: string; detail: string }[]>([]);
  const approved = campaign.status === "approved" || campaign.status === "active";
  const act = async (key: string, fn: () => Promise<void>) => {
    setBusy(key);
    try {
      await fn();
      qc.invalidateQueries({ queryKey: ["campaign", campaign.id] });
    } catch (e) {
      toast.error(apiErrorMessage(e, "Não foi possível concluir."));
    } finally {
      setBusy(null);
    }
  };
  const row = (ch: "google" | "tiktok", label: string) => {
    const ext = ch === "google" ? campaign.google_campaign_id : campaign.tiktok_campaign_id;
    const st = ch === "google" ? campaign.google_status : campaign.tiktok_status;
    const active = st === "ENABLED" || st === "ENABLE";
    return (
      <div className="space-y-2 rounded-lg border border-border/60 p-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="font-medium">{label}</p>
          {ext ? <StatusPill status={active ? "connected" : "paused"} label={`${active ? "Ativa" : "Pausada"} · ${ext}`} /> : <span className="text-xs text-muted-foreground">Não ligada</span>}
        </div>
        {ext ? (
          canEdit && (
            (active || canManage) && (
              <Button size="sm" variant="outline" disabled={!!busy} onClick={() => act(`st-${ch}`, async () => {
                await setStatus({ data: { campaignId: campaign.id, channel: ch, active: !active } });
                toast.success(active ? "Pausada." : "Ativada.");
              })}>
                {active ? "Pausar" : "Ativar (gasta verba)"}
              </Button>
            )
          )
        ) : (
          canEdit && (
            <div className="flex flex-wrap gap-2">
              <Button size="sm" disabled={!!busy || !approved} title={approved ? "" : "Aprove a campanha antes"} onClick={() => act(`new-${ch}`, async () => {
                const r = await create({ data: { campaignId: campaign.id, channel: ch } });
                setLog(r.steps);
                toast.success(`Campanha criada pausada no ${label}.`);
              })}>
                {busy === `new-${ch}` ? "Criando..." : ch === "google" ? "Criar campanha de Pesquisa (pausada)" : "Criar campanha de vídeo (desativada)"}
              </Button>
              <Input className="h-9 w-44" placeholder="ou ID existente" value={ids[ch]} onChange={(e) => setIds({ ...ids, [ch]: e.target.value })} />
              <Button size="sm" variant="outline" disabled={!!busy || !ids[ch].trim()} onClick={() => act(`link-${ch}`, async () => {
                await link({ data: { campaignId: campaign.id, channel: ch, externalId: ids[ch] } });
                toast.success("Campanha ligada. Os resultados chegam na próxima sincronização.");
              })}>
                Ligar
              </Button>
            </div>
          )
        )}
      </div>
    );
  };
  return (
    <Section title="Google Ads e TikTok Ads" description="Conecte os canais em Integrações. Resultados entram junto com os da Meta (a cada 3 horas).">
      <div className="space-y-3 text-sm">
        {row("google", "Google Ads")}
        {row("tiktok", "TikTok Ads")}
        {log.length > 0 && (
          <ol className="space-y-1 text-xs">
            {log.map((s, i) => (
              <li key={i} className={s.status === "failed" ? "text-destructive" : "text-muted-foreground"}>
                {s.status === "failed" ? "✗" : "✓"} {s.label} {s.detail ? `· ${s.detail}` : ""}
              </li>
            ))}
          </ol>
        )}
      </div>
    </Section>
  );
}
