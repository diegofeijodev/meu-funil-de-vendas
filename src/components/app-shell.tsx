import { useState, type ReactNode } from "react";
import { Link, useRouterState, useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import {
  LayoutDashboard,
  Sparkles,
  Megaphone,
  Users,
  Images,
  CalendarDays,
  BarChart3,
  Lightbulb,
  ShieldCheck,
  Plug,
  Settings,
  LogOut,
  Menu,
  X,
  Instagram,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useWorkspace } from "@/lib/workspace";
import { ROLE_LABELS } from "@/lib/labels";
import { cn } from "@/lib/utils";
import meuFunilLogo from "@/assets/meu-funil-logo.png.asset.json";
import meuFunilSymbol from "@/assets/meu-funil-symbol.png.asset.json";

const NAV = [
  { to: "/overview", label: "Overview", icon: LayoutDashboard },
  { to: "/brands", label: "Brands", icon: Sparkles },
  { to: "/campaigns", label: "Campaigns", icon: Megaphone },
  { to: "/crm", label: "CRM", icon: Users },
  { to: "/studio", label: "Creative Studio", icon: Images },
  { to: "/calendar", label: "Content Calendar", icon: CalendarDays },
  { to: "/instagram", label: "Instagram", icon: Instagram },
  { to: "/performance", label: "Performance", icon: BarChart3 },
  { to: "/insights", label: "AI Insights", icon: Lightbulb },
  { to: "/approvals", label: "Approvals", icon: ShieldCheck },
  { to: "/integrations", label: "Integrations", icon: Plug },
  { to: "/settings", label: "Settings", icon: Settings },
] as const;

export function AppShell({ children }: { children: ReactNode }) {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const { workspaceName, memberships, workspaceId, setWorkspaceId, role, user } = useWorkspace();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);

  const signOut = async () => {
    await supabase.auth.signOut();
    navigate({ to: "/auth" });
  };

  const { data: igPending = 0 } = useQuery({
    queryKey: ["ig-pending-badge", workspaceId],
    enabled: !!workspaceId,
    refetchInterval: 120_000,
    queryFn: async () => {
      const { count } = await supabase
        .from("ig_posts")
        .select("id", { count: "exact", head: true })
        .eq("workspace_id", workspaceId!)
        .eq("status", "pending_approval");
      return count ?? 0;
    },
  });

  const nav = (
    <nav className="flex flex-1 flex-col gap-0.5 px-3">
      {NAV.map((item) => {
        const active = pathname === item.to || pathname.startsWith(`${item.to}/`);
        const Icon = item.icon;
        return (
          <Link
            key={item.to}
            to={item.to}
            onClick={() => setOpen(false)}
            className={cn(
              "flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition-colors",
              active
                ? "bg-sidebar-accent text-sidebar-accent-foreground font-medium"
                : "text-sidebar-foreground/75 hover:bg-sidebar-accent/60 hover:text-sidebar-accent-foreground",
            )}
          >
            <Icon className={cn("size-4", active && "text-sidebar-primary")} />
            {item.label}
            {item.to === "/instagram" && igPending > 0 && (
              <span className="ml-auto rounded-full bg-primary px-1.5 py-0.5 text-[10px] font-semibold text-primary-foreground" title="Posts aguardando aprovação">
                {igPending}
              </span>
            )}
          </Link>
        );
      })}
    </nav>
  );

  return (
    <div className="flex min-h-screen bg-background">
      <aside className="hidden w-64 shrink-0 flex-col border-r border-sidebar-border bg-sidebar py-5 lg:flex">
        <BrandMark />
        <WorkspacePicker
          workspaceId={workspaceId}
          workspaceName={workspaceName}
          memberships={memberships}
          onChange={setWorkspaceId}
        />
        {nav}
        <UserBox email={user?.email ?? ""} role={role} onSignOut={signOut} />
      </aside>

      {open && (
        <div className="fixed inset-0 z-50 flex lg:hidden">
          <div className="absolute inset-0 bg-background/80" onClick={() => setOpen(false)} />
          <aside className="relative flex w-64 flex-col border-r border-sidebar-border bg-sidebar py-5">
            <button
              onClick={() => setOpen(false)}
              className="absolute right-3 top-4 text-muted-foreground"
              aria-label="Fechar menu"
            >
              <X className="size-5" />
            </button>
            <BrandMark />
            <WorkspacePicker
              workspaceId={workspaceId}
              workspaceName={workspaceName}
              memberships={memberships}
              onChange={setWorkspaceId}
            />
            {nav}
            <UserBox email={user?.email ?? ""} role={role} onSignOut={signOut} />
          </aside>
        </div>
      )}

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex items-center gap-3 border-b border-border px-4 py-3 lg:hidden">
          <button onClick={() => setOpen(true)} aria-label="Abrir menu">
            <Menu className="size-5" />
          </button>
          <img src={meuFunilSymbol.url} alt="Meu Funil" className="size-8 object-contain" />
          <span className="font-display font-bold text-brand-navy">Meu Funil</span>
        </header>
        <main className="surface-grid min-w-0 flex-1 px-4 py-8 md:px-8 lg:px-10">
          <div className="mx-auto w-full max-w-[1400px]">{children}</div>
        </main>
      </div>
    </div>
  );
}

function BrandMark() {
  return (
    <div className="mb-6 px-5">
      <img
        src={meuFunilLogo.url}
        alt="Meu Funil — A IA que transforma marketing em vendas"
        className="h-auto w-[190px] object-contain object-left"
      />
    </div>
  );
}

function WorkspacePicker({
  workspaceId,
  workspaceName,
  memberships,
  onChange,
}: {
  workspaceId: string | null;
  workspaceName: string;
  memberships: { workspace_id: string; workspaces: { name: string } | null }[];
  onChange: (id: string) => void;
}) {
  if (memberships.length <= 1) {
    return (
      <div className="mx-3 mb-4 rounded-lg border border-sidebar-border bg-sidebar-accent/40 px-3 py-2">
        <p className="text-[11px] uppercase tracking-wider text-muted-foreground">Workspace</p>
        <p className="truncate text-sm font-medium">{workspaceName}</p>
      </div>
    );
  }
  return (
    <div className="mx-3 mb-4">
      <label className="text-[11px] uppercase tracking-wider text-muted-foreground">Workspace</label>
      <select
        value={workspaceId ?? ""}
        onChange={(e) => onChange(e.target.value)}
        className="mt-1 w-full rounded-lg border border-sidebar-border bg-sidebar-accent/40 px-2.5 py-2 text-sm outline-none focus:ring-2 focus:ring-ring"
      >
        {memberships.map((m) => (
          <option key={m.workspace_id} value={m.workspace_id}>
            {m.workspaces?.name ?? "Workspace"}
          </option>
        ))}
      </select>
    </div>
  );
}

function UserBox({
  email,
  role,
  onSignOut,
}: {
  email: string;
  role: string;
  onSignOut: () => void;
}) {
  return (
    <div className="mt-4 border-t border-sidebar-border px-5 pt-4">
      <p className="truncate text-xs text-muted-foreground">{email}</p>
      <p className="text-xs font-medium text-sidebar-primary">{ROLE_LABELS[role] ?? role}</p>
      <button
        onClick={onSignOut}
        className="mt-3 inline-flex items-center gap-2 text-xs text-muted-foreground transition-colors hover:text-foreground"
      >
        <LogOut className="size-3.5" /> Sair
      </button>
    </div>
  );
}
