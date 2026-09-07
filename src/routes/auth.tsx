import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Sparkles, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { lovable } from "@/integrations/lovable/index";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export const Route = createFileRoute("/auth")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "Entrar · AI Marketing OS" },
      {
        name: "description",
        content:
          "Acesse o AI Marketing OS: estratégia, criativos, campanhas e ROI operados por inteligência artificial.",
      },
      { property: "og:title", content: "Entrar · AI Marketing OS" },
      {
        property: "og:description",
        content: "Sua agência de marketing operada por IA, do briefing ao ROI.",
      },
    ],
  }),
  component: AuthPage,
});

function AuthPage() {
  const navigate = useNavigate();
  const [mode, setMode] = useState<"signin" | "signup">("signup");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [company, setCompany] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      if (data.session) navigate({ to: "/overview" });
    });
  }, [navigate]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    try {
      if (mode === "signup") {
        const { error } = await supabase.auth.signUp({
          email,
          password,
          options: {
            emailRedirectTo: window.location.origin,
            data: { full_name: name, company_name: company || `Workspace de ${name || email}` },
          },
        });
        if (error) throw error;
        const { error: signInError } = await supabase.auth.signInWithPassword({ email, password });
        if (signInError) {
          toast.success("Conta criada! Confirme seu e-mail para entrar.");
          return;
        }
        toast.success("Conta criada. Preparamos um workspace de demonstração para você.");
        navigate({ to: "/overview" });
      } else {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
        navigate({ to: "/overview" });
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Não foi possível continuar.");
    } finally {
      setLoading(false);
    }
  };

  const google = async () => {
    const result = await lovable.auth.signInWithOAuth("google", {
      redirect_uri: window.location.origin,
    });
    if (result.error) {
      toast.error("Não foi possível entrar com o Google.");
      return;
    }
    if (result.redirected) return;
    navigate({ to: "/overview" });
  };

  return (
    <div className="surface-grid flex min-h-screen items-center justify-center px-4 py-12">
      <div className="grid w-full max-w-5xl items-center gap-10 lg:grid-cols-2">
        <div className="hidden lg:block">
          <div className="mb-6 inline-flex items-center gap-2 rounded-full border border-border bg-card px-3 py-1 text-xs text-muted-foreground">
            <Sparkles className="size-3.5 text-primary" /> Agência de marketing operada por IA
          </div>
          <h1 className="text-4xl font-semibold leading-tight">
            Do briefing ao <span className="text-gradient-brand">ROI</span>, sem perder o
            controle humano.
          </h1>
          <p className="mt-4 max-w-md text-muted-foreground">
            Cadastre a marca uma vez. A plataforma transforma o DNA do seu negócio em estratégia,
            copies, criativos, campanhas e análise de retorno — sempre com aprovação humana antes de
            qualquer ação externa.
          </p>
          <ul className="mt-8 space-y-3 text-sm text-muted-foreground">
            {[
              "Brand Brain como contexto de todos os agentes",
              "Estratégia versionada e editável",
              "Copy engine e Creative Studio integrados",
              "Publicação Meta com fila de aprovação",
              "Dashboard de ROAS, ROI e CAC em tempo real",
            ].map((i) => (
              <li key={i} className="flex items-center gap-2">
                <span className="size-1.5 rounded-full bg-primary" />
                {i}
              </li>
            ))}
          </ul>
        </div>

        <div className="panel p-8">
          <h2 className="text-xl font-semibold">
            {mode === "signup" ? "Criar conta" : "Entrar"}
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            {mode === "signup"
              ? "Seu workspace já nasce com uma marca e campanhas de demonstração."
              : "Bem-vindo de volta."}
          </p>

          <form onSubmit={submit} className="mt-6 space-y-4">
            {mode === "signup" && (
              <>
                <div className="space-y-1.5">
                  <Label htmlFor="name">Seu nome</Label>
                  <Input id="name" value={name} onChange={(e) => setName(e.target.value)} required />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="company">Nome da empresa / workspace</Label>
                  <Input
                    id="company"
                    value={company}
                    onChange={(e) => setCompany(e.target.value)}
                    placeholder="Minha Agência"
                  />
                </div>
              </>
            )}
            <div className="space-y-1.5">
              <Label htmlFor="email">E-mail</Label>
              <Input
                id="email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="password">Senha</Label>
              <Input
                id="password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                minLength={6}
                required
              />
            </div>
            <Button type="submit" className="w-full" disabled={loading}>
              {loading && <Loader2 className="mr-2 size-4 animate-spin" />}
              {mode === "signup" ? "Criar conta" : "Entrar"}
            </Button>
          </form>

          <div className="my-5 flex items-center gap-3 text-xs text-muted-foreground">
            <span className="h-px flex-1 bg-border" /> ou <span className="h-px flex-1 bg-border" />
          </div>

          <Button variant="outline" className="w-full" onClick={google}>
            Continuar com Google
          </Button>

          <p className="mt-6 text-center text-sm text-muted-foreground">
            {mode === "signup" ? "Já tem conta?" : "Ainda não tem conta?"}{" "}
            <button
              type="button"
              className="font-medium text-primary hover:underline"
              onClick={() => setMode(mode === "signup" ? "signin" : "signup")}
            >
              {mode === "signup" ? "Entrar" : "Criar conta"}
            </button>
          </p>
        </div>
      </div>
    </div>
  );
}
