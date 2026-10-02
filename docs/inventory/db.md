# Database inventory (Lovable/Supabase prototype) - FINAL state after 41 migrations

Source: `.prototype/supabase/migrations/*.sql` (20260907151138 .. 20261002120000), cross-checked with `.prototype/src/integrations/supabase/types.ts` (63 tables, 1 enum, 3 RPC functions). `supabase/config.toml` only contains `project_id = "medgffgtvjahzbaqzxpl"`.

Conventions used below
- Everything is in schema `public` unless noted. "ws" = workspace. `uuid` PKs default `gen_random_uuid()` unless noted.
- Every ws-scoped table has `workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE` (exceptions flagged).
- "created_at" = `timestamptz NOT NULL DEFAULT now()`; "updated_at" likewise.
- Columns typed `uuid` that look like user refs (`owner_id`, `created_by`, `requested_by`, `decided_by`, `actor_id`, `assignee_id`, `author_id`, `moved_by`, `sent_by`, `applied_by`, `default_owner_id`, `user_id`) have NO foreign key to anything (not even `auth.users`).
- 63 tables, 1 enum, 8 functions, 23 triggers, 10 cron jobs, 2 buckets referenced (0 created by migrations).

---------------------------------------------------------------------------
## 1. Tables

### 1.1 Workspaces / auth

**profiles** (no FK to auth.users; id == auth.users.id by convention)
| col | type | null | default |
|---|---|---|---|
| id | uuid | NOT NULL | - (PK) |
| email | text | yes | |
| full_name | text | yes | |
| avatar_url | text | yes | |
| created_at | timestamptz | NOT NULL | now() |

**workspaces**
| col | type | null | default |
|---|---|---|---|
| id | uuid PK | | gen_random_uuid() |
| name | text | NOT NULL | |
| slug | text | NOT NULL | (NO unique constraint) |
| plan | text | NOT NULL | 'trial' |
| owner_id | uuid | NOT NULL | (no FK) |
| created_at | timestamptz | NOT NULL | now() |
| ai_inherit_from | uuid | yes | FK workspaces(id) ON DELETE SET NULL (agency: inherit AI connections from another ws) |

**workspace_members**: id PK; workspace_id FK cascade; user_id uuid NOT NULL (no FK); role `workspace_role` NOT NULL default 'marketing'; created_at. UNIQUE (workspace_id, user_id).

### 1.2 Brands

**brands**: id; workspace_id; name text NOT NULL; description, website, segment, differentials, target_audience, competitors, tone_of_voice text; preferred_words text[] NOT NULL '{}'; banned_words text[] NOT NULL '{}'; primary_color text default '#4F46E5'; secondary_color text default '#0EA5E9'; typography text; logo_url text; region text; past_campaigns text; created_at; updated_at; visual_style jsonb NOT NULL '{}'. Index (workspace_id). Trigger touch updated_at.

**brand_assets**: id; workspace_id; brand_id FK brands cascade NOT NULL; kind text NOT NULL 'photo'; name text; url text; created_at; tag text; storage_path text. Index (workspace_id).

**products**: id; workspace_id; brand_id FK brands cascade NOT NULL; name text NOT NULL; description text; price numeric; margin_percent numeric; created_at. Index (workspace_id).

**personas**: id; workspace_id; brand_id FK brands cascade NOT NULL; name text NOT NULL; age_range, location, interests, pains, desires text; segment_type text default 'B2C'; created_at. Index (workspace_id).

**brand_learnings**: id; workspace_id; brand_id FK brands cascade NOT NULL; category text NOT NULL; value text NOT NULL; metric text; score numeric default 0; created_at. Index (workspace_id).

### 1.3 Campaigns / strategy / copy / creatives

**campaigns**
| col | type | null | default |
|---|---|---|---|
| id | uuid PK | | gen_random_uuid() |
| workspace_id | uuid FK cascade | NOT NULL | |
| brand_id | uuid FK brands cascade | NOT NULL | |
| name | text | NOT NULL | |
| objective | text | NOT NULL | 'leads' |
| status | text | NOT NULL | 'draft' (free text; values used: draft, approved, active, ...; guarded by trigger) |
| offer_product, offer_promise, landing_url | text | yes | |
| offer_price | numeric | yes | |
| start_date, end_date | date | yes | |
| audience | jsonb | NOT NULL | '{}' |
| budget_total, budget_daily | numeric | yes | 0 |
| goal_leads, goal_sales, avg_ticket, margin_percent, max_cac | numeric | yes | |
| formats | text[] | NOT NULL | '{}' |
| created_at, updated_at | timestamptz | NOT NULL | now() |
| meta_campaign_id, meta_adset_id | text | yes | |
| meta_ad_ids | text[] | NOT NULL | '{}' |
| meta_delivery_status | text | yes | (value 'ACTIVE' guarded by trigger) |
| meta_adset_ids | text[] | NOT NULL | '{}' |
| meta_ad_map | jsonb | NOT NULL | '{}' |
| meta_lead_form_id | text | yes | |
| ads_config | jsonb | NOT NULL | '{}' |
| automation_rules | jsonb | NOT NULL | '{}' |
| last_insights_sync_at | timestamptz | yes | |
| google_campaign_id, google_status, tiktok_campaign_id, tiktok_status | text | yes | |
Indexes: (workspace_id), (brand_id). Triggers: touch updated_at; guard_campaign_approval (BEFORE INSERT OR UPDATE OF status); guard_campaign_delivery (BEFORE UPDATE OF meta_delivery_status).

**campaign_strategies**: id; workspace_id; campaign_id FK campaigns cascade NOT NULL; version int NOT NULL 1; status text NOT NULL 'draft'; content jsonb NOT NULL '{}'; created_at. Index (workspace_id).

**copies**: same shape as campaign_strategies (campaign_id FK cascade NOT NULL; version int 1; status 'draft'; content jsonb '{}'; created_at) + `angle text` (nullable). Index (workspace_id).

**creatives**: id; workspace_id; campaign_id FK campaigns cascade NULL; brand_id FK brands cascade NULL; title text NOT NULL; type text NOT NULL 'static_image'; prompt text; aspect_ratio text '1:1'; copy_text text; status text NOT NULL 'draft'; version int NOT NULL 1; provider text NOT NULL 'mock'; estimated_cost numeric 0; real_cost numeric 0; preview_url text; created_at; updated_at; final_prompt text; error_message text; thumbnail_url text; external_job_id text; angle text; extras jsonb NOT NULL '{}'. Indexes (workspace_id), (campaign_id, angle) `creatives_campaign_angle`. Trigger touch.

**creative_versions**: id; workspace_id; creative_id FK creatives cascade NOT NULL; version int NOT NULL 1; prompt text; preview_url text; created_at. Index (workspace_id).

**creative_generation_jobs**: id; workspace_id; brand_id FK brands SET NULL; campaign_id FK campaigns SET NULL; creative_id FK creatives SET NULL; provider text NOT NULL 'mock'; type text NOT NULL 'static_image'; prompt, final_prompt text; aspect_ratio text; status text NOT NULL 'queued'; external_job_id text; asset_url text; thumbnail_url text; error_message text; estimated_cost numeric 0; actual_cost numeric 0; created_by uuid; created_at; completed_at timestamptz; provider_log text; options jsonb NOT NULL '{}'. Index (workspace_id, created_at DESC) `creative_generation_jobs_ws_idx`.

### 1.4 Approvals / activity / AI recommendations

**approval_requests**: id; workspace_id; entity_type text NOT NULL; entity_id uuid (no FK, polymorphic); campaign_id FK campaigns cascade NULL; title text NOT NULL; summary text; status text NOT NULL 'pending'; requested_by uuid; decided_by uuid; decided_at timestamptz; created_at. Index (workspace_id). Trigger guard_approval_decision (BEFORE UPDATE OF status).

**activity_logs**: id; workspace_id; actor_id uuid; action text NOT NULL; entity_type text; entity_id uuid; metadata jsonb NOT NULL '{}'; created_at. Index (workspace_id).

**ai_recommendations**: id; workspace_id; campaign_id FK campaigns cascade NULL; action text NOT NULL; title text NOT NULL; reason text NOT NULL; estimated_impact text; severity text NOT NULL 'medium'; requires_approval boolean NOT NULL true; status text NOT NULL 'pending'; created_at; payload jsonb NOT NULL '{}'; source text NOT NULL 'ai'; applied_at timestamptz; applied_by uuid; result text. Index (workspace_id).

### 1.5 Publishing / Instagram

**social_posts**: id; workspace_id; brand_id FK brands cascade NULL; campaign_id FK campaigns SET NULL; channel text NOT NULL 'instagram_feed'; title text NOT NULL; copy_text text; creative_id FK creatives SET NULL; status text NOT NULL 'idea'; scheduled_at timestamptz; created_at. Index (workspace_id).

**publishing_jobs**: id; workspace_id; campaign_id FK campaigns cascade NULL; post_id FK social_posts cascade NULL; target text NOT NULL 'meta'; status text NOT NULL 'queued'; mode text NOT NULL 'mock'; log text; created_at; channel text NOT NULL 'meta_ads' CHECK (channel IN ('meta_ads','instagram_organic')); ig_post_id uuid FK ig_posts(id) ON DELETE CASCADE NULL; run_at timestamptz; attempts int NOT NULL 0; locked_at timestamptz. Indexes (workspace_id), (channel, status, run_at) `publishing_jobs_queue`.

**instagram_accounts**: id; workspace_id **UNIQUE** (1 per ws); ig_user_id, username, facebook_page_id, profile_picture_url text; status text NOT NULL 'disconnected' CHECK IN ('connected','error','disconnected'); last_error text; connected_at timestamptz; created_at; updated_at. Trigger touch.

**ig_content_plans**: id; workspace_id; brand_id FK brands SET NULL; name text NOT NULL; objective, tone_of_voice text; content_pillars jsonb NOT NULL '[]'; posting_frequency jsonb NOT NULL '{"feed":3,"reels":2,"stories":7}'; preferred_times jsonb NOT NULL '[]'; hashtag_strategy jsonb NOT NULL '{}'; cta_default text; status text NOT NULL 'draft' CHECK IN ('draft','active','paused'); auto_publish boolean NOT NULL false; requires_approval boolean NOT NULL true; created_at; updated_at; ai_notes jsonb NOT NULL '[]'; pillar_weights jsonb NOT NULL '{}'; last_autopilot_at timestamptz; posting_days int[] NOT NULL '{0,1,2,3,4,5,6}'. Trigger touch.

**ig_posts**: id; workspace_id; plan_id FK ig_content_plans SET NULL; format text NOT NULL CHECK IN ('feed_image','feed_carousel','reel','story_image','story_video'); status text NOT NULL 'idea' CHECK IN ('idea','generating','ready','pending_approval','approved','scheduled','publishing','published','failed','cancelled'); scheduled_at, published_at timestamptz; theme, hook, caption text; hashtags text[] NOT NULL '{}'; cta text; creative_brief jsonb NOT NULL '{}'; media jsonb NOT NULL '[]' (array of {url,type,width,height,duration}); ig_media_id text; ig_permalink text; ai_provider text; ai_generation_log jsonb NOT NULL '[]'; last_error, rejection_reason text; retry_count int NOT NULL 0; metrics_collected jsonb NOT NULL '[]'; created_at; updated_at; approved_at timestamptz; ig_creation_id text; source text NOT NULL 'app'; automation text CHECK (automation IN ('publish','approval')) (nullable); run_id uuid FK ig_auto_runs(id) SET NULL.
Indexes: (workspace_id, status) `ig_posts_ws_status`; UNIQUE (workspace_id, ig_media_id) WHERE ig_media_id IS NOT NULL `ig_posts_ws_media_uidx`; (status, scheduled_at) WHERE automation IS NOT NULL `ig_posts_automation_idx`. Trigger touch.

**ig_post_metrics**: id; workspace_id; post_id FK ig_posts cascade NOT NULL; collected_at timestamptz NOT NULL now(); reach, impressions, likes, comments, saves, shares, plays, profile_visits int (all nullable); raw jsonb NOT NULL '{}'; created_at; updated_at. Trigger touch.

**ig_autopilot_events**: id; workspace_id; plan_id FK ig_content_plans SET NULL; post_id FK ig_posts SET NULL; kind text NOT NULL; level text NOT NULL 'info'; message text NOT NULL; created_at. Index (workspace_id, created_at DESC) `ig_autopilot_events_ws`.

**ig_autopilot_weeks**: PK (plan_id, week_start); plan_id FK ig_content_plans cascade NOT NULL; week_start date NOT NULL; created_at. (no workspace_id)

**ig_account_insights**: id; workspace_id; date date NOT NULL; followers_total, new_followers, reach, views, profile_views, website_clicks, accounts_engaged, interactions int; created_at; updated_at (no touch trigger). UNIQUE (workspace_id, date).

**ig_auto_runs**: id; workspace_id; plan_id FK ig_content_plans cascade NOT NULL; parent_id FK ig_auto_runs(id) SET NULL; created_by uuid; campaign_id FK campaigns SET NULL; start_date date NOT NULL; end_date date NOT NULL; weekdays int[] NOT NULL '{0,1,2,3,4,5,6}'; times text[] NOT NULL '{}'; story_times text[] NOT NULL '{}'; formats text[] NOT NULL '{feed_image,feed_carousel,reel}'; focus text; mode text NOT NULL 'publish' CHECK IN ('publish','approval'); recurring boolean NOT NULL false; status text NOT NULL 'planning' CHECK IN ('planning','active','done','cancelled','failed'); slots jsonb NOT NULL '[]'; filled int NOT NULL 0; last_error text; locked_until timestamptz; created_at; updated_at (no touch trigger). Indexes (workspace_id, created_at DESC) `ig_auto_runs_ws_idx`; UNIQUE (parent_id, start_date) WHERE parent_id IS NOT NULL.

### 1.6 Ads / Meta / performance

**meta_accounts**: id; workspace_id; ad_account_id, facebook_page, instagram_account, pixel_id text; status text NOT NULL 'mock'; created_at.
**meta_campaigns**: id; workspace_id; campaign_id FK campaigns cascade NOT NULL; external_id text; name text NOT NULL; objective text; status text NOT NULL 'paused'; created_at.
**meta_adsets**: id; workspace_id; meta_campaign_id FK meta_campaigns cascade NOT NULL; name text NOT NULL; daily_budget numeric; targeting jsonb NOT NULL '{}'; placements text[] NOT NULL '{}'; status text NOT NULL 'paused'; created_at.
**meta_ads**: id; workspace_id; meta_adset_id FK meta_adsets cascade NOT NULL; creative_id FK creatives SET NULL; name text NOT NULL; utm text; status text NOT NULL 'paused'; created_at.
(all four: index (workspace_id).)

**performance_daily**: id; workspace_id; campaign_id FK campaigns cascade NOT NULL; creative_id FK creatives SET NULL; adset_name text; date date NOT NULL; spend numeric NOT NULL 0; impressions, reach, clicks, leads, conversions bigint NOT NULL 0; revenue numeric NOT NULL 0; created_at; source text NOT NULL 'demo' (existing random demo rows become 'demo'); meta_ad_id, meta_adset_id, ad_name text; synced_at timestamptz; external_id text.
Indexes: (workspace_id); (campaign_id, date); UNIQUE (campaign_id, meta_ad_id, date) `performance_daily_meta_key`; (workspace_id, source, date) `performance_daily_source`; UNIQUE (campaign_id, source, external_id, date) `performance_daily_external_key`. (Note: NULL meta_ad_id/external_id rows are never considered duplicates.)

**conversions**: id; workspace_id; campaign_id FK campaigns cascade NOT NULL; value numeric NOT NULL 0; source text 'meta'; occurred_at timestamptz NOT NULL now(). Index (workspace_id).
**campaign_costs**: id; workspace_id; campaign_id FK cascade NOT NULL; kind text NOT NULL 'ai'; description text; amount numeric NOT NULL 0; created_at. Index (workspace_id).

### 1.7 Media library

**media_assets**: id; workspace_id; brand_id FK brands SET NULL; campaign_id FK campaigns SET NULL; creative_id FK creatives SET NULL; ig_post_id FK ig_posts SET NULL; parent_id FK media_assets(id) SET NULL; title text NOT NULL 'Mídia'; kind text NOT NULL 'image' CHECK IN ('image','video'); source text NOT NULL 'upload' CHECK IN ('higgsfield','chatgpt','gemini','upload','mock','other','canva','instagram'); storage_path, url, thumbnail_path, thumbnail_url, mime text; width, height int; duration_seconds numeric; size_bytes bigint; aspect_ratio text; target_format text NOT NULL 'other' CHECK IN ('ig_feed_square','ig_feed_portrait','ig_story','ig_reel','meta_ad_square','meta_ad_vertical','meta_ad_landscape','other'); ig_ready boolean NOT NULL false; quality_report jsonb NOT NULL '{}'; tags text[] NOT NULL '{}'; folder text; status text NOT NULL 'draft' CHECK IN ('draft','approved','rejected','archived'); prompt, provider text; cost numeric; created_by uuid; created_at; updated_at; angle text. Indexes (workspace_id, created_at DESC), (creative_id), (ig_post_id). Trigger touch.

### 1.8 CRM (leads, pipeline, inbox, cadences, SDR)

**crm_pipelines**: id; workspace_id; name text NOT NULL; is_default boolean NOT NULL false; created_at; updated_at. Trigger touch.
**crm_stages**: id; workspace_id; pipeline_id FK crm_pipelines cascade NOT NULL; name text NOT NULL; color text NOT NULL '#6366f1'; position int NOT NULL 0; sla_hours int NOT NULL 24; is_won boolean NOT NULL false; is_lost boolean NOT NULL false; created_at; updated_at. Trigger touch.
**crm_loss_reasons**: id; workspace_id; name text NOT NULL; created_at.
**crm_tags**: id; workspace_id; name text NOT NULL; color text NOT NULL '#22d3ee'; created_at. UNIQUE (workspace_id, name).
**crm_settings**: PK workspace_id (FK workspaces cascade; 1 row/ws); distribution text NOT NULL 'round_robin'; default_owner_id uuid; created_at; updated_at; wa_hourly_limit int NOT NULL 30. Trigger touch.

**crm_leads**: id; workspace_id; pipeline_id FK crm_pipelines SET NULL; stage_id FK crm_stages SET NULL; name text NOT NULL; phone, email, city text; source text NOT NULL 'manual'; campaign_name, adset_name, ad_name, utm_source, utm_medium, utm_campaign text; owner_id uuid; score int NOT NULL 0; temperature text NOT NULL 'frio'; estimated_value numeric NOT NULL 0; tags text[] NOT NULL '{}'; loss_reason text; lgpd_consent boolean NOT NULL false; lgpd_consent_at timestamptz; unsubscribed boolean NOT NULL false; ai_active boolean NOT NULL true; stage_entered_at timestamptz NOT NULL now(); last_interaction_at, first_response_at timestamptz; created_at; updated_at; form_id, form_name, external_id, wa_id, referral_ad_id text; raw_payload jsonb; instagram_id, instagram_username text.
Indexes: (workspace_id, stage_id) `crm_leads_ws_stage_idx`; (workspace_id, phone); (workspace_id, email); UNIQUE (workspace_id, instagram_id) WHERE instagram_id IS NOT NULL `crm_leads_instagram_key`. Trigger touch.

**crm_interactions**: id; workspace_id; lead_id FK crm_leads cascade NOT NULL; kind text NOT NULL 'note'; author_type text NOT NULL 'user'; author_id uuid; content text; metadata jsonb NOT NULL '{}'; created_at. Index (lead_id, created_at DESC).
**crm_tasks**: id; workspace_id; lead_id FK crm_leads cascade NULL; title text NOT NULL; assignee_id uuid; due_at timestamptz; status text NOT NULL 'open'; created_at; updated_at. Trigger touch.
**crm_stage_history**: id; workspace_id; lead_id FK crm_leads cascade NOT NULL; from_stage_id uuid; to_stage_id uuid (no FKs); moved_by uuid; created_at. Index (workspace_id, created_at).

**crm_integrations**: id; workspace_id; kind text NOT NULL CHECK IN ('meta_lead_ads','whatsapp','instagram','site_form','email','calendar'); provider text NOT NULL CHECK IN ('meta','whatsapp_cloud','zapi','evolution','site','resend','calcom'); status text NOT NULL 'disconnected' CHECK IN ('disconnected','connecting','connected','expired','error'); config jsonb NOT NULL '{}'; field_mapping jsonb NOT NULL '{}'; webhook_token text NOT NULL DEFAULT encode(gen_random_bytes(18),'hex'); verify_token text NOT NULL DEFAULT encode(gen_random_bytes(12),'hex'); last_event_at timestamptz; last_error text; created_at; updated_at. UNIQUE (workspace_id, kind); UNIQUE INDEX (webhook_token). Trigger touch. (config can hold provider secrets; readable by all members under RLS.)

**crm_cadences**: id; workspace_id; name text NOT NULL; source text NOT NULL 'meta_lead_ads'; is_active boolean NOT NULL true; steps jsonb NOT NULL '[]'; created_at; updated_at; description text NOT NULL ''; trigger_type text NOT NULL 'source'; trigger_value text; exit_rules jsonb NOT NULL '{"on_reply":true,"on_stage_change":true,"on_won_lost":true,"on_opt_out":true,"on_human_takeover":true}'; template_key text. Trigger touch.
**crm_cadence_runs**: id; workspace_id; cadence_id FK crm_cadences cascade NOT NULL; lead_id FK crm_leads cascade NOT NULL; step_index int NOT NULL 0; status text NOT NULL 'running' CHECK IN ('running','done','stopped','failed'); next_run_at timestamptz NOT NULL now(); last_error text; created_at; updated_at; entered_at timestamptz NOT NULL now(); entry_stage_id uuid; stop_reason text; last_step_at timestamptz. Index (status, next_run_at) `crm_cadence_runs_due_idx` (created twice, idempotent). Trigger touch.
**crm_cadence_events**: id; workspace_id; cadence_id FK crm_cadences cascade NOT NULL; run_id FK crm_cadence_runs SET NULL; lead_id FK crm_leads cascade NULL; step_index int NOT NULL 0; channel text NOT NULL 'wa_text'; event text NOT NULL; message_id FK crm_messages SET NULL; detail text; created_at. Indexes (cadence_id, step_index), (workspace_id, created_at DESC).

**crm_conversations**: id; workspace_id; lead_id FK crm_leads cascade NULL; provider text NOT NULL 'whatsapp_cloud'; phone text NOT NULL; wa_id text; unread_count int NOT NULL 0; window_expires_at, last_message_at timestamptz; last_message_preview text; created_at; updated_at. UNIQUE (workspace_id, phone). Trigger touch.
**crm_messages**: id; workspace_id; conversation_id FK crm_conversations cascade NOT NULL; lead_id FK crm_leads cascade NULL; direction text NOT NULL CHECK IN ('in','out'); message_type text NOT NULL 'text' CHECK IN ('text','image','audio','video','document','template','sticker','other'); body, media_url, template_name text; status text NOT NULL 'sent' CHECK IN ('queued','sent','delivered','read','failed','received'); external_id text; error_message text; sent_by uuid; author_type text NOT NULL 'user' CHECK IN ('user','ai','system','contact'); created_at. Indexes (conversation_id, created_at); UNIQUE (workspace_id, external_id) WHERE external_id IS NOT NULL `crm_messages_external_idx`.
**crm_quick_replies**: id; workspace_id; title text NOT NULL; body text NOT NULL; created_at.
**crm_wa_templates**: id; workspace_id; name text NOT NULL; language text NOT NULL 'pt_BR'; category text; status text NOT NULL 'APPROVED'; body_preview text; variables int NOT NULL 0; synced_at timestamptz NOT NULL now(). UNIQUE (workspace_id, name, language).
**crm_campaign_costs**: id; workspace_id; date date NOT NULL; campaign_id **text** NOT NULL (Meta external id, not an FK); campaign_name text; spend numeric NOT NULL 0; impressions, clicks, leads int NOT NULL 0; created_at. UNIQUE (workspace_id, date, campaign_id).
**crm_webhook_events** (server only): id; workspace_id FK cascade NULL; source text NOT NULL; external_id text; payload jsonb; status text NOT NULL 'processed'; error_message text; created_at. UNIQUE (source, external_id) WHERE external_id IS NOT NULL `crm_webhook_events_dedup_idx`.

**crm_sdr_agents**: id; workspace_id **UNIQUE**; is_active boolean NOT NULL false; name text NOT NULL 'Agente SDR'; persona text NOT NULL ''; tone text NOT NULL 'consultivo e cordial'; goal text NOT NULL 'Qualificar o lead e agendar uma reuniao com o time comercial.'; knowledge_text text NOT NULL ''; questions jsonb NOT NULL '[]'; min_score int NOT NULL 60; scheduling_link text; available_slots jsonb NOT NULL '[]'; business_hours jsonb NOT NULL '{"timezone":"America/Sao_Paulo","days":[1,2,3,4,5],"start":"09:00","end":"18:00"}'; offhours_message text NOT NULL 'Recebemos sua mensagem! Nosso time responde no proximo horario comercial.'; max_messages int NOT NULL 20; handoff_triggers jsonb NOT NULL '["negociacao de preco","reclamacao","assunto juridico","falar com atendente"]'; model text NOT NULL 'openai/gpt-6-astra'; created_at; updated_at. Trigger touch.
**crm_sdr_documents**: id; workspace_id; agent_id FK crm_sdr_agents cascade NOT NULL; file_name text NOT NULL; mime_type text NOT NULL 'application/pdf'; size_bytes int NOT NULL 0; extracted_text text NOT NULL ''; created_at. Index (agent_id).
**crm_sdr_runs**: id; workspace_id; agent_id FK crm_sdr_agents SET NULL; lead_id FK crm_leads cascade NULL; conversation_id FK crm_conversations SET NULL; mode text NOT NULL 'live'; inbound_text, reply_text text; decision jsonb NOT NULL '{}'; score int; handoff boolean NOT NULL false; status text NOT NULL 'ok'; error_message text; model text; input_tokens, output_tokens, duration_ms int; created_at. Indexes (workspace_id, created_at DESC), (lead_id, created_at DESC).

### 1.9 Integrations / credentials / MCP / cron infra

**integration_connections**: id; workspace_id; provider text NOT NULL; status text NOT NULL 'disconnected'; mode text NOT NULL 'mock'; account_label text; connected_at timestamptz; created_at. UNIQUE (workspace_id, provider). Index (workspace_id).

**mcp_connections** (dropped & recreated twice; final shape): id; workspace_id; provider text NOT NULL CHECK (provider = ANY('higgsfield','meta','canva')); label text; server_url text NOT NULL; access_token text; status text NOT NULL 'disconnected'; tools jsonb NOT NULL '[]'; last_error text; connected_at timestamptz; created_at; updated_at; refresh_token text; expires_at timestamptz; oauth_client_id, oauth_client_secret, oauth_state, oauth_code_verifier, oauth_authorization_endpoint, oauth_token_endpoint, oauth_scope, oauth_resource, oauth_redirect_uri text. UNIQUE (workspace_id, provider). Index (oauth_state). Trigger touch. **Column-level grants**: authenticated can SELECT only (id, workspace_id, provider, label, server_url, status, tools, last_error, connected_at, expires_at, created_at, updated_at) and INSERT/UPDATE/DELETE; token/secret columns readable only by service_role.

**app_credentials** (secret vault; AES-GCM encrypted app-side when CREDENTIALS_ENCRYPTION_KEY set): id uuid PK default gen_random_uuid(); key text NOT NULL; value text NOT NULL; updated_at timestamptz NOT NULL now(); workspace_id uuid FK workspaces cascade NULL (NULL = global/platform). UNIQUE NULLS NOT DISTINCT (workspace_id, key) `app_credentials_workspace_key` (PG15+ syntax). Original PK was `key`; replaced by `id`. Keys seen in code: CANVA_CLIENT_ID/SECRET, GOOGLE_ADS_*, TIKTOK_*, META_TOKEN_EXPIRES_AT, META_TOKEN_SOURCE, openai/gemini AI keys (via ai-keys.server.ts).

**cron_tokens**: name text PK; token text NOT NULL; created_at. Rows (seeded): instagram, crm_cadences, crm_daily, ads, unsubscribe (also used as HMAC secret for unsubscribe links).
**cron_heartbeats**: name text PK; last_run_at timestamptz NOT NULL now(); last_status text NOT NULL 'ok'; last_detail text.

---------------------------------------------------------------------------
## 2. Enums / custom types

| name | values |
|---|---|
| `public.workspace_role` | owner, admin, marketing, viewer |

No other CREATE TYPE. Many "enum-like" text columns are enforced by CHECK (listed per table above). Free-text (unchecked) status columns: campaigns.status, creatives.status, social_posts.status, publishing_jobs.status/mode/target, approval_requests.status/entity_type, ai_recommendations.status/severity, crm_*.source/temperature/kind/author_type, integration_connections.*, performance_daily.source ('demo' | 'meta' | 'google' | 'tiktok' ...).

---------------------------------------------------------------------------
## 3. RLS policies (all tables have RLS enabled)

Helper functions (SECURITY DEFINER, STABLE, search_path=public, depend on `auth.uid()`):
- `is_workspace_member(_ws uuid) -> boolean`: exists workspace_members row (ws, auth.uid()).
- `has_workspace_role(_ws uuid, _roles workspace_role[]) -> boolean`: same + role = any(_roles).
Execute granted to `authenticated` only (revoked from public/anon).

Roles: `authenticated` (end users), `service_role` (server; bypasses RLS and has GRANT ALL on every table), `anon` (no grants, except policy `app_credentials` deny).

**A. "ws members full access"** (FOR ALL to authenticated; USING and WITH CHECK `is_workspace_member(workspace_id)`) -> any member (even `viewer`) can read AND write: brands, brand_assets, products, personas, campaigns, campaign_strategies, copies, creatives, creative_versions, social_posts, publishing_jobs, meta_accounts, meta_campaigns, meta_adsets, meta_ads, performance_daily, conversions, campaign_costs, ai_recommendations, brand_learnings, integration_connections, approval_requests, activity_logs, instagram_accounts, ig_content_plans, ig_posts, ig_post_metrics.
Same rule under different policy names: creative_generation_jobs (`jobs_select_members` + `jobs_write_members`), crm_pipelines, crm_stages, crm_loss_reasons, crm_tags, crm_settings, crm_leads, crm_interactions, crm_tasks, crm_stage_history (each "<table> members"), crm_cadence_runs ("members manage cadence runs"), crm_conversations, crm_messages, crm_quick_replies ("members manage ...").
(Role restrictions for campaign approval/activation are enforced by triggers, not policies - see section 4.)

**B. Member read + owner/admin write** (SELECT: is_workspace_member; FOR ALL write: has_workspace_role(ws, {owner,admin})): mcp_connections (+ column-grant restriction above), crm_integrations, crm_cadences, crm_wa_templates, crm_campaign_costs, crm_sdr_agents, crm_sdr_documents.

**C. Member read + owner/admin/marketing write**: media_assets ("Membros veem mídias" SELECT member; "Editores gerenciam mídias" ALL for owner|admin|marketing). viewer = read-only.

**D. Member read-only (no INSERT/UPDATE/DELETE grant to authenticated; server writes)**: crm_sdr_runs, crm_cadence_events, ig_autopilot_events, ig_account_insights, ig_auto_runs.

**E. Special**
- profiles: "own profile" FOR ALL: id = auth.uid() (USING and CHECK). No DELETE grant. NOTE: settings page tries to read profiles of other members (`.in("id", ids)`) - RLS returns only own row.
- workspaces: SELECT member; INSERT only if owner_id = auth.uid(); UPDATE owner|admin; DELETE only owner_id = auth.uid().
- workspace_members: SELECT member; ALL (insert/update/delete) owner|admin only (so first-owner row must be created via SECURITY DEFINER code: handle_new_user / create_workspace).
- crm_webhook_events: RLS enabled, NO policies, no grants to authenticated -> server only.
- ig_autopilot_weeks: RLS enabled, no policies, no authenticated grants -> server only.
- cron_tokens: policy "Somente o servidor acessa tokens de cron" FOR ALL to service_role true; no authenticated grants.
- cron_heartbeats: SELECT any authenticated user (USING true; NOT workspace scoped); no write grants.
- app_credentials: policy "Cofre inacessível pelo navegador" FOR ALL to anon, authenticated USING false / CHECK false; only service_role. 

---------------------------------------------------------------------------
## 4. Functions / RPCs / triggers

Functions (8 in final state)
1. `is_workspace_member(_ws uuid) boolean` - see above. App calls via `.rpc("is_workspace_member", {_ws})` (crm-cadences, crm-integrations, crm-sdr .functions.ts) as an authorization check in server functions.
2. `has_workspace_role(_ws uuid, _roles workspace_role[]) boolean` - app calls via `.rpc` with `["owner","admin"]` (same 3 files).
3. `create_workspace(_name text) uuid` - SECURITY DEFINER; requires auth.uid() (else exception 'not authenticated'); name trimmed non-empty (else 'nome obrigatório'); inserts workspaces(name, slug 'ws-'+first 12 hex chars of a random uuid, owner_id=auth.uid()) and workspace_members(owner). Returns ws id. Execute: authenticated only. **App calls it** (`src/components/app-shell.tsx:185`, "new company").
4. `touch_updated_at() trigger` - sets NEW.updated_at = now(). Execute revoked from all roles.
5. `handle_new_user() trigger` - SECURITY DEFINER; on auth.users INSERT: inserts profiles(id,email,full_name = raw_user_meta_data->>'full_name' or email local part); inserts workspaces(name = raw_user_meta_data->>'company_name' or 'Meu Workspace', slug 'ws-'+first 10 hex of user id, owner_id=new.id); inserts workspace_members(owner). (The original version also called seed_demo_workspace; that was removed and the function dropped.)
6. `guard_campaign_approval() trigger` - SECURITY DEFINER. If `auth.jwt()->>'role'` <> 'authenticated' (server/service_role/migrations) -> pass. Otherwise, if NEW.status in ('approved','active') and (INSERT, or OLD.status null/not in approved|active) and caller is not owner|admin of the ws -> raise 42501 "Só o dono ou um administrador da empresa pode aprovar a campanha." Toggling approved<->active stays free.
7. `guard_approval_decision() trigger` - same bypass; if NEW.status changed and is 'approved'|'rejected' and caller not owner|admin -> raise 42501 "Só o dono ou um administrador da empresa pode decidir aprovações."
8. `guard_campaign_delivery() trigger` - same bypass; if NEW.meta_delivery_status = 'ACTIVE' and OLD is distinct from 'ACTIVE' and caller not owner|admin -> raise 42501 "Só o dono ou um administrador pode ativar a veiculação (gastar verba)." EXECUTE revoked from public/anon/authenticated.
(Dropped: `seed_demo_workspace(uuid)`.) Only create_workspace, is_workspace_member, has_workspace_role are in the generated RPC types; only those 3 are called with `.rpc(` in `src/`.

Triggers (23)
- `on_auth_user_created` AFTER INSERT ON **auth.users** FOR EACH ROW -> handle_new_user().
- `touch_updated_at` BEFORE UPDATE FOR EACH ROW on (19): brands, campaigns, creatives, mcp_connections, crm_pipelines, crm_stages, crm_leads, crm_tasks, crm_settings, crm_integrations, crm_cadences, crm_cadence_runs, crm_conversations, crm_sdr_agents, instagram_accounts, ig_content_plans, ig_posts, ig_post_metrics, media_assets. (NOT on ig_auto_runs, ig_account_insights though they have updated_at - app sets manually.)
- `guard_campaign_approval` BEFORE INSERT OR UPDATE OF status ON campaigns.
- `guard_campaign_delivery` BEFORE UPDATE OF meta_delivery_status ON campaigns.
- `guard_approval_decision` BEFORE UPDATE OF status ON approval_requests.
(No counters, no stage-history trigger: stage history/last_interaction etc. are maintained by app code.)

---------------------------------------------------------------------------
## 5. Storage buckets

Migrations never INSERT into storage.buckets (buckets were created in the Supabase dashboard). Code references:
- `creative-assets` - used by generated creatives (`providers/lovable-ai.server.ts`: path `YYYY-MM-DD/<uuid>.<ext>`, **private**, signed URLs valid 5 years), media library (`MEDIA_BUCKET`, paths like `media/<ws>/<id>`, `_thumb.jpg`), brand asset uploads from browser (`brands/<workspaceId>/...`), CRM media understanding (signed 1 year). Bucket is private (comments in code say "Bucket privado").
- `ig-media` - constant declared in `instagram.server.ts` (apparently unused for actual calls); visibility unknown (migration only grants service_role read).

Policies on `storage.objects` (from migrations):
- "service_role reads ig-media and creative-assets": SELECT to service_role where bucket_id in ('ig-media','creative-assets').
- "brand files: members read": SELECT authenticated, bucket 'creative-assets', first folder = 'brands' and `is_workspace_member(folder[2]::uuid)`.
- "brand files: editors upload": INSERT authenticated, same path rule, `has_workspace_role(folder[2]::uuid, {owner,admin,marketing})`.
- "brand files: editors delete": DELETE authenticated, same.
Everything else in the buckets is written/read by the server with the service key.

---------------------------------------------------------------------------
## 6. Scheduled jobs (pg_cron + pg_net) - final state (10)

All POST via `net.http_post(url, headers {Content-Type: application/json, x-cron-secret: (select token from cron_tokens where name=...)}, body, timeout_milliseconds := 120000)` to the custom domain `https://www.meufunildevendas.com.br/api/public/cron/...` (earlier versions pointed at the lovable.app preview URL and had the default 5 s timeout; all re-created). The app route validates `x-cron-secret` against env CRM_CRON_SECRET or cron_tokens (`cron-auth.server.ts`) and writes `cron_heartbeats`.

| jobname | schedule (UTC) | path | body | token name |
|---|---|---|---|---|
| crm-cadences-5min | */5 * * * * | /api/public/cron/crm-cadences | {} | crm_cadences |
| instagram-queue-5min | */5 * * * * | /api/public/cron/instagram | {"task":"queue"} | instagram |
| instagram-media-5min | */5 * * * * | /api/public/cron/instagram | {"task":"media"} | instagram |
| instagram-metrics-5min | */5 * * * * | /api/public/cron/instagram | {"task":"metrics"} | instagram |
| instagram-autopilot-weekly | 0 21 * * 0 | /api/public/cron/instagram | {"task":"weekly"} | instagram |
| instagram-optimizer-monday | 0 12 * * 1 | /api/public/cron/instagram | {"task":"optimize"} | instagram |
| instagram-account-daily | 25 10 * * * | /api/public/cron/instagram | {"task":"account"} | instagram |
| ads-insights-3h | 17 */3 * * * | /api/public/cron/ads | {"task":"sync"} | ads |
| ads-rules-daily | 40 12 * * * | /api/public/cron/ads | {"task":"rules"} | ads |
| crm-daily | 10 9 * * * (06:10 BRT) | /api/public/cron/crm-daily | {} | crm_daily |

Extensions: `pg_cron`, `pg_net` created `with schema extensions`. Port: replace with in-process scheduler (e.g. @nestjs/schedule / BullMQ repeatable jobs) calling the same handlers; token table no longer needed (no HTTP hop).

---------------------------------------------------------------------------
## 7. Seed data inserted by migrations

- `cron_tokens` rows (random 32-byte hex via `extensions.gen_random_bytes(32)`): instagram, crm_cadences, crm_daily, ads, unsubscribe (ON CONFLICT DO NOTHING).
- CRM defaults (migration 20260917103746) - **one-time loop over workspaces existing at migration time only** (new workspaces get NOTHING from migrations; app code must lazily create pipeline/stages/settings): per ws: pipeline "Funil Padrão" (is_default) with 8 stages [name, color, position, sla_hours, won/lost]: Novo Lead #38bdf8 1 1h; Contato Iniciado (SDR IA) #818cf8 2 4h; Qualificado #a78bfa 3 24h; Reunião Agendada #f59e0b 4 48h; Reunião Realizada #f97316 5 48h; Proposta #22d3ee 6 72h; Ganho #22c55e 7 72h (is_won); Perdido #ef4444 8 72h (is_lost). Loss reasons: Sem orçamento, Sem perfil, Escolheu concorrente, Não respondeu, Fora da região. Tags: VIP #f59e0b, Investidor #22d3ee, Baixo ticket #94a3b8, Reengajar #a78bfa. crm_settings(distribution 'round_robin'). Plus 20 demo leads/ws with stage history, 3 interactions each, and tasks for every third lead (pure demo data; do not port).
- Original migration 1 defined `seed_demo_workspace` (Nutrivita demo brand/campaigns/etc.) called from handle_new_user; removed in migration 5 - existing users keep that demo data, new users do not. performance_daily rows from it are marked `source='demo'`.
- Backfills (20260930152535): media_assets rows generated from creatives (with preview_url) and from ig_posts.media elements. One-time data migration, not catalog.
- No catalogs/enum tables otherwise.

---------------------------------------------------------------------------
## 8. Auth coupling

- Only `auth.users` reference: trigger `on_auth_user_created` AFTER INSERT (-> handle_new_user). No FKs to auth.users anywhere; `profiles.id`, `workspace_members.user_id`, `workspaces.owner_id` and all actor columns are bare uuids.
- `auth.uid()` used in: is_workspace_member, has_workspace_role, profiles policy, workspaces INSERT policy (owner_id = auth.uid()), workspaces DELETE policy, create_workspace.
- `auth.jwt()->>'role'` used in 3 guard triggers to distinguish end-user JWT ('authenticated') from service role (bypass).
- Signup metadata read: `raw_user_meta_data->>'full_name'` and `->>'company_name'`.
- App auth (src/routes/auth.tsx): `supabase.auth.signUp` (email+password, then auto signInWithPassword), `signInWithPassword`, Google OAuth via `lovable.auth.signInWithOAuth("google")` (Lovable cloud auth wrapper), `auth.getSession`. Server functions use a bearer-token middleware (`auth-middleware.ts`) and `supabaseAdmin` (service key) for server-only tables.
- Roles are per-workspace via workspace_members; no global admin role.

---------------------------------------------------------------------------
## 9. Port notes (NestJS + Prisma + plain Postgres)

1. **Auth replacement**: supply own `users` table (email, password hash, OAuth identities) replacing auth.users; reproduce handle_new_user in the signup service (profile + workspace + owner membership, in one transaction). Recommended: keep `profiles` 1:1 and add real FKs (prototype has none).
2. **RLS -> app-level authorization**: all rules in section 3 must be re-implemented as guards/services (member / owner|admin / owner|admin|marketing / read-only server-written). Alternatively keep RLS with `SET LOCAL app.user_id` and rewrite `auth.uid()` as `current_setting('app.user_id')::uuid`. Prisma has no native RLS support. Rules not expressible as RLS but present as triggers (campaign approve/activate, approval decision, ACTIVE delivery) must become service-level checks; they were bypassed by service_role, i.e. the server's own writes are trusted.
3. **Column-level security**: mcp_connections token/secret columns hidden from end users; in the API simply never serialize them. app_credentials/cron_tokens/crm_webhook_events/ig_autopilot_weeks are server-only (no public API).
4. **Secrets**: app_credentials.value is AES-GCM (Web Crypto, key derived by SHA-256 of env CREDENTIALS_ENCRYPTION_KEY; values may be plaintext if key unset - legacy). No pgcrypto/Vault use for data. mcp_connections tokens, crm_integrations.config and webhook/verify tokens are stored in PLAINTEXT. Consider encrypting.
5. **Extensions**: pgcrypto (`gen_random_bytes` for crm_integrations.webhook_token/verify_token defaults - and cron_tokens seeding; `gen_random_uuid` is core PG13+), pg_cron, pg_net (drop; replace with scheduler). `UNIQUE NULLS NOT DISTINCT` on app_credentials needs PG15+ (Prisma cannot express it: use raw SQL migration or composite handling for NULL workspace_id, e.g. sentinel/partial unique indexes).
6. **Prisma-hostile constructs** (need raw SQL in migrations): partial unique indexes (ig_posts_ws_media_uidx, ig_auto_runs_recurring_uidx, crm_messages_external_idx, crm_webhook_events_dedup_idx, crm_leads_instagram_key), partial non-unique index ig_posts_automation_idx, CHECK constraints (Prisma ignores them; list in section 1), DESC indexes (supported via `sort: Desc`), `text[]`/`int[]` arrays (supported), jsonb defaults, column defaults using functions (`encode(gen_random_bytes(18),'hex')` -> use `dbgenerated` or generate in app).
7. **Updated_at triggers**: Prisma `@updatedAt` replaces touch_updated_at, but raw SQL updates and tables without trigger (ig_auto_runs, ig_account_insights) need explicit handling.
8. **Realtime**: no `supabase_realtime` publication changes in migrations and no `.channel(`/`postgres_changes` usage in src - nothing to port. No generated columns, no views, no materialized views, no composite types, no domain types, no partitioning, no Postgres sequences.
9. **Storage**: replace Supabase Storage with S3/MinIO-compatible service; two bucket names (`creative-assets` private with signed URLs - the app stores 1-5 year signed URLs in creatives.preview_url/media_assets.url/ig_posts.media, which will break after migration: store keys and sign on read; `ig-media`). Folder-prefix policy `brands/<workspace_id>/...` must be enforced by API. Existing DB rows contain Supabase signed URLs and `storage_path` values that need a data migration.
10. **Cron endpoints**: the app exposes `/api/public/cron/{instagram,crm-cadences,crm-daily,ads}` with `x-cron-secret`; port as Nest scheduled jobs (task names: queue, media, metrics, weekly, optimize, account, sync, rules). `cron_heartbeats` is read by the "what's left to configure" setup panel (readable by any logged user; not ws-scoped).
11. **Webhook tokens**: crm_integrations.webhook_token (unique, in URL) and verify_token (Meta verify) are generated per row; webhook idempotency relies on crm_webhook_events(source, external_id) and crm_messages(workspace_id, external_id) unique partial indexes.
12. **Multi-tenancy gotchas**: workspaces.slug has no unique constraint; `ai_inherit_from` lets one ws use another's AI connections (agency model) - authorization for it is app-side; crm_campaign_costs.campaign_id is Meta's text id, not an FK; performance_daily has overlapping unique keys per source with NULL-able key columns; polymorphic approval_requests.entity_id has no FK.
13. **Defaults worth preserving**: crm_sdr_agents.model 'openai/gpt-6-astra' (Lovable AI gateway model id - will need remapping), Brazilian timezone 'America/Sao_Paulo' in business_hours, crm-daily 09:10 UTC = 06:10 BRT, pg_net timeout 120 s (long-running handlers).
14. **Data-state quirks**: new workspaces have no CRM pipeline/stages/settings/loss reasons/tags (only the one-time migration seeded them) - confirm how the app creates them (likely lazily in server functions) and replicate; legacy demo rows have performance_daily.source='demo' and must be filtered out in dashboards.
