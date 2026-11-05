import { joinPt } from "@/lib/health-alerts";

/** `GET /v1/workspaces/:id/deletion-preview` (contrato §31). */
export type DeletionCounts = {
  brands: number;
  campaigns: number;
  creatives: number;
  media_assets: number;
  ig_posts_pending: number;
  ig_posts_published: number;
  crm_leads: number;
  members: number;
  saved_keys: number;
  connections: number;
};

export type DeletionBlocker = { code: string; message: string; items?: { id: string; name: string }[] };

export type DeletionPreview = {
  workspace: { id: string; name: string };
  counts: DeletionCounts;
  inheritors: { id: string; name: string }[];
  inheritors_hidden: number;
  blockers: DeletionBlocker[];
};

/** Mesma regra da API: espaços nas pontas não contam, maiúsculas contam, vazio nunca confere. */
export function confirmNameMatches(typed: string, name: string): boolean {
  const t = typed.trim();
  return t.length > 0 && t === name.trim();
}

const n = (count: number, one: string, many: string) => (count === 1 ? `1 ${one}` : `${count} ${many}`);

/** O que vai junto, em frases curtas (só o que existe). Lista vazia = empresa vazia. */
export function deletionSummary(c: DeletionCounts): string[] {
  const lines: string[] = [];
  if (c.brands) lines.push(n(c.brands, "marca", "marcas"));
  if (c.campaigns) lines.push(`${n(c.campaigns, "campanha", "campanhas")}, com os resultados`);
  if (c.creatives) lines.push(`${n(c.creatives, "criativo", "criativos")} (artes e vídeos)`);
  if (c.media_assets) lines.push(n(c.media_assets, "arquivo da biblioteca", "arquivos da biblioteca"));
  if (c.ig_posts_pending) {
    lines.push(c.ig_posts_pending === 1 ? "1 post do Instagram que ainda ia sair (não sai mais)" : `${c.ig_posts_pending} posts do Instagram que ainda iam sair (não saem mais)`);
  }
  if (c.ig_posts_published) {
    lines.push(
      c.ig_posts_published === 1
        ? "o histórico de 1 post já publicado (ele continua no Instagram)"
        : `o histórico de ${c.ig_posts_published} posts já publicados (eles continuam no Instagram)`,
    );
  }
  if (c.crm_leads) lines.push(n(c.crm_leads, "contato do CRM", "contatos do CRM"));
  if (c.saved_keys) lines.push(`${n(c.saved_keys, "chave salva", "chaves salvas")} (como as de IA)`);
  if (c.connections) lines.push(`${n(c.connections, "conta conectada", "contas conectadas")} (Instagram, Meta e outras)`);
  const others = c.members - 1;
  if (others > 0) lines.push(others === 1 ? "o acesso de mais 1 pessoa a esta empresa" : `o acesso de mais ${others} pessoas a esta empresa`);
  return lines;
}

/** Aviso para quem herda a IA desta empresa (nome só das que o usuário também participa). `null` = ninguém herda. */
export function inheritorsWarning(p: Pick<DeletionPreview, "inheritors" | "inheritors_hidden">): string | null {
  const names = p.inheritors.map((i) => i.name);
  const hidden = p.inheritors_hidden;
  if (!names.length && !hidden) return null;
  const parts = [...names];
  if (hidden) parts.push(hidden === 1 ? "mais 1 empresa de que você não participa" : `mais ${hidden} empresas de que você não participa`);
  const total = names.length + hidden;
  // Sem nome na frente, a frase começa por "Mais N empresas" (nome de empresa nunca é mexido).
  const who = names.length ? joinPt(parts) : joinPt(parts).replace(/^mais/, "Mais");
  return total === 1
    ? `${who} usa a IA desta empresa e vai ficar sem IA até alguém colocar uma chave própria nela.`
    : `${who} usam a IA desta empresa e vão ficar sem IA até alguém colocar uma chave própria nelas.`;
}

/** Para onde o app vai depois de apagar: a primeira outra empresa do usuário (a lista vem mais antiga primeiro). */
export function nextWorkspaceAfterDelete(memberships: { workspace_id: string }[], deletedId: string): string | null {
  return memberships.find((m) => m.workspace_id !== deletedId)?.workspace_id ?? null;
}
