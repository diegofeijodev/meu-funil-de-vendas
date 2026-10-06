"use client";
/* eslint-disable @typescript-eslint/no-explicit-any -- porte 1:1 do protótipo: os jsonb de ig_posts/ig_content_plans chegam soltos */

import { useQuery } from "@tanstack/react-query";
import {
  Bot,
  CalendarClock,
  AlertTriangle,
  CheckCircle2,
  Send,
  Sparkles,
  RefreshCw,
  ShieldAlert,
  Clapperboard,
} from "lucide-react";
import { listIgEvents, listIgPlans } from "@/modules/instagram/infrastructure/instagram.api";
import { Section, StatusPill, EmptyState } from "@/components/ui-bits";
import { fmtDateTime } from "./shared";

const KIND: Record<string, { label: string; icon: any }> = {
  generation: { label: "Geração", icon: Sparkles },
  media: { label: "Mídia", icon: Sparkles },
  schedule: { label: "Agendamento", icon: CalendarClock },
  publish: { label: "Publicação", icon: Send },
  failure: { label: "Falha", icon: AlertTriangle },
  approval: { label: "Aprovação", icon: CheckCircle2 },
  reschedule: { label: "Reagendado", icon: RefreshCw },
  optimize: { label: "Otimização", icon: Bot },
  guardrail: { label: "Proteção", icon: ShieldAlert },
  // Produção automática (programações com IA).
  strategy_auto_approved: { label: "Estratégia aprovada", icon: CheckCircle2 },
  post_rewritten: { label: "Reescrito pela IA", icon: RefreshCw },
  post_skipped: { label: "Pulado", icon: AlertTriangle },
  video_regenerated: { label: "Vídeo refeito", icon: Clapperboard },
};

/** Próximo domingo 18h em São Paulo (UTC-3 → 21h UTC). */
function nextSunday18() {
  const now = new Date();
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 21, 0, 0));
  const add = (7 - d.getUTCDay()) % 7;
  d.setUTCDate(d.getUTCDate() + add);
  if (d.getTime() <= now.getTime()) d.setUTCDate(d.getUTCDate() + 7);
  return d;
}

export function IgAutopilotPanel({ workspaceId }: { workspaceId: string }) {
  const { data: plans } = useQuery({
    queryKey: ["ig-plans-autopilot", workspaceId],
    queryFn: () => listIgPlans(workspaceId),
  });
  const { data: events, isLoading } = useQuery({
    queryKey: ["ig-autopilot-events", workspaceId],
    refetchInterval: 60_000,
    queryFn: () => listIgEvents(workspaceId),
  });

  const active = (plans ?? []).filter((p: any) => p.auto_publish && p.status === "active");
  const paused = (plans ?? []).filter((p: any) => p.auto_publish && p.status === "paused");
  const on = active.length > 0;

  return (
    <Section
      title="Piloto automático"
      description="Gera, agenda e publica sozinho conforme o plano de conteúdo e as programações com IA."
    >
      <div className="grid gap-4 sm:grid-cols-3">
        <div className="rounded-lg border border-border p-3">
          <p className="text-xs text-muted-foreground">Status</p>
          <div className="mt-1 flex items-center gap-2">
            <StatusPill
              status={on ? "connected" : paused.length ? "error" : "disconnected"}
              label={on ? "Ligado" : paused.length ? "Pausado" : "Desligado"}
            />
          </div>
          <p className="mt-2 text-xs text-muted-foreground">
            {on
              ? active
                  .map(
                    (p: any) =>
                      `${p.name}${p.requires_approval ? " (com aprovação)" : " (sem aprovação)"}`,
                  )
                  .join(", ")
              : paused.length
                ? "Plano pausado por erro na conta. Reconecte o Instagram e reative o plano na aba Estratégia."
                : 'Ative "Publicação automática" em um plano na aba Estratégia.'}
          </p>
        </div>
        <div className="rounded-lg border border-border p-3">
          <p className="text-xs text-muted-foreground">Próxima geração semanal</p>
          <p className="mt-1 font-semibold">
            {on ? fmtDateTime(nextSunday18().toISOString()) : "—"}
          </p>
          <p className="mt-2 text-xs text-muted-foreground">
            Todo domingo às 18h (Brasília). A fila de publicação roda a cada 5 minutos.
          </p>
        </div>
        <div className="rounded-lg border border-border p-3">
          <p className="text-xs text-muted-foreground">Próxima otimização</p>
          <p className="mt-1 font-semibold">Segunda às 9h</p>
          <p className="mt-2 text-xs text-muted-foreground">
            Ajusta horários e pilares com base nos últimos 14 dias.
          </p>
        </div>
      </div>

      <div className="mt-5">
        <p className="mb-2 text-sm font-medium">Últimos eventos</p>
        {isLoading ? (
          <div className="h-24 animate-pulse rounded-lg bg-muted" />
        ) : !events?.length ? (
          <EmptyState
            title="Nenhum evento ainda"
            description="Os registros de geração, agendamento, publicação e falhas aparecem aqui."
          />
        ) : (
          <ul className="divide-y divide-border rounded-lg border border-border">
            {events.map((e: any) => {
              const k = KIND[e.kind] ?? { label: e.kind, icon: Bot };
              const Icon = k.icon;
              return (
                <li key={e.id} className="flex items-start gap-3 p-3 text-sm">
                  <Icon
                    className={`mt-0.5 size-4 shrink-0 ${e.level === "error" ? "text-destructive" : e.level === "warn" ? "text-warning" : "text-primary"}`}
                  />
                  <div className="min-w-0 flex-1">
                    <p className="break-words">{e.message}</p>
                    <p className="text-xs text-muted-foreground">
                      {k.label} · {fmtDateTime(e.created_at)}
                    </p>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </Section>
  );
}
