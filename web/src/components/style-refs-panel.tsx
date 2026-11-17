"use client";

import { useEffect, useId, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { AlertTriangle } from "lucide-react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { StyleRefRow } from "@/components/style-ref-row";
import { fullDate } from "@/lib/format";
import {
  PANEL_TEXT,
  SELECTION_TEXT,
  brandCounter,
  liveAnnouncement,
  promotedToast,
  selectionAnnouncement,
  removedToast,
  seeAllLabel,
  stopSourceQuestion,
  visibleRefs,
  refsPollInterval,
} from "@/lib/style-refs";
import { apiErrorMessage } from "@/modules/shared/infrastructure/http";
import {
  addPinterestRef,
  listStyleRefs,
  removeStyleRef,
  removeStyleSource,
  uploadStyleRef,
  type StyleRef,
} from "@/modules/style-refs/infrastructure/style-refs.api";

type Props = {
  workspaceId: string;
  brandId: string;
  campaignId: string | null;
  canEdit: boolean;
  started?: boolean;
  /**
   * Onde a Seleção do Meu Funil aparece (ui.md §3.7/§3.8). `below` (Marca): os itens dela NÃO entram aqui, o bloco da Seleção os mostra.
   * `inline` (campanha, padrão): vão no fim da lista, sem "Parar". `none`: não aparecem.
   */
  selection?: "none" | "below" | "inline";
  /** Quando passada (Marca), a frase da região viva vai para quem chama e o painel não renderiza a própria região `aria-live`. */
  announce?: (msg: string) => void;
};

/**
 * Corpo do "Estilo das artes" (ui.md §2). O título e a descrição ficam na `Section` de quem chama (PANEL_TEXT.title/description).
 * Fotos ou Pins com o clima desejado → o Meu Funil descreve o estilo em palavras; nada é copiado nem publicado.
 */
export function StyleRefsPanel({ workspaceId, brandId, campaignId, canEdit, started, selection = "inline", announce }: Props) {
  const qc = useQueryClient();
  const key = ["style-refs", workspaceId, brandId, campaignId];
  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: key,
    queryFn: () => listStyleRefs(workspaceId, brandId, campaignId),
    // "Lendo o estilo…" (1ª leitura): 5 s; só tentativas espaçadas: 60 s; nenhuma lendo: sem conferência.
    // Na Marca (`below`) só as próprias contam: a Seleção é acompanhada pela vista do bloco, e refazer a lista a cada 5 s renova as miniaturas.
    refetchInterval: (q) => refsPollInterval(selection === "below" ? q.state.data?.refs.filter((r) => r.origin !== "selection") : q.state.data?.refs),
  });
  const [link, setLink] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [stopping, setStopping] = useState<{ id: string; refs_count: number } | null>(null);
  const [announcement, setAnnouncement] = useState("");
  const prevRefs = useRef<{ id: string; status: string }[] | undefined>(undefined);
  const announceRef = useRef(announce);
  announceRef.current = announce;
  const prevSel = useRef<{ id: string; status: string }[] | undefined>(undefined);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const fieldId = useId();
  const refresh = () => qc.invalidateQueries({ queryKey: key });
  const pinterest = !!data?.limits.pinterest;
  const inCampaign = data?.limits.in_campaign ?? 0;
  const allRefs: StyleRef[] = data?.refs ?? [];
  const allSources = data?.sources ?? [];
  // Lista de cima = só as próprias (ui.md §3.7). A Seleção só entra aqui no modo "inline".
  const refs = allRefs.filter((r) => r.origin !== "selection");
  const sources = allSources.filter((s) => s.origin !== "selection");
  const selRefs = allRefs.filter((r) => r.origin === "selection");
  const selSources = allSources.filter((s) => s.origin === "selection");
  const hasSelection = selRefs.length + selSources.length > 0;
  const inlineSelection = selection === "inline";
  // Seleção em pausa (estado 6): 4 ou mais próprias da marca toda, lendo ou prontas.
  const paused = allRefs.filter((r) => r.origin !== "selection" && !r.campaign_id && r.status !== "failed").length >= 4;

  // Região viva única: compara a lista anterior com a nova (a 1ª carga não anuncia).
  useEffect(() => {
    if (!data) return;
    const next = data.refs.filter((r) => r.origin !== "selection").map((r) => ({ id: r.id, status: r.status }));
    const nextSel = data.refs.filter((r) => r.origin === "selection").map((r) => ({ id: r.id, status: r.status }));
    // As frases da §2 têm prioridade; a da Seleção só entra quando nenhuma delas vale (no máximo uma por conferência).
    const msg = liveAnnouncement(prevRefs.current, next) ?? selectionAnnouncement(prevSel.current, nextSel);
    prevRefs.current = next;
    prevSel.current = nextSel;
    if (!msg) return;
    if (announceRef.current) {
      announceRef.current(msg);
      return;
    }
    // Limpa antes: a mesma frase duas vezes seguidas precisa mudar o DOM para ser anunciada de novo.
    setAnnouncement("");
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setAnnouncement(msg), 100);
  }, [data]);

  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);

  const upload = async (file: File | undefined) => {
    if (!file) return;
    if (file.size > 15 * 1024 * 1024) {
      toast.error("A imagem passa de 15 MB.");
      return;
    }
    setBusy("upload");
    try {
      await uploadStyleRef(workspaceId, brandId, file, campaignId);
      await refresh();
    } catch (e) {
      toast.error(apiErrorMessage(e, "Não foi possível enviar a imagem."));
    } finally {
      setBusy(null);
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  const addFromPinterest = async () => {
    if (!link.trim()) return;
    setBusy("pin");
    try {
      const r = await addPinterestRef(workspaceId, brandId, link.trim(), campaignId);
      setLink("");
      await refresh();
      toast.success(
        r.promoted
          ? promotedToast(r.kind)
          : r.kind === "pin"
            ? "Pin adicionado. Lendo o estilo…"
            : r.added
              ? `Pasta acompanhada: ${r.added} Pin(s) novos. Ela é atualizada sozinha todo dia.`
              : "Pasta acompanhada. Ela é atualizada sozinha todo dia.",
      );
    } catch (e) {
      toast.error(apiErrorMessage(e, "Não foi possível usar esse link."));
    } finally {
      setBusy(null);
    }
  };

  const remove = async (r: StyleRef) => {
    try {
      await removeStyleRef(workspaceId, brandId, r.id);
      await refresh();
      toast.success(removedToast(r));
    } catch (e) {
      toast.error(apiErrorMessage(e, "Não foi possível remover."));
    }
  };

  const stopSource = async (id: string) => {
    try {
      await removeStyleSource(workspaceId, brandId, id);
      await refresh();
      toast.success("Pasta parada. As referências dela saíram.");
    } catch (e) {
      toast.error(apiErrorMessage(e, "Não foi possível parar a pasta."));
    }
  };

  const shown = visibleRefs(refs, expanded);

  return (
    <div className="space-y-4">
      {!announce && (
        <p aria-live="polite" className="sr-only">
          {announcement}
        </p>
      )}
      {started && <p className="text-sm text-muted-foreground">Vale para as artes que ainda vão ser feitas.</p>}
      {campaignId && <p className="text-sm text-muted-foreground">{PANEL_TEXT.campaignOnly}</p>}

      {canEdit && (
        <div className="space-y-3">
          {pinterest ? (
            <div className="space-y-1.5">
              <Label htmlFor={fieldId}>{PANEL_TEXT.field}</Label>
              <div className="flex flex-col gap-2 sm:flex-row">
                <Input
                  id={fieldId}
                  inputMode="url"
                  className="h-11"
                  value={link}
                  onChange={(e) => setLink(e.target.value)}
                />
                <Button className="h-11" onClick={() => void addFromPinterest()} disabled={busy === "pin" || !link.trim()}>
                  {busy === "pin" ? PANEL_TEXT.adding : PANEL_TEXT.add}
                </Button>
              </div>
              <p className="text-sm text-muted-foreground">{PANEL_TEXT.help}</p>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">Achou no Pinterest? Salve a imagem no celular e envie aqui.</p>
          )}
          <div>
            <input ref={fileRef} type="file" accept="image/jpeg,image/png" className="hidden" onChange={(e) => void upload(e.target.files?.[0])} />
            <Button variant="outline" className="h-11" onClick={() => fileRef.current?.click()} disabled={busy === "upload"}>
              {busy === "upload" ? PANEL_TEXT.uploading : PANEL_TEXT.upload}
            </Button>
          </div>
        </div>
      )}

      {campaignId ? (
        <p className="text-sm text-muted-foreground">{inCampaign} de {data?.limits.campaign ?? 8} referências nesta campanha.</p>
      ) : (
        !!data && <p className="text-sm text-muted-foreground">{brandCounter(data.limits.in_brand)}</p>
      )}

      {isLoading && <p className="text-sm text-muted-foreground">{PANEL_TEXT.loading}</p>}
      {isError && (
        <div className="space-y-2">
          <p className="text-sm text-destructive">{PANEL_TEXT.loadError}</p>
          <Button variant="outline" className="h-11" onClick={() => void refetch()}>
            {PANEL_TEXT.retry}
          </Button>
        </div>
      )}
      {!!data && !refs.length && !sources.length && (
        <p className="text-sm text-muted-foreground">{selection !== "none" && selRefs.length > 0 ? SELECTION_TEXT.emptyWithSelection : PANEL_TEXT.empty}</p>
      )}

      {!!sources.length && (
        <div className="space-y-2">
          <p className="text-sm font-medium">{PANEL_TEXT.sources}</p>
          <ul className="space-y-2">
            {sources.map((s) => (
              <li key={s.id} className="flex flex-col gap-1 rounded-lg border border-border p-3 text-sm sm:flex-row sm:items-center sm:justify-between">
                <div className="min-w-0 space-y-1">
                  <a href={s.url} target="_blank" rel="noreferrer" className="font-medium underline-offset-2 hover:underline">
                    {s.title ?? "Pasta do Pinterest"}
                  </a>
                  <p className="text-sm text-muted-foreground">
                    {s.last_synced_at ? `Atualizada em ${fullDate(s.last_synced_at)}` : "Aguardando a primeira leitura"}
                  </p>
                  {s.last_error && (
                    <p className="flex items-start gap-1.5 text-sm text-destructive">
                      <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
                      <span>{s.last_error}</span>
                    </p>
                  )}
                </div>
                {canEdit && (
                  <Button variant="ghost" size="sm" className="h-11 sm:h-8" onClick={() => setStopping({ id: s.id, refs_count: s.refs_count })}>
                    Parar
                  </Button>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}

      {!!refs.length && (
        <>
          {selection !== "none" && hasSelection && <p className="text-sm font-medium">{SELECTION_TEXT.ownRefs}</p>}
          <ul className="space-y-3">
            {shown.map((r) => (
              <StyleRefRow key={r.id} item={r} canEdit={canEdit} onRemove={(x) => void remove(x)} />
            ))}
          </ul>
          {!expanded && refs.length > shown.length && (
            <Button variant="outline" className="h-11" onClick={() => setExpanded(true)}>
              {seeAllLabel(refs.length)}
            </Button>
          )}
        </>
      )}

      {inlineSelection && hasSelection && (
        <div className="space-y-3">
          {!!selSources.length && (
            <ul className="space-y-2">
              {selSources.map((s) => (
                <li key={s.id} className="space-y-1 rounded-lg border border-border p-3 text-sm">
                  <a href={s.url} target="_blank" rel="noreferrer" className="font-medium underline-offset-2 hover:underline">
                    {s.title ?? SELECTION_TEXT.folderFallbackTitle}
                  </a>
                  <p className="text-sm text-muted-foreground">{SELECTION_TEXT.folderLabel}</p>
                  <p className="text-sm text-muted-foreground">
                    {s.last_synced_at ? `Atualizada em ${fullDate(s.last_synced_at)}` : "Aguardando a primeira leitura"}
                  </p>
                  {s.last_error && (
                    <p className="flex items-start gap-1.5 text-sm text-destructive">
                      <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
                      <span>{SELECTION_TEXT.folderError}</span>
                    </p>
                  )}
                </li>
              ))}
            </ul>
          )}
          {!!selRefs.length && (
            <ul className="space-y-3">
              {selRefs.map((r) => (
                <StyleRefRow key={r.id} item={r} canEdit={canEdit} onRemove={(x) => void remove(x)} selection paused={paused} />
              ))}
            </ul>
          )}
          <p className="text-sm text-muted-foreground">{SELECTION_TEXT.campaignHelp}</p>
        </div>
      )}

      <AlertDialog open={!!stopping} onOpenChange={(o) => !o && setStopping(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{PANEL_TEXT.stopConfirm}</AlertDialogTitle>
            <AlertDialogDescription>{stopping ? stopSourceQuestion(stopping.refs_count) : ""}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{PANEL_TEXT.stopCancel}</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (stopping) void stopSource(stopping.id);
                setStopping(null);
              }}
            >
              {PANEL_TEXT.stopConfirm}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
