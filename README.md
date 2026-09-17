# AI Marketing Pilot

Crie uma aplicação SaaS full-stack chamada provisoriamente de AI Marketing OS, uma agência de marketing operada por IA.

OBJETIVO DO PRODUTO
O usuário cadastra sua empresa, identidade visual, marca, produtos/serviços, público-alvo e objetivos de marketing. A plataforma transforma isso automaticamente em estratégia, criativos, copy, campanhas, publicações e análise de ROI, mantendo um fluxo de aprovação humana antes de ações externas.

ARQUITETURA DO PRODUTO

1. AUTH + WORKSPACES
- Login e cadastro.
- Multiempresa/multimarca.
- Cada workspace representa um negócio ou cliente de agência.
- Perfis: Owner, Admin, Marketing, Viewer.

2. BRAND BRAIN
Página Brand Kit / DNA da Marca com:
- Nome da empresa.
- Descrição do negócio.
- Site.
- Segmento.
- Produtos/serviços.
- Diferenciais.
- Público-alvo.
- Concorrentes.
- Tom de voz.
- Palavras que deve usar e palavras proibidas.
- Cores primárias/secundárias.
- Logos com upload.
- Tipografia.
- Fotos de referência.
- Exemplos de campanhas anteriores.
- Persona principal.
- Região geográfica atendida.
Guardar tudo em banco e disponibilizar como contexto para os agentes de IA.

3. NOVA CAMPANHA – WIZARD
Fluxo simples em etapas:
Etapa A – Objetivo
- Reconhecimento
- Engajamento
- Tráfego
- Leads
- WhatsApp
- Vendas/Conversão
- Remarketing

Etapa B – Oferta
- Produto/serviço
- Preço
- Condição/promessa
- URL/landing page
- Datas da campanha

Etapa C – Público
- Persona sugerida a partir do Brand Brain
- Idade
- Localização
- Interesses
- Segmento B2B/B2C
- Público frio, morno ou remarketing

Etapa D – Orçamento e metas
- Orçamento total
- Orçamento diário
- Meta de leads/vendas
- Ticket médio
- Margem estimada
- CAC máximo desejado

Etapa E – Formatos
checkboxes:
- Imagem estática
- Vídeo/Reels
- Carrossel
- Stories
- Quiz/interativo
- UGC

Botão principal: GERAR CAMPANHA COM IA.

4. AGENTE ESTRATEGISTA
Após o briefing, gerar uma tela Campaign Strategy contendo:
- Resumo executivo.
- Problema/oportunidade.
- Objetivo SMART.
- ICP/persona.
- Oferta e posicionamento.
- Big Idea.
- Ângulos criativos.
- Funil.
- Mensagem principal.
- Objeções e respostas.
- Plano de canais.
- Distribuição de verba.
- KPIs alvo.
- Hipóteses a testar.
- Plano de testes A/B.
- Cronograma.
- Recomendações.

Criar versões editáveis e salvar histórico/versionamento.

5. COPY ENGINE
Para cada campanha gerar automaticamente:
- Headline principal.
- 5 variações de headline.
- Texto curto.
- Texto longo.
- CTA obrigatório.
- Texto de anúncio Meta.
- Copy para Instagram feed.
- Copy para Reels.
- Copy para Stories.
- Script para vídeo UGC.
- Script para vídeo institucional.
- Estrutura de carrossel slide a slide.
- Perguntas e respostas do quiz.

Criar botão GERAR NOVAS VARIAÇÕES e botão APROVAR.
Toda copy deve respeitar o Brand Brain e o objetivo da campanha.

6. CREATIVE STUDIO
Interface visual estilo galeria.
Tipos:
- Static image
- Video
- Carousel
- UGC
- Story
- Quiz

Cada criativo deve possuir:
- prompt
- formato/aspect ratio
- copy relacionada
- status: draft, generating, ready, approved, rejected, published
- versão
- custo de geração estimado/real
- preview

Criar camada de integração preparada para Higgsfield.
Não acoplar a UI diretamente ao fornecedor. Criar service/provider abstraction chamada CreativeProvider, para que no futuro seja possível usar Higgsfield, OpenAI Image ou outros.

Criar tela Settings > Integrations > Higgsfield com status disconnected/connected e botão conectar. Preparar backend para OAuth/MCP/endpoint seguro, sem expor credenciais no frontend.

7. META ADS + SOCIAL PUBLISHING
Criar módulo Integrations > Meta.
Preparar arquitetura para Meta Marketing API e Instagram/Facebook publishing.
Entidades:
- ad account
- Facebook page
- Instagram account
- pixel/dataset

Fluxo de publicação:
Campaign Draft -> Human Approval -> Create Meta Campaign -> Ad Set -> Creative -> Ad -> Active.
Nunca ativar campanha sem etapa explícita de aprovação.

Permitir:
- objetivo
- orçamento
- datas
- segmentação
- placements
- criativos
- copy
- UTMs
- status

Criar páginas:
- Campaign Builder
- Media Plan
- Approval Center
- Publishing Queue

Para o MVP, criar integração simulada/mock com interfaces de serviço bem definidas e telas reais, para depois ligar APIs/credenciais.

8. CONTENT CALENDAR
Calendário semanal/mensal com posts orgânicos.
- Instagram feed
- Reels
- Stories
- Facebook
Status: idea, draft, approved, scheduled, published, failed.
Permitir abrir qualquer item e editar copy/criativo.

9. DASHBOARD DE PERFORMANCE / ROI
Tela principal de cada campanha com:
- gasto
- impressões
- alcance
- CPM
- cliques
- CTR
- CPC
- leads
- CPL
- conversões/vendas
- CPA/CAC
- receita atribuída
- ROAS
- ROI

Fórmulas:
ROAS = Receita atribuída / investimento em mídia.
ROI = (Receita atribuída - custo total da campanha) / custo total da campanha * 100.
Custo total da campanha = mídia + custo de IA/criativos + outros custos registrados.

Incluir gráficos de evolução diária, comparação entre criativos e comparação entre conjuntos de anúncios.

10. AI OPTIMIZER
Criar painel com recomendações automáticas baseadas em métricas:
- aumentar orçamento
- reduzir orçamento
- pausar criativo
- testar nova headline
- criar variação do vencedor
- trocar CTA
- mudar público
- criar remarketing

Toda recomendação precisa explicar POR QUÊ usando dados e indicar impacto estimado.
Ações que alteram Meta precisam passar por aprovação humana.

11. LEARNING LOOP
Banco deve armazenar aprendizados por marca:
- melhores headlines
- melhores CTAs
- melhores formatos
- melhores públicos
- melhores ângulos
- melhores horários/dias
- histórico de ROAS/ROI

Ao criar uma nova campanha, usar esses aprendizados como contexto para o Campaign Strategist.

12. DASHBOARD GERAL
Home com cards:
- Investimento no mês
- Receita atribuída
- ROAS
- ROI
- Leads
- CAC médio
- Campanhas ativas
- Melhor campanha
- Melhor criativo

Adicionar seção AI Insights: 3 a 5 recomendações prioritárias.

13. DATA MODEL
Criar tabelas principais:
users
workspaces
workspace_members
brands
brand_assets
products
personas
campaigns
campaign_strategies
campaign_audiences
campaign_budgets
copies
creatives
creative_versions
social_posts
publishing_jobs
meta_accounts
meta_campaigns
meta_adsets
meta_ads
performance_daily
conversions
campaign_costs
ai_recommendations
brand_learnings
integration_connections
approval_requests
activity_logs

14. UX/UI
Visual premium SaaS, clean e moderno, inspirado em Linear, HubSpot e plataformas modernas de mídia, sem copiar layouts.
Sidebar:
- Overview
- Brands
- Campaigns
- Creative Studio
- Content Calendar
- Performance
- AI Insights
- Approvals
- Integrations
- Settings

Desktop-first e responsivo.
Cards bem organizados.
Dashboard rico em dados, mas simples de ler.
Português do Brasil como idioma inicial.

15. SEGURANÇA
- tokens/segredos apenas backend.
- row level security por workspace.
- audit log.
- nenhuma publicação ou gasto externo sem aprovação.
- mostrar claramente quando uma integração estiver em mock/sandbox.

16. MVP
Nesta primeira entrega, implemente totalmente a experiência da aplicação, banco, autenticação, dados mock realistas e services/interfaces para IA, Higgsfield e Meta. O sistema precisa ser navegável ponta a ponta: criar marca -> criar campanha -> gerar estratégia simulada -> gerar copies/criativos simulados -> aprovar -> publicar mock -> visualizar dashboard e recomendações.

Não faça apenas uma landing page. Quero o produto SaaS funcional e navegável, com dados persistentes e estrutura pronta para conectarmos os provedores reais depois.

This project was built with [Lovable](https://lovable.dev).

**Live app**: https://ai-brand-pilot-87.lovable.app

## Build with Lovable

Continue developing this project in the [Lovable editor](https://lovable.dev/projects/9177203a-9cd6-4830-837f-805f2df251ed).

- **Ship faster**: describe what you want to build and Lovable handles the code.
- **Stay in sync**: every change made in Lovable is committed straight to this repository.
- **Full ownership**: this code is yours. Push to `main` on GitHub and your changes sync back into Lovable, ready for your next prompt.

## Development

Prefer working locally? You need Node.js and npm — [install with nvm](https://github.com/nvm-sh/nvm#installing-and-updating).

```sh
git clone <this-repository-url>
cd <repository-name>
npm i
npm run dev
```
