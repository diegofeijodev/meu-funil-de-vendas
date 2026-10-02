"use client";

import type { ReactNode } from "react";
import { Link, useRouterState } from "@/lib/router";
import { cn } from "@/lib/utils";

const TABS = [
  { to: "/crm", label: "Funil" },
  { to: "/crm/leads", label: "Leads" },
  { to: "/crm/inbox", label: "Inbox" },
  { to: "/crm/cadences", label: "Cadências" },
  { to: "/crm/tasks", label: "Minhas tarefas" },
  { to: "/crm/dashboard", label: "Indicadores" },
  { to: "/crm/integrations", label: "Integrações" },
  { to: "/crm/settings", label: "Configurações" },
] as const;

export default function CrmLayout({ children }: { children: ReactNode }) {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  return (
    <div>
      <div className="mb-6 flex gap-1 overflow-x-auto rounded-lg border border-border bg-card p-1">
        {TABS.map((t) => {
          const active = t.to === "/crm" ? pathname === "/crm" : pathname.startsWith(t.to);
          return (
            <Link
              key={t.to}
              to={t.to}
              className={cn(
                "whitespace-nowrap rounded-md px-3 py-1.5 text-sm transition-colors",
                active
                  ? "bg-primary text-primary-foreground font-medium"
                  : "text-muted-foreground hover:bg-secondary",
              )}
            >
              {t.label}
            </Link>
          );
        })}
      </div>
      {children}
    </div>
  );
}
