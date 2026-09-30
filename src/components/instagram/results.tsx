import { useQuery } from "@tanstack/react-query";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { supabase } from "@/integrations/supabase/client";
import { Section, EmptyState } from "@/components/ui-bits";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { FORMATS, fmtDateTime, fmtNum, type IgPost } from "./shared";

export function IgResults({
  workspaceId,
  posts,
  onOpen,
}: {
  workspaceId: string;
  posts: IgPost[];
  onOpen: (id: string) => void;
}) {
  const { data: metrics, isLoading } = useQuery({
    queryKey: ["ig-metrics", workspaceId],
    queryFn: async () =>
      (
        await supabase
          .from("ig_post_metrics")
          .select("*")
          .eq("workspace_id", workspaceId)
          .order("collected_at", { ascending: false })
      ).data ?? [],
  });
  const { data: plans = [] } = useQuery({
    queryKey: ["ig-plans", workspaceId],
    queryFn: async () =>
      (await supabase.from("ig_content_plans").select("*").eq("workspace_id", workspaceId)).data ??
      [],
  });

  if (isLoading) return <div className="h-64 animate-pulse rounded-lg bg-muted" />;
  const latest = new Map<string, any>();
  for (const r of metrics ?? []) if (!latest.has(r.post_id)) latest.set(r.post_id, r);
  const rows = posts
    .filter((p) => p.status === "published")
    .map((p) => ({ p, m: latest.get(p.id) ?? {} }));
  if (!rows.length)
    return (
      <EmptyState
        title="Sem resultados ainda"
        description="As métricas aparecem 1h, 24h e 7 dias depois de cada publicação."
      />
    );

  const byFormat = Object.entries(FORMATS)
    .map(([k, v]) => {
      const r = rows.filter((x) => x.p.format === k);
      return {
        formato: v.label,
        alcance: r.reduce((a, x) => a + (x.m.reach ?? 0), 0),
        salvos: r.reduce((a, x) => a + (x.m.saves ?? 0), 0),
      };
    })
    .filter((x) => x.alcance || x.salvos);

  const hourAgg = new Map<number, { total: number; n: number }>();
  for (const { p, m } of rows) {
    const h = new Date(p.published_at ?? p.scheduled_at ?? p.created_at).getHours();
    const c = hourAgg.get(h) ?? { total: 0, n: 0 };
    hourAgg.set(h, { total: c.total + (m.reach ?? 0), n: c.n + 1 });
  }
  const bestHours = [...hourAgg.entries()]
    .map(([h, c]) => ({ label: `${String(h).padStart(2, "0")}h`, avg: c.total / c.n }))
    .sort((a, b) => b.avg - a.avg)
    .slice(0, 5);

  // Pilar ≈ tema do post comparado aos pilares do plano.
  const pillarAgg = new Map<string, { total: number; n: number }>();
  for (const { p, m } of rows) {
    const plan: any = plans.find((x: any) => x.id === p.plan_id);
    const pillars: string[] = plan?.content_pillars ?? [];
    const text = `${p.theme ?? ""} ${p.caption ?? ""}`.toLowerCase();
    const pillar =
      pillars.find((x) => text.includes(x.toLowerCase().split(" ")[0] ?? "")) ??
      p.theme ??
      "Outros";
    const c = pillarAgg.get(pillar) ?? { total: 0, n: 0 };
    pillarAgg.set(pillar, { total: c.total + (m.reach ?? 0), n: c.n + 1 });
  }
  const bestPillars = [...pillarAgg.entries()]
    .map(([label, c]) => ({ label, avg: c.total / c.n }))
    .sort((a, b) => b.avg - a.avg)
    .slice(0, 5);

  const Rank = ({ items }: { items: { label: string; avg: number }[] }) => (
    <ol className="space-y-2">
      {items.map((x, i) => (
        <li key={x.label} className="flex items-center justify-between gap-2 text-sm">
          <span className="truncate">
            {i + 1}. {x.label}
          </span>
          <span className="tabular-nums text-muted-foreground">{fmtNum(x.avg)} alcance médio</span>
        </li>
      ))}
    </ol>
  );

  return (
    <div className="space-y-6">
      <div className="grid gap-6 lg:grid-cols-3">
        <Section title="Por formato">
          <div className="h-56">
            <ResponsiveContainer>
              <BarChart data={byFormat}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                <XAxis dataKey="formato" fontSize={11} stroke="var(--muted-foreground)" />
                <YAxis fontSize={11} stroke="var(--muted-foreground)" />
                <Tooltip
                  contentStyle={{ background: "var(--card)", border: "1px solid var(--border)" }}
                />
                <Bar dataKey="alcance" fill="var(--primary)" radius={4} />
                <Bar dataKey="salvos" fill="var(--accent)" radius={4} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Section>
        <Section title="Melhores horários">
          <Rank items={bestHours} />
        </Section>
        <Section title="Melhores pilares">
          <Rank items={bestPillars} />
        </Section>
      </div>

      <Section title="Por post">
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Post</TableHead>
                <TableHead>Formato</TableHead>
                <TableHead>Publicado</TableHead>
                <TableHead className="text-right">Alcance</TableHead>
                <TableHead className="text-right">Curtidas</TableHead>
                <TableHead className="text-right">Coment.</TableHead>
                <TableHead className="text-right">Salvos</TableHead>
                <TableHead className="text-right">Compart.</TableHead>
                <TableHead className="text-right">Plays</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map(({ p, m }) => (
                <TableRow key={p.id} className="cursor-pointer" onClick={() => onOpen(p.id)}>
                  <TableCell className="max-w-48 truncate">{p.theme ?? "Post"}</TableCell>
                  <TableCell>{FORMATS[p.format]?.label}</TableCell>
                  <TableCell>{fmtDateTime(p.published_at)}</TableCell>
                  {["reach", "likes", "comments", "saves", "shares", "plays"].map((k) => (
                    <TableCell key={k} className="text-right tabular-nums">
                      {m[k] == null ? "—" : fmtNum(m[k])}
                    </TableCell>
                  ))}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </Section>
    </div>
  );
}
