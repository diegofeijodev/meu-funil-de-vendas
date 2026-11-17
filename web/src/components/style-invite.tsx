"use client";

import { Button } from "@/components/ui/button";
import { Link } from "@/lib/router";
import { useWorkspace } from "@/lib/workspace";
import { useFeatures } from "@/modules/features/infrastructure/features.api";
import { INVITE_CTA, styleInvite, type StyleRecordLike } from "@/lib/style-refs";

/** Linha "Estilo: …" onde a arte é vista (ui.md §5). Só com `features.style_library` (P27); sem registro (peça antiga ou prompt à mão), não mostra nada. */
export function StyleInvite({
  record,
  invite: given,
  className,
}: {
  record?: StyleRecordLike | null;
  /** Convite já calculado (Pacote do piloto usa `packageInvite`). */
  invite?: ReturnType<typeof styleInvite>;
  className?: string;
}) {
  const { workspaceId } = useWorkspace();
  const features = useFeatures(workspaceId);
  if (features.data?.style_library !== true) return null;
  const invite = given !== undefined ? given : styleInvite(record);
  if (!invite) return null;
  return (
    <div className={className}>
      <p className="text-sm text-muted-foreground">{invite.text}</p>
      {invite.cta && (
        <Button asChild variant="link" className="h-11 px-0 sm:h-auto">
          {invite.brandId ? (
            <Link to="/brands/$id" params={{ id: invite.brandId }} search={{ tab: "guia" }}>{INVITE_CTA}</Link>
          ) : (
            <Link to="/brands">{INVITE_CTA}</Link>
          )}
        </Button>
      )}
    </div>
  );
}
