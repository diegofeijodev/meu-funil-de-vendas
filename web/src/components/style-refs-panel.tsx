"use client";

import { useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { fullDate } from "@/lib/format";
import { apiErrorMessage } from "@/modules/shared/infrastructure/http";
import {
  addPinterestRef,
  listStyleRefs,
  removeStyleRef,
  removeStyleSource,
  uploadStyleRef,
} from "@/modules/style-refs/infrastructure/style-refs.api";

type Props = { workspaceId: string; brandId: string; campaignId: string | null; canEdit: boolean; started?: boolean };

/** "Estilo das artes" (ux §E): fotos ou Pins com o clima desejado → o estrategista descreve o estilo em palavras; nada é copiado nem publicado. */
export function StyleRefsPanel({ workspaceId, brandId, campaignId, canEdit, started }: Props) {
  const qc = useQueryClient();
  const key = ["style-refs", workspaceId, brandId, campaignId];
  const { data, isLoading } = useQuery({
    queryKey: key,
    queryFn: () => listStyleRefs(workspaceId, brandId, campaignId),
    // Enquanto alguma está "Lendo o estilo…", confere de novo a cada 5 s.
    refetchInterval: (q) => (q.state.data?.refs.some((r) => r.status === "processing") ? 5000 : false),
  });
  const [link, setLink] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const refresh = () => qc.invalidateQueries({ queryKey: key });
  const pinterest = !!data?.limits.pinterest;
  const inCampaign = data?.limits.in_campaign ?? 0;

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
        r.kind === "pin"
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

  const remove = async (id: string) => {
    try {
      await removeStyleRef(workspaceId, brandId, id);
      await refresh();
      toast.success("Referência removida.");
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

  return (
    <div className="space-y-4">
      <div className="space-y-1">
        <p className="text-sm text-muted-foreground">
          Mostre fotos com o clima que você quer. O estrategista descreve o estilo em palavras e cria artes novas: não copia a imagem, as
          pessoas, as marcas nem os textos, e a referência nunca é publicada.
        </p>
        {started && <p className="text-xs text-muted-foreground">Vale para as artes que ainda vão ser feitas.</p>}
      </div>

      {canEdit && (
        <div className="space-y-3">
          {pinterest ? (
            <div className="space-y-1.5">
              <Label htmlFor="pin-link">Link do Pinterest (Pin, pasta ou perfil)</Label>
              <div className="flex flex-col gap-2 sm:flex-row">
                <Input
                  id="pin-link"
                  inputMode="url"
                  placeholder="https://pin.it/… ou https://br.pinterest.com/…"
                  value={link}
                  onChange={(e) => setLink(e.target.value)}
                />
                <Button onClick={() => void addFromPinterest()} disabled={busy === "pin" || !link.trim()}>
                  {busy === "pin" ? "Buscando…" : "Usar"}
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">
                Uma pasta ou perfil público vira fonte: os Pins novos entram sozinhos todo dia (até 8 por vez).
              </p>
            </div>
          ) : (
            <p className="text-xs text-muted-foreground">Achou no Pinterest? Salve a imagem no celular e envie aqui.</p>
          )}
          <div>
            <input ref={fileRef} type="file" accept="image/jpeg,image/png,image/webp" className="hidden" onChange={(e) => void upload(e.target.files?.[0])} />
            <Button variant="outline" onClick={() => fileRef.current?.click()} disabled={busy === "upload"}>
              {busy === "upload" ? "Enviando…" : "Enviar imagem"}
            </Button>
          </div>
        </div>
      )}

      {!!data?.sources.length && (
        <div className="space-y-2">
          <p className="text-sm font-medium">Pastas acompanhadas</p>
          <ul className="space-y-2">
            {data.sources.map((s) => (
              <li key={s.id} className="flex flex-col gap-1 rounded-lg border border-border p-3 text-sm sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <a href={s.url} target="_blank" rel="noreferrer" className="font-medium underline-offset-2 hover:underline">
                    {s.title ?? s.url}
                  </a>
                  <p className="text-xs text-muted-foreground">
                    {s.last_error ?? (s.last_synced_at ? `Atualizada em ${fullDate(s.last_synced_at)}` : "Aguardando a primeira leitura")}
                  </p>
                </div>
                {canEdit && (
                  <Button variant="ghost" size="sm" onClick={() => void stopSource(s.id)}>
                    Parar
                  </Button>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}

      {isLoading && <div className="h-20 animate-pulse rounded-lg bg-muted" aria-hidden="true" />}
      {!!data?.refs.length && (
        <ul className="space-y-3">
          {data.refs.map((r) => (
            <li key={r.id} className="flex gap-3 rounded-lg border border-border p-3">
              {r.image_url ? (
                <img src={r.image_url} alt="" className="size-16 shrink-0 rounded-md object-cover" loading="lazy" />
              ) : (
                <div className="size-16 shrink-0 rounded-md bg-muted" />
              )}
              <div className="min-w-0 flex-1 space-y-1 text-sm">
                <p className="text-xs text-muted-foreground">
                  {r.source === "pinterest" ? (r.from_source ? "Pinterest · pasta" : "Pinterest") : "Enviada"}
                  {r.campaign_id ? " · desta campanha" : " · da marca"}
                </p>
                {r.status === "processing" && <p role="status">Lendo o estilo…</p>}
                {r.status === "ready" && <p>O que eu peguei: {r.summary ?? "estilo lido."}</p>}
                {r.status === "failed" && <p className="text-destructive">{r.error}</p>}
              </div>
              {canEdit && (
                <Button variant="ghost" size="sm" className="self-start" onClick={() => void remove(r.id)}>
                  Remover
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}
      {campaignId && <p className="text-xs text-muted-foreground">{inCampaign} de {data?.limits.campaign ?? 8} referências nesta campanha.</p>}
    </div>
  );
}
