import { createFileRoute, Link, Outlet, useRouterState } from "@tanstack/react-router";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_authenticated/crm")({
  component: CrmLayout,
});

const TABS = [
  { to: "/crm", label: "Funil" },
  { to: "/crm/leads", label: "Leads" },
  { to: "/crm/tasks", label: "Minhas tarefas" },
  { to: "/crm/dashboard", label: "Indicadores" },
  { to: "/crm/settings", label: "Configurações" },
] as const;

function CrmLayout() {
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
      <Outlet />
    </div>
  );
}
