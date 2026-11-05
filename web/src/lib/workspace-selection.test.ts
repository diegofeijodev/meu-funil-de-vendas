import { describe, expect, it } from "vitest";
import { isForbidden, pickWorkspaceId } from "./workspace-selection";

const list = [{ workspace_id: "a" }, { workspace_id: "b" }];

describe("pickWorkspaceId", () => {
  it("usa a escolhida/salva se ainda é do usuário, na ordem dada", () => {
    expect(pickWorkspaceId(list, "b", "a")).toBe("b");
    expect(pickWorkspaceId(list, null, "b")).toBe("b");
  });

  it("empresa apagada (em outra aba) ou que a pessoa perdeu cai para a primeira da lista", () => {
    expect(pickWorkspaceId(list, "apagada", "apagada")).toBe("a");
    expect(pickWorkspaceId(list, "apagada", "b")).toBe("b");
    expect(pickWorkspaceId(list)).toBe("a");
  });

  it("sem empresa nenhuma: null", () => {
    expect(pickWorkspaceId([], "a")).toBeNull();
  });
});

describe("isForbidden", () => {
  it("só 403 da API", () => {
    expect(isForbidden({ response: { status: 403 } })).toBe(true);
    expect(isForbidden({ response: { status: 404 } })).toBe(false);
    expect(isForbidden(new Error("x"))).toBe(false);
    expect(isForbidden(null)).toBe(false);
  });
});
