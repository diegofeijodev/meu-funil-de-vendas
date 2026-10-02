import { serverFnPost } from "@/lib/server-fn";

export type SetupItem = {
  key: string;
  group: "Começo" | "Conexões" | "CRM" | "Agendadores";
  label: string;
  status: "ok" | "pending" | "error" | "optional";
  detail: string;
  link: string;
  required: boolean;
};

/** `POST /v1/setup/status` — checklist "o que falta configurar" (qualquer membro). */
export const setupStatus = serverFnPost<{ workspaceId: string }, { items: SetupItem[] }>("/v1/setup/status");
