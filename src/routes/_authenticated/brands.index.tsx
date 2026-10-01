import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useWorkspace, logActivity } from "@/lib/workspace";
import { PageHeader, EmptyState, Section } from "@/components/ui-bits";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { HowTo } from "@/components/how-to";
import { GUIDES } from "@/lib/guides";

export const Route = createFileRoute("/_authenticated/brands/")({
  head: () => ({
    meta: [
      { title: "Brands · Meu Funil" },
      { name: "description", content: "Marcas do workspace e o DNA que alimenta os agentes de IA." },
      { property: "og:title", content: "Brands · Meu Funil" },
      { property: "og:description", content: "Brand Brain: identidade, produtos, personas e tom de voz." },
    ],
  }),
  component: BrandsPage,
});

function BrandsPage() {
  const { workspaceId, canEdit } = useWorkspace();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [segment, setSegment] = useState("");
  const [deleting, setDeleting] = useState<{ id: string; name: string } | null>(null);
  const [deletingBusy, setDeletingBusy] = useState(false);

  const confirmDelete = async () => {
    if (!deleting || !workspaceId) return;
    setDeletingBusy(true);
    const { error } = await supabase.from("brands").delete().eq("id", deleting.id);
    setDeletingBusy(false);
    if (error) {
      toast.error("Não foi possível excluir: " + error.message);
      return;
    }
    await logActivity(workspaceId, "brand.deleted", "brand", { name: deleting.name });
    qc.invalidateQueries({ queryKey: ["brands", workspaceId] });
    setDeleting(null);
    toast.success(`Marca "${deleting.name}" excluída.`);
  };

  const { data: brands = [], isLoading } = useQuery({
    queryKey: ["brands", workspaceId],
    enabled: !!workspaceId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("brands")
        .select("*, campaigns(count), products(count)")
        .eq("workspace_id", workspaceId!)
        .order("created_at");
      if (error) throw error;
      return data;
    },
  });

  const create = async () => {
    if (!workspaceId || !name.trim()) return;
    const { data, error } = await supabase
      .from("brands")
      .insert({ workspace_id: workspaceId, name, segment })
      .select()
      .single();
    if (error) {
      toast.error(error.message);
      return;
    }
    await logActivity(workspaceId, "brand.created", "brand", { name });
    qc.invalidateQueries({ queryKey: ["brands", workspaceId] });
    setOpen(false);
    setName("");
    setSegment("");
    toast.success("Marca criada. Complete o Brand Brain.");
    navigate({ to: "/brands/$id", params: { id: data.id } });
  };

  return (
    <>
      <PageHeader
        title="Brands"
        subtitle="Cada marca guarda o DNA usado como contexto por todos os agentes de IA da plataforma."
        actions={canEdit && <Button onClick={() => setOpen(true)}>Nova marca</Button>}
      />
      <div className="mb-6">
        <HowTo title={GUIDES.brands.title} steps={GUIDES.brands.steps} references={GUIDES.brands.references ?? []} />
      </div>

      {isLoading ? (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="panel h-44 animate-pulse" />
          ))}
        </div>
      ) : brands.length === 0 ? (
        <EmptyState
          title="Nenhuma marca ainda"
          description="Crie a primeira marca para liberar o wizard de campanha, o copy engine e o Creative Studio."
          action={<Button onClick={() => setOpen(true)}>Criar marca</Button>}
        />
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {brands.map((b) => (
            <Link key={b.id} to="/brands/$id" params={{ id: b.id }} className="panel block p-5 transition-colors hover:border-primary/50">
              <div className="flex items-center gap-3">
                <span
                  className="size-10 shrink-0 rounded-xl"
                  style={{
                    background: `linear-gradient(135deg, ${b.primary_color ?? "#4F46E5"}, ${b.secondary_color ?? "#0EA5E9"})`,
                  }}
                />
                <div className="min-w-0">
                  <p className="truncate font-semibold">{b.name}</p>
                  <p className="truncate text-xs text-muted-foreground">{b.segment || "Segmento não definido"}</p>
                </div>
              </div>
              <p className="mt-4 line-clamp-2 text-sm text-muted-foreground">
                {b.description || "Sem descrição cadastrada."}
              </p>
              <div className="mt-4 flex items-center gap-4 text-xs text-muted-foreground">
                <span>{b.campaigns?.[0]?.count ?? 0} campanhas</span>
                <span>{b.products?.[0]?.count ?? 0} produtos</span>
                {canEdit && (
                  <button
                    type="button"
                    className="ml-auto text-destructive/80 transition-colors hover:text-destructive"
                    onClick={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      setDeleting({ id: b.id, name: b.name });
                    }}
                  >
                    Excluir
                  </button>
                )}
              </div>
            </Link>
          ))}
        </div>
      )}

      <Section title="Como o Brand Brain é usado" description="Contexto compartilhado por estratégia, copy e criativos.">
        <div className="grid gap-4 text-sm text-muted-foreground md:grid-cols-3">
          <p>O Agente Estrategista lê diferenciais, concorrentes, público e histórico para montar o plano.</p>
          <p>O Copy Engine respeita tom de voz, palavras preferidas e palavras proibidas em toda geração.</p>
          <p>O Creative Studio usa cores, tipografia e referências visuais nos prompts enviados ao provedor.</p>
        </div>
      </Section>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Nova marca</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="bname">Nome da empresa</Label>
              <Input id="bname" value={name} onChange={(e) => setName(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="bseg">Segmento</Label>
              <Input id="bseg" value={segment} onChange={(e) => setSegment(e.target.value)} />
            </div>
          </div>
          <DialogFooter>
            <Button onClick={create}>Criar marca</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!deleting} onOpenChange={(v) => !v && setDeleting(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Excluir marca</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            Tem certeza que deseja excluir a marca <strong className="text-foreground">{deleting?.name}</strong>?
            Campanhas, produtos, criativos e demais dados vinculados também serão removidos. Essa ação não pode ser desfeita.
          </p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleting(null)} disabled={deletingBusy}>
              Cancelar
            </Button>
            <Button variant="destructive" onClick={confirmDelete} disabled={deletingBusy}>
              {deletingBusy ? "Excluindo..." : "Excluir marca"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
