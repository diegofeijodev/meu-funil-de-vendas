import { createFileRoute, redirect } from "@tanstack/react-router";

/**
 * O calendário de conteúdo real fica dentro do Instagram (estratégia, geração, aprovação e publicação).
 * Esta rota antiga era um calendário simulado; agora só redireciona para não quebrar links salvos.
 */
export const Route = createFileRoute("/_authenticated/calendar")({
  beforeLoad: () => {
    throw redirect({ to: "/instagram", search: { tab: "calendar" } });
  },
});
