import { createFileRoute, redirect } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "Meu Funil · Marketing e vendas com IA" },
      {
        name: "description",
        content:
          "Estratégia, conteúdo, mídia, CRM e automação trabalhando em um único fluxo para transformar marketing em vendas.",
      },
      { property: "og:title", content: "Meu Funil" },
      {
        property: "og:description",
        content: "A IA que transforma marketing em vendas.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  beforeLoad: async () => {
    const { data } = await supabase.auth.getSession();
    throw redirect({ to: data.session ? "/overview" : "/auth" });
  },
  component: () => null,
});
