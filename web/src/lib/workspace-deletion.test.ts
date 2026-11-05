import { describe, expect, it } from "vitest";
import { confirmNameMatches, deletionSummary, inheritorsWarning, nextWorkspaceAfterDelete, type DeletionCounts } from "./workspace-deletion";

const ZERO: DeletionCounts = {
  brands: 0,
  campaigns: 0,
  creatives: 0,
  media_assets: 0,
  ig_posts_pending: 0,
  ig_posts_published: 0,
  crm_leads: 0,
  members: 1,
  saved_keys: 0,
  connections: 0,
};

describe("confirmNameMatches", () => {
  it("igual à API: espaços nas pontas não contam, maiúsculas contam, vazio nunca confere", () => {
    expect(confirmNameMatches("  Freela Serviços ", "Freela Serviços")).toBe(true);
    expect(confirmNameMatches("freela serviços", "Freela Serviços")).toBe(false);
    expect(confirmNameMatches("Freela", "Freela Serviços")).toBe(false);
    expect(confirmNameMatches("", "")).toBe(false);
  });
});

describe("deletionSummary", () => {
  it("empresa vazia (só o dono): nenhuma linha", () => {
    expect(deletionSummary(ZERO)).toEqual([]);
  });

  it("singular e plural, só o que existe, na ordem da tela", () => {
    expect(
      deletionSummary({ brands: 1, campaigns: 3, creatives: 12, media_assets: 1, ig_posts_pending: 2, ig_posts_published: 40, crm_leads: 1, members: 3, saved_keys: 2, connections: 1 }),
    ).toEqual([
      "1 marca",
      "3 campanhas, com os resultados",
      "12 criativos (artes e vídeos)",
      "1 arquivo da biblioteca",
      "2 posts do Instagram que ainda iam sair (não saem mais)",
      "o histórico de 40 posts já publicados (eles continuam no Instagram)",
      "1 contato do CRM",
      "2 chaves salvas (como as de IA)",
      "1 conta conectada (Instagram, Meta e outras)",
      "o acesso de mais 2 pessoas a esta empresa",
    ]);
    expect(deletionSummary({ ...ZERO, campaigns: 1, ig_posts_pending: 1, ig_posts_published: 1, members: 2 })).toEqual([
      "1 campanha, com os resultados",
      "1 post do Instagram que ainda ia sair (não sai mais)",
      "o histórico de 1 post já publicado (ele continua no Instagram)",
      "o acesso de mais 1 pessoa a esta empresa",
    ]);
  });
});

describe("inheritorsWarning", () => {
  it("ninguém herda: sem aviso", () => {
    expect(inheritorsWarning({ inheritors: [], inheritors_hidden: 0 })).toBeNull();
  });

  it("uma empresa (singular) e várias, com as de outros clientes só no número", () => {
    expect(inheritorsWarning({ inheritors: [{ id: "a", name: "Frutá Frozen" }], inheritors_hidden: 0 })).toBe(
      "Frutá Frozen usa a IA desta empresa e vai ficar sem IA até alguém colocar uma chave própria nela.",
    );
    expect(inheritorsWarning({ inheritors: [{ id: "a", name: "Frutá Frozen" }, { id: "b", name: "Bar do Zé" }], inheritors_hidden: 1 })).toBe(
      "Frutá Frozen, Bar do Zé e mais 1 empresa de que você não participa usam a IA desta empresa e vão ficar sem IA até alguém colocar uma chave própria nelas.",
    );
    expect(inheritorsWarning({ inheritors: [], inheritors_hidden: 1 })).toBe(
      "Mais 1 empresa de que você não participa usa a IA desta empresa e vai ficar sem IA até alguém colocar uma chave própria nela.",
    );
    expect(inheritorsWarning({ inheritors: [], inheritors_hidden: 2 })).toBe(
      "Mais 2 empresas de que você não participa usam a IA desta empresa e vão ficar sem IA até alguém colocar uma chave própria nelas.",
    );
  });
});

describe("nextWorkspaceAfterDelete", () => {
  it("a primeira outra empresa; nenhuma → null", () => {
    const list = [{ workspace_id: "a" }, { workspace_id: "b" }, { workspace_id: "c" }];
    expect(nextWorkspaceAfterDelete(list, "a")).toBe("b");
    expect(nextWorkspaceAfterDelete(list, "b")).toBe("a");
    expect(nextWorkspaceAfterDelete([{ workspace_id: "a" }], "a")).toBeNull();
  });
});
