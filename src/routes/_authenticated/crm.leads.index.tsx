import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { Download, Upload, Plus } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useWorkspace } from "@/lib/workspace";
import { PageHeader } from "@/components/ui-bits";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { usePipelines, useStages, useLeads, useMembers } from "@/lib/crm-queries";
import { Select } from "@/routes/_authenticated/crm.index";
import { LEAD_SOURCES, TEMPERATURES } from "@/lib/crm";
import { brl, fullDate } from "@/lib/format";
import { useServerFn } from "@tanstack/react-start";
import { enrollLeads } from "@/lib/crm-cadences.functions";

export const Route = createFileRoute("/_authenticated/crm/leads/")({
  head: () => ({
    meta: [
      { title: "CRM · Lista de leads · Meu Funil" },
      { name: "description", content: "Filtre, edite em massa, importe e exporte leads do CRM." },
      { property: "og:title", content: "CRM · Lista de leads" },
      { property: "og:description", content: "Gestão de leads com ações em massa e CSV." },
    ],
  }),
  component: LeadsPage,
});

function LeadsPage() {
  const { workspaceId } = useWorkspace();
  const qc = useQueryClient();
  const { data: pipelines = [] } = usePipelines(workspaceId);
  const pipelineId = pipelines[0]?.id ?? null;
  const { data: stages = [] } = useStages(workspaceId, pipelineId);
  const { data: leads = [] } = useLeads(workspaceId, pipelineId);
  const { data: members = [] } = useMembers(workspaceId);
  const fileRef = useRef<HTMLInputElement>(null);
  const enroll = useServerFn(enrollLeads);
  const { data: cadences = [] } = useQuery({
    queryKey: ["crm-cadences-select", workspaceId],
    enabled: !!workspaceId,
    queryFn: async () => {
      const { data } = await supabase
        .from("crm_cadences")
        .select("id, name")
        .eq("workspace_id", workspaceId!)
        .order("name");
      return (data ?? []) as { id: string; name: string }[];
    },
  });

  const [search, setSearch] = useState("");
  const [stageFilter, setStageFilter] = useState("");
  const [sourceFilter, setSourceFilter] = useState("");
  const [selected, setSelected] = useState<string[]>([]);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ name: "", phone: "", email: "", city: "", source: "manual" });

  const rows = useMemo(
    () =>
      leads.filter((l) => {
        if (search && !`${l.name} ${l.phone ?? ""} ${l.email ?? ""}`.toLowerCase().includes(search.toLowerCase()))
          return false;
        if (stageFilter && l.stage_id !== stageFilter) return false;
        if (sourceFilter && l.source !== sourceFilter) return false;
        return true;
      }),
    [leads, search, stageFilter, sourceFilter],
  );

  const refresh = () => qc.invalidateQueries({ queryKey: ["crm-leads", workspaceId, pipelineId] });

  const bulk = async (
    patch: {
      stage_id?: string;
      owner_id?: string | null;
      ai_active?: boolean;
      stage_entered_at?: string;
    },
    label: string,
  ) => {
    if (!selected.length) {
      toast.error("Selecione ao menos um lead.");
      return;
    }
    const { error } = await supabase.from("crm_leads").update(patch).in("id", selected);
    if (error) {
      toast.error("Não foi possível aplicar a ação.");
      return;
    }
    toast.success(label);
    setSelected([]);
    refresh();
  };

  const addTag = async (tag: string) => {
    if (!tag || !selected.length) return;
    for (const id of selected) {
      const lead = leads.find((l) => l.id === id);
      if (!lead) continue;
      const tags = [...new Set([...(lead.tags ?? []), tag])];
      await supabase.from("crm_leads").update({ tags }).eq("id", id);
    }
    toast.success("Tag aplicada aos leads selecionados.");
    setSelected([]);
    refresh();
  };

  const exportCsv = () => {
    const header = ["nome", "telefone", "email", "cidade", "origem", "campanha", "etapa", "score", "temperatura", "valor"];
    const lines = rows.map((l) =>
      [
        l.name,
        l.phone ?? "",
        l.email ?? "",
        l.city ?? "",
        LEAD_SOURCES[l.source] ?? l.source,
        l.campaign_name ?? "",
        stages.find((s) => s.id === l.stage_id)?.name ?? "",
        l.score,
        l.temperature,
        l.estimated_value,
      ]
        .map((v) => `"${String(v).replace(/"/g, '""')}"`)
        .join(","),
    );
    const blob = new Blob([[header.join(","), ...lines].join("\n")], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "leads.csv";
    a.click();
    URL.revokeObjectURL(url);
  };

  const importCsv = async (file: File): Promise<void> => {
    if (!workspaceId) return;
    const text = await file.text();
    const [head, ...body] = text.trim().split(/\r?\n/);
    const cols = (head ?? "").split(",").map((c) => c.replace(/"/g, "").trim().toLowerCase());
    const payload = body
      .map((line) => {
        const cells = line.split(",").map((c) => c.replace(/^"|"$/g, "").replace(/""/g, '"').trim());
        const get = (k: string) => cells[cols.indexOf(k)] ?? "";
        return {
          workspace_id: workspaceId,
          pipeline_id: pipelineId,
          stage_id: stages[0]?.id ?? null,
          name: get("nome") || get("name") || "Sem nome",
          phone: get("telefone") || get("phone") || null,
          email: get("email") || null,
          city: get("cidade") || null,
          source: "import",
        };
      })
      .filter((r) => r.name);
    if (!payload.length) {
      toast.error("Arquivo sem linhas válidas.");
      return;
    }
    const { error } = await supabase.from("crm_leads").insert(payload);
    if (error) {
      toast.error("Falha ao importar o arquivo.");
      return;
    }
    toast.success(`${payload.length} leads importados.`);
    refresh();
  };

  const createLead = async (): Promise<void> => {
    if (!workspaceId || !form.name) {
      toast.error("Informe o nome do lead.");
      return;
    }
    const { error } = await supabase.from("crm_leads").insert({
      workspace_id: workspaceId,
      pipeline_id: pipelineId,
      stage_id: stages[0]?.id ?? null,
      ...form,
    });
    if (error) {
      toast.error("Não foi possível criar o lead.");
      return;
    }
    setOpen(false);
    setForm({ name: "", phone: "", email: "", city: "", source: "manual" });
    refresh();
    toast.success("Lead criado.");
  };

  return (
    <div>
      <PageHeader
        title="Leads"
        subtitle="Filtre, edite em massa, importe e exporte sua base."
        actions={
          <>
            <input
              ref={fileRef}
              type="file"
              accept=".csv"
              className="hidden"
              onChange={(e) => e.target.files?.[0] && importCsv(e.target.files[0])}
            />
            <Button variant="outline" size="sm" onClick={() => fileRef.current?.click()}>
              <Upload className="size-4" /> Importar CSV
            </Button>
            <Button variant="outline" size="sm" onClick={exportCsv}>
              <Download className="size-4" /> Exportar CSV
            </Button>
            <Dialog open={open} onOpenChange={setOpen}>
              <DialogTrigger asChild>
                <Button size="sm">
                  <Plus className="size-4" /> Novo lead
                </Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>Novo lead</DialogTitle>
                </DialogHeader>
                <div className="grid gap-3">
                  <div>
                    <Label>Nome</Label>
                    <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
                  </div>
                  <div>
                    <Label>Telefone (E.164)</Label>
                    <Input
                      placeholder="+5511999999999"
                      value={form.phone}
                      onChange={(e) => setForm({ ...form, phone: e.target.value })}
                    />
                  </div>
                  <div>
                    <Label>E-mail</Label>
                    <Input value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
                  </div>
                  <div>
                    <Label>Cidade</Label>
                    <Input value={form.city} onChange={(e) => setForm({ ...form, city: e.target.value })} />
                  </div>
                  <div>
                    <Label>Origem</Label>
                    <Select value={form.source} onChange={(v) => setForm({ ...form, source: v })}>
                      {Object.entries(LEAD_SOURCES).map(([k, v]) => (
                        <option key={k} value={k}>{v}</option>
                      ))}
                    </Select>
                  </div>
                  <Button onClick={createLead}>Criar lead</Button>
                </div>
              </DialogContent>
            </Dialog>
          </>
        }
      />

      <div className="mb-4 grid gap-2 md:grid-cols-3">
        <Input placeholder="Buscar lead" value={search} onChange={(e) => setSearch(e.target.value)} />
        <Select value={stageFilter} onChange={setStageFilter}>
          <option value="">Todas as etapas</option>
          {stages.map((s) => (
            <option key={s.id} value={s.id}>{s.name}</option>
          ))}
        </Select>
        <Select value={sourceFilter} onChange={setSourceFilter}>
          <option value="">Todas as origens</option>
          {Object.entries(LEAD_SOURCES).map(([k, v]) => (
            <option key={k} value={k}>{v}</option>
          ))}
        </Select>
      </div>

      {selected.length > 0 && (
        <div className="mb-4 flex flex-wrap items-center gap-2 rounded-lg border border-border bg-card p-3">
          <span className="text-sm text-muted-foreground">{selected.length} selecionados</span>
          <Select value="" onChange={(v) => v && bulk({ stage_id: v, stage_entered_at: new Date().toISOString() }, "Leads movidos.")}>
            <option value="">Mover para etapa…</option>
            {stages.map((s) => (
              <option key={s.id} value={s.id}>{s.name}</option>
            ))}
          </Select>
          <Select value="" onChange={(v) => v && bulk({ owner_id: v }, "Responsável atribuído.")}>
            <option value="">Atribuir responsável…</option>
            {members.map((m) => (
              <option key={m.user_id} value={m.user_id}>{m.label}</option>
            ))}
          </Select>
          <Select value="" onChange={addTag}>
            <option value="">Aplicar tag…</option>
            {["VIP", "Investidor", "Reengajar", "Baixo ticket"].map((t) => (
              <option key={t} value={t}>{t}</option>
            ))}
          </Select>
          <Select
            value=""
            onChange={async (v) => {
              if (!v || !workspaceId) return;
              try {
                const r = await enroll({ data: { workspaceId, cadenceId: v, leadIds: selected } });
                toast.success(`${r.enrolled} lead(s) incluído(s) na cadência.`);
                setSelected([]);
              } catch {
                toast.error("Não foi possível incluir na cadência.");
              }
            }}
          >
            <option value="">Incluir em cadência…</option>
            {cadences.map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </Select>
        </div>
      )}

      <div className="panel overflow-x-auto">
        <table className="w-full min-w-[900px] text-sm">
          <thead>
            <tr className="border-b border-border text-left text-xs uppercase tracking-wider text-muted-foreground">
              <th className="p-3">
                <input
                  type="checkbox"
                  checked={!!rows.length && selected.length === rows.length}
                  onChange={(e) => setSelected(e.target.checked ? rows.map((r) => r.id) : [])}
                />
              </th>
              <th className="p-3">Lead</th>
              <th className="p-3">Origem</th>
              <th className="p-3">Etapa</th>
              <th className="p-3">Score</th>
              <th className="p-3">Temperatura</th>
              <th className="p-3">Valor</th>
              <th className="p-3">Criado</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((l) => (
              <tr key={l.id} className="border-b border-border/60">
                <td className="p-3">
                  <input
                    type="checkbox"
                    checked={selected.includes(l.id)}
                    onChange={(e) =>
                      setSelected(e.target.checked ? [...selected, l.id] : selected.filter((id) => id !== l.id))
                    }
                  />
                </td>
                <td className="p-3">
                  <Link to="/crm/leads/$id" params={{ id: l.id }} className="font-medium hover:text-primary">
                    {l.name}
                  </Link>
                  <p className="text-xs text-muted-foreground">{l.phone ?? l.email ?? "—"}</p>
                </td>
                <td className="p-3 text-muted-foreground">{LEAD_SOURCES[l.source] ?? l.source}</td>
                <td className="p-3">{stages.find((s) => s.id === l.stage_id)?.name ?? "—"}</td>
                <td className="p-3 tabular-nums">{l.score}</td>
                <td className="p-3">{TEMPERATURES[l.temperature] ?? l.temperature}</td>
                <td className="p-3 tabular-nums">{brl(l.estimated_value)}</td>
                <td className="p-3 text-muted-foreground">{fullDate(l.created_at)}</td>
              </tr>
            ))}
            {!rows.length && (
              <tr>
                <td colSpan={8} className="p-8 text-center text-sm text-muted-foreground">
                  Nenhum lead encontrado.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
