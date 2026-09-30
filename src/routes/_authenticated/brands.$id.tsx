import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Plus, Trash2, Upload } from "lucide-react";

const ASSET_KINDS = [
  { kind: "logo", label: "Logo" },
  { kind: "identity", label: "Identidade visual" },
  { kind: "photo", label: "Foto de referência" },
];
import { supabase } from "@/integrations/supabase/client";
import { useWorkspace, logActivity } from "@/lib/workspace";
import { PageHeader, Section } from "@/components/ui-bits";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { brl } from "@/lib/format";

export const Route = createFileRoute("/_authenticated/brands/$id")({
  head: () => ({
    meta: [
      { title: "Brand Kit · Meu Funil" },
      { name: "description", content: "DNA da marca: identidade, produtos, personas, tom de voz e aprendizados." },
      { property: "og:title", content: "Brand Kit · Meu Funil" },
      { property: "og:description", content: "O contexto que alimenta todos os agentes de IA." },
    ],
  }),
  component: BrandDetail,
});

type BrandForm = Record<string, string>;

const FIELDS: { key: string; label: string; long?: boolean; placeholder?: string }[] = [
  { key: "name", label: "Nome da empresa" },
  { key: "website", label: "Site" },
  { key: "segment", label: "Segmento" },
  { key: "region", label: "Região geográfica atendida" },
  { key: "description", label: "Descrição do negócio", long: true },
  { key: "differentials", label: "Diferenciais", long: true },
  { key: "target_audience", label: "Público-alvo", long: true },
  { key: "competitors", label: "Concorrentes", long: true },
  { key: "tone_of_voice", label: "Tom de voz", long: true },
  { key: "past_campaigns", label: "Exemplos de campanhas anteriores", long: true },
];

function BrandDetail() {
  const { id } = Route.useParams();
  const { workspaceId, canEdit } = useWorkspace();
  const qc = useQueryClient();
  const [form, setForm] = useState<BrandForm>({});
  const [preferred, setPreferred] = useState("");
  const [banned, setBanned] = useState("");
  const [saving, setSaving] = useState(false);

  const { data: brand } = useQuery({
    queryKey: ["brand", id],
    queryFn: async () => {
      const { data, error } = await supabase.from("brands").select("*").eq("id", id).single();
      if (error) throw error;
      return data;
    },
  });

  const { data: products = [] } = useQuery({
    queryKey: ["products", id],
    queryFn: async () => (await supabase.from("products").select("*").eq("brand_id", id).order("created_at")).data ?? [],
  });

  const { data: personas = [] } = useQuery({
    queryKey: ["personas", id],
    queryFn: async () => (await supabase.from("personas").select("*").eq("brand_id", id).order("created_at")).data ?? [],
  });

  const { data: assets = [] } = useQuery({
    queryKey: ["assets", id],
    queryFn: async () => (await supabase.from("brand_assets").select("*").eq("brand_id", id).order("created_at")).data ?? [],
  });

  const { data: learnings = [] } = useQuery({
    queryKey: ["learnings", id],
    queryFn: async () => (await supabase.from("brand_learnings").select("*").eq("brand_id", id).order("score", { ascending: false })).data ?? [],
  });

  useEffect(() => {
    if (!brand) return;
    const f: BrandForm = {};
    for (const k of FIELDS) f[k.key] = (brand as Record<string, unknown>)[k.key] as string ?? "";
    f["primary_color"] = brand.primary_color ?? "#4F46E5";
    f["secondary_color"] = brand.secondary_color ?? "#0EA5E9";
    f["typography"] = brand.typography ?? "";
    f["logo_url"] = brand.logo_url ?? "";
    setForm(f);
    setPreferred((brand.preferred_words ?? []).join(", "));
    setBanned((brand.banned_words ?? []).join(", "));
  }, [brand]);

  const save = async () => {
    setSaving(true);
    const payload = {
      ...form,
      preferred_words: preferred.split(",").map((s) => s.trim()).filter(Boolean),
      banned_words: banned.split(",").map((s) => s.trim()).filter(Boolean),
    };
    const { error } = await supabase.from("brands").update(payload).eq("id", id);
    setSaving(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    if (workspaceId) await logActivity(workspaceId, "brand.updated", "brand", { brand_id: id });
    qc.invalidateQueries({ queryKey: ["brand", id] });
    toast.success("Brand Brain atualizado. Os agentes já usam o novo contexto.");
  };

  const addProduct = async () => {
    if (!workspaceId) return;
    await supabase.from("products").insert({ workspace_id: workspaceId, brand_id: id, name: "Novo produto", price: 0, margin_percent: 0 });
    qc.invalidateQueries({ queryKey: ["products", id] });
  };

  const addPersona = async () => {
    if (!workspaceId) return;
    await supabase.from("personas").insert({ workspace_id: workspaceId, brand_id: id, name: "Nova persona" });
    qc.invalidateQueries({ queryKey: ["personas", id] });
  };

  const [uploading, setUploading] = useState<string | null>(null);
  const uploadAssets = async (kind: string, files: FileList | null) => {
    if (!workspaceId || !files?.length) return;
    setUploading(kind);
    let ok = 0;
    for (const file of Array.from(files)) {
      if (!file.type.startsWith("image/") && file.type !== "application/pdf") {
        toast.error(`${file.name}: envie uma imagem (JPG, PNG, SVG, WEBP) ou PDF.`);
        continue;
      }
      if (file.size > 20 * 1024 * 1024) {
        toast.error(`${file.name}: máximo de 20 MB.`);
        continue;
      }
      const ext = file.name.split(".").pop()?.toLowerCase() || "png";
      const path = `brands/${workspaceId}/${id}/${kind}/${crypto.randomUUID()}.${ext}`;
      const up = await supabase.storage.from("creative-assets").upload(path, file, { contentType: file.type });
      if (up.error) {
        toast.error(`Falha ao enviar ${file.name}.`);
        continue;
      }
      const { data: signed } = await supabase.storage
        .from("creative-assets")
        .createSignedUrl(path, 60 * 60 * 24 * 365 * 5);
      const url = signed?.signedUrl ?? "";
      await supabase.from("brand_assets").insert({ workspace_id: workspaceId, brand_id: id, kind, url, name: file.name });
      if (kind === "logo") {
        await supabase.from("brands").update({ logo_url: url }).eq("id", id);
        qc.invalidateQueries({ queryKey: ["brand", id] });
      }
      ok++;
    }
    setUploading(null);
    if (ok) toast.success(ok === 1 ? "Arquivo enviado." : `${ok} arquivos enviados.`);
    qc.invalidateQueries({ queryKey: ["assets", id] });
  };

  if (!brand) return <div className="panel h-64 animate-pulse" />;

  return (
    <>
      <PageHeader
        title={brand.name}
        subtitle="Brand Kit / DNA da marca — tudo aqui vira contexto para estratégia, copy e criativos."
        actions={
          <>
            <Button variant="outline" asChild>
              <Link to="/brands">Voltar</Link>
            </Button>
            {canEdit && (
              <Button onClick={save} disabled={saving}>
                {saving ? "Salvando..." : "Salvar Brand Brain"}
              </Button>
            )}
          </>
        }
      />

      <Tabs defaultValue="dna">
        <TabsList className="mb-6">
          <TabsTrigger value="dna">DNA</TabsTrigger>
          <TabsTrigger value="identidade">Identidade visual</TabsTrigger>
          <TabsTrigger value="produtos">Produtos</TabsTrigger>
          <TabsTrigger value="personas">Personas</TabsTrigger>
          <TabsTrigger value="aprendizados">Aprendizados</TabsTrigger>
        </TabsList>

        <TabsContent value="dna" className="space-y-6">
          <Section title="Negócio">
            <div className="grid gap-4 md:grid-cols-2">
              {FIELDS.map((f) => (
                <div key={f.key} className={f.long ? "md:col-span-2 space-y-1.5" : "space-y-1.5"}>
                  <Label htmlFor={f.key}>{f.label}</Label>
                  {f.long ? (
                    <Textarea
                      id={f.key}
                      rows={3}
                      value={form[f.key] ?? ""}
                      onChange={(e) => setForm({ ...form, [f.key]: e.target.value })}
                    />
                  ) : (
                    <Input
                      id={f.key}
                      value={form[f.key] ?? ""}
                      onChange={(e) => setForm({ ...form, [f.key]: e.target.value })}
                    />
                  )}
                </div>
              ))}
            </div>
          </Section>

          <Section title="Linguagem" description="Guarda-corpo do Copy Engine.">
            <div className="grid gap-4 md:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="pw">Palavras que deve usar</Label>
                <Textarea id="pw" rows={2} value={preferred} onChange={(e) => setPreferred(e.target.value)} placeholder="separadas por vírgula" />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="bw">Palavras proibidas</Label>
                <Textarea id="bw" rows={2} value={banned} onChange={(e) => setBanned(e.target.value)} placeholder="separadas por vírgula" />
              </div>
            </div>
          </Section>
        </TabsContent>

        <TabsContent value="identidade" className="space-y-6">
          <Section title="Cores e tipografia">
            <div className="grid gap-4 md:grid-cols-3">
              <div className="space-y-1.5">
                <Label htmlFor="pc">Cor primária</Label>
                <div className="flex gap-2">
                  <input
                    type="color"
                    id="pc"
                    className="h-9 w-12 rounded-md border border-border bg-transparent"
                    value={form["primary_color"] ?? "#4F46E5"}
                    onChange={(e) => setForm({ ...form, primary_color: e.target.value })}
                  />
                  <Input value={form["primary_color"] ?? ""} onChange={(e) => setForm({ ...form, primary_color: e.target.value })} />
                </div>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="sc">Cor secundária</Label>
                <div className="flex gap-2">
                  <input
                    type="color"
                    id="sc"
                    className="h-9 w-12 rounded-md border border-border bg-transparent"
                    value={form["secondary_color"] ?? "#0EA5E9"}
                    onChange={(e) => setForm({ ...form, secondary_color: e.target.value })}
                  />
                  <Input value={form["secondary_color"] ?? ""} onChange={(e) => setForm({ ...form, secondary_color: e.target.value })} />
                </div>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="ty">Tipografia</Label>
                <Input id="ty" value={form["typography"] ?? ""} onChange={(e) => setForm({ ...form, typography: e.target.value })} />
              </div>
            </div>
          </Section>

          <Section
            title="Logo, identidade visual e referências"
            description="Envie os arquivos do seu computador. Eles entram no contexto usado pela IA para criar os criativos."
            actions={
              canEdit && (
                <div className="flex flex-wrap gap-2">
                  {ASSET_KINDS.map((k) => (
                    <Button key={k.kind} size="sm" variant="outline" asChild disabled={!!uploading}>
                      <label className="cursor-pointer">
                        <Upload className="mr-1 size-3.5" />
                        {uploading === k.kind ? "Enviando..." : k.label}
                        <input
                          type="file"
                          accept="image/*,application/pdf"
                          multiple={k.kind !== "logo"}
                          className="hidden"
                          onChange={(e) => {
                            void uploadAssets(k.kind, e.target.files);
                            e.target.value = "";
                          }}
                        />
                      </label>
                    </Button>
                  ))}
                </div>
              )
            }
          >
            {assets.length === 0 ? (
              <p className="text-sm text-muted-foreground">Nenhum arquivo enviado ainda.</p>
            ) : (
              <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-5">
                {assets.map((a) => (
                  <div key={a.id} className="overflow-hidden rounded-lg border border-border">
                    {a.name?.toLowerCase().endsWith(".pdf") ? (
                      <a href={a.url ?? "#"} target="_blank" rel="noreferrer" className="flex aspect-square w-full items-center justify-center bg-muted text-xs font-semibold text-muted-foreground">
                        PDF
                      </a>
                    ) : (
                      <img src={a.url ?? ""} alt={a.name ?? "Arquivo da marca"} className="aspect-square w-full bg-muted object-contain" />
                    )}
                    <div className="flex items-center justify-between px-2 py-1.5">
                      <span className="truncate text-[11px] text-muted-foreground" title={a.name ?? ""}>
                        {ASSET_KINDS.find((k) => k.kind === a.kind)?.label ?? a.kind}
                      </span>
                      <button
                        onClick={async () => {
                          await supabase.from("brand_assets").delete().eq("id", a.id);
                          qc.invalidateQueries({ queryKey: ["assets", id] });
                        }}
                        aria-label="Remover"
                      >
                        <Trash2 className="size-3.5 text-muted-foreground hover:text-destructive" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </Section>
        </TabsContent>

        <TabsContent value="produtos">
          <Section
            title="Produtos e serviços"
            actions={canEdit && <Button size="sm" variant="outline" onClick={addProduct}><Plus className="mr-1 size-3.5" /> Adicionar</Button>}
          >
            <div className="space-y-3">
              {products.map((p) => (
                <EditableRow
                  key={p.id}
                  fields={[
                    { key: "name", label: "Nome", value: p.name },
                    { key: "description", label: "Descrição", value: p.description ?? "" },
                    { key: "price", label: "Preço", value: String(p.price ?? "") , numeric: true},
                    { key: "margin_percent", label: "Margem %", value: String(p.margin_percent ?? ""), numeric: true },
                  ]}
                  footer={`Preço atual: ${brl(Number(p.price ?? 0))}`}
                  onSave={async (values) => {
                    await supabase.from("products").update({
                      name: values["name"] ?? "",
                      description: values["description"] ?? "",
                      price: Number(values["price"] ?? 0),
                      margin_percent: Number(values["margin_percent"] ?? 0),
                    }).eq("id", p.id);
                    qc.invalidateQueries({ queryKey: ["products", id] });
                    toast.success("Produto salvo");
                  }}
                  onDelete={async () => {
                    await supabase.from("products").delete().eq("id", p.id);
                    qc.invalidateQueries({ queryKey: ["products", id] });
                  }}
                />
              ))}
              {!products.length && <p className="text-sm text-muted-foreground">Nenhum produto cadastrado.</p>}
            </div>
          </Section>
        </TabsContent>

        <TabsContent value="personas">
          <Section
            title="Personas"
            actions={canEdit && <Button size="sm" variant="outline" onClick={addPersona}><Plus className="mr-1 size-3.5" /> Adicionar</Button>}
          >
            <div className="space-y-3">
              {personas.map((p) => (
                <EditableRow
                  key={p.id}
                  fields={[
                    { key: "name", label: "Nome", value: p.name },
                    { key: "age_range", label: "Faixa etária", value: p.age_range ?? "" },
                    { key: "location", label: "Localização", value: p.location ?? "" },
                    { key: "interests", label: "Interesses", value: p.interests ?? "" },
                    { key: "pains", label: "Dores", value: p.pains ?? "" },
                    { key: "desires", label: "Desejos", value: p.desires ?? "" },
                    { key: "segment_type", label: "B2B/B2C", value: p.segment_type ?? "B2C" },
                  ]}
                  onSave={async (values) => {
                    await supabase.from("personas").update({
                      name: values["name"] ?? "",
                      age_range: values["age_range"] ?? "",
                      location: values["location"] ?? "",
                      interests: values["interests"] ?? "",
                      pains: values["pains"] ?? "",
                      desires: values["desires"] ?? "",
                      segment_type: values["segment_type"] ?? "B2C",
                    }).eq("id", p.id);
                    qc.invalidateQueries({ queryKey: ["personas", id] });
                    toast.success("Persona salva");
                  }}
                  onDelete={async () => {
                    await supabase.from("personas").delete().eq("id", p.id);
                    qc.invalidateQueries({ queryKey: ["personas", id] });
                  }}
                />
              ))}
              {!personas.length && <p className="text-sm text-muted-foreground">Nenhuma persona cadastrada.</p>}
            </div>
          </Section>
        </TabsContent>

        <TabsContent value="aprendizados">
          <Section
            title="Learning loop"
            description="O que já funcionou para esta marca. Usado automaticamente como contexto ao gerar novas estratégias."
          >
            <div className="grid gap-3 md:grid-cols-2">
              {learnings.map((l) => (
                <div key={l.id} className="rounded-lg border border-border bg-surface/60 p-4">
                  <p className="text-[11px] uppercase tracking-wider text-primary">{l.category}</p>
                  <p className="mt-1 text-sm font-medium">{l.value}</p>
                  <p className="mt-1 text-xs text-muted-foreground">{l.metric} · score {l.score}</p>
                </div>
              ))}
              {!learnings.length && <p className="text-sm text-muted-foreground">Nenhum aprendizado registrado ainda.</p>}
            </div>
          </Section>
        </TabsContent>
      </Tabs>
    </>
  );
}

function EditableRow({
  fields,
  onSave,
  onDelete,
  footer,
}: {
  fields: { key: string; label: string; value: string; numeric?: boolean }[];
  onSave: (values: Record<string, string>) => Promise<void>;
  onDelete: () => Promise<void>;
  footer?: string;
}) {
  const [values, setValues] = useState<Record<string, string>>(
    Object.fromEntries(fields.map((f) => [f.key, f.value])),
  );
  return (
    <div className="rounded-lg border border-border bg-surface/50 p-4">
      <div className="grid gap-3 md:grid-cols-3">
        {fields.map((f) => (
          <div key={f.key} className="space-y-1">
            <Label className="text-xs">{f.label}</Label>
            <Input
              value={values[f.key] ?? ""}
              type={f.numeric ? "number" : "text"}
              onChange={(e) => setValues({ ...values, [f.key]: e.target.value })}
            />
          </div>
        ))}
      </div>
      <div className="mt-3 flex items-center justify-between">
        <span className="text-xs text-muted-foreground">{footer}</span>
        <div className="flex gap-2">
          <Button size="sm" variant="ghost" onClick={onDelete}>
            Remover
          </Button>
          <Button size="sm" variant="outline" onClick={() => onSave(values)}>
            Salvar
          </Button>
        </div>
      </div>
    </div>
  );
}
