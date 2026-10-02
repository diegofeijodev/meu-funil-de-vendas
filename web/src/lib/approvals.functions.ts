import { serverFnPost } from "@/lib/server-fn";

/** `POST /v1/approvals/decide-approval` — só o dono ou um administrador decide; efeito na campanha/criativo do pedido. */
export const decideApproval = serverFnPost<{ approvalId: string; decision: "approved" | "rejected" }, { ok: true }>(
  "/v1/approvals/decide-approval",
);
