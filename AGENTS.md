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
