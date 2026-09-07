import { createFileRoute, redirect } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "AI Marketing OS · Sua agência operada por IA" },
      {
        name: "description",
        content:
          "Plataforma que transforma o DNA da sua marca em estratégia, copies, criativos, campanhas e análise de ROI, com aprovação humana.",
      },
      { property: "og:title", content: "AI Marketing OS" },
      {
        property: "og:description",
        content: "Do briefing ao ROI: estratégia, criativos e campanhas operados por IA.",
      },
    ],
  }),
  beforeLoad: async () => {
    const { data } = await supabase.auth.getSession();
    throw redirect({ to: data.session ? "/overview" : "/auth" });
  },
  component: () => null,
});
