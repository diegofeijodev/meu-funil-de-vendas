-- OAuth `state` de uso único (Meta Ads / Google Ads / TikTok Ads): aleatório, guardado SÓ como hash, com validade,
-- preso ao usuário + empresa que iniciou o login. O callback consome (apaga) a linha.
CREATE TABLE "oauth_states" (
    "state_hash" TEXT NOT NULL,
    "channel" TEXT NOT NULL,
    "workspace_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "expires_at" TIMESTAMPTZ(6) NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "oauth_states_pkey" PRIMARY KEY ("state_hash"),
    CONSTRAINT "oauth_states_channel_check" CHECK ("channel" IN ('meta', 'google', 'tiktok'))
);

CREATE INDEX "oauth_states_expires_idx" ON "oauth_states"("expires_at");
