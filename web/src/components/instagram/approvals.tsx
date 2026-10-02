"use client";

import { EmptyState } from "@/components/ui-bits";

/**
 * PLACEHOLDER (Task 3): lista de posts do Instagram aguardando aprovação (aprovar/rejeitar em lote). O componente
 * real nasce na tarefa do Instagram, que substitui este arquivo mantendo a assinatura abaixo.
 */
export function IgApprovalList(props: { workspaceId: string; onOpen?: (id: string) => void; canEdit?: boolean }) {
  void props;
  return <EmptyState title="Nenhum post aguardando aprovação" description="Posts do Instagram enviados para aprovação aparecem aqui." />;
}
