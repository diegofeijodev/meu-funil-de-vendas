/**
 * Passos do pipeline de publicação (a lógica do publicador mora na API; aqui só o tipo da tela).
 * Fluxo obrigatório: Draft -> Aprovação humana -> Campaign -> Ad Set -> Creative -> Ad -> Active.
 */
export type PublishStep = {
  key: string;
  label: string;
  status: "pending" | "done" | "failed";
  detail: string;
};
