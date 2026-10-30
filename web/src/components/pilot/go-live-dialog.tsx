"use client";

import { useEffect, useRef, useState } from "react";
import { regionSentence } from "@/components/region-picker";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";

export type GoLiveCampaign = {
  objective?: string | null;
  geo_targets?: unknown;
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

const geoLine = (g: unknown) => {
  const first = Array.isArray(g) ? (g[0] as { name?: string; uf?: string; radius_km?: number | null } | undefined) : undefined;
  return first?.name ? regionSentence({ ...first, name: first.uf ? `${first.name} – ${first.uf}` : first.name } as never) : "";
};
const money = (n: number) => n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const ddmm = (iso?: string | null) => (iso ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}` : "");
const todaySp = () => new Date(Date.now() - 3 * 3600e3).toISOString().slice(0, 10);
const daysBetween = (a?: string | null, b?: string | null) => (a && b ? Math.round((Date.parse(b) - Date.parse(a)) / 86_400_000) + 1 : null);
const isVideo = (url?: string | null) => !!url && /\.(mp4|mov|webm)(\?|$)/i.test(url);
/** Para onde vai quem clicar, pelo objetivo (como a Meta monta): formulário instantâneo, WhatsApp ou a página. */
export function clickDestination(objective: string | null | undefined, landing: string | null | undefined): string {
  if (objective === "leads") return "Formulário da Meta, dentro do Instagram/Facebook: a pessoa deixa nome e WhatsApp sem sair do app. Ela não abre a sua página.";
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
  error,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  error?: string | null;
  campaign: GoLiveCampaign;
  creatives: Creative[];
  canManage: boolean;
  busy: boolean;
  onConfirm: (confirmOffer: boolean) => void;
  onExclude: (creativeId: string) => Promise<void>;
}) {
  const [confirm, setConfirm] = useState(false);
  const [excluding, setExcluding] = useState<string | null>(null);
  const [asking, setAsking] = useState<string | null>(null);
  const titleRef = useRef<HTMLHeadingElement>(null);
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
    <Dialog open={open} onOpenChange={(o) => { if (busy) return; if (o) setConfirm(false); onOpenChange(o); }}>
      <DialogContent
        className="max-h-[100dvh] overflow-y-auto sm:max-h-[85vh]"
        onOpenAutoFocus={(e) => { e.preventDefault(); titleRef.current?.focus(); }}
        onCloseAutoFocus={(e) => { const live = document.getElementById("pilot-live"); if (live) { e.preventDefault(); live.focus(); } }}
      >
        <DialogHeader>
          <DialogTitle ref={titleRef} tabIndex={-1} className="outline-none">Conferir antes de ligar</DialogTitle>
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
            <p>{geoLine(campaign.geo_targets) || aud.localizacao || "Região da campanha"}</p>
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
            <p className="[overflow-wrap:anywhere]">{clickDestination(campaign.objective, campaign.landing_url)}</p>
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
            <ul className="mt-2 grid grid-cols-2 gap-3 sm:grid-cols-3">
              {arts.map((c, i) => (
                <li key={c.id} className="space-y-1">
                  <div className="flex aspect-[4/5] items-center justify-center overflow-hidden rounded border bg-muted">
                    {isVideo(c.preview_url) ? (
                      <video src={c.preview_url!} poster={c.thumbnail_url ?? undefined} controls muted playsInline preload="metadata" className="h-full w-full object-cover" aria-label={`Vídeo ${i + 1} de ${arts.length}`} />
                    ) : c.preview_url ? (
                      <img src={c.preview_url} alt={`Arte ${i + 1} de ${arts.length}`} className="h-full w-full object-cover" />
                    ) : (
                      <><span aria-hidden="true">▶</span><span className="sr-only">Vídeo sem prévia: {c.title}</span></>
                    )}
                  </div>
                  {canManage && arts.length > 1 && !inCarousel.has(c.id) && (asking === c.id ? (
                    <div className="space-y-1 text-sm">
                      <p>Tirar esta arte do anúncio? Ela fica pausada na Meta.</p>
                      <div className="flex flex-wrap gap-2">
                        <Button
                          className="h-11 whitespace-normal lg:h-9" disabled={!!excluding}
                          onClick={() => { setExcluding(c.id); void onExclude(c.id).finally(() => { setExcluding(null); setAsking(null); }); }}
                        >
                          {excluding === c.id ? "Tirando…" : "Tirar do anúncio"}
                        </Button>
                        <Button variant="outline" className="h-11 lg:h-9" onClick={() => setAsking(null)}>Manter</Button>
                      </div>
                    </div>
                  ) : (
                    <Button variant="link" className="h-11 whitespace-normal px-0 text-sm lg:h-auto" aria-label={`Não usar a arte ${i + 1} de ${arts.length}`} onClick={() => setAsking(c.id)}>
                      Não usar esta arte
                    </Button>
                  ))}
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
        <DialogFooter className="sticky bottom-0 flex-col gap-2 border-t bg-background pt-3 pb-[env(safe-area-inset-bottom)] sm:flex-col">
          {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
          {days != null && <p className="text-sm">{money(daily)} × {days} dias = até cerca de {money(daily * days)} ({ddmm(from)} a {ddmm(campaign.end_date)})</p>}
          {canManage && needsConfirm && !confirm && <p className="text-sm">Marque “Confirmo que o Freela cumpre essa oferta” para ligar.</p>}
          {canManage && !arts.length && <p className="text-sm">Nenhuma arte ficou no anúncio. Feche e escolha as artes na aba Criativos.</p>}
          {canManage ? (
            <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              <Button variant="ghost" className="h-11 lg:h-9" onClick={() => onOpenChange(false)}>Agora não</Button>
              <Button className="h-11 lg:h-9" disabled={busy || (needsConfirm && !confirm) || !arts.length} onClick={() => onConfirm(needsConfirm && confirm)}>
                {busy ? "Ligando na Meta…" : `Ligar anúncio: ${money(daily)} por dia`}
              </Button>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">Só o dono ou um admin liga o anúncio. Avise quem aprova.</p>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
