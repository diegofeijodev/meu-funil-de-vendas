/**
 * 8.2 Guias "Como fazer" de cada módulo: passos numerados, link direto e referência oficial.
 * Mantidos num só lugar para o texto ficar consistente entre as telas.
 */
import type { HowToStep } from "@/components/how-to";

type Guide = { title: string; steps: HowToStep[]; references?: { label: string; url: string }[] };

export const GUIDES: Record<
  "agency" | "brands" | "campaignNew" | "campaign" | "studio" | "library" | "instagram" | "crm" | "cadences" | "sdr" | "insights",
  Guide
> = {
  agency: {
    title: "Como usar o painel da agência",
    steps: [
      "Cada linha é uma empresa (cliente). Crie novas empresas no seletor do menu lateral.",
      "Em Integrações, na empresa da agência, conecte as IAs uma vez e use \"aplicar a todas as minhas empresas\".",
      "Cada cliente conecta a própria Meta, Instagram e WhatsApp na empresa dele.",
      "Clique nos números de leads, posts e pendências para abrir direto na empresa certa.",
    ],
  },
  brands: {
    title: "Como cadastrar a marca (DNA)",
    steps: [
      "Crie a marca e preencha descrição, público-alvo, diferenciais, concorrentes e tom de voz.",
      "Liste palavras preferidas e proibidas: a IA usa as primeiras e nunca escreve as outras.",
      "Envie o logo (PNG com fundo transparente) e fotos reais do produto marcadas como \"produto\".",
      "Em Guia visual, clique para a IA ler as fotos e sugerir estilo, luz e paleta. Revise e salve.",
      "Cadastre produtos e personas: o estrategista e o designer usam tudo isso.",
    ],
  },
  campaignNew: {
    title: "Como criar uma campanha",
    steps: [
      "Escolha a marca, dê um nome e o objetivo (Leads, WhatsApp, Vendas, Tráfego…).",
      "Descreva a oferta (produto, preço, promessa) e a página de destino.",
      "Defina público, verba total e diária e as metas (leads, vendas, CAC máximo).",
      "Ao concluir, o estrategista (IA) gera a estratégia e a copy segue essa estratégia.",
      "Na campanha, revise e aprove a estratégia antes de gerar criativos.",
    ],
  },
  campaign: {
    title: "Fluxo da campanha, do plano à Meta",
    steps: [
      "Estratégia: gere com IA, revise e clique em Aprovar estratégia.",
      "Copies: gere variações; elas seguem a big idea e os ângulos aprovados.",
      "Criativos: no Creative Studio escolha a campanha e o ângulo; aprove os melhores.",
      "Anúncios e regras: escolha estrutura (teste A/B por ângulo), CTA, posicionamentos, públicos e regras automáticas.",
      "Solicite aprovação; o dono ou um admin aprova em Aprovações e a campanha é publicada pausada.",
      "Ative na Meta. Os resultados chegam a cada 3 horas e a IA sugere otimizações em AI Insights.",
      "Opcional: com Google Ads ou TikTok Ads conectados em Integrações, crie a mesma campanha pausada nesses canais na aba Anúncios e regras.",
    ],
    references: [{ label: "Central de ajuda da Meta para anunciantes", url: "https://www.facebook.com/business/help" }],
  },
  studio: {
    title: "Como gerar criativos",
    steps: [
      "Escolha a campanha e o ângulo da estratégia: o diretor de arte segue os dois.",
      "Escolha o formato de destino (feed, stories, Reels…) e qual IA usar (Automático usa Higgsfield, suas chaves ou os créditos do app).",
      "Use \"Usar a copy da campanha\" para preencher título e chamada; o texto é aplicado por cima, nunca desenhado pela IA.",
      "Opcional: clique em Montar com diretor de arte para ver e editar o prompt antes de gerar.",
      "Vídeos rodam em segundo plano; marque \"capa com logo\" para sair com capa e legendas. Use \"Pacote para CapCut\" para editar.",
      "Aprove os melhores: só criativos aprovados vão para a Meta.",
    ],
  },
  library: {
    title: "Como organizar a biblioteca",
    steps: [
      "Tudo que é gerado ou enviado fica aqui, no tamanho certo para Instagram e anúncios.",
      "Filtre por marca, campanha, formato, pasta ou tag; selecione várias mídias para mover, marcar, aprovar ou excluir.",
      "Na ficha da mídia veja o ângulo e os resultados reais nos anúncios.",
      "Use Enviar ao Canva para editar e Importar do Canva para trazer a versão final.",
      "A aba Textos guarda copies, legendas e roteiros de todas as campanhas.",
    ],
  },
  instagram: {
    title: "Como funciona o Instagram",
    steps: [
      "Conecte a conta profissional em Visão geral (usa a Página e o token da Meta).",
      "Em Estratégia, crie o plano (pilares, frequência, horários) — ou crie a partir da estratégia de uma campanha.",
      "No Calendário, gere as ideias da semana; depois gere a mídia de cada post (texto e logo entram por cima).",
      "Aprove em Aprovações e agende: a publicação é automática na hora marcada.",
      "Ligue o piloto automático para gerar e agendar toda semana. Resultados e insights da conta ficam em Resultados.",
    ],
    references: [{ label: "Publicação de conteúdo (Meta)", url: "https://developers.facebook.com/docs/instagram-platform/content-publishing" }],
  },
  crm: {
    title: "Como os leads chegam no CRM",
    steps: [
      "Em CRM → Integrações conecte WhatsApp, formulários da Meta, Instagram (Direct e comentários) e o formulário do site.",
      "Cada lead novo entra na primeira etapa do funil, com origem, campanha e UTM.",
      "O agente SDR responde, qualifica e move o lead; cadências seguem automaticamente.",
      "Quando um humano responde, a IA pausa para aquele lead.",
    ],
  },
  cadences: {
    title: "Como montar uma cadência",
    steps: [
      "Escolha o gatilho: origem do lead (whatsapp, meta_lead_ads, site, instagram_dm…), campanha, etapa ou tag.",
      "Adicione os passos: WhatsApp texto ou template, e-mail (Resend) ou tarefa de ligação, com espera entre eles.",
      "Fora da janela de 24 h o WhatsApp oficial só aceita template: defina um template de reserva.",
      "Regras de saída param a cadência quando o lead responde, muda de etapa ou pede para sair.",
    ],
  },
  sdr: {
    title: "Como configurar o agente SDR",
    steps: [
      "Defina nome, persona, tom e objetivo do agente.",
      "Liste as perguntas de qualificação com peso e a nota mínima para qualificar.",
      "Cole a base de conhecimento (ou envie documentos): o agente não inventa o que não está lá.",
      "Conecte a agenda (Cal.com) em CRM → Integrações para ele oferecer horários reais; senão, informe um link de agendamento.",
      "Use Testar agente antes de ativar.",
    ],
  },
  insights: {
    title: "Como funciona o otimizador",
    steps: [
      "Os resultados da Meta são sincronizados a cada 3 horas (ou em Atualizar da Meta).",
      "Rode o AI Optimizer: a IA lê os números reais e sugere ações com justificativa.",
      "Ações de pausar anúncio e mudar verba são executadas na Meta quando o dono ou um admin clica em Aplicar.",
      "Regras automáticas (configuradas em cada campanha) aparecem aqui como \"Regra automática\".",
    ],
  },
};
