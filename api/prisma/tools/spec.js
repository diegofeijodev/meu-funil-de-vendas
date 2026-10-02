// Compact spec of the 62 prototype tables (+ users). Column syntax:
//   "name type [? nullable] [>table cascade|setnull] [= default]"
// shorthands: 'id', 'ws', 'created', 'updated', 'updated_t' (touch trigger)
const T = {};
const t = (name, cols, o = {}) => (T[name] = { name, cols, ...o });

t('users', [
  'id u pk = gen_random_uuid()', 'email t', 'password_hash t ?', 'google_sub t ?', 'token_version i = 0', 'created', 'updated',
], { unique: [['email'], ['google_sub']], extraUsers: true });

t('profiles', ['id u pk', 'email t ?', 'full_name t ?', 'avatar_url t ?', 'created']);
t('workspaces', ['id', 'name t', 'slug t', "plan t = 'trial'", 'owner_id u', 'created', 'ai_inherit_from u ? >workspaces setnull']);
t('workspace_members', ['id', 'ws', 'user_id u', 'role workspace_role = marketing', 'created'], { unique: [['workspace_id', 'user_id']] });

t('brands', ['id', 'ws', 'name t', 'description t ?', 'website t ?', 'segment t ?', 'differentials t ?', 'target_audience t ?',
  'competitors t ?', 'tone_of_voice t ?', 'preferred_words t[]', 'banned_words t[]', "primary_color t ? = '#4F46E5'",
  "secondary_color t ? = '#0EA5E9'", 'typography t ?', 'logo_url t ?', 'region t ?', 'past_campaigns t ?', 'created', 'updated_t',
  'visual_style j = {}'], { idx: [['workspace_id']] });
t('brand_assets', ['id', 'ws', 'brand_id u >brands cascade', "kind t = 'photo'", 'name t ?', 'url t ?', 'created', 'tag t ?', 'storage_path t ?'], { idx: [['workspace_id']] });
t('products', ['id', 'ws', 'brand_id u >brands cascade', 'name t', 'description t ?', 'price n ?', 'margin_percent n ?', 'created'], { idx: [['workspace_id']] });
t('personas', ['id', 'ws', 'brand_id u >brands cascade', 'name t', 'age_range t ?', 'location t ?', 'interests t ?', 'pains t ?', 'desires t ?', "segment_type t ? = 'B2C'", 'created'], { idx: [['workspace_id']] });
t('brand_learnings', ['id', 'ws', 'brand_id u >brands cascade', 'category t', 'value t', 'metric t ?', 'score n ? = 0', 'created'], { idx: [['workspace_id']] });

t('campaigns', ['id', 'ws', 'brand_id u >brands cascade', 'name t', "objective t = 'leads'", "status t = 'draft'",
  'offer_product t ?', 'offer_promise t ?', 'landing_url t ?', 'offer_price n ?', 'start_date d ?', 'end_date d ?', 'audience j = {}',
  'budget_total n ? = 0', 'budget_daily n ? = 0', 'goal_leads n ?', 'goal_sales n ?', 'avg_ticket n ?', 'margin_percent n ?', 'max_cac n ?',
  'formats t[]', 'created', 'updated_t', 'meta_campaign_id t ?', 'meta_adset_id t ?', 'meta_ad_ids t[]', 'meta_delivery_status t ?',
  'meta_adset_ids t[]', 'meta_ad_map j = {}', 'meta_lead_form_id t ?', 'ads_config j = {}', 'automation_rules j = {}',
  'last_insights_sync_at tz ?', 'google_campaign_id t ?', 'google_status t ?', 'tiktok_campaign_id t ?', 'tiktok_status t ?'],
  { idx: [['workspace_id'], ['brand_id']] });
t('campaign_strategies', ['id', 'ws', 'campaign_id u >campaigns cascade', 'version i = 1', "status t = 'draft'", 'content j = {}', 'created'], { idx: [['workspace_id']] });
t('copies', ['id', 'ws', 'campaign_id u >campaigns cascade', 'version i = 1', "status t = 'draft'", 'content j = {}', 'created', 'angle t ?'], { idx: [['workspace_id']] });
t('creatives', ['id', 'ws', 'campaign_id u ? >campaigns cascade', 'brand_id u ? >brands cascade', 'title t', "type t = 'static_image'", 'prompt t ?',
  "aspect_ratio t ? = '1:1'", 'copy_text t ?', "status t = 'draft'", 'version i = 1', "provider t = 'mock'", 'estimated_cost n ? = 0', 'real_cost n ? = 0',
  'preview_url t ?', 'created', 'updated_t', 'final_prompt t ?', 'error_message t ?', 'thumbnail_url t ?', 'external_job_id t ?', 'angle t ?', 'extras j = {}'],
  { idx: [['workspace_id'], { cols: ['campaign_id', 'angle'], name: 'creatives_campaign_angle' }] });
t('creative_versions', ['id', 'ws', 'creative_id u >creatives cascade', 'version i = 1', 'prompt t ?', 'preview_url t ?', 'created'], { idx: [['workspace_id']] });
t('creative_generation_jobs', ['id', 'ws', 'brand_id u ? >brands setnull', 'campaign_id u ? >campaigns setnull', 'creative_id u ? >creatives setnull',
  "provider t = 'mock'", "type t = 'static_image'", 'prompt t ?', 'final_prompt t ?', 'aspect_ratio t ?', "status t = 'queued'", 'external_job_id t ?',
  'asset_url t ?', 'thumbnail_url t ?', 'error_message t ?', 'estimated_cost n ? = 0', 'actual_cost n ? = 0', 'created_by u ?', 'created', 'completed_at tz ?',
  'provider_log t ?', 'options j = {}'],
  { idx: [{ cols: ['workspace_id', 'created_at desc'], name: 'creative_generation_jobs_ws_idx' }] });

t('approval_requests', ['id', 'ws', 'entity_type t', 'entity_id u ?', 'campaign_id u ? >campaigns cascade', 'title t', 'summary t ?', "status t = 'pending'",
  'requested_by u ?', 'decided_by u ?', 'decided_at tz ?', 'created'], { idx: [['workspace_id']] });
t('activity_logs', ['id', 'ws', 'actor_id u ?', 'action t', 'entity_type t ?', 'entity_id u ?', 'metadata j = {}', 'created'], { idx: [['workspace_id']] });
t('ai_recommendations', ['id', 'ws', 'campaign_id u ? >campaigns cascade', 'action t', 'title t', 'reason t', 'estimated_impact t ?', "severity t = 'medium'",
  'requires_approval b = true', "status t = 'pending'", 'created', 'payload j = {}', "source t = 'ai'", 'applied_at tz ?', 'applied_by u ?', 'result t ?'], { idx: [['workspace_id']] });

t('social_posts', ['id', 'ws', 'brand_id u ? >brands cascade', 'campaign_id u ? >campaigns setnull', "channel t = 'instagram_feed'", 'title t', 'copy_text t ?',
  'creative_id u ? >creatives setnull', "status t = 'idea'", 'scheduled_at tz ?', 'created'], { idx: [['workspace_id']] });
t('publishing_jobs', ['id', 'ws', 'campaign_id u ? >campaigns cascade', 'post_id u ? >social_posts cascade', "target t = 'meta'", "status t = 'queued'", "mode t = 'mock'",
  'log t ?', 'created', "channel t = 'meta_ads'", 'ig_post_id u ? >ig_posts cascade', 'run_at tz ?', 'attempts i = 0', 'locked_at tz ?'],
  { idx: [['workspace_id'], { cols: ['channel', 'status', 'run_at'], name: 'publishing_jobs_queue' }],
    checks: [["channel IN ('meta_ads','instagram_organic')"]] });
t('instagram_accounts', ['id', 'ws', 'ig_user_id t ?', 'username t ?', 'facebook_page_id t ?', 'profile_picture_url t ?', "status t = 'disconnected'", 'last_error t ?',
  'connected_at tz ?', 'created', 'updated_t'], { unique: [['workspace_id']], checks: [["status IN ('connected','error','disconnected')"]] });
t('ig_content_plans', ['id', 'ws', 'brand_id u ? >brands setnull', 'name t', 'objective t ?', 'tone_of_voice t ?', 'content_pillars j = []',
  'posting_frequency j = {"feed":3,"reels":2,"stories":7}', 'preferred_times j = []', 'hashtag_strategy j = {}', 'cta_default t ?', "status t = 'draft'",
  'auto_publish b = false', 'requires_approval b = true', 'created', 'updated_t', 'ai_notes j = []', 'pillar_weights j = {}', 'last_autopilot_at tz ?',
  'posting_days i[] = [0,1,2,3,4,5,6]'], { checks: [["status IN ('draft','active','paused')"]] });
t('ig_posts', ['id', 'ws', 'plan_id u ? >ig_content_plans setnull', 'format t', "status t = 'idea'", 'scheduled_at tz ?', 'published_at tz ?', 'theme t ?', 'hook t ?', 'caption t ?',
  'hashtags t[]', 'cta t ?', 'creative_brief j = {}', 'media j = []', 'ig_media_id t ?', 'ig_permalink t ?', 'ai_provider t ?', 'ai_generation_log j = []',
  'last_error t ?', 'rejection_reason t ?', 'retry_count i = 0', 'metrics_collected j = []', 'created', 'updated_t', 'approved_at tz ?', 'ig_creation_id t ?',
  "source t = 'app'", 'automation t ?', 'run_id u ? >ig_auto_runs setnull'],
  { idx: [{ cols: ['workspace_id', 'status'], name: 'ig_posts_ws_status' }],
    checks: [["format IN ('feed_image','feed_carousel','reel','story_image','story_video')"],
      ["status IN ('idea','generating','ready','pending_approval','approved','scheduled','publishing','published','failed','cancelled')"],
      ["automation IN ('publish','approval')"]] });
t('ig_post_metrics', ['id', 'ws', 'post_id u >ig_posts cascade', 'collected_at tz = now', 'reach i ?', 'impressions i ?', 'likes i ?', 'comments i ?', 'saves i ?', 'shares i ?',
  'plays i ?', 'profile_visits i ?', 'raw j = {}', 'created', 'updated_t']);
t('ig_autopilot_events', ['id', 'ws', 'plan_id u ? >ig_content_plans setnull', 'post_id u ? >ig_posts setnull', 'kind t', "level t = 'info'", 'message t', 'created'],
  { idx: [{ cols: ['workspace_id', 'created_at desc'], name: 'ig_autopilot_events_ws' }] });
t('ig_autopilot_weeks', ['plan_id u >ig_content_plans cascade', 'week_start d', 'created'], { compositePk: ['plan_id', 'week_start'] });
t('ig_account_insights', ['id', 'ws', 'date d', 'followers_total i ?', 'new_followers i ?', 'reach i ?', 'views i ?', 'profile_views i ?', 'website_clicks i ?',
  'accounts_engaged i ?', 'interactions i ?', 'created', 'updated'], { unique: [['workspace_id', 'date']] });
t('ig_auto_runs', ['id', 'ws', 'plan_id u >ig_content_plans cascade', 'parent_id u ? >ig_auto_runs setnull', 'created_by u ?', 'campaign_id u ? >campaigns setnull',
  'start_date d', 'end_date d', 'weekdays i[] = [0,1,2,3,4,5,6]', 'times t[]', 'story_times t[]', "formats t[] = ['feed_image','feed_carousel','reel']", 'focus t ?',
  "mode t = 'publish'", 'recurring b = false', "status t = 'planning'", 'slots j = []', 'filled i = 0', 'last_error t ?', 'locked_until tz ?', 'created', 'updated'],
  { idx: [{ cols: ['workspace_id', 'created_at desc'], name: 'ig_auto_runs_ws_idx' }],
    checks: [["mode IN ('publish','approval')"], ["status IN ('planning','active','done','cancelled','failed')"]] });

t('meta_accounts', ['id', 'ws', 'ad_account_id t ?', 'facebook_page t ?', 'instagram_account t ?', 'pixel_id t ?', "status t = 'mock'", 'created'], { idx: [['workspace_id']] });
t('meta_campaigns', ['id', 'ws', 'campaign_id u >campaigns cascade', 'external_id t ?', 'name t', 'objective t ?', "status t = 'paused'", 'created'], { idx: [['workspace_id']] });
t('meta_adsets', ['id', 'ws', 'meta_campaign_id u >meta_campaigns cascade', 'name t', 'daily_budget n ?', 'targeting j = {}', 'placements t[]', "status t = 'paused'", 'created'], { idx: [['workspace_id']] });
t('meta_ads', ['id', 'ws', 'meta_adset_id u >meta_adsets cascade', 'creative_id u ? >creatives setnull', 'name t', 'utm t ?', "status t = 'paused'", 'created'], { idx: [['workspace_id']] });

t('performance_daily', ['id', 'ws', 'campaign_id u >campaigns cascade', 'creative_id u ? >creatives setnull', 'adset_name t ?', 'date d', 'spend n = 0', 'impressions bi = 0',
  'reach bi = 0', 'clicks bi = 0', 'leads bi = 0', 'conversions bi = 0', 'revenue n = 0', 'created', "source t = 'demo'", 'meta_ad_id t ?', 'meta_adset_id t ?', 'ad_name t ?',
  'synced_at tz ?', 'external_id t ?'],
  { idx: [['workspace_id'], ['campaign_id', 'date'], { cols: ['workspace_id', 'source', 'date'], name: 'performance_daily_source' }],
    unique: [{ cols: ['campaign_id', 'meta_ad_id', 'date'], name: 'performance_daily_meta_key' },
      { cols: ['campaign_id', 'source', 'external_id', 'date'], name: 'performance_daily_external_key' }] });
t('conversions', ['id', 'ws', 'campaign_id u >campaigns cascade', 'value n = 0', "source t ? = 'meta'", 'occurred_at tz = now'], { idx: [['workspace_id']] });
t('campaign_costs', ['id', 'ws', 'campaign_id u >campaigns cascade', "kind t = 'ai'", 'description t ?', 'amount n = 0', 'created'], { idx: [['workspace_id']] });

t('media_assets', ['id', 'ws', 'brand_id u ? >brands setnull', 'campaign_id u ? >campaigns setnull', 'creative_id u ? >creatives setnull', 'ig_post_id u ? >ig_posts setnull',
  'parent_id u ? >media_assets setnull', "title t = 'Mídia'", "kind t = 'image'", "source t = 'upload'", 'storage_path t ?', 'url t ?', 'thumbnail_path t ?', 'thumbnail_url t ?',
  'mime t ?', 'width i ?', 'height i ?', 'duration_seconds n ?', 'size_bytes bi ?', 'aspect_ratio t ?', "target_format t = 'other'", 'ig_ready b = false', 'quality_report j = {}',
  'tags t[]', 'folder t ?', "status t = 'draft'", 'prompt t ?', 'provider t ?', 'cost n ?', 'created_by u ?', 'created', 'updated_t', 'angle t ?'],
  { idx: [['workspace_id', 'created_at desc'], ['creative_id'], ['ig_post_id']],
    checks: [["kind IN ('image','video')"], ["source IN ('higgsfield','chatgpt','gemini','upload','mock','other','canva','instagram')"],
      ["target_format IN ('ig_feed_square','ig_feed_portrait','ig_story','ig_reel','meta_ad_square','meta_ad_vertical','meta_ad_landscape','other')"],
      ["status IN ('draft','approved','rejected','archived')"]] });

t('crm_pipelines', ['id', 'ws', 'name t', 'is_default b = false', 'created', 'updated_t']);
t('crm_stages', ['id', 'ws', 'pipeline_id u >crm_pipelines cascade', 'name t', "color t = '#6366f1'", 'position i = 0', 'sla_hours i = 24', 'is_won b = false', 'is_lost b = false', 'created', 'updated_t']);
t('crm_loss_reasons', ['id', 'ws', 'name t', 'created']);
t('crm_tags', ['id', 'ws', 'name t', "color t = '#22d3ee'", 'created'], { unique: [['workspace_id', 'name']] });
t('crm_settings', ['workspace_id u pk >workspaces cascade', "distribution t = 'round_robin'", 'default_owner_id u ?', 'created', 'updated_t', 'wa_hourly_limit i = 30']);
t('crm_leads', ['id', 'ws', 'pipeline_id u ? >crm_pipelines setnull', 'stage_id u ? >crm_stages setnull', 'name t', 'phone t ?', 'email t ?', 'city t ?', "source t = 'manual'",
  'campaign_name t ?', 'adset_name t ?', 'ad_name t ?', 'utm_source t ?', 'utm_medium t ?', 'utm_campaign t ?', 'owner_id u ?', 'score i = 0', "temperature t = 'frio'",
  'estimated_value n = 0', 'tags t[]', 'loss_reason t ?', 'lgpd_consent b = false', 'lgpd_consent_at tz ?', 'unsubscribed b = false', 'ai_active b = true',
  'stage_entered_at tz = now', 'last_interaction_at tz ?', 'first_response_at tz ?', 'created', 'updated_t', 'form_id t ?', 'form_name t ?', 'external_id t ?', 'wa_id t ?',
  'referral_ad_id t ?', 'raw_payload j ?', 'instagram_id t ?', 'instagram_username t ?'],
  { idx: [{ cols: ['workspace_id', 'stage_id'], name: 'crm_leads_ws_stage_idx' }, ['workspace_id', 'phone'], ['workspace_id', 'email']] });
t('crm_interactions', ['id', 'ws', 'lead_id u >crm_leads cascade', "kind t = 'note'", "author_type t = 'user'", 'author_id u ?', 'content t ?', 'metadata j = {}', 'created'],
  { idx: [['lead_id', 'created_at desc']] });
t('crm_tasks', ['id', 'ws', 'lead_id u ? >crm_leads cascade', 'title t', 'assignee_id u ?', 'due_at tz ?', "status t = 'open'", 'created', 'updated_t']);
t('crm_stage_history', ['id', 'ws', 'lead_id u >crm_leads cascade', 'from_stage_id u ?', 'to_stage_id u ?', 'moved_by u ?', 'created'], { idx: [['workspace_id', 'created_at']] });
t('crm_integrations', ['id', 'ws', 'kind t', 'provider t', "status t = 'disconnected'", 'config j = {}', 'field_mapping j = {}',
  "webhook_token t = dbg:encode(gen_random_bytes(18), 'hex')", "verify_token t = dbg:encode(gen_random_bytes(12), 'hex')", 'last_event_at tz ?', 'last_error t ?', 'created', 'updated_t'],
  { unique: [['workspace_id', 'kind'], ['webhook_token']],
    checks: [["kind IN ('meta_lead_ads','whatsapp','instagram','site_form','email','calendar')"], ["provider IN ('meta','whatsapp_cloud','zapi','evolution','site','resend','calcom')"],
      ["status IN ('disconnected','connecting','connected','expired','error')"]] });
t('crm_cadences', ['id', 'ws', 'name t', "source t = 'meta_lead_ads'", 'is_active b = true', 'steps j = []', 'created', 'updated_t', "description t = ''", "trigger_type t = 'source'",
  'trigger_value t ?', 'exit_rules j = {"on_reply":true,"on_stage_change":true,"on_won_lost":true,"on_opt_out":true,"on_human_takeover":true}', 'template_key t ?']);
t('crm_cadence_runs', ['id', 'ws', 'cadence_id u >crm_cadences cascade', 'lead_id u >crm_leads cascade', 'step_index i = 0', "status t = 'running'", 'next_run_at tz = now',
  'last_error t ?', 'created', 'updated_t', 'entered_at tz = now', 'entry_stage_id u ?', 'stop_reason t ?', 'last_step_at tz ?'],
  { idx: [{ cols: ['status', 'next_run_at'], name: 'crm_cadence_runs_due_idx' }], checks: [["status IN ('running','done','stopped','failed')"]] });
t('crm_cadence_events', ['id', 'ws', 'cadence_id u >crm_cadences cascade', 'run_id u ? >crm_cadence_runs setnull', 'lead_id u ? >crm_leads cascade', 'step_index i = 0',
  "channel t = 'wa_text'", 'event t', 'message_id u ? >crm_messages setnull', 'detail t ?', 'created'],
  { idx: [['cadence_id', 'step_index'], ['workspace_id', 'created_at desc']] });
t('crm_conversations', ['id', 'ws', 'lead_id u ? >crm_leads cascade', "provider t = 'whatsapp_cloud'", 'phone t', 'wa_id t ?', 'unread_count i = 0', 'window_expires_at tz ?',
  'last_message_at tz ?', 'last_message_preview t ?', 'created', 'updated_t'], { unique: [['workspace_id', 'phone']] });
t('crm_messages', ['id', 'ws', 'conversation_id u >crm_conversations cascade', 'lead_id u ? >crm_leads cascade', 'direction t', "message_type t = 'text'", 'body t ?', 'media_url t ?',
  'template_name t ?', "status t = 'sent'", 'external_id t ?', 'error_message t ?', 'sent_by u ?', "author_type t = 'user'", 'created'],
  { idx: [['conversation_id', 'created_at']],
    checks: [["direction IN ('in','out')"], ["message_type IN ('text','image','audio','video','document','template','sticker','other')"],
      ["status IN ('queued','sent','delivered','read','failed','received')"], ["author_type IN ('user','ai','system','contact')"]] });
t('crm_quick_replies', ['id', 'ws', 'title t', 'body t', 'created']);
t('crm_wa_templates', ['id', 'ws', 'name t', "language t = 'pt_BR'", 'category t ?', "status t = 'APPROVED'", 'body_preview t ?', 'variables i = 0', 'synced_at tz = now'],
  { unique: [['workspace_id', 'name', 'language']] });
t('crm_campaign_costs', ['id', 'ws', 'date d', 'campaign_id t', 'campaign_name t ?', 'spend n = 0', 'impressions i = 0', 'clicks i = 0', 'leads i = 0', 'created'],
  { unique: [['workspace_id', 'date', 'campaign_id']] });
t('crm_webhook_events', ['id', 'workspace_id u ? >workspaces cascade', 'source t', 'external_id t ?', 'payload j ?', "status t = 'processed'", 'error_message t ?', 'created']);
t('crm_sdr_agents', ['id', 'ws', 'is_active b = false', "name t = 'Agente SDR'", "persona t = ''", "tone t = 'consultivo e cordial'",
  "goal t = 'Qualificar o lead e agendar uma reuniao com o time comercial.'", "knowledge_text t = ''", 'questions j = []', 'min_score i = 60', 'scheduling_link t ?', 'available_slots j = []',
  'business_hours j = {"timezone":"America/Sao_Paulo","days":[1,2,3,4,5],"start":"09:00","end":"18:00"}',
  "offhours_message t = 'Recebemos sua mensagem! Nosso time responde no proximo horario comercial.'", 'max_messages i = 20',
  'handoff_triggers j = ["negociacao de preco","reclamacao","assunto juridico","falar com atendente"]', "model t = 'openai/gpt-6-astra'", 'created', 'updated_t'],
  { unique: [['workspace_id']] });
t('crm_sdr_documents', ['id', 'ws', 'agent_id u >crm_sdr_agents cascade', 'file_name t', "mime_type t = 'application/pdf'", 'size_bytes i = 0', "extracted_text t = ''", 'created'], { idx: [['agent_id']] });
t('crm_sdr_runs', ['id', 'ws', 'agent_id u ? >crm_sdr_agents setnull', 'lead_id u ? >crm_leads cascade', 'conversation_id u ? >crm_conversations setnull', "mode t = 'live'",
  'inbound_text t ?', 'reply_text t ?', 'decision j = {}', 'score i ?', 'handoff b = false', "status t = 'ok'", 'error_message t ?', 'model t ?', 'input_tokens i ?', 'output_tokens i ?',
  'duration_ms i ?', 'created'], { idx: [['workspace_id', 'created_at desc'], ['lead_id', 'created_at desc']] });

t('integration_connections', ['id', 'ws', 'provider t', "status t = 'disconnected'", "mode t = 'mock'", 'account_label t ?', 'connected_at tz ?', 'created'],
  { unique: [['workspace_id', 'provider']], idx: [['workspace_id']] });
t('mcp_connections', ['id', 'ws', 'provider t', 'label t ?', 'server_url t', 'access_token t ?', "status t = 'disconnected'", 'tools j = []', 'last_error t ?', 'connected_at tz ?', 'created',
  'updated_t', 'refresh_token t ?', 'expires_at tz ?', 'oauth_client_id t ?', 'oauth_client_secret t ?', 'oauth_state t ?', 'oauth_code_verifier t ?', 'oauth_authorization_endpoint t ?',
  'oauth_token_endpoint t ?', 'oauth_scope t ?', 'oauth_resource t ?', 'oauth_redirect_uri t ?'],
  { unique: [['workspace_id', 'provider']], idx: [['oauth_state']], checks: [["provider IN ('higgsfield','meta','canva')"]] });
t('app_credentials', ['id', 'key t', 'value t', 'updated', 'workspace_id u ? >workspaces cascade'],
  { unique: [{ cols: ['workspace_id', 'key'], name: 'app_credentials_workspace_key' }] });
t('cron_tokens', ['name t pk', 'token t', 'created']);
t('cron_heartbeats', ['name t pk', 'last_run_at tz = now', "last_status t = 'ok'", 'last_detail t ?']);

module.exports = T;
