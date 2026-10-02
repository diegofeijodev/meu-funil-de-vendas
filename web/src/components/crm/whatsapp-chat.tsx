"use client";

/**
 * Conversa do lead (WhatsApp / Direct do Instagram). PLACEHOLDER da Task 7: mantém só o cartão externo da tela; a Task 8
 * troca por o componente completo (polling, janela de 24 h, templates, mídia por URL) usando `sendWhatsAppMessage` e
 * `sendInstagramMessage` de `@/lib/crm-integrations.functions`.
 */
export function WhatsAppChat(_props: {
  workspaceId: string;
  leadId: string;
  phone: string | null;
  instagramId?: string | null;
  unsubscribed: boolean;
}) {
  return (
    <div className="flex h-full flex-col">
      <div className="max-h-[420px] min-h-[180px] flex-1 space-y-2 overflow-y-auto rounded-lg border border-border bg-background/50 p-3">
        <p className="py-8 text-center text-sm text-muted-foreground">Disponível em breve.</p>
      </div>
    </div>
  );
}
