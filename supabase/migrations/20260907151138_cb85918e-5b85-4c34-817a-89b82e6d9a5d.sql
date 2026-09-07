
-- ENUMS
create type public.workspace_role as enum ('owner','admin','marketing','viewer');

-- PROFILES
create table public.profiles (
  id uuid primary key,
  email text,
  full_name text,
  avatar_url text,
  created_at timestamptz not null default now()
);
grant select, insert, update on public.profiles to authenticated;
grant all on public.profiles to service_role;
alter table public.profiles enable row level security;
create policy "own profile" on public.profiles for all to authenticated using (id = auth.uid()) with check (id = auth.uid());

-- WORKSPACES
create table public.workspaces (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text not null,
  plan text not null default 'trial',
  owner_id uuid not null,
  created_at timestamptz not null default now()
);
create table public.workspace_members (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  user_id uuid not null,
  role public.workspace_role not null default 'marketing',
  created_at timestamptz not null default now(),
  unique (workspace_id, user_id)
);

create or replace function public.is_workspace_member(_ws uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.workspace_members m where m.workspace_id = _ws and m.user_id = auth.uid());
$$;

create or replace function public.has_workspace_role(_ws uuid, _roles public.workspace_role[])
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.workspace_members m where m.workspace_id = _ws and m.user_id = auth.uid() and m.role = any(_roles));
$$;

grant select, insert, update, delete on public.workspaces to authenticated;
grant all on public.workspaces to service_role;
alter table public.workspaces enable row level security;
create policy "members read ws" on public.workspaces for select to authenticated using (public.is_workspace_member(id));
create policy "create ws" on public.workspaces for insert to authenticated with check (owner_id = auth.uid());
create policy "owners update ws" on public.workspaces for update to authenticated using (public.has_workspace_role(id, array['owner','admin']::public.workspace_role[]));
create policy "owners delete ws" on public.workspaces for delete to authenticated using (owner_id = auth.uid());

grant select, insert, update, delete on public.workspace_members to authenticated;
grant all on public.workspace_members to service_role;
alter table public.workspace_members enable row level security;
create policy "read members" on public.workspace_members for select to authenticated using (public.is_workspace_member(workspace_id));
create policy "manage members" on public.workspace_members for all to authenticated
  using (public.has_workspace_role(workspace_id, array['owner','admin']::public.workspace_role[]))
  with check (public.has_workspace_role(workspace_id, array['owner','admin']::public.workspace_role[]));

-- Generic table factory (written out explicitly below)
create table public.brands (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  name text not null,
  description text,
  website text,
  segment text,
  differentials text,
  target_audience text,
  competitors text,
  tone_of_voice text,
  preferred_words text[] not null default '{}',
  banned_words text[] not null default '{}',
  primary_color text default '#4F46E5',
  secondary_color text default '#0EA5E9',
  typography text,
  logo_url text,
  region text,
  past_campaigns text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.brand_assets (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  brand_id uuid not null references public.brands(id) on delete cascade,
  kind text not null default 'photo',
  name text,
  url text,
  created_at timestamptz not null default now()
);

create table public.products (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  brand_id uuid not null references public.brands(id) on delete cascade,
  name text not null,
  description text,
  price numeric,
  margin_percent numeric,
  created_at timestamptz not null default now()
);

create table public.personas (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  brand_id uuid not null references public.brands(id) on delete cascade,
  name text not null,
  age_range text,
  location text,
  interests text,
  pains text,
  desires text,
  segment_type text default 'B2C',
  created_at timestamptz not null default now()
);

create table public.campaigns (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  brand_id uuid not null references public.brands(id) on delete cascade,
  name text not null,
  objective text not null default 'leads',
  status text not null default 'draft',
  offer_product text,
  offer_price numeric,
  offer_promise text,
  landing_url text,
  start_date date,
  end_date date,
  audience jsonb not null default '{}'::jsonb,
  budget_total numeric default 0,
  budget_daily numeric default 0,
  goal_leads numeric,
  goal_sales numeric,
  avg_ticket numeric,
  margin_percent numeric,
  max_cac numeric,
  formats text[] not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.campaign_strategies (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  campaign_id uuid not null references public.campaigns(id) on delete cascade,
  version integer not null default 1,
  status text not null default 'draft',
  content jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table public.copies (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  campaign_id uuid not null references public.campaigns(id) on delete cascade,
  version integer not null default 1,
  status text not null default 'draft',
  content jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table public.creatives (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  campaign_id uuid references public.campaigns(id) on delete cascade,
  brand_id uuid references public.brands(id) on delete cascade,
  title text not null,
  type text not null default 'static_image',
  prompt text,
  aspect_ratio text default '1:1',
  copy_text text,
  status text not null default 'draft',
  version integer not null default 1,
  provider text not null default 'mock',
  estimated_cost numeric default 0,
  real_cost numeric default 0,
  preview_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.creative_versions (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  creative_id uuid not null references public.creatives(id) on delete cascade,
  version integer not null default 1,
  prompt text,
  preview_url text,
  created_at timestamptz not null default now()
);

create table public.social_posts (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  brand_id uuid references public.brands(id) on delete cascade,
  campaign_id uuid references public.campaigns(id) on delete set null,
  channel text not null default 'instagram_feed',
  title text not null,
  copy_text text,
  creative_id uuid references public.creatives(id) on delete set null,
  status text not null default 'idea',
  scheduled_at timestamptz,
  created_at timestamptz not null default now()
);

create table public.publishing_jobs (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  campaign_id uuid references public.campaigns(id) on delete cascade,
  post_id uuid references public.social_posts(id) on delete cascade,
  target text not null default 'meta',
  status text not null default 'queued',
  mode text not null default 'mock',
  log text,
  created_at timestamptz not null default now()
);

create table public.meta_accounts (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  ad_account_id text,
  facebook_page text,
  instagram_account text,
  pixel_id text,
  status text not null default 'mock',
  created_at timestamptz not null default now()
);

create table public.meta_campaigns (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  campaign_id uuid not null references public.campaigns(id) on delete cascade,
  external_id text,
  name text not null,
  objective text,
  status text not null default 'paused',
  created_at timestamptz not null default now()
);

create table public.meta_adsets (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  meta_campaign_id uuid not null references public.meta_campaigns(id) on delete cascade,
  name text not null,
  daily_budget numeric,
  targeting jsonb not null default '{}'::jsonb,
  placements text[] not null default '{}',
  status text not null default 'paused',
  created_at timestamptz not null default now()
);

create table public.meta_ads (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  meta_adset_id uuid not null references public.meta_adsets(id) on delete cascade,
  creative_id uuid references public.creatives(id) on delete set null,
  name text not null,
  utm text,
  status text not null default 'paused',
  created_at timestamptz not null default now()
);

create table public.performance_daily (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  campaign_id uuid not null references public.campaigns(id) on delete cascade,
  creative_id uuid references public.creatives(id) on delete set null,
  adset_name text,
  date date not null,
  spend numeric not null default 0,
  impressions bigint not null default 0,
  reach bigint not null default 0,
  clicks bigint not null default 0,
  leads bigint not null default 0,
  conversions bigint not null default 0,
  revenue numeric not null default 0,
  created_at timestamptz not null default now()
);

create table public.conversions (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  campaign_id uuid not null references public.campaigns(id) on delete cascade,
  value numeric not null default 0,
  source text default 'meta',
  occurred_at timestamptz not null default now()
);

create table public.campaign_costs (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  campaign_id uuid not null references public.campaigns(id) on delete cascade,
  kind text not null default 'ai',
  description text,
  amount numeric not null default 0,
  created_at timestamptz not null default now()
);

create table public.ai_recommendations (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  campaign_id uuid references public.campaigns(id) on delete cascade,
  action text not null,
  title text not null,
  reason text not null,
  estimated_impact text,
  severity text not null default 'medium',
  requires_approval boolean not null default true,
  status text not null default 'pending',
  created_at timestamptz not null default now()
);

create table public.brand_learnings (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  brand_id uuid not null references public.brands(id) on delete cascade,
  category text not null,
  value text not null,
  metric text,
  score numeric default 0,
  created_at timestamptz not null default now()
);

create table public.integration_connections (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  provider text not null,
  status text not null default 'disconnected',
  mode text not null default 'mock',
  account_label text,
  connected_at timestamptz,
  created_at timestamptz not null default now(),
  unique (workspace_id, provider)
);

create table public.approval_requests (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  entity_type text not null,
  entity_id uuid,
  campaign_id uuid references public.campaigns(id) on delete cascade,
  title text not null,
  summary text,
  status text not null default 'pending',
  requested_by uuid,
  decided_by uuid,
  decided_at timestamptz,
  created_at timestamptz not null default now()
);

create table public.activity_logs (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  actor_id uuid,
  action text not null,
  entity_type text,
  entity_id uuid,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

-- Grants + RLS for all workspace-scoped tables
do $$
declare t text;
begin
  foreach t in array array[
    'brands','brand_assets','products','personas','campaigns','campaign_strategies','copies',
    'creatives','creative_versions','social_posts','publishing_jobs','meta_accounts','meta_campaigns',
    'meta_adsets','meta_ads','performance_daily','conversions','campaign_costs','ai_recommendations',
    'brand_learnings','integration_connections','approval_requests','activity_logs'
  ] loop
    execute format('grant select, insert, update, delete on public.%I to authenticated', t);
    execute format('grant all on public.%I to service_role', t);
    execute format('alter table public.%I enable row level security', t);
    execute format('create policy "ws members full access" on public.%I for all to authenticated using (public.is_workspace_member(workspace_id)) with check (public.is_workspace_member(workspace_id))', t);
    execute format('create index on public.%I (workspace_id)', t);
  end loop;
end $$;

create index on public.performance_daily (campaign_id, date);
create index on public.campaigns (brand_id);

-- SEED FUNCTION
create or replace function public.seed_demo_workspace(_ws uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  b uuid; c1 uuid; c2 uuid; cr uuid; cr2 uuid; d date; i int;
begin
  insert into public.brands (workspace_id, name, description, website, segment, differentials, target_audience,
    competitors, tone_of_voice, preferred_words, banned_words, primary_color, secondary_color, typography, region, past_campaigns)
  values (_ws, 'Nutrivita Suplementos',
    'Marca de suplementos naturais premium com foco em performance e longevidade.',
    'https://nutrivita.com.br', 'Saúde e bem-estar',
    'Fórmulas veganas, matéria-prima rastreada, laudo de pureza em cada lote.',
    'Adultos 28-45 anos, praticantes de atividade física, classe A/B, grandes centros urbanos.',
    'Growth Supplements, Essential Nutrition, Vitafor',
    'Confiante, científico e acolhedor. Fala como um especialista amigo, sem prometer milagres.',
    array['performance','longevidade','ciência','rastreabilidade'],
    array['milagroso','cura','emagrece rápido'],
    '#4F46E5','#22C55E','Inter / Söhne','Brasil - foco SP, RJ e MG',
    'Black Friday 2024 (ROAS 4,2) e Lançamento Whey Vegan (ROAS 3,1).')
  returning id into b;

  insert into public.products (workspace_id, brand_id, name, description, price, margin_percent) values
    (_ws, b, 'Whey Vegan 900g', 'Proteína isolada de ervilha e arroz, 24g por dose.', 249.90, 62),
    (_ws, b, 'Creatina Pure 300g', 'Creatina monohidratada com laudo de pureza.', 149.90, 68),
    (_ws, b, 'Multivitamínico Daily', 'Complexo diário com 23 nutrientes.', 89.90, 71);

  insert into public.personas (workspace_id, brand_id, name, age_range, location, interests, pains, desires, segment_type) values
    (_ws, b, 'Marina, a performer consciente', '28-38', 'São Paulo capital', 'Treino funcional, corrida, alimentação limpa',
     'Falta de energia no fim do dia e desconfiança com suplementos', 'Performance sustentável e saúde a longo prazo', 'B2C'),
    (_ws, b, 'Rafael, o atleta amador', '30-45', 'RJ e BH', 'Musculação, crossfit, wearables',
     'Platô de resultados', 'Ganho de massa magra com segurança', 'B2C');

  insert into public.brand_learnings (workspace_id, brand_id, category, value, metric, score) values
    (_ws, b, 'headline', 'Perguntas que citam a dor específica ("Cansaço às 15h?")', 'CTR médio 2,9%', 92),
    (_ws, b, 'cta', 'Quero meu protocolo', 'CVR 8,1%', 88),
    (_ws, b, 'formato', 'Reels UGC de 18 segundos', 'CPL R$ 9,40', 95),
    (_ws, b, 'publico', 'Lookalike 1% compradores 180 dias', 'CAC R$ 61', 90),
    (_ws, b, 'angulo', 'Prova científica + laudo de pureza', 'ROAS 4,4', 86),
    (_ws, b, 'horario', 'Terças e quintas, 18h-21h', 'CPM 22% menor', 78);

  insert into public.campaigns (workspace_id, brand_id, name, objective, status, offer_product, offer_price, offer_promise,
    landing_url, start_date, end_date, audience, budget_total, budget_daily, goal_leads, goal_sales, avg_ticket, margin_percent, max_cac, formats)
  values (_ws, b, 'Protocolo Performance - Leads Q3', 'leads', 'active', 'Whey Vegan 900g', 249.90,
    'Kit de 30 dias com plano nutricional gratuito', 'https://nutrivita.com.br/protocolo',
    current_date - 20, current_date + 10,
    '{"idade":"28-45","localizacao":"SP, RJ, MG","interesses":"fitness, nutrição, corrida","tipo":"B2C","temperatura":"frio"}'::jsonb,
    18000, 600, 450, 120, 249.90, 62, 70, array['static_image','video','carousel'])
  returning id into c1;

  insert into public.campaigns (workspace_id, brand_id, name, objective, status, offer_product, offer_price, offer_promise,
    landing_url, start_date, end_date, audience, budget_total, budget_daily, goal_leads, goal_sales, avg_ticket, margin_percent, max_cac, formats)
  values (_ws, b, 'Remarketing Creatina - Setembro', 'remarketing', 'draft', 'Creatina Pure 300g', 149.90,
    'Frete grátis + 10% off na primeira compra', 'https://nutrivita.com.br/creatina',
    current_date - 5, current_date + 25,
    '{"idade":"25-45","localizacao":"Brasil","interesses":"musculação","tipo":"B2C","temperatura":"remarketing"}'::jsonb,
    6000, 200, 180, 90, 149.90, 68, 45, array['static_image','stories'])
  returning id into c2;

  insert into public.campaign_strategies (workspace_id, campaign_id, version, status, content) values
  (_ws, c1, 1, 'approved', jsonb_build_object(
    'resumo_executivo','Campanha de geração de leads qualificados para o Protocolo Performance, explorando a autoridade científica da Nutrivita e a dor de queda de energia no meio da tarde. Meta de 450 leads a um CPL máximo de R$ 40 e CAC de R$ 70.',
    'problema','O público testa suplementos, não vê resultado consistente e desconfia de promessas exageradas do mercado.',
    'objetivo_smart','Gerar 450 leads qualificados em 30 dias com CPL <= R$ 40 e converter 120 vendas com CAC <= R$ 70.',
    'icp','Marina, 28-38 anos, treina 4x por semana, mora em capitais, renda acima de R$ 8 mil, valoriza evidência científica.',
    'oferta','Kit de 30 dias do Whey Vegan + plano nutricional personalizado gratuito.',
    'big_idea','Performance não vem de promessa, vem de laudo.',
    'angulos', jsonb_build_array('Prova científica e laudo de pureza','Energia estável o dia inteiro','Vegano sem abrir mão de 24g de proteína','Depoimento UGC de atleta amadora','Comparativo honesto com concorrentes'),
    'funil','Topo: vídeo educativo sobre absorção proteica. Meio: quiz de perfil nutricional. Fundo: oferta do kit com plano gratuito.',
    'mensagem_principal','O único whey vegano com laudo de pureza por lote e 24g de proteína por dose.',
    'objecoes', jsonb_build_array(
      jsonb_build_object('objecao','Proteína vegana não tem o mesmo efeito','resposta','Blend de ervilha e arroz com perfil completo de aminoácidos, comprovado em laudo.'),
      jsonb_build_object('objecao','É caro','resposta','Custo por dose de R$ 8,30, abaixo da média premium do mercado.'),
      jsonb_build_object('objecao','Já tentei outros e não funcionou','resposta','Plano nutricional incluso ajusta a dose ao seu treino.')),
    'canais','Meta Ads (Instagram + Facebook) 80%, Instagram orgânico 20%.',
    'distribuicao_verba', jsonb_build_object('prospeccao',60,'remarketing',25,'teste_criativos',15),
    'kpis', jsonb_build_object('CPL','<= R$ 40','CTR','>= 1,8%','CAC','<= R$ 70','ROAS','>= 3,5'),
    'hipoteses', jsonb_build_array('UGC supera criativo institucional em CTR','Quiz reduz CPL em 20%','Público lookalike de compradores tem menor CAC'),
    'plano_testes','A/B de headline (dor vs. prova) por 7 dias, 2 criativos por conjunto, corte no CPL 30% acima da meta.',
    'cronograma','Semana 1: aquecimento e testes. Semana 2: escala do vencedor. Semana 3: remarketing. Semana 4: oferta final.',
    'recomendacoes', jsonb_build_array('Instalar evento de lead no pixel antes do go-live','Preparar 3 variações de UGC','Ativar remarketing só após 200 cliques')));

  insert into public.copies (workspace_id, campaign_id, version, status, content) values
  (_ws, c1, 1, 'approved', jsonb_build_object(
    'headline','Cansaço às 15h não é falta de café. É falta de proteína de verdade.',
    'headline_variacoes', jsonb_build_array(
      'O whey vegano com laudo de pureza em cada lote',
      '24g de proteína vegetal. Zero promessa vazia.',
      'Sua performance merece mais que marketing',
      'Testado em laboratório, aprovado no treino',
      'Energia estável do treino ao fim do expediente'),
    'texto_curto','Whey Vegan Nutrivita: 24g de proteína, laudo de pureza por lote e plano nutricional gratuito nos primeiros 30 dias.',
    'texto_longo','Você treina, come bem e ainda assim trava no meio da tarde. Na maioria das vezes o problema não é disciplina: é a qualidade da proteína que você consome. O Whey Vegan Nutrivita combina isolado de ervilha e arroz para entregar 24g de proteína com perfil completo de aminoácidos, com laudo de pureza publicado a cada lote. Nos primeiros 30 dias você recebe um plano nutricional ajustado à sua rotina de treino, sem custo. Sem promessa de milagre, com evidência.',
    'cta','Quero meu protocolo',
    'meta_ad','Whey vegano com 24g de proteína e laudo de pureza por lote. Receba o plano nutricional de 30 dias gratuito. Quero meu protocolo.',
    'instagram_feed','Nem todo whey vegano entrega o que promete. O nosso publica o laudo. 24g de proteína por dose, blend de ervilha e arroz, plano nutricional gratuito por 30 dias. Link na bio.',
    'reels','[0-3s] Você trava às 15h? [3-8s] Não é o café. [8-15s] É proteína de baixa absorção. [15-22s] Mostra o laudo de pureza. [22-28s] Quero meu protocolo.',
    'stories','Story 1: enquete "Você trava no meio da tarde?" / Story 2: dado sobre absorção proteica / Story 3: laudo do lote / Story 4: CTA arrasta pra cima.',
    'script_ugc','Abertura em câmera na mão: "Eu testei 4 wheys veganos esse ano." Corte para cozinha preparando o shake. "Esse é o único que veio com laudo do lote." Corte para treino. "Três semanas depois, meu treino não cai mais no fim." Fechamento: "Quero meu protocolo, link na bio."',
    'script_institucional','Plano aberto do laboratório. Narração: "Cada lote da Nutrivita passa por análise independente." Cortes de produção, atleta treinando, encerramento com assinatura da marca.',
    'carrossel', jsonb_build_array(
      'Slide 1: Cansaço às 15h não é falta de café',
      'Slide 2: A maioria dos wheys veganos entrega menos proteína do que anuncia',
      'Slide 3: Nosso blend: ervilha + arroz = perfil completo de aminoácidos',
      'Slide 4: 24g de proteína por dose',
      'Slide 5: Laudo de pureza publicado por lote',
      'Slide 6: Plano nutricional gratuito nos primeiros 30 dias',
      'Slide 7: Quero meu protocolo'),
    'quiz', jsonb_build_array(
      jsonb_build_object('pergunta','Quantas vezes por semana você treina?','opcoes', jsonb_build_array('1-2','3-4','5+')),
      jsonb_build_object('pergunta','Em que momento do dia sua energia cai?','opcoes', jsonb_build_array('Manhã','Tarde','Noite')),
      jsonb_build_object('pergunta','Você já usa suplemento proteico?','opcoes', jsonb_build_array('Sim, animal','Sim, vegetal','Não')))));

  insert into public.creatives (workspace_id, campaign_id, brand_id, title, type, prompt, aspect_ratio, copy_text, status, version, estimated_cost, real_cost)
  values (_ws, c1, b, 'UGC - Atleta amadora testa o laudo', 'ugc', 'Vídeo vertical estilo UGC, atleta amadora em cozinha iluminada preparando shake, tom natural', '9:16',
    'Eu testei 4 wheys veganos esse ano. Só um veio com laudo.', 'approved', 2, 4.50, 4.20)
  returning id into cr;
  insert into public.creatives (workspace_id, campaign_id, brand_id, title, type, prompt, aspect_ratio, copy_text, status, version, estimated_cost, real_cost)
  values (_ws, c1, b, 'Estático - Laudo de pureza', 'static_image', 'Foto de produto premium sobre bancada de concreto com selo de laudo, luz lateral', '1:1',
    'Laudo de pureza publicado em cada lote.', 'approved', 1, 1.20, 1.10)
  returning id into cr2;
  insert into public.creatives (workspace_id, campaign_id, brand_id, title, type, prompt, aspect_ratio, copy_text, status, version, estimated_cost, real_cost) values
    (_ws, c1, b, 'Carrossel - 7 slides da objeção', 'carousel', 'Carrossel editorial minimalista com tipografia forte', '4:5', 'Cansaço às 15h não é falta de café.', 'ready', 1, 2.00, 0),
    (_ws, c2, b, 'Stories - Frete grátis creatina', 'story', 'Story dinâmico com selo de frete grátis e produto em destaque', '9:16', 'Frete grátis na sua creatina hoje.', 'draft', 1, 0.90, 0),
    (_ws, c1, b, 'Quiz - Perfil nutricional', 'quiz', 'Card interativo de quiz com 3 perguntas', '1:1', 'Descubra seu protocolo em 3 perguntas.', 'generating', 1, 1.50, 0);

  for i in 0..29 loop
    d := current_date - i;
    insert into public.performance_daily (workspace_id, campaign_id, creative_id, adset_name, date, spend, impressions, reach, clicks, leads, conversions, revenue)
    values (_ws, c1, cr, 'Lookalike 1% compradores', d,
      round((320 + random()*120)::numeric,2), (18000 + random()*6000)::bigint, (14000 + random()*4000)::bigint,
      (320 + random()*120)::bigint, (9 + random()*7)::bigint, (3 + random()*3)::bigint, round((900 + random()*700)::numeric,2));
    insert into public.performance_daily (workspace_id, campaign_id, creative_id, adset_name, date, spend, impressions, reach, clicks, leads, conversions, revenue)
    values (_ws, c1, cr2, 'Interesses fitness frio', d,
      round((210 + random()*90)::numeric,2), (13000 + random()*5000)::bigint, (10000 + random()*3000)::bigint,
      (180 + random()*90)::bigint, (5 + random()*5)::bigint, (1 + random()*3)::bigint, round((450 + random()*600)::numeric,2));
  end loop;

  insert into public.campaign_costs (workspace_id, campaign_id, kind, description, amount) values
    (_ws, c1, 'ai', 'Geração de criativos e copies (IA)', 186.40),
    (_ws, c1, 'other', 'Produção de UGC com criadora', 900.00);

  insert into public.ai_recommendations (workspace_id, campaign_id, action, title, reason, estimated_impact, severity, requires_approval) values
    (_ws, c1, 'increase_budget', 'Aumentar orçamento do conjunto Lookalike 1% em 30%',
     'Nos últimos 7 dias esse conjunto teve CPL de R$ 31,80 (21% abaixo da meta de R$ 40) e ROAS de 4,1 com frequência ainda em 1,7.',
     'Estimativa de +38 leads/mês mantendo CPL abaixo de R$ 38.', 'high', true),
    (_ws, c1, 'pause_creative', 'Pausar o criativo estático "Laudo de pureza"',
     'CTR caiu de 1,9% para 0,8% em 5 dias e o CPL subiu para R$ 61,20, 53% acima da meta.',
     'Economia estimada de R$ 1.400 no mês, realocados para o UGC vencedor.', 'high', true),
    (_ws, c1, 'test_headline', 'Testar nova headline focada em prova social',
     'As headlines de dor já rodaram 22 mil impressões e a curva de CTR está achatando.',
     'Potencial de +0,4pp de CTR com base no histórico da marca.', 'medium', true),
    (_ws, c1, 'create_variation', 'Criar 2 variações do UGC vencedor',
     'O UGC responde por 68% dos leads e ainda tem frequência baixa; variações mantêm o ângulo e renovam o criativo.',
     'Prolonga a vida útil do ângulo por ~3 semanas.', 'medium', true),
    (_ws, c2, 'create_remarketing', 'Ativar remarketing de 14 dias para visitantes da página da creatina',
     '1.240 visitantes não converteram nos últimos 14 dias e a campanha ainda está em rascunho.',
     'Projeção de 40-55 vendas adicionais com CAC próximo de R$ 38.', 'medium', true);

  insert into public.social_posts (workspace_id, brand_id, campaign_id, channel, title, copy_text, creative_id, status, scheduled_at) values
    (_ws, b, c1, 'instagram_reels', 'Reels: o teste do laudo', 'Você trava às 15h? Não é o café.', cr, 'scheduled', now() + interval '1 day'),
    (_ws, b, c1, 'instagram_feed', 'Carrossel: 7 objeções sobre whey vegano', 'Nem todo whey vegano entrega o que promete.', cr2, 'approved', now() + interval '3 day'),
    (_ws, b, c1, 'instagram_stories', 'Stories: enquete de energia', 'Você trava no meio da tarde?', null, 'draft', now() + interval '5 day'),
    (_ws, b, c2, 'facebook', 'Post: frete grátis creatina', 'Frete grátis na creatina com laudo de pureza.', null, 'idea', now() + interval '7 day'),
    (_ws, b, c1, 'instagram_feed', 'Bastidores do laboratório', 'Cada lote passa por análise independente.', null, 'published', now() - interval '2 day');

  insert into public.approval_requests (workspace_id, entity_type, entity_id, campaign_id, title, summary, status) values
    (_ws, 'campaign', c2, c2, 'Publicar campanha "Remarketing Creatina - Setembro" na Meta', 'Orçamento diário de R$ 200, 2 criativos, público de remarketing 14 dias.', 'pending'),
    (_ws, 'creative', cr, c1, 'Aprovar novo corte do UGC (v2)', 'Versão de 18s com legenda queimada e CTA no fim.', 'pending'),
    (_ws, 'recommendation', null, c1, 'Aumentar orçamento do Lookalike 1% em 30%', 'Recomendação do AI Optimizer com base em CPL 21% abaixo da meta.', 'pending');

  insert into public.meta_accounts (workspace_id, ad_account_id, facebook_page, instagram_account, pixel_id, status)
  values (_ws, 'act_000000000 (mock)', 'Nutrivita Brasil', '@nutrivita.oficial', 'px_mock_9931', 'mock');

  insert into public.integration_connections (workspace_id, provider, status, mode, account_label) values
    (_ws, 'higgsfield', 'disconnected', 'mock', null),
    (_ws, 'meta', 'connected', 'mock', 'Nutrivita Brasil (sandbox)'),
    (_ws, 'openai_image', 'disconnected', 'mock', null);

  insert into public.activity_logs (workspace_id, action, entity_type, metadata) values
    (_ws, 'workspace.created', 'workspace', '{"origem":"onboarding"}'::jsonb),
    (_ws, 'campaign.strategy_generated', 'campaign', '{"campanha":"Protocolo Performance - Leads Q3"}'::jsonb),
    (_ws, 'creative.approved', 'creative', '{"criativo":"UGC - Atleta amadora testa o laudo"}'::jsonb);
end $$;

-- NEW USER HANDLER
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
declare ws uuid;
begin
  insert into public.profiles (id, email, full_name)
  values (new.id, new.email, coalesce(new.raw_user_meta_data->>'full_name', split_part(new.email,'@',1)));

  insert into public.workspaces (name, slug, owner_id)
  values (coalesce(new.raw_user_meta_data->>'company_name', 'Meu Workspace'),
          'ws-' || substr(replace(new.id::text,'-',''),1,10), new.id)
  returning id into ws;

  insert into public.workspace_members (workspace_id, user_id, role) values (ws, new.id, 'owner');
  perform public.seed_demo_workspace(ws);
  return new;
end $$;

create trigger on_auth_user_created after insert on auth.users
for each row execute function public.handle_new_user();

create or replace function public.touch_updated_at()
returns trigger language plpgsql set search_path = public as $$
begin new.updated_at = now(); return new; end $$;

create trigger t_brands_updated before update on public.brands for each row execute function public.touch_updated_at();
create trigger t_campaigns_updated before update on public.campaigns for each row execute function public.touch_updated_at();
create trigger t_creatives_updated before update on public.creatives for each row execute function public.touch_updated_at();
