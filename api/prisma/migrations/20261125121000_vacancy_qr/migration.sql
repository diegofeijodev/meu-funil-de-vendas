-- QR code da vaga no rodapé da arte (desenho de 24/11/2026 §2.3; UI §2.5). Desligado por padrão: só liga (dono/admin) depois de uma prévia
-- com QR que o sistema conferiu. `qr_enabled_at` = desde quando (a tela diz "Ligado desde …"); nulo quando desligado.
ALTER TABLE "vacancy_story_settings"
  ADD COLUMN "qr_enabled" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "qr_enabled_at" TIMESTAMPTZ(6);
