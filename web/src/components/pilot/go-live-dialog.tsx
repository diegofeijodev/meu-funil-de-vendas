"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";

export type GoLiveCampaign = {
  objective?: string | null;
  meta_ad_map?: unknown;
  budget_daily?: number | string | null;
  start_date?: string | null;
  end_date?: string | null;
  landing_url?: string | null;
  audience?: Record<string, unknown> | null;
  offer_promise?: string | null;
  offer_terms?: unknown;
};
type Creative = { id: string; title: string; preview_url?: string | null; thumbnail_url?: string | null; type?: string | null; extras?: unknown };
type AdEntry = { creativeId?: string | null; creativeIds?: string[]; carousel?: boolean };

const money = (n: number) => n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const ddmm = (iso?: string | null) => (iso ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}` : "");
const todaySp = () => new Date(Date.now() - 3 * 3600e3).toISOString().slice(0, 10);
const daysBetween = (a?: string | null, b?: string | null) => (a && b ? Math.round((Date.parse(b) - Date.parse(a)) / 86_400_000) + 1 : null);
const isVideo = (url?: string | null) => !!url && /\.(mp4|mov|webm)(\?|$)/i.test(url);
/** Para onde vai quem clicar, pelo objetivo (como a Meta monta): formulário instantâneo, WhatsApp ou a página. */
function clickDestination(objective: string | null | undefined, landing: string | null | undefined): string {
  if (objective === "leads") return "Formulário no Instagram/Facebook; o contato cai no seu CRM.";
  if (objective === "whatsapp") return "Conversa no WhatsApp da Página.";
  return landing || "Falta o destino do anúncio.";
}
const WHAT: Record<string, string> = { taxa: "sem a taxa do Freela", diaria: "sem a diária", ambas: "sem a taxa e a diária" };

/**
 * "Pronto para ligar" (doc de UI, D): a conferência É a confirmação de alto risco, com o valor no verbo do botão. Mostra o que vai rodar,
 * pede o "Confirmo que o Freela cumpre essa oferta" quando a oferta veio do intake, e deixa tirar uma arte antes de ligar.
 */
export function GoLiveDialog({
  open, onOpenChange, campaign, creatives, canManage, busy, onConfirm, onExclude,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  campaign: GoLiveCampaign;
  creatives: Creative[];
  canManage: boolean;
  busy: boolean;
  onConfirm: (confirmOffer: boolean) => void;
  onExclude: (creativeId: string) => Promise<void>;
}) {
  const [confirm, setConfirm] = useState(false);
  const [excluding, setExcluding] = useState<string | null>(null);
  // Toda abertura começa sem a caixa marcada (também quando quem abre é o painel ou o cabeçalho).
  useEffect(() => { if (open) setConfirm(false); }, [open]);
  const daily = Number(campaign.budget_daily ?? 0);
  // A Meta começa a gastar ao ligar (ou no 1º dia, se for depois): a conta usa o que falta do período.
  const today = todaySp();
  const from = campaign.start_date && campaign.start_date.slice(0, 10) > today ? campaign.start_date.slice(0, 10) : today;
  const days = campaign.end_date ? daysBetween(from, campaign.end_date.slice(0, 10)) : null;
  const aud = (campaign.audience ?? {}) as { persona?: string; idade?: string; localizacao?: string };
  const terms = campaign.offer_terms && typeof campaign.offer_terms === "object" ? (campaign.offer_terms as { what?: string; valid_until?: string; new_only?: boolean; confirmed_at?: string }) : null;
  // Mesma regra do servidor: promessa + condições do intake, ainda sem confirmação.
  const needsConfirm = !!campaign.offer_promise?.trim() && !!terms && !terms.confirmed_at;
  // As artes que estão NA Meta (mapa anúncio → arte), sem as tiradas; carrossel junta várias num anúncio só.
  const map = (campaign.meta_ad_map && typeof campaign.meta_ad_map === "object" ? Object.values(campaign.meta_ad_map as Record<string, AdEntry>) : []) as AdEntry[];
  const inCarousel = new Set(map.filter((v) => v.carousel && (v.creativeIds?.length ?? 0) > 1).flatMap((v) => v.creativeIds ?? []));
  const onMeta = new Set(map.flatMap((v) => v.creativeIds ?? (v.creativeId ? [v.creativeId] : [])));
  const arts = creatives.filter((c) => onMeta.has(c.id) && !(c.extras as { excluded_from_ads_at?: string } | null)?.excluded_from_ads_at);

  return (
    <Dialog open={open} onOpenChange={(o) => { if (o) setConfirm(false); onOpenChange(o); }}>
      <DialogContent className="max-h-[100dvh] overflow-y-auto sm:max-h-[85vh]">
        <DialogHeader>
          <DialogTitle>Conferir antes de ligar</DialogTitle>
          <DialogDescription>O anúncio está montado e desligado. Confira o que vai rodar.</DialogDescription>
        </DialogHeader>
        <div className="space-y-4 text-sm">
          <div>
            <h3 className="font-semibold">Quanto</h3>
            <p className="text-2xl font-semibold">{money(daily)} por dia</p>
            {days == null && <p>Roda até você pausar ou encerrar.</p>}
            {days != null && (
              <>
                <p>{ddmm(from)} a {ddmm(campaign.end_date)} ({days} dias)</p>
                <p>{money(daily)} × {days} dias = cerca de {money(daily * days)} no período</p>
              </>
            )}
          </div>
          <div>
            <h3 className="font-semibold">Onde</h3>
            <p>{aud.localizacao || "Região da campanha"}</p>
            <p className="text-muted-foreground">No Instagram e no Facebook</p>
          </div>
          {aud.persona && (
            <div>
              <h3 className="font-semibold">Para quem</h3>
              <p>{aud.persona}{aud.idade ? `, ${aud.idade} anos` : ""}</p>
            </div>
          )}
          <div>
            <h3 className="font-semibold">Quem clicar vai para</h3>
            <p className="break-all">{clickDestination(campaign.objective, campaign.landing_url)}</p>
          </div>
          {campaign.offer_promise && (
            <div>
              <h3 className="font-semibold">O que o anúncio promete</h3>
              <p>
                “{campaign.offer_promise}
                {terms?.what ? `: ${WHAT[terms.what] ?? terms.what}` : ""}
                {terms?.new_only ? ", para empresa nova" : ""}
                {terms?.valid_until ? `, até ${ddmm(terms.valid_until)}` : ""}.”
              </p>
              {needsConfirm && (
                <label className="mt-2 flex min-h-11 items-center gap-2">
                  <input type="checkbox" checked={confirm} onChange={(e) => setConfirm(e.target.checked)} />
                  Confirmo que o Freela cumpre essa oferta.
                </label>
              )}
            </div>
          )}
          <div>
            <h3 className="font-semibold">Artes ({arts.length})</h3>
            <ul className="mt-2 grid grid-cols-3 gap-2">
              {arts.map((c) => (
                <li key={c.id} className="space-y-1">
                  <div className="flex aspect-[4/5] items-center justify-center overflow-hidden rounded border bg-muted">
                    {isVideo(c.preview_url) ? (
                      <video src={c.preview_url!} poster={c.thumbnail_url ?? undefined} controls muted playsInline preload="metadata" className="h-full w-full object-cover" aria-label={c.title} />
                    ) : c.preview_url ? (
                      <img src={c.preview_url} alt={c.title} className="h-full w-full object-cover" />
                    ) : (
                      <span aria-hidden="true">▶</span>
                    )}
                  </div>
                  {canManage && arts.length > 1 && !inCarousel.has(c.id) && (
                    <Button
                      variant="link" className="h-11 px-0 text-xs lg:h-auto" disabled={!!excluding}
                      onClick={() => { setExcluding(c.id); void onExclude(c.id).finally(() => setExcluding(null)); }}
                    >
                      {excluding === c.id ? "Tirando…" : "Não usar esta arte"}
                    </Button>
                  )}
                </li>
              ))}
            </ul>
          </div>
          <div className="rounded-md bg-muted p-3">
            <h3 className="font-semibold">Bom saber</h3>
            <p>
              A Meta cobra na forma de pagamento da conta de anúncios. Num dia ela pode gastar até 75% a mais (até {money(daily * 1.75)}), mas numa semana não
              passa de 7 × {money(daily)} = {money(daily * 7)} (regra de orçamento diário da Meta). Não dá para garantir quantos cadastros vão chegar. Você pode
              pausar quando quiser.
            </p>
          </div>
        </div>
        <DialogFooter className="sticky bottom-0 bg-background pt-2 pb-[env(safe-area-inset-bottom)]">
          {canManage ? (
            <>
              <Button variant="ghost" className="h-11 lg:h-9" onClick={() => onOpenChange(false)}>Agora não</Button>
              <Button className="h-11 lg:h-9" disabled={busy || (needsConfirm && !confirm) || !arts.length} onClick={() => onConfirm(needsConfirm && confirm)}>
                {busy ? "Ligando na Meta…" : `Ligar anúncio: ${money(daily)} por dia`}
              </Button>
            </>
          ) : (
            <p className="text-sm text-muted-foreground">Só o dono ou um admin liga o anúncio. Avise quem aprova.</p>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
