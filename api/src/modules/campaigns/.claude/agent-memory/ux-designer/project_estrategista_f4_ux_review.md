---
name: estrategista-f4-ux-review
description: Revisão de UX de 2026-10-30 da F4 do piloto (conferência "Pronto para ligar", bloqueios da Meta, papéis): achados principais para conferir na rodada de correção
metadata:
  type: project
---

Revisão de UX da F4 (Meu Funil, estrategista) em 2026-10-30. Pessoas: Diego (dono, celular, aprova o plano e liga), marketing (começa, não liga verba nem conecta a Meta), quem só vê.

Achados que a correção precisa fechar (conferir na próxima revisão):
- Bloqueante: LANDING_MISSING/BUDGET_MISSING/GEO_UNRESOLVED mandavam para a aba Briefing, que é só leitura; os formulários de correção ficam acima das abas e o da cidade só aparecia depois de um "Publicar" manual. GEO_UNRESOLVED do piloto não tinha onde corrigir.
- Destino "leads": o plano mostrava a URL e a conferência dizia "formulário"; "cai no seu CRM" só vale com a integração de formulários da Meta ligada; sem link de privacidade, o formulário usa a página de destino.
- "Não usar esta arte": sem confirmação, sem desfazer e sem endpoint de volta; miniaturas de ~99 px em 360 px.
- "Ligar" desabilitado sem dizer o que falta; "Onde" lia texto livre em vez de `geo_targets` + raio.
- Conectar a Meta exige dono/admin, mas o botão aparecia para marketing. O cartão da lista dizia "Tudo pronto" quando faltava ligar.

**Why:** a F5 (ligar/otimizar) reabre a conferência e os bloqueios; esses pontos não aparecem nos testes.
**How to apply:** na próxima revisão, conferir esses itens antes de olhar coisas novas. Relaciona com [[estrategista-f4-review]] (memória do arquiteto em meu-funil/.claude/agent-memory/software-architect).
