import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { ArrowRight, Check, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { lovable } from "@/integrations/lovable/index";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import meuFunilLogo from "@/assets/meu-funil-logo.png.asset.json";

export const Route = createFileRoute("/auth")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "Entrar · Meu Funil" },
      {
        name: "description",
        content:
          "Acesse o Meu Funil e transforme marketing em vendas com inteligência artificial.",
      },
      { property: "og:title", content: "Entrar · Meu Funil" },
      {
        property: "og:description",
        content: "A IA que transforma marketing em vendas.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
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
      const raw = err instanceof Error ? err.message : "";
      const friendly = raw.includes("already registered")
        ? "Esse e-mail já tem conta. Faça login."
        : raw.toLowerCase().includes("weak")
          ? "Escolha uma senha mais forte (evite senhas comuns)."
          : raw.includes("Invalid login credentials")
            ? "E-mail ou senha incorretos."
            : raw.toLowerCase().includes("password")
              ? "A senha precisa ter pelo menos 6 caracteres."
              : raw || "Não foi possível continuar.";
      toast.error(friendly);
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
    <div className="surface-grid flex min-h-screen items-center justify-center px-4 py-10 sm:px-6">
      <div className="grid w-full max-w-6xl items-center gap-12 lg:grid-cols-[1.08fr_.92fr]">
        <section className="hidden lg:block">
          <img
            src={meuFunilLogo.url}
            alt="Meu Funil — A IA que transforma marketing em vendas"
            className="mb-10 h-auto w-[300px] object-contain object-left"
          />
          <p className="mb-4 font-semibold text-primary">Tecnologia para transformar atenção em vendas.</p>
          <h1 className="max-w-xl text-5xl font-extrabold leading-[1.08] text-brand-navy">
            Marketing, vendas e IA em <span className="text-gradient-brand">um único fluxo.</span>
          </h1>
          <p className="mt-5 max-w-lg text-lg leading-8 text-muted-foreground">
            Estratégia, conteúdo, mídia, CRM e automação trabalhando juntos para organizar e acelerar o crescimento.
          </p>
          <ul className="mt-8 grid max-w-lg gap-3 text-sm text-foreground sm:grid-cols-2">
            {[
              "Estratégia e conteúdo integrados",
              "CRM com automação inteligente",
              "Campanhas e criativos em um só lugar",
              "Performance orientada a vendas",
            ].map((i) => (
              <li key={i} className="flex items-center gap-2.5">
                <span className="grid size-5 shrink-0 place-items-center rounded-full bg-success/15 text-success"><Check className="size-3" /></span>
                {i}
              </li>
            ))}
          </ul>
        </section>

        <div className="rounded-xl border border-border bg-card p-6 shadow-elevated sm:p-10">
          <img
            src={meuFunilLogo.url}
            alt="Meu Funil"
            className="mx-auto mb-8 h-auto w-[220px] object-contain lg:hidden"
          />
          <h2 className="text-2xl font-bold text-brand-navy">
            {mode === "signup" ? "Criar conta" : "Entrar"}
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            {mode === "signup"
              ? "Comece a transformar marketing em vendas."
              : "Bem-vindo de volta ao seu funil."}
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
            <Button type="submit" size="lg" className="w-full" disabled={loading}>
              {loading && <Loader2 className="mr-2 size-4 animate-spin" />}
              {mode === "signup" ? "Criar conta" : "Entrar no Meu Funil"}
              {!loading && <ArrowRight className="ml-1 size-4" />}
            </Button>
          </form>

          <div className="my-5 flex items-center gap-3 text-xs text-muted-foreground">
            <span className="h-px flex-1 bg-border" /> ou <span className="h-px flex-1 bg-border" />
          </div>

          <Button variant="outline" size="lg" className="w-full" onClick={google}>
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
