"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "@/lib/router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@/lib/server-fn";
import { toast } from "sonner";
import {
  Archive,
  CheckCircle2,
  Download,
  FileText,
  FolderInput,
  Instagram,
  Loader2,
  Megaphone,
  Play,
  Tag,
  TriangleAlert,
  Upload,
  X,
} from "lucide-react";
import { bulkUpdateMedia, listMedia, listMediaFacets, setMediaTags } from "@/modules/media/infrastructure/media.api";
import { listBrands } from "@/modules/brands/infrastructure/brands.api";
import { listCampaigns } from "@/modules/campaigns/infrastructure/campaigns.api";
import { useWorkspace } from "@/lib/workspace";
import { EmptyState, PageHeader, StatusPill } from "@/components/ui-bits";
import { ImportFromCanvaButton, SendToCanvaButton } from "@/components/media/canva-buttons";
import { AssetAdResults, LibraryTexts } from "@/components/media/library-extras";
import { deleteMediaAssets, renameMediaFolder, renameMediaTag } from "@/lib/media/manage.functions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { brl } from "@/lib/format";
import {
  IG_FORMATS,
  TARGET_FORMATS,
  TARGET_FORMAT_KEYS,
  formatBytes,
  formatLabel,
  type TargetFormat,
} from "@/lib/media/formats";
import {
  downloadAsset,
  exportPdf,
  exportZip,
  reformatMedia,
  revalidateAssets,
  uploadMedia,
  useMediaInCampaign,
  useMediaInInstagram,
} from "@/lib/media/export.functions";
import { HowTo } from "@/components/how-to";
import { GUIDES } from "@/lib/guides";
import { apiErrorMessage } from "@/modules/shared/infrastructure/http";

type Asset = {
  id: string;
  title: string;
  kind: "image" | "video";
  source: string;
  url: string | null;
  thumbnail_url: string | null;
  mime: string | null;
  width: number | null;
  height: number | null;
  duration_seconds: number | null;
  size_bytes: number | null;
  target_format: string;
  ig_ready: boolean;
  quality_report: {
    issues?: string[];
    checks?: Record<string, unknown>;
    backfill?: boolean;
  } | null;
  tags: string[];
  folder: string | null;
  status: "draft" | "approved" | "rejected" | "archived";
  prompt: string | null;
  provider: string | null;
  cost: number | null;
  brand_id: string | null;
  campaign_id: string | null;
  parent_id: string | null;
  created_at: string;
  brands: { name: string } | null;
  campaigns: { name: string } | null;
  creative_id: string | null;
  angle?: string | null;
};

const STATUS: Record<string, string> = {
  draft: "Rascunho",
  approved: "Aprovado",
  rejected: "Rejeitado",
  archived: "Arquivado",
};
const SOURCE: Record<string, string> = {
  higgsfield: "Higgsfield",
  chatgpt: "ChatGPT",
  gemini: "Gemini",
  upload: "Upload",
  canva: "Canva",
  instagram: "Instagram (histórico)",
  mock: "Simulado (antigo)",
  other: "Outro",
};

const sel = "h-9 rounded-md border border-input bg-background px-2 text-sm";

function triggerDownload(url: string) {
  const a = document.createElement("a");
  a.href = url;
  a.rel = "noopener";
  document.body.appendChild(a);
  a.click();
  a.remove();
}

export function LibraryPage() {
  const { workspaceId, canEdit } = useWorkspace();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [f, setF] = useState({
    q: "",
    brand: "",
    campaign: "",
    kind: "",
    format: "",
    status: "active",
    tag: "",
    folder: "",
    source: "",
    period: "",
    sort: "new",
  });
  const [picked, setPicked] = useState<string[]>([]);
  const [view, setView] = useState<"media" | "texts">("media");
  const [openId, setOpenId] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [campaignDialog, setCampaignDialog] = useState(false);
  const [uploadTarget, setUploadTarget] = useState<TargetFormat>("ig_feed_square");
  const [dragging, setDragging] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const fns = {
    download: useServerFn(downloadAsset),
    pdf: useServerFn(exportPdf),
    zip: useServerFn(exportZip),
    reformat: useServerFn(reformatMedia),
    revalidate: useServerFn(revalidateAssets),
    upload: useServerFn(uploadMedia),
    ig: useServerFn(useMediaInInstagram),
    campaign: useServerFn(useMediaInCampaign),
    remove: useServerFn(deleteMediaAssets),
    renameTag: useServerFn(renameMediaTag),
    renameFolder: useServerFn(renameMediaFolder),
  };

  const removeAssets = (ids: string[]) => {
    if (!ids.length || !window.confirm(`Excluir ${ids.length} mídia(s) de vez? Os arquivos são apagados e não dá para desfazer.`)) return;
    return run(
      "delete",
      async () => {
        const r = await fns.remove({ data: { workspaceId: workspaceId!, assetIds: ids } });
        setPicked([]);
        setOpenId(null);
        refresh();
        return r;
      },
      (r) => `${r.deleted} mídia(s) excluída(s).`,
    );
  };

  const renameFacet = async (kind: "tag" | "folder") => {
    const from = kind === "tag" ? f.tag : f.folder;
    if (!from) return;
    const to = window.prompt(`Novo nome para ${kind === "tag" ? "a tag" : "a pasta"} "${from}" (vazio remove):`, from);
    if (to === null) return;
    await run(
      "bulk",
      async () => {
        const r =
          kind === "tag"
            ? await fns.renameTag({ data: { workspaceId: workspaceId!, from, to } })
            : await fns.renameFolder({ data: { workspaceId: workspaceId!, from, to } });
        setF((x) => ({ ...x, [kind]: to.trim() }));
        refresh();
        return r;
      },
      (r) => `${r.updated} mídia(s) atualizada(s).`,
    );
  };

  // 6.3 Busca, filtros, ordenação e paginação no servidor (sem limite de 500 itens).
  const PAGE = 60;
  const [pages, setPages] = useState(1);
  useEffect(() => setPages(1), [f]);
  const { data, isLoading } = useQuery({
    queryKey: ["library", workspaceId, f, pages],
    enabled: !!workspaceId,
    placeholderData: (prev) => prev,
    // `select *, brands(name), campaigns(name)` count exact + filtros/ordem/range da tela (a API monta o where) + brands, campaigns e facetas.
    queryFn: async () => {
      const [list, brands, campaigns, facets] = await Promise.all([
        listMedia(workspaceId!, f, pages * PAGE),
        listBrands(workspaceId!),
        listCampaigns(workspaceId!),
        listMediaFacets(workspaceId!),
      ]);
      return {
        assets: list.assets as unknown as Asset[],
        total: list.total,
        brands: brands.map((b) => ({ id: b.id, name: b.name })),
        campaigns: campaigns.map((c) => ({ id: c.id, name: c.name })),
        facets,
      };
    },
  });
  const refresh = () => qc.invalidateQueries({ queryKey: ["library", workspaceId] });

  const assets = data?.assets ?? [];
  const tags = useMemo(() => [...new Set((data?.facets ?? []).flatMap((a) => a.tags ?? []))].sort(), [data?.facets]);
  const folders = useMemo(
    () => [...new Set((data?.facets ?? []).map((a) => a.folder).filter(Boolean) as string[])].sort(),
    [data?.facets],
  );
  const list = assets;
  const hasMore = (data?.total ?? 0) > assets.length;

  const open = assets.find((a) => a.id === openId) ?? null;
  const toggle = (id: string) =>
    setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]));

  async function run<T>(key: string, fn: () => Promise<T>, ok?: string | ((r: T) => string)) {
    setBusy(key);
    try {
      const r = await fn();
      if (ok) toast.success(typeof ok === "function" ? ok(r) : ok);
      return r;
    } catch (e) {
      toast.error(apiErrorMessage(e, "Algo deu errado. Tente novamente."));
      return null;
    } finally {
      setBusy(null);
    }
  }

  const bulkUpdate = (patch: { status?: string; folder?: string | null }, msg: string) =>
    run(
      "bulk",
      async () => {
        await bulkUpdateMedia(workspaceId!, picked, patch);
        refresh();
      },
      msg,
    );

  const revalidate = (idsToCheck: string[]) =>
    run(
      "revalidate",
      async () => {
        const r = await fns.revalidate({ data: { workspaceId: workspaceId!, assetIds: idsToCheck } });
        refresh();
        return r;
      },
      (r) =>
        `${r.total} revalidada(s): ${r.ready} pronta(s) p/ Instagram${r.archived ? `, ${r.archived} arquivada(s) (simuladas)` : ""}${r.failed ? `, ${r.failed} com erro` : ""}.`,
    );

  const addTag = async () => {
    const t = window.prompt("Tag para adicionar às mídias selecionadas:")?.trim();
    if (!t) return;
    await run(
      "bulk",
      async () => {
        for (const a of assets.filter((x) => picked.includes(x.id))) {
          const next = [...new Set([...(a.tags ?? []), t])];
          await setMediaTags(workspaceId!, a.id, next);
        }
        refresh();
      },
      "Tag adicionada.",
    );
  };

  const moveFolder = async () => {
    const name = window.prompt("Nome da pasta (deixe vazio para remover da pasta):");
    if (name === null) return;
    await bulkUpdate({ folder: name.trim() || null }, "Mídias movidas.");
  };

  const downloadOne = (id: string, format: "original" | "png" | "jpg") =>
    run(
      `dl-${id}-${format}`,
      async () => {
        const r = await fns.download({ data: { workspaceId: workspaceId!, assetId: id, format } });
        triggerDownload(r.url);
        return r;
      },
      "Download iniciado.",
    );

  const downloadSelected = async (format: "original" | "png" | "jpg") => {
    for (const id of picked) await downloadOne(id, format);
  };

  const uploadFiles = async (files: FileList | File[]) => {
    const arr = Array.from(files);
    if (!arr.length || !workspaceId) return;
    setBusy("upload");
    let ok = 0;
    for (const file of arr) {
      const fd = new FormData();
      fd.set("workspaceId", workspaceId);
      fd.set("target", uploadTarget);
      fd.set("file", file);
      try {
        const r = await fns.upload({ data: fd });
        ok++;
        if (!r.igReady)
          toast.warning(`${file.name}: ${r.issues.join(" ") || "fora do padrão do Instagram."}`);
      } catch (e) {
        toast.error(apiErrorMessage(e, `Falha ao enviar ${file.name}.`));
      }
    }
    setBusy(null);
    if (ok)
      toast.success(
        `${ok} arquivo${ok > 1 ? "s" : ""} enviado${ok > 1 ? "s" : ""} e padronizado${ok > 1 ? "s" : ""}.`,
      );
    refresh();
  };

  if (!workspaceId) return null;

  return (
    <>
      <PageHeader
        title="Biblioteca de mídia"
        subtitle="Imagens e vídeos no tamanho certo para Instagram e anúncios. Baixe, exporte em PDF e reaproveite em posts e campanhas."
        actions={
          canEdit && (
            <div className="flex items-center gap-2">
              <select
                className={sel}
                value={uploadTarget}
                onChange={(e) => setUploadTarget(e.target.value as TargetFormat)}
                aria-label="Formato do upload"
              >
                {TARGET_FORMAT_KEYS.map((k) => (
                  <option key={k} value={k}>
                    {TARGET_FORMATS[k].label}
                  </option>
                ))}
                <option value="other">Manter tamanho original</option>
              </select>
              <ImportFromCanvaButton workspaceId={workspaceId} onImported={() => qc.invalidateQueries()} />
              <Button onClick={() => fileRef.current?.click()} disabled={busy === "upload"}>
                {busy === "upload" ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <Upload className="size-4" />
                )}{" "}
                Enviar arquivos
              </Button>
              <input
                ref={fileRef}
                type="file"
                multiple
                accept="image/*,video/mp4,video/quicktime"
                className="hidden"
                onChange={(e) =>
                  e.target.files && uploadFiles(e.target.files).then(() => (e.target.value = ""))
                }
              />
            </div>
          )
        }
      />
      <div className="mb-6">
        <HowTo title={GUIDES.library.title} steps={GUIDES.library.steps} references={GUIDES.library.references ?? []} />
      </div>

      <div
        className={cn(
          "space-y-4 rounded-xl transition",
          dragging && "outline-dashed outline-2 outline-primary",
        )}
        onDragOver={(e) => {
          if (!canEdit) return;
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          if (canEdit && e.dataTransfer.files.length) uploadFiles(e.dataTransfer.files);
        }}
      >
        <div className="flex gap-2">
          <Button size="sm" variant={view === "media" ? "default" : "outline"} onClick={() => setView("media")}>
            Imagens e vídeos
          </Button>
          <Button size="sm" variant={view === "texts" ? "default" : "outline"} onClick={() => setView("texts")}>
            Textos (copies, legendas, roteiros)
          </Button>
        </div>
        {view === "texts" ? (
          <LibraryTexts workspaceId={workspaceId} brandId={f.brand} />
        ) : (
        <>
        <div className="panel flex flex-wrap items-end gap-2 p-3">
          <div className="min-w-48 flex-1">
            <Label className="text-xs">Buscar</Label>
            <Input
              placeholder="Título ou prompt"
              value={f.q}
              onChange={(e) => setF({ ...f, q: e.target.value })}
              className="h-9"
            />
          </div>
          <Filter
            label="Marca"
            value={f.brand}
            onChange={(v) => setF({ ...f, brand: v })}
            options={(data?.brands ?? []).map((b) => [b.id, b.name])}
          />
          <Filter
            label="Campanha"
            value={f.campaign}
            onChange={(v) => setF({ ...f, campaign: v })}
            options={(data?.campaigns ?? []).map((c) => [c.id, c.name])}
          />
          <Filter
            label="Tipo"
            value={f.kind}
            onChange={(v) => setF({ ...f, kind: v })}
            options={[
              ["image", "Imagem"],
              ["video", "Vídeo"],
            ]}
          />
          <Filter
            label="Formato"
            value={f.format}
            onChange={(v) => setF({ ...f, format: v })}
            options={[
              ...TARGET_FORMAT_KEYS.map((k) => [k, TARGET_FORMATS[k].short] as [string, string]),
              ["other", "Outro"],
            ]}
          />
          <Filter
            label="Status"
            value={f.status}
            onChange={(v) => setF({ ...f, status: v })}
            all="Todos"
            options={[["active", "Ativos"], ...Object.entries(STATUS)]}
          />
          <Filter
            label="Tag"
            value={f.tag}
            onChange={(v) => setF({ ...f, tag: v })}
            options={tags.map((t) => [t, t])}
          />
          <Filter
            label="Pasta"
            value={f.folder}
            onChange={(v) => setF({ ...f, folder: v })}
            options={folders.map((t) => [t, t])}
          />
          <Filter
            label="Fonte"
            value={f.source}
            onChange={(v) => setF({ ...f, source: v })}
            options={Object.entries(SOURCE)}
          />
          <Filter
            label="Período"
            value={f.period}
            onChange={(v) => setF({ ...f, period: v })}
            options={[
              ["7", "7 dias"],
              ["30", "30 dias"],
              ["90", "90 dias"],
            ]}
          />
          <Filter
            label="Ordenar"
            value={f.sort}
            onChange={(v) => setF({ ...f, sort: v || "new" })}
            all={null}
            options={[
              ["new", "Mais recentes"],
              ["old", "Mais antigas"],
              ["title", "Título"],
              ["size", "Maior peso"],
            ]}
          />
          {canEdit && f.folder && (
            <Button size="sm" variant="ghost" onClick={() => renameFacet("folder")}>
              Renomear pasta
            </Button>
          )}
          {canEdit && f.tag && (
            <Button size="sm" variant="ghost" onClick={() => renameFacet("tag")}>
              Renomear tag
            </Button>
          )}
        </div>

        {picked.length > 0 && (
          <div className="panel sticky top-2 z-10 flex flex-wrap items-center gap-2 p-2.5">
            <span className="px-2 text-sm font-medium">
              {picked.length} selecionada{picked.length > 1 ? "s" : ""}
            </span>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button size="sm" variant="outline" disabled={!!busy}>
                  <Download className="size-4" /> Baixar
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent>
                <DropdownMenuItem onClick={() => downloadSelected("original")}>
                  Original (MP4/JPG/PNG)
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => downloadSelected("jpg")}>
                  Imagens em JPG
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => downloadSelected("png")}>
                  Imagens em PNG
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button size="sm" variant="outline" disabled={!!busy}>
                  {busy === "pdf" ? (
                    <Loader2 className="size-4 animate-spin" />
                  ) : (
                    <FileText className="size-4" />
                  )}{" "}
                  Exportar PDF
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent>
                {(["one_per_page", "contact_sheet"] as const).map((layout) => (
                  <DropdownMenuItem
                    key={layout}
                    onClick={() =>
                      run(
                        "pdf",
                        async () => {
                          const r = await fns.pdf({
                            data: { workspaceId, assetIds: picked, layout },
                          });
                          triggerDownload(r.url);
                          return r;
                        },
                        "PDF pronto.",
                      )
                    }
                  >
                    {layout === "one_per_page"
                      ? "Uma por página (tamanho real)"
                      : "Folha de contato (grade 2x3)"}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
            <Button
              size="sm"
              variant="outline"
              disabled={!!busy}
              onClick={() =>
                run(
                  "zip",
                  async () => {
                    const r = await fns.zip({ data: { workspaceId, assetIds: picked } });
                    triggerDownload(r.url);
                    return r;
                  },
                  "ZIP pronto.",
                )
              }
            >
              {busy === "zip" ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <Download className="size-4" />
              )}{" "}
              Baixar ZIP
            </Button>
            {canEdit && (
              <>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={!!busy}
                  onClick={() => bulkUpdate({ status: "approved" }, "Mídias aprovadas.")}
                >
                  <CheckCircle2 className="size-4" /> Aprovar
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={!!busy}
                  onClick={() => bulkUpdate({ status: "archived" }, "Mídias arquivadas.")}
                >
                  <Archive className="size-4" /> Arquivar
                </Button>
                <Button size="sm" variant="outline" disabled={!!busy} onClick={() => removeAssets(picked)}>
                  <X className="size-4" /> Excluir
                </Button>
                <Button size="sm" variant="outline" disabled={!!busy} onClick={() => revalidate(picked)}>
                  {busy === "revalidate" ? <Loader2 className="size-4 animate-spin" /> : <CheckCircle2 className="size-4" />} Revalidar
                </Button>
                <Button size="sm" variant="outline" disabled={!!busy} onClick={moveFolder}>
                  <FolderInput className="size-4" /> Mover para pasta
                </Button>
                <Button size="sm" variant="outline" disabled={!!busy} onClick={addTag}>
                  <Tag className="size-4" /> Adicionar tags
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={!!busy}
                  onClick={() =>
                    run(
                      "ig",
                      async () => {
                        const r = await fns.ig({ data: { workspaceId, assetIds: picked } });
                        navigate({ to: "/instagram" });
                        return r;
                      },
                      "Post rascunho criado no Instagram (Calendário).",
                    )
                  }
                >
                  <Instagram className="size-4" /> Usar no Instagram
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={!!busy}
                  onClick={() => setCampaignDialog(true)}
                >
                  <Megaphone className="size-4" /> Usar em campanha
                </Button>
                <SendToCanvaButton workspaceId={workspaceId} assetIds={picked} disabled={!!busy} />
              </>
            )}
            <Button size="sm" variant="ghost" onClick={() => setPicked([])}>
              <X className="size-4" /> Limpar
            </Button>
          </div>
        )}

        {isLoading ? (
          <div className="grid grid-cols-2 gap-4 md:grid-cols-4 xl:grid-cols-5">
            {Array.from({ length: 10 }).map((_, i) => (
              <div key={i} className="aspect-square animate-pulse rounded-lg bg-muted" />
            ))}
          </div>
        ) : list.length === 0 ? (
          <EmptyState
            title={
              assets.length ? "Nada encontrado com estes filtros" : "Sua biblioteca está vazia"
            }
            description={
              assets.length
                ? "Limpe alguns filtros para ver mais mídias."
                : "Gere criativos no Creative Studio ou arraste arquivos para cá. Tudo é padronizado no tamanho certo."
            }
          />
        ) : (
          <>
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <Checkbox
                checked={picked.length === list.length}
                onCheckedChange={(v) => setPicked(v ? list.map((a) => a.id) : [])}
                aria-label="Selecionar todas"
              />
              {list.length} de {data?.total ?? list.length} mídia{(data?.total ?? 0) > 1 ? "s" : ""}
            </div>
            <div className="grid grid-cols-2 gap-4 md:grid-cols-4 xl:grid-cols-5">
              {list.map((a) => (
                <AssetCard
                  key={a.id}
                  a={a}
                  picked={picked.includes(a.id)}
                  onPick={() => toggle(a.id)}
                  onOpen={() => setOpenId(a.id)}
                />
              ))}
            </div>
            {hasMore && (
              <div className="flex justify-center">
                <Button variant="outline" onClick={() => setPages((n) => n + 1)}>
                  Carregar mais
                </Button>
              </div>
            )}
          </>
        )}
        </>
        )}
      </div>

      <Sheet open={!!open} onOpenChange={(v) => !v && setOpenId(null)}>
        <SheetContent className="w-full overflow-y-auto sm:max-w-xl">
          {open && (
            <AssetDetail
              workspaceId={workspaceId}
              onDelete={() => removeAssets([open.id])}
              a={open}
              versions={assets
                .filter(
                  (x) =>
                    x.parent_id === open.id ||
                    (open.parent_id && (x.id === open.parent_id || x.parent_id === open.parent_id)),
                )
                .filter((x) => x.id !== open.id)}
              canEdit={canEdit}
              busy={busy}
              onDownload={(fmt) => downloadOne(open.id, fmt)}
              onReformat={(targets) =>
                run(
                  "reformat",
                  async () => {
                    const r = await fns.reformat({
                      data: { workspaceId, assetId: open.id, targets },
                    });
                    refresh();
                    return r;
                  },
                  (r) =>
                    `${r.ids.length} versão${r.ids.length > 1 ? "ões" : ""} criada${r.ids.length > 1 ? "s" : ""} sem gastar créditos de IA.`,
                )
              }
              onOpenVersion={(id) => setOpenId(id)}
              onRevalidate={() => revalidate([open.id])}
            />
          )}
        </SheetContent>
      </Sheet>

      <Dialog open={campaignDialog} onOpenChange={setCampaignDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Usar em qual campanha?</DialogTitle>
          </DialogHeader>
          {(data?.campaigns ?? []).length === 0 ? (
            <p className="text-sm text-muted-foreground">Nenhuma campanha criada ainda.</p>
          ) : (
            <div className="space-y-2">
              {(data?.campaigns ?? []).map((c) => (
                <Button
                  key={c.id}
                  variant="outline"
                  className="w-full justify-start"
                  disabled={!!busy}
                  onClick={() =>
                    run(
                      "campaign",
                      async () => {
                        const r = await fns.campaign({
                          data: { workspaceId, assetIds: picked, campaignId: c.id },
                        });
                        setCampaignDialog(false);
                        refresh();
                        return r;
                      },
                      (r) =>
                        `${r.count} criativo${r.count > 1 ? "s" : ""} aprovado${r.count > 1 ? "s" : ""} adicionado${r.count > 1 ? "s" : ""} à campanha.`,
                    )
                  }
                >
                  {c.name}
                </Button>
              ))}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}

function Filter({
  label,
  value,
  onChange,
  options,
  all = "Todos",
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: [string, string][];
  all?: string | null;
}) {
  return (
    <div>
      <Label className="text-xs">{label}</Label>
      <select
        className={cn(sel, "block w-full min-w-28")}
        value={value}
        onChange={(e) => onChange(e.target.value)}
      >
        {all !== null && <option value="">{all}</option>}
        {options.map(([v, l]) => (
          <option key={v} value={v}>
            {l}
          </option>
        ))}
      </select>
    </div>
  );
}

const ASPECT_CLASS: Record<string, string> = {
  ig_feed_square: "aspect-square",
  meta_ad_square: "aspect-square",
  ig_feed_portrait: "aspect-[4/5]",
  meta_ad_vertical: "aspect-[4/5]",
  ig_story: "aspect-[9/16]",
  ig_reel: "aspect-[9/16]",
  meta_ad_landscape: "aspect-[1200/628]",
};

function Media({ a, className, controls }: { a: Asset; className?: string; controls?: boolean }) {
  if (a.kind === "video")
    return (
      <video
        src={a.url ?? undefined}
        controls={controls}
        muted={!controls}
        preload="metadata"
        className={cn("w-full bg-muted object-cover", className)}
      />
    );
  return (
    <img
      src={(controls ? a.url : a.thumbnail_url) ?? a.url ?? ""}
      alt={a.title}
      loading="lazy"
      className={cn("w-full bg-muted object-cover", className)}
    />
  );
}

function ReadyBadge({ a }: { a: Asset }) {
  const issues = a.quality_report?.issues ?? [];
  if (a.ig_ready)
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-success/15 px-2 py-0.5 text-[11px] font-medium text-success">
        <CheckCircle2 className="size-3" /> Pronto p/ Instagram
      </span>
    );
  return (
    <span
      title={issues.join(" ") || "Ainda não validado."}
      className="inline-flex items-center gap-1 rounded-full bg-destructive/15 px-2 py-0.5 text-[11px] font-medium text-destructive"
    >
      <TriangleAlert className="size-3" /> {issues.length ? "Fora do padrão" : "Não validado"}
    </span>
  );
}

function AssetCard({
  a,
  picked,
  onPick,
  onOpen,
}: {
  a: Asset;
  picked: boolean;
  onPick: () => void;
  onOpen: () => void;
}) {
  return (
    <div
      className={cn(
        "group overflow-hidden rounded-lg border bg-surface/50 transition",
        picked ? "border-primary ring-2 ring-primary" : "border-border",
      )}
    >
      <div className="relative">
        <button type="button" onClick={onOpen} className="block w-full">
          <Media a={a} className={ASPECT_CLASS[a.target_format] ?? "aspect-square"} />
        </button>
        <div className="absolute left-2 top-2">
          <Checkbox
            checked={picked}
            onCheckedChange={onPick}
            aria-label={`Selecionar ${a.title}`}
            className="bg-background/90"
          />
        </div>
        <span className="absolute right-2 top-2 rounded bg-background/85 px-1.5 py-0.5 text-[11px] font-medium">
          {formatLabel(a.target_format)}
        </span>
        {a.kind === "video" && (
          <span className="absolute bottom-2 right-2 inline-flex items-center gap-1 rounded bg-background/85 px-1.5 py-0.5 text-[11px]">
            <Play className="size-3" />{" "}
            {a.duration_seconds ? `${Math.round(Number(a.duration_seconds))}s` : "vídeo"}
          </span>
        )}
      </div>
      <button type="button" onClick={onOpen} className="block w-full space-y-1.5 p-2.5 text-left">
        <p className="truncate text-sm font-medium">{a.title}</p>
        <p className="truncate text-xs text-muted-foreground">
          {a.brands?.name ?? "Sem marca"}
          {a.campaigns?.name ? ` · ${a.campaigns.name}` : ""}
        </p>
        <ReadyBadge a={a} />
      </button>
    </div>
  );
}

function AssetDetail({
  a,
  versions,
  canEdit,
  busy,
  onDownload,
  onReformat,
  onOpenVersion,
  onRevalidate,
  workspaceId,
  onDelete,
}: {
  workspaceId: string;
  onDelete: () => void;
  a: Asset;
  versions: Asset[];
  canEdit: boolean;
  busy: string | null;
  onDownload: (f: "original" | "png" | "jpg") => void;
  onReformat: (targets: TargetFormat[]) => void;
  onOpenVersion: (id: string) => void;
  onRevalidate: () => void;
}) {
  const [target, setTarget] = useState<TargetFormat>("ig_feed_portrait");
  const checks = (a.quality_report?.checks ?? {}) as Record<string, unknown>;
  const rows: [string, string][] = [
    ["Formato", formatLabel(a.target_format)],
    ["Dimensões", a.width && a.height ? `${a.width} x ${a.height}px` : "—"],
    ["Peso", formatBytes(a.size_bytes)],
    ["Tipo de arquivo", a.mime ?? "—"],
    ...(a.kind === "video"
      ? ([
          ["Duração", a.duration_seconds ? `${a.duration_seconds}s` : "—"],
          ["Resolução", String(checks["resolution"] ?? "—")],
          [
            "Codec",
            [checks["videoCodec"], checks["audioCodec"]].filter(Boolean).join(" / ") || "—",
          ],
          ["Quadros/s", checks["fps"] ? String(checks["fps"]) : "—"],
        ] as [string, string][])
      : []),
    ["Fonte", SOURCE[a.source] ?? a.source],
    ["Custo", a.cost != null ? brl(a.cost) : "—"],
    ["Marca", a.brands?.name ?? "—"],
    ["Campanha", a.campaigns?.name ?? "—"],
    ["Ângulo da estratégia", a.angle ?? "—"],
    ["Pasta", a.folder ?? "—"],
    ["Tags", a.tags?.length ? a.tags.join(", ") : "—"],
    ["Criada em", new Date(a.created_at).toLocaleString("pt-BR")],
  ];
  const issues = a.quality_report?.issues ?? [];
  return (
    <>
      <SheetHeader>
        <SheetTitle className="pr-6">{a.title}</SheetTitle>
      </SheetHeader>
      <div className="mt-4 space-y-5">
        <div className="mx-auto max-w-sm overflow-hidden rounded-lg border border-border">
          <Media a={a} controls className={ASPECT_CLASS[a.target_format] ?? ""} />
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <ReadyBadge a={a} />
          <StatusPill status={a.status} label={STATUS[a.status] ?? a.status} />
          {canEdit && (
            <Button size="sm" variant="ghost" className="ml-auto text-destructive" disabled={!!busy} onClick={onDelete}>
              Excluir
            </Button>
          )}
        </div>
        <div className="rounded-md border border-border/60 p-3">
          <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-primary">Resultados nos anúncios</p>
          <AssetAdResults workspaceId={workspaceId} creativeId={a.creative_id} />
        </div>
        {!a.ig_ready && (
          <div className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-xs text-destructive">
            {issues.length ? (
              issues.map((i) => <p key={i}>• {i}</p>)
            ) : (
              <p>Esta mídia ainda não passou pela validação (item antigo).</p>
            )}
          </div>
        )}
        <div className="flex flex-wrap gap-2">
          <Button
            size="sm"
            variant="outline"
            onClick={() => onDownload("original")}
            disabled={!!busy}
          >
            <Download className="size-4" /> {a.kind === "video" ? "Baixar MP4" : "Baixar original"}
          </Button>
          {a.kind === "image" && (
            <>
              <Button
                size="sm"
                variant="outline"
                onClick={() => onDownload("jpg")}
                disabled={!!busy}
              >
                JPG
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={() => onDownload("png")}
                disabled={!!busy}
              >
                PNG
              </Button>
            </>
          )}
        </div>

        {canEdit && a.kind === "image" && (
          <div className="space-y-2 rounded-lg border border-border p-3">
            <p className="text-sm font-medium">Outros formatos (sem gastar créditos de IA)</p>
            <div className="flex flex-wrap gap-2">
              <select
                className={sel}
                value={target}
                onChange={(e) => setTarget(e.target.value as TargetFormat)}
              >
                {TARGET_FORMAT_KEYS.map((k) => (
                  <option key={k} value={k}>
                    {TARGET_FORMATS[k].label}
                  </option>
                ))}
              </select>
              <Button
                size="sm"
                variant="outline"
                disabled={!!busy}
                onClick={() => onReformat([target])}
              >
                {busy === "reformat" && <Loader2 className="size-4 animate-spin" />} Gerar variação
                neste formato
              </Button>
            </div>
            <Button size="sm" variant="outline" disabled={!!busy} onClick={onRevalidate}>
              {busy === "revalidate" && <Loader2 className="size-4 animate-spin" />} Revalidar
            </Button>
            <Button size="sm" disabled={!!busy} onClick={() => onReformat(IG_FORMATS)}>
              Redimensionar para todos os formatos do Instagram
            </Button>
            <p className="text-xs text-muted-foreground">
              O corte é centralizado. Para vídeos, gere um novo vídeo no formato desejado.
            </p>
          </div>
        )}

        <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
          {rows.map(([k, v]) => (
            <div key={k} className="contents">
              <dt className="text-muted-foreground">{k}</dt>
              <dd className="break-words">{v}</dd>
            </div>
          ))}
        </dl>

        {a.prompt && (
          <div className="space-y-1">
            <p className="text-sm font-medium">Prompt usado</p>
            <p className="whitespace-pre-wrap rounded-md bg-muted/50 p-3 text-xs text-muted-foreground">
              {a.prompt}
            </p>
          </div>
        )}

        {versions.length > 0 && (
          <div className="space-y-2">
            <p className="text-sm font-medium">Versões em outros formatos</p>
            <div className="grid grid-cols-3 gap-2">
              {versions.map((v) => (
                <button
                  key={v.id}
                  type="button"
                  onClick={() => onOpenVersion(v.id)}
                  className="overflow-hidden rounded border border-border text-left"
                >
                  <Media a={v} className="aspect-square" />
                  <p className="truncate px-1.5 py-1 text-[11px]">{formatLabel(v.target_format)}</p>
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
    </>
  );
}
