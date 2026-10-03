<!-- LOVABLE:BEGIN -->
> [!IMPORTANT]
> This project is connected to [Lovable](https://lovable.dev). Avoid rewriting
> published git history — force pushing, or rebasing/amending/squashing commits
> that are already pushed — as it rewrites history on Lovable's side and the
> user will likely lose their project history.
>
> Commits you push to the connected branch sync back to Lovable and show up in
> the editor, so keep the branch in a working state.
<!-- LOVABLE:END -->
- Instagram orgânico vive em src/lib/instagram/ (não src/server/, que é bloqueado do cliente); fila em publishing_jobs com channel=instagram_organic, processada por /api/public/cron/instagram — reaproveita a fila existente.
- Piloto automático do Instagram vive em src/lib/instagram/autopilot.server.ts; eventos em ig_autopilot_events; tarefas weekly/optimize pelo mesmo cron /api/public/cron/instagram (body.task) — um só endpoint protegido.
- Media library: all media goes through ingestAsset into creative-assets and media_assets; Jimp normalizes images and MP4 headers validate video because native/WASM image processors are incompatible with the server runtime.
- Direção de arte dos criativos vive em src/lib/creative/ (art-director → pipeline de variações + crítico visual → compose com jimp + opentype.js); texto e logo nunca são gerados pela IA — são aplicados por cima para ficarem legíveis e fiéis à marca.
- Calendário automático do Instagram vive em src/lib/instagram/auto-calendar.server.ts: ig_auto_runs guarda período/dias/horários; computeSlots fixa as datas (SP, UTC-3) e a IA só preenche o conteúdo; posts levam automation (publish|approval) e run_id; processado pelo mesmo cron /api/public/cron/instagram (task media).
- Automatic image-provider fallback keeps its ordered candidate list immutable across concurrent variations, because each attempt must be able to retry every eligible provider independently.
