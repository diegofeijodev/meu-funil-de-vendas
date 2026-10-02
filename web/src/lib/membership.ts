/**
 * Papéis do workspace. No protótipo este arquivo trazia `requireRole` (checagem
 * das server functions); aqui a checagem vive na API (`WorkspaceAccessService`).
 * Ficam os tipos e os grupos de papel usados pelo cliente.
 */
export type WorkspaceRole = "owner" | "admin" | "marketing" | "viewer";

/** Podem criar/editar (viewer só lê). */
export const EDITORS: WorkspaceRole[] = ["owner", "admin", "marketing"];
/** Aprovam decisões, ativam campanha, conectam contas, chaves de IA. */
export const MANAGERS: WorkspaceRole[] = ["owner", "admin"];

export const canEditRole = (role: string) => role !== "viewer";
export const canManageRole = (role: string) => (MANAGERS as string[]).includes(role);
