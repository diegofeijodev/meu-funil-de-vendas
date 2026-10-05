-- Índices únicos sobrepostos em crm_messages: `crm_messages_external_idx` (init, do protótipo: (workspace_id, external_id) onde external_id não é nulo,
-- vale para as duas direções) já garante a idempotência das recebidas; `crm_messages_ws_external_in_uidx` (só direction='in') era um subconjunto dele.
-- Fica UM índice único (o do protótipo); o código trata P2002 de qualquer um deles igual.
DROP INDEX IF EXISTS "crm_messages_ws_external_in_uidx";
