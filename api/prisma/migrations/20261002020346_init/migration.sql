-- Meu Funil — schema inicial (62 tabelas do protótipo + users).
-- Gerado pelo Prisma e complementado à mão com o que o Prisma não expressa:
-- extensões, função/gatilhos touch_updated_at, CHECKs, colunas array NOT NULL,
-- índices únicos parciais e UNIQUE NULLS NOT DISTINCT (app_credentials, PG15+).

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- CreateEnum
CREATE TYPE "workspace_role" AS ENUM ('owner', 'admin', 'marketing', 'viewer');

-- CreateTable
CREATE TABLE "users" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "email" TEXT NOT NULL,
    "password_hash" TEXT,
    "google_sub" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "profiles" (
    "id" UUID NOT NULL,
    "email" TEXT,
    "full_name" TEXT,
    "avatar_url" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "profiles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "workspaces" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "plan" TEXT NOT NULL DEFAULT 'trial',
    "owner_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ai_inherit_from" UUID,

    CONSTRAINT "workspaces_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "workspace_members" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "workspace_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "role" "workspace_role" NOT NULL DEFAULT 'marketing',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "workspace_members_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "brands" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "workspace_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "website" TEXT,
    "segment" TEXT,
    "differentials" TEXT,
    "target_audience" TEXT,
    "competitors" TEXT,
    "tone_of_voice" TEXT,
    "preferred_words" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "banned_words" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "primary_color" TEXT DEFAULT '#4F46E5',
    "secondary_color" TEXT DEFAULT '#0EA5E9',
    "typography" TEXT,
    "logo_url" TEXT,
    "region" TEXT,
    "past_campaigns" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "visual_style" JSONB NOT NULL DEFAULT '{}',

    CONSTRAINT "brands_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "brand_assets" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "workspace_id" UUID NOT NULL,
    "brand_id" UUID NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'photo',
    "name" TEXT,
    "url" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "tag" TEXT,
    "storage_path" TEXT,

    CONSTRAINT "brand_assets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "products" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "workspace_id" UUID NOT NULL,
    "brand_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "price" DECIMAL,
    "margin_percent" DECIMAL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "products_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "personas" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "workspace_id" UUID NOT NULL,
    "brand_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "age_range" TEXT,
    "location" TEXT,
    "interests" TEXT,
    "pains" TEXT,
    "desires" TEXT,
    "segment_type" TEXT DEFAULT 'B2C',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "personas_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "brand_learnings" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "workspace_id" UUID NOT NULL,
    "brand_id" UUID NOT NULL,
    "category" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "metric" TEXT,
    "score" DECIMAL DEFAULT 0,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "brand_learnings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "campaigns" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "workspace_id" UUID NOT NULL,
    "brand_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "objective" TEXT NOT NULL DEFAULT 'leads',
    "status" TEXT NOT NULL DEFAULT 'draft',
    "offer_product" TEXT,
    "offer_promise" TEXT,
    "landing_url" TEXT,
    "offer_price" DECIMAL,
    "start_date" DATE,
    "end_date" DATE,
    "audience" JSONB NOT NULL DEFAULT '{}',
    "budget_total" DECIMAL DEFAULT 0,
    "budget_daily" DECIMAL DEFAULT 0,
    "goal_leads" DECIMAL,
    "goal_sales" DECIMAL,
    "avg_ticket" DECIMAL,
    "margin_percent" DECIMAL,
    "max_cac" DECIMAL,
    "formats" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "meta_campaign_id" TEXT,
    "meta_adset_id" TEXT,
    "meta_ad_ids" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "meta_delivery_status" TEXT,
    "meta_adset_ids" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "meta_ad_map" JSONB NOT NULL DEFAULT '{}',
    "meta_lead_form_id" TEXT,
    "ads_config" JSONB NOT NULL DEFAULT '{}',
    "automation_rules" JSONB NOT NULL DEFAULT '{}',
    "last_insights_sync_at" TIMESTAMPTZ(6),
    "google_campaign_id" TEXT,
    "google_status" TEXT,
    "tiktok_campaign_id" TEXT,
    "tiktok_status" TEXT,

    CONSTRAINT "campaigns_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "campaign_strategies" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "workspace_id" UUID NOT NULL,
    "campaign_id" UUID NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "content" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "campaign_strategies_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "copies" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "workspace_id" UUID NOT NULL,
    "campaign_id" UUID NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "content" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "angle" TEXT,

    CONSTRAINT "copies_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "creatives" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "workspace_id" UUID NOT NULL,
    "campaign_id" UUID,
    "brand_id" UUID,
    "title" TEXT NOT NULL,
    "type" TEXT NOT NULL DEFAULT 'static_image',
    "prompt" TEXT,
    "aspect_ratio" TEXT DEFAULT '1:1',
    "copy_text" TEXT,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "version" INTEGER NOT NULL DEFAULT 1,
    "provider" TEXT NOT NULL DEFAULT 'mock',
    "estimated_cost" DECIMAL DEFAULT 0,
    "real_cost" DECIMAL DEFAULT 0,
    "preview_url" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "final_prompt" TEXT,
    "error_message" TEXT,
    "thumbnail_url" TEXT,
    "external_job_id" TEXT,
    "angle" TEXT,
    "extras" JSONB NOT NULL DEFAULT '{}',

    CONSTRAINT "creatives_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "creative_versions" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "workspace_id" UUID NOT NULL,
    "creative_id" UUID NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "prompt" TEXT,
    "preview_url" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "creative_versions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "creative_generation_jobs" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "workspace_id" UUID NOT NULL,
    "brand_id" UUID,
    "campaign_id" UUID,
    "creative_id" UUID,
    "provider" TEXT NOT NULL DEFAULT 'mock',
    "type" TEXT NOT NULL DEFAULT 'static_image',
    "prompt" TEXT,
    "final_prompt" TEXT,
    "aspect_ratio" TEXT,
    "status" TEXT NOT NULL DEFAULT 'queued',
    "external_job_id" TEXT,
    "asset_url" TEXT,
    "thumbnail_url" TEXT,
    "error_message" TEXT,
    "estimated_cost" DECIMAL DEFAULT 0,
    "actual_cost" DECIMAL DEFAULT 0,
    "created_by" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completed_at" TIMESTAMPTZ(6),
    "provider_log" TEXT,
    "options" JSONB NOT NULL DEFAULT '{}',

    CONSTRAINT "creative_generation_jobs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "approval_requests" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "workspace_id" UUID NOT NULL,
    "entity_type" TEXT NOT NULL,
    "entity_id" UUID,
    "campaign_id" UUID,
    "title" TEXT NOT NULL,
    "summary" TEXT,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "requested_by" UUID,
    "decided_by" UUID,
    "decided_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "approval_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "activity_logs" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "workspace_id" UUID NOT NULL,
    "actor_id" UUID,
    "action" TEXT NOT NULL,
    "entity_type" TEXT,
    "entity_id" UUID,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "activity_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_recommendations" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "workspace_id" UUID NOT NULL,
    "campaign_id" UUID,
    "action" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "estimated_impact" TEXT,
    "severity" TEXT NOT NULL DEFAULT 'medium',
    "requires_approval" BOOLEAN NOT NULL DEFAULT true,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "payload" JSONB NOT NULL DEFAULT '{}',
    "source" TEXT NOT NULL DEFAULT 'ai',
    "applied_at" TIMESTAMPTZ(6),
    "applied_by" UUID,
    "result" TEXT,

    CONSTRAINT "ai_recommendations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "social_posts" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "workspace_id" UUID NOT NULL,
    "brand_id" UUID,
    "campaign_id" UUID,
    "channel" TEXT NOT NULL DEFAULT 'instagram_feed',
    "title" TEXT NOT NULL,
    "copy_text" TEXT,
    "creative_id" UUID,
    "status" TEXT NOT NULL DEFAULT 'idea',
    "scheduled_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "social_posts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "publishing_jobs" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "workspace_id" UUID NOT NULL,
    "campaign_id" UUID,
    "post_id" UUID,
    "target" TEXT NOT NULL DEFAULT 'meta',
    "status" TEXT NOT NULL DEFAULT 'queued',
    "mode" TEXT NOT NULL DEFAULT 'mock',
    "log" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "channel" TEXT NOT NULL DEFAULT 'meta_ads',
    "ig_post_id" UUID,
    "run_at" TIMESTAMPTZ(6),
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "locked_at" TIMESTAMPTZ(6),

    CONSTRAINT "publishing_jobs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "instagram_accounts" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "workspace_id" UUID NOT NULL,
    "ig_user_id" TEXT,
    "username" TEXT,
    "facebook_page_id" TEXT,
    "profile_picture_url" TEXT,
    "status" TEXT NOT NULL DEFAULT 'disconnected',
    "last_error" TEXT,
    "connected_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "instagram_accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ig_content_plans" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "workspace_id" UUID NOT NULL,
    "brand_id" UUID,
    "name" TEXT NOT NULL,
    "objective" TEXT,
    "tone_of_voice" TEXT,
    "content_pillars" JSONB NOT NULL DEFAULT '[]',
    "posting_frequency" JSONB NOT NULL DEFAULT '{"feed":3,"reels":2,"stories":7}',
    "preferred_times" JSONB NOT NULL DEFAULT '[]',
    "hashtag_strategy" JSONB NOT NULL DEFAULT '{}',
    "cta_default" TEXT,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "auto_publish" BOOLEAN NOT NULL DEFAULT false,
    "requires_approval" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ai_notes" JSONB NOT NULL DEFAULT '[]',
    "pillar_weights" JSONB NOT NULL DEFAULT '{}',
    "last_autopilot_at" TIMESTAMPTZ(6),
    "posting_days" INTEGER[] DEFAULT ARRAY[0, 1, 2, 3, 4, 5, 6]::INTEGER[],

    CONSTRAINT "ig_content_plans_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ig_posts" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "workspace_id" UUID NOT NULL,
    "plan_id" UUID,
    "format" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'idea',
    "scheduled_at" TIMESTAMPTZ(6),
    "published_at" TIMESTAMPTZ(6),
    "theme" TEXT,
    "hook" TEXT,
    "caption" TEXT,
    "hashtags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "cta" TEXT,
    "creative_brief" JSONB NOT NULL DEFAULT '{}',
    "media" JSONB NOT NULL DEFAULT '[]',
    "ig_media_id" TEXT,
    "ig_permalink" TEXT,
    "ai_provider" TEXT,
    "ai_generation_log" JSONB NOT NULL DEFAULT '[]',
    "last_error" TEXT,
    "rejection_reason" TEXT,
    "retry_count" INTEGER NOT NULL DEFAULT 0,
    "metrics_collected" JSONB NOT NULL DEFAULT '[]',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "approved_at" TIMESTAMPTZ(6),
    "ig_creation_id" TEXT,
    "source" TEXT NOT NULL DEFAULT 'app',
    "automation" TEXT,
    "run_id" UUID,

    CONSTRAINT "ig_posts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ig_post_metrics" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "workspace_id" UUID NOT NULL,
    "post_id" UUID NOT NULL,
    "collected_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reach" INTEGER,
    "impressions" INTEGER,
    "likes" INTEGER,
    "comments" INTEGER,
    "saves" INTEGER,
    "shares" INTEGER,
    "plays" INTEGER,
    "profile_visits" INTEGER,
    "raw" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ig_post_metrics_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ig_autopilot_events" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "workspace_id" UUID NOT NULL,
    "plan_id" UUID,
    "post_id" UUID,
    "kind" TEXT NOT NULL,
    "level" TEXT NOT NULL DEFAULT 'info',
    "message" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ig_autopilot_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ig_autopilot_weeks" (
    "plan_id" UUID NOT NULL,
    "week_start" DATE NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ig_autopilot_weeks_pkey" PRIMARY KEY ("plan_id","week_start")
);

-- CreateTable
CREATE TABLE "ig_account_insights" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "workspace_id" UUID NOT NULL,
    "date" DATE NOT NULL,
    "followers_total" INTEGER,
    "new_followers" INTEGER,
    "reach" INTEGER,
    "views" INTEGER,
    "profile_views" INTEGER,
    "website_clicks" INTEGER,
    "accounts_engaged" INTEGER,
    "interactions" INTEGER,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ig_account_insights_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ig_auto_runs" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "workspace_id" UUID NOT NULL,
    "plan_id" UUID NOT NULL,
    "parent_id" UUID,
    "created_by" UUID,
    "campaign_id" UUID,
    "start_date" DATE NOT NULL,
    "end_date" DATE NOT NULL,
    "weekdays" INTEGER[] DEFAULT ARRAY[0, 1, 2, 3, 4, 5, 6]::INTEGER[],
    "times" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "story_times" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "formats" TEXT[] DEFAULT ARRAY['feed_image', 'feed_carousel', 'reel']::TEXT[],
    "focus" TEXT,
    "mode" TEXT NOT NULL DEFAULT 'publish',
    "recurring" BOOLEAN NOT NULL DEFAULT false,
    "status" TEXT NOT NULL DEFAULT 'planning',
    "slots" JSONB NOT NULL DEFAULT '[]',
    "filled" INTEGER NOT NULL DEFAULT 0,
    "last_error" TEXT,
    "locked_until" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ig_auto_runs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "meta_accounts" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "workspace_id" UUID NOT NULL,
    "ad_account_id" TEXT,
    "facebook_page" TEXT,
    "instagram_account" TEXT,
    "pixel_id" TEXT,
    "status" TEXT NOT NULL DEFAULT 'mock',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "meta_accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "meta_campaigns" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "workspace_id" UUID NOT NULL,
    "campaign_id" UUID NOT NULL,
    "external_id" TEXT,
    "name" TEXT NOT NULL,
    "objective" TEXT,
    "status" TEXT NOT NULL DEFAULT 'paused',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "meta_campaigns_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "meta_adsets" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "workspace_id" UUID NOT NULL,
    "meta_campaign_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "daily_budget" DECIMAL,
    "targeting" JSONB NOT NULL DEFAULT '{}',
    "placements" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "status" TEXT NOT NULL DEFAULT 'paused',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "meta_adsets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "meta_ads" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "workspace_id" UUID NOT NULL,
    "meta_adset_id" UUID NOT NULL,
    "creative_id" UUID,
    "name" TEXT NOT NULL,
    "utm" TEXT,
    "status" TEXT NOT NULL DEFAULT 'paused',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "meta_ads_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "performance_daily" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "workspace_id" UUID NOT NULL,
    "campaign_id" UUID NOT NULL,
    "creative_id" UUID,
    "adset_name" TEXT,
    "date" DATE NOT NULL,
    "spend" DECIMAL NOT NULL DEFAULT 0,
    "impressions" BIGINT NOT NULL DEFAULT 0,
    "reach" BIGINT NOT NULL DEFAULT 0,
    "clicks" BIGINT NOT NULL DEFAULT 0,
    "leads" BIGINT NOT NULL DEFAULT 0,
    "conversions" BIGINT NOT NULL DEFAULT 0,
    "revenue" DECIMAL NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "source" TEXT NOT NULL DEFAULT 'demo',
    "meta_ad_id" TEXT,
    "meta_adset_id" TEXT,
    "ad_name" TEXT,
    "synced_at" TIMESTAMPTZ(6),
    "external_id" TEXT,

    CONSTRAINT "performance_daily_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "conversions" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "workspace_id" UUID NOT NULL,
    "campaign_id" UUID NOT NULL,
    "value" DECIMAL NOT NULL DEFAULT 0,
    "source" TEXT DEFAULT 'meta',
    "occurred_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "conversions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "campaign_costs" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "workspace_id" UUID NOT NULL,
    "campaign_id" UUID NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'ai',
    "description" TEXT,
    "amount" DECIMAL NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "campaign_costs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "media_assets" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "workspace_id" UUID NOT NULL,
    "brand_id" UUID,
    "campaign_id" UUID,
    "creative_id" UUID,
    "ig_post_id" UUID,
    "parent_id" UUID,
    "title" TEXT NOT NULL DEFAULT 'Mídia',
    "kind" TEXT NOT NULL DEFAULT 'image',
    "source" TEXT NOT NULL DEFAULT 'upload',
    "storage_path" TEXT,
    "url" TEXT,
    "thumbnail_path" TEXT,
    "thumbnail_url" TEXT,
    "mime" TEXT,
    "width" INTEGER,
    "height" INTEGER,
    "duration_seconds" DECIMAL,
    "size_bytes" BIGINT,
    "aspect_ratio" TEXT,
    "target_format" TEXT NOT NULL DEFAULT 'other',
    "ig_ready" BOOLEAN NOT NULL DEFAULT false,
    "quality_report" JSONB NOT NULL DEFAULT '{}',
    "tags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "folder" TEXT,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "prompt" TEXT,
    "provider" TEXT,
    "cost" DECIMAL,
    "created_by" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "angle" TEXT,

    CONSTRAINT "media_assets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "crm_pipelines" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "workspace_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "is_default" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "crm_pipelines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "crm_stages" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "workspace_id" UUID NOT NULL,
    "pipeline_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "color" TEXT NOT NULL DEFAULT '#6366f1',
    "position" INTEGER NOT NULL DEFAULT 0,
    "sla_hours" INTEGER NOT NULL DEFAULT 24,
    "is_won" BOOLEAN NOT NULL DEFAULT false,
    "is_lost" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "crm_stages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "crm_loss_reasons" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "workspace_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "crm_loss_reasons_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "crm_tags" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "workspace_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "color" TEXT NOT NULL DEFAULT '#22d3ee',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "crm_tags_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "crm_settings" (
    "workspace_id" UUID NOT NULL,
    "distribution" TEXT NOT NULL DEFAULT 'round_robin',
    "default_owner_id" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "wa_hourly_limit" INTEGER NOT NULL DEFAULT 30,

    CONSTRAINT "crm_settings_pkey" PRIMARY KEY ("workspace_id")
);

-- CreateTable
CREATE TABLE "crm_leads" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "workspace_id" UUID NOT NULL,
    "pipeline_id" UUID,
    "stage_id" UUID,
    "name" TEXT NOT NULL,
    "phone" TEXT,
    "email" TEXT,
    "city" TEXT,
    "source" TEXT NOT NULL DEFAULT 'manual',
    "campaign_name" TEXT,
    "adset_name" TEXT,
    "ad_name" TEXT,
    "utm_source" TEXT,
    "utm_medium" TEXT,
    "utm_campaign" TEXT,
    "owner_id" UUID,
    "score" INTEGER NOT NULL DEFAULT 0,
    "temperature" TEXT NOT NULL DEFAULT 'frio',
    "estimated_value" DECIMAL NOT NULL DEFAULT 0,
    "tags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "loss_reason" TEXT,
    "lgpd_consent" BOOLEAN NOT NULL DEFAULT false,
    "lgpd_consent_at" TIMESTAMPTZ(6),
    "unsubscribed" BOOLEAN NOT NULL DEFAULT false,
    "ai_active" BOOLEAN NOT NULL DEFAULT true,
    "stage_entered_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_interaction_at" TIMESTAMPTZ(6),
    "first_response_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "form_id" TEXT,
    "form_name" TEXT,
    "external_id" TEXT,
    "wa_id" TEXT,
    "referral_ad_id" TEXT,
    "raw_payload" JSONB,
    "instagram_id" TEXT,
    "instagram_username" TEXT,

    CONSTRAINT "crm_leads_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "crm_interactions" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "workspace_id" UUID NOT NULL,
    "lead_id" UUID NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'note',
    "author_type" TEXT NOT NULL DEFAULT 'user',
    "author_id" UUID,
    "content" TEXT,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "crm_interactions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "crm_tasks" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "workspace_id" UUID NOT NULL,
    "lead_id" UUID,
    "title" TEXT NOT NULL,
    "assignee_id" UUID,
    "due_at" TIMESTAMPTZ(6),
    "status" TEXT NOT NULL DEFAULT 'open',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "crm_tasks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "crm_stage_history" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "workspace_id" UUID NOT NULL,
    "lead_id" UUID NOT NULL,
    "from_stage_id" UUID,
    "to_stage_id" UUID,
    "moved_by" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "crm_stage_history_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "crm_integrations" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "workspace_id" UUID NOT NULL,
    "kind" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'disconnected',
    "config" JSONB NOT NULL DEFAULT '{}',
    "field_mapping" JSONB NOT NULL DEFAULT '{}',
    "webhook_token" TEXT NOT NULL DEFAULT encode(gen_random_bytes(18), 'hex'),
    "verify_token" TEXT NOT NULL DEFAULT encode(gen_random_bytes(12), 'hex'),
    "last_event_at" TIMESTAMPTZ(6),
    "last_error" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "crm_integrations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "crm_cadences" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "workspace_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "source" TEXT NOT NULL DEFAULT 'meta_lead_ads',
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "steps" JSONB NOT NULL DEFAULT '[]',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "description" TEXT NOT NULL DEFAULT '',
    "trigger_type" TEXT NOT NULL DEFAULT 'source',
    "trigger_value" TEXT,
    "exit_rules" JSONB NOT NULL DEFAULT '{"on_reply":true,"on_stage_change":true,"on_won_lost":true,"on_opt_out":true,"on_human_takeover":true}',
    "template_key" TEXT,

    CONSTRAINT "crm_cadences_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "crm_cadence_runs" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "workspace_id" UUID NOT NULL,
    "cadence_id" UUID NOT NULL,
    "lead_id" UUID NOT NULL,
    "step_index" INTEGER NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'running',
    "next_run_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_error" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "entered_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "entry_stage_id" UUID,
    "stop_reason" TEXT,
    "last_step_at" TIMESTAMPTZ(6),

    CONSTRAINT "crm_cadence_runs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "crm_cadence_events" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "workspace_id" UUID NOT NULL,
    "cadence_id" UUID NOT NULL,
    "run_id" UUID,
    "lead_id" UUID,
    "step_index" INTEGER NOT NULL DEFAULT 0,
    "channel" TEXT NOT NULL DEFAULT 'wa_text',
    "event" TEXT NOT NULL,
    "message_id" UUID,
    "detail" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "crm_cadence_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "crm_conversations" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "workspace_id" UUID NOT NULL,
    "lead_id" UUID,
    "provider" TEXT NOT NULL DEFAULT 'whatsapp_cloud',
    "phone" TEXT NOT NULL,
    "wa_id" TEXT,
    "unread_count" INTEGER NOT NULL DEFAULT 0,
    "window_expires_at" TIMESTAMPTZ(6),
    "last_message_at" TIMESTAMPTZ(6),
    "last_message_preview" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "crm_conversations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "crm_messages" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "workspace_id" UUID NOT NULL,
    "conversation_id" UUID NOT NULL,
    "lead_id" UUID,
    "direction" TEXT NOT NULL,
    "message_type" TEXT NOT NULL DEFAULT 'text',
    "body" TEXT,
    "media_url" TEXT,
    "template_name" TEXT,
    "status" TEXT NOT NULL DEFAULT 'sent',
    "external_id" TEXT,
    "error_message" TEXT,
    "sent_by" UUID,
    "author_type" TEXT NOT NULL DEFAULT 'user',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "crm_messages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "crm_quick_replies" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "workspace_id" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "crm_quick_replies_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "crm_wa_templates" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "workspace_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "language" TEXT NOT NULL DEFAULT 'pt_BR',
    "category" TEXT,
    "status" TEXT NOT NULL DEFAULT 'APPROVED',
    "body_preview" TEXT,
    "variables" INTEGER NOT NULL DEFAULT 0,
    "synced_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "crm_wa_templates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "crm_campaign_costs" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "workspace_id" UUID NOT NULL,
    "date" DATE NOT NULL,
    "campaign_id" TEXT NOT NULL,
    "campaign_name" TEXT,
    "spend" DECIMAL NOT NULL DEFAULT 0,
    "impressions" INTEGER NOT NULL DEFAULT 0,
    "clicks" INTEGER NOT NULL DEFAULT 0,
    "leads" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "crm_campaign_costs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "crm_webhook_events" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "workspace_id" UUID,
    "source" TEXT NOT NULL,
    "external_id" TEXT,
    "payload" JSONB,
    "status" TEXT NOT NULL DEFAULT 'processed',
    "error_message" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "crm_webhook_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "crm_sdr_agents" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "workspace_id" UUID NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT false,
    "name" TEXT NOT NULL DEFAULT 'Agente SDR',
    "persona" TEXT NOT NULL DEFAULT '',
    "tone" TEXT NOT NULL DEFAULT 'consultivo e cordial',
    "goal" TEXT NOT NULL DEFAULT 'Qualificar o lead e agendar uma reuniao com o time comercial.',
    "knowledge_text" TEXT NOT NULL DEFAULT '',
    "questions" JSONB NOT NULL DEFAULT '[]',
    "min_score" INTEGER NOT NULL DEFAULT 60,
    "scheduling_link" TEXT,
    "available_slots" JSONB NOT NULL DEFAULT '[]',
    "business_hours" JSONB NOT NULL DEFAULT '{"timezone":"America/Sao_Paulo","days":[1,2,3,4,5],"start":"09:00","end":"18:00"}',
    "offhours_message" TEXT NOT NULL DEFAULT 'Recebemos sua mensagem! Nosso time responde no proximo horario comercial.',
    "max_messages" INTEGER NOT NULL DEFAULT 20,
    "handoff_triggers" JSONB NOT NULL DEFAULT '["negociacao de preco","reclamacao","assunto juridico","falar com atendente"]',
    "model" TEXT NOT NULL DEFAULT 'openai/gpt-6-astra',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "crm_sdr_agents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "crm_sdr_documents" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "workspace_id" UUID NOT NULL,
    "agent_id" UUID NOT NULL,
    "file_name" TEXT NOT NULL,
    "mime_type" TEXT NOT NULL DEFAULT 'application/pdf',
    "size_bytes" INTEGER NOT NULL DEFAULT 0,
    "extracted_text" TEXT NOT NULL DEFAULT '',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "crm_sdr_documents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "crm_sdr_runs" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "workspace_id" UUID NOT NULL,
    "agent_id" UUID,
    "lead_id" UUID,
    "conversation_id" UUID,
    "mode" TEXT NOT NULL DEFAULT 'live',
    "inbound_text" TEXT,
    "reply_text" TEXT,
    "decision" JSONB NOT NULL DEFAULT '{}',
    "score" INTEGER,
    "handoff" BOOLEAN NOT NULL DEFAULT false,
    "status" TEXT NOT NULL DEFAULT 'ok',
    "error_message" TEXT,
    "model" TEXT,
    "input_tokens" INTEGER,
    "output_tokens" INTEGER,
    "duration_ms" INTEGER,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "crm_sdr_runs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "integration_connections" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "workspace_id" UUID NOT NULL,
    "provider" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'disconnected',
    "mode" TEXT NOT NULL DEFAULT 'mock',
    "account_label" TEXT,
    "connected_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "integration_connections_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "mcp_connections" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "workspace_id" UUID NOT NULL,
    "provider" TEXT NOT NULL,
    "label" TEXT,
    "server_url" TEXT NOT NULL,
    "access_token" TEXT,
    "status" TEXT NOT NULL DEFAULT 'disconnected',
    "tools" JSONB NOT NULL DEFAULT '[]',
    "last_error" TEXT,
    "connected_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "refresh_token" TEXT,
    "expires_at" TIMESTAMPTZ(6),
    "oauth_client_id" TEXT,
    "oauth_client_secret" TEXT,
    "oauth_state" TEXT,
    "oauth_code_verifier" TEXT,
    "oauth_authorization_endpoint" TEXT,
    "oauth_token_endpoint" TEXT,
    "oauth_scope" TEXT,
    "oauth_resource" TEXT,
    "oauth_redirect_uri" TEXT,

    CONSTRAINT "mcp_connections_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "app_credentials" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "key" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "workspace_id" UUID,

    CONSTRAINT "app_credentials_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cron_tokens" (
    "name" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "cron_tokens_pkey" PRIMARY KEY ("name")
);

-- CreateTable
CREATE TABLE "cron_heartbeats" (
    "name" TEXT NOT NULL,
    "last_run_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_status" TEXT NOT NULL DEFAULT 'ok',
    "last_detail" TEXT,

    CONSTRAINT "cron_heartbeats_pkey" PRIMARY KEY ("name")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE UNIQUE INDEX "users_google_sub_key" ON "users"("google_sub");

-- CreateIndex
CREATE UNIQUE INDEX "workspace_members_workspace_id_user_id_key" ON "workspace_members"("workspace_id", "user_id");

-- CreateIndex
CREATE INDEX "brands_workspace_id_idx" ON "brands"("workspace_id");

-- CreateIndex
CREATE INDEX "brand_assets_workspace_id_idx" ON "brand_assets"("workspace_id");

-- CreateIndex
CREATE INDEX "products_workspace_id_idx" ON "products"("workspace_id");

-- CreateIndex
CREATE INDEX "personas_workspace_id_idx" ON "personas"("workspace_id");

-- CreateIndex
CREATE INDEX "brand_learnings_workspace_id_idx" ON "brand_learnings"("workspace_id");

-- CreateIndex
CREATE INDEX "campaigns_workspace_id_idx" ON "campaigns"("workspace_id");

-- CreateIndex
CREATE INDEX "campaigns_brand_id_idx" ON "campaigns"("brand_id");

-- CreateIndex
CREATE INDEX "campaign_strategies_workspace_id_idx" ON "campaign_strategies"("workspace_id");

-- CreateIndex
CREATE INDEX "copies_workspace_id_idx" ON "copies"("workspace_id");

-- CreateIndex
CREATE INDEX "creatives_workspace_id_idx" ON "creatives"("workspace_id");

-- CreateIndex
CREATE INDEX "creatives_campaign_angle" ON "creatives"("campaign_id", "angle");

-- CreateIndex
CREATE INDEX "creative_versions_workspace_id_idx" ON "creative_versions"("workspace_id");

-- CreateIndex
CREATE INDEX "creative_generation_jobs_ws_idx" ON "creative_generation_jobs"("workspace_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "approval_requests_workspace_id_idx" ON "approval_requests"("workspace_id");

-- CreateIndex
CREATE INDEX "activity_logs_workspace_id_idx" ON "activity_logs"("workspace_id");

-- CreateIndex
CREATE INDEX "ai_recommendations_workspace_id_idx" ON "ai_recommendations"("workspace_id");

-- CreateIndex
CREATE INDEX "social_posts_workspace_id_idx" ON "social_posts"("workspace_id");

-- CreateIndex
CREATE INDEX "publishing_jobs_workspace_id_idx" ON "publishing_jobs"("workspace_id");

-- CreateIndex
CREATE INDEX "publishing_jobs_queue" ON "publishing_jobs"("channel", "status", "run_at");

-- CreateIndex
CREATE UNIQUE INDEX "instagram_accounts_workspace_id_key" ON "instagram_accounts"("workspace_id");

-- CreateIndex
CREATE INDEX "ig_posts_ws_status" ON "ig_posts"("workspace_id", "status");

-- CreateIndex
CREATE INDEX "ig_autopilot_events_ws" ON "ig_autopilot_events"("workspace_id", "created_at" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "ig_account_insights_workspace_id_date_key" ON "ig_account_insights"("workspace_id", "date");

-- CreateIndex
CREATE INDEX "ig_auto_runs_ws_idx" ON "ig_auto_runs"("workspace_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "meta_accounts_workspace_id_idx" ON "meta_accounts"("workspace_id");

-- CreateIndex
CREATE INDEX "meta_campaigns_workspace_id_idx" ON "meta_campaigns"("workspace_id");

-- CreateIndex
CREATE INDEX "meta_adsets_workspace_id_idx" ON "meta_adsets"("workspace_id");

-- CreateIndex
CREATE INDEX "meta_ads_workspace_id_idx" ON "meta_ads"("workspace_id");

-- CreateIndex
CREATE INDEX "performance_daily_workspace_id_idx" ON "performance_daily"("workspace_id");

-- CreateIndex
CREATE INDEX "performance_daily_campaign_id_date_idx" ON "performance_daily"("campaign_id", "date");

-- CreateIndex
CREATE INDEX "performance_daily_source" ON "performance_daily"("workspace_id", "source", "date");

-- CreateIndex
CREATE UNIQUE INDEX "performance_daily_meta_key" ON "performance_daily"("campaign_id", "meta_ad_id", "date");

-- CreateIndex
CREATE UNIQUE INDEX "performance_daily_external_key" ON "performance_daily"("campaign_id", "source", "external_id", "date");

-- CreateIndex
CREATE INDEX "conversions_workspace_id_idx" ON "conversions"("workspace_id");

-- CreateIndex
CREATE INDEX "campaign_costs_workspace_id_idx" ON "campaign_costs"("workspace_id");

-- CreateIndex
CREATE INDEX "media_assets_workspace_id_created_at_idx" ON "media_assets"("workspace_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "media_assets_creative_id_idx" ON "media_assets"("creative_id");

-- CreateIndex
CREATE INDEX "media_assets_ig_post_id_idx" ON "media_assets"("ig_post_id");

-- CreateIndex
CREATE UNIQUE INDEX "crm_tags_workspace_id_name_key" ON "crm_tags"("workspace_id", "name");

-- CreateIndex
CREATE INDEX "crm_leads_ws_stage_idx" ON "crm_leads"("workspace_id", "stage_id");

-- CreateIndex
CREATE INDEX "crm_leads_workspace_id_phone_idx" ON "crm_leads"("workspace_id", "phone");

-- CreateIndex
CREATE INDEX "crm_leads_workspace_id_email_idx" ON "crm_leads"("workspace_id", "email");

-- CreateIndex
CREATE INDEX "crm_interactions_lead_id_created_at_idx" ON "crm_interactions"("lead_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "crm_stage_history_workspace_id_created_at_idx" ON "crm_stage_history"("workspace_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "crm_integrations_workspace_id_kind_key" ON "crm_integrations"("workspace_id", "kind");

-- CreateIndex
CREATE UNIQUE INDEX "crm_integrations_webhook_token_key" ON "crm_integrations"("webhook_token");

-- CreateIndex
CREATE INDEX "crm_cadence_runs_due_idx" ON "crm_cadence_runs"("status", "next_run_at");

-- CreateIndex
CREATE INDEX "crm_cadence_events_cadence_id_step_index_idx" ON "crm_cadence_events"("cadence_id", "step_index");

-- CreateIndex
CREATE INDEX "crm_cadence_events_workspace_id_created_at_idx" ON "crm_cadence_events"("workspace_id", "created_at" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "crm_conversations_workspace_id_phone_key" ON "crm_conversations"("workspace_id", "phone");

-- CreateIndex
CREATE INDEX "crm_messages_conversation_id_created_at_idx" ON "crm_messages"("conversation_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "crm_wa_templates_workspace_id_name_language_key" ON "crm_wa_templates"("workspace_id", "name", "language");

-- CreateIndex
CREATE UNIQUE INDEX "crm_campaign_costs_workspace_id_date_campaign_id_key" ON "crm_campaign_costs"("workspace_id", "date", "campaign_id");

-- CreateIndex
CREATE UNIQUE INDEX "crm_sdr_agents_workspace_id_key" ON "crm_sdr_agents"("workspace_id");

-- CreateIndex
CREATE INDEX "crm_sdr_documents_agent_id_idx" ON "crm_sdr_documents"("agent_id");

-- CreateIndex
CREATE INDEX "crm_sdr_runs_workspace_id_created_at_idx" ON "crm_sdr_runs"("workspace_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "crm_sdr_runs_lead_id_created_at_idx" ON "crm_sdr_runs"("lead_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "integration_connections_workspace_id_idx" ON "integration_connections"("workspace_id");

-- CreateIndex
CREATE UNIQUE INDEX "integration_connections_workspace_id_provider_key" ON "integration_connections"("workspace_id", "provider");

-- CreateIndex
CREATE INDEX "mcp_connections_oauth_state_idx" ON "mcp_connections"("oauth_state");

-- CreateIndex
CREATE UNIQUE INDEX "mcp_connections_workspace_id_provider_key" ON "mcp_connections"("workspace_id", "provider");

-- CreateIndex
CREATE UNIQUE INDEX "app_credentials_workspace_key" ON "app_credentials"("workspace_id", "key") NULLS NOT DISTINCT;

-- AddForeignKey
ALTER TABLE "workspaces" ADD CONSTRAINT "workspaces_ai_inherit_from_fkey" FOREIGN KEY ("ai_inherit_from") REFERENCES "workspaces"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workspace_members" ADD CONSTRAINT "workspace_members_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "brands" ADD CONSTRAINT "brands_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "brand_assets" ADD CONSTRAINT "brand_assets_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "brand_assets" ADD CONSTRAINT "brand_assets_brand_id_fkey" FOREIGN KEY ("brand_id") REFERENCES "brands"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "products" ADD CONSTRAINT "products_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "products" ADD CONSTRAINT "products_brand_id_fkey" FOREIGN KEY ("brand_id") REFERENCES "brands"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "personas" ADD CONSTRAINT "personas_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "personas" ADD CONSTRAINT "personas_brand_id_fkey" FOREIGN KEY ("brand_id") REFERENCES "brands"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "brand_learnings" ADD CONSTRAINT "brand_learnings_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "brand_learnings" ADD CONSTRAINT "brand_learnings_brand_id_fkey" FOREIGN KEY ("brand_id") REFERENCES "brands"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "campaigns" ADD CONSTRAINT "campaigns_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "campaigns" ADD CONSTRAINT "campaigns_brand_id_fkey" FOREIGN KEY ("brand_id") REFERENCES "brands"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "campaign_strategies" ADD CONSTRAINT "campaign_strategies_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "campaign_strategies" ADD CONSTRAINT "campaign_strategies_campaign_id_fkey" FOREIGN KEY ("campaign_id") REFERENCES "campaigns"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "copies" ADD CONSTRAINT "copies_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "copies" ADD CONSTRAINT "copies_campaign_id_fkey" FOREIGN KEY ("campaign_id") REFERENCES "campaigns"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "creatives" ADD CONSTRAINT "creatives_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "creatives" ADD CONSTRAINT "creatives_campaign_id_fkey" FOREIGN KEY ("campaign_id") REFERENCES "campaigns"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "creatives" ADD CONSTRAINT "creatives_brand_id_fkey" FOREIGN KEY ("brand_id") REFERENCES "brands"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "creative_versions" ADD CONSTRAINT "creative_versions_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "creative_versions" ADD CONSTRAINT "creative_versions_creative_id_fkey" FOREIGN KEY ("creative_id") REFERENCES "creatives"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "creative_generation_jobs" ADD CONSTRAINT "creative_generation_jobs_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "creative_generation_jobs" ADD CONSTRAINT "creative_generation_jobs_brand_id_fkey" FOREIGN KEY ("brand_id") REFERENCES "brands"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "creative_generation_jobs" ADD CONSTRAINT "creative_generation_jobs_campaign_id_fkey" FOREIGN KEY ("campaign_id") REFERENCES "campaigns"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "creative_generation_jobs" ADD CONSTRAINT "creative_generation_jobs_creative_id_fkey" FOREIGN KEY ("creative_id") REFERENCES "creatives"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "approval_requests" ADD CONSTRAINT "approval_requests_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "approval_requests" ADD CONSTRAINT "approval_requests_campaign_id_fkey" FOREIGN KEY ("campaign_id") REFERENCES "campaigns"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "activity_logs" ADD CONSTRAINT "activity_logs_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_recommendations" ADD CONSTRAINT "ai_recommendations_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_recommendations" ADD CONSTRAINT "ai_recommendations_campaign_id_fkey" FOREIGN KEY ("campaign_id") REFERENCES "campaigns"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "social_posts" ADD CONSTRAINT "social_posts_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "social_posts" ADD CONSTRAINT "social_posts_brand_id_fkey" FOREIGN KEY ("brand_id") REFERENCES "brands"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "social_posts" ADD CONSTRAINT "social_posts_campaign_id_fkey" FOREIGN KEY ("campaign_id") REFERENCES "campaigns"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "social_posts" ADD CONSTRAINT "social_posts_creative_id_fkey" FOREIGN KEY ("creative_id") REFERENCES "creatives"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "publishing_jobs" ADD CONSTRAINT "publishing_jobs_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "publishing_jobs" ADD CONSTRAINT "publishing_jobs_campaign_id_fkey" FOREIGN KEY ("campaign_id") REFERENCES "campaigns"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "publishing_jobs" ADD CONSTRAINT "publishing_jobs_post_id_fkey" FOREIGN KEY ("post_id") REFERENCES "social_posts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "publishing_jobs" ADD CONSTRAINT "publishing_jobs_ig_post_id_fkey" FOREIGN KEY ("ig_post_id") REFERENCES "ig_posts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "instagram_accounts" ADD CONSTRAINT "instagram_accounts_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ig_content_plans" ADD CONSTRAINT "ig_content_plans_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ig_content_plans" ADD CONSTRAINT "ig_content_plans_brand_id_fkey" FOREIGN KEY ("brand_id") REFERENCES "brands"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ig_posts" ADD CONSTRAINT "ig_posts_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ig_posts" ADD CONSTRAINT "ig_posts_plan_id_fkey" FOREIGN KEY ("plan_id") REFERENCES "ig_content_plans"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ig_posts" ADD CONSTRAINT "ig_posts_run_id_fkey" FOREIGN KEY ("run_id") REFERENCES "ig_auto_runs"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ig_post_metrics" ADD CONSTRAINT "ig_post_metrics_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ig_post_metrics" ADD CONSTRAINT "ig_post_metrics_post_id_fkey" FOREIGN KEY ("post_id") REFERENCES "ig_posts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ig_autopilot_events" ADD CONSTRAINT "ig_autopilot_events_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ig_autopilot_events" ADD CONSTRAINT "ig_autopilot_events_plan_id_fkey" FOREIGN KEY ("plan_id") REFERENCES "ig_content_plans"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ig_autopilot_events" ADD CONSTRAINT "ig_autopilot_events_post_id_fkey" FOREIGN KEY ("post_id") REFERENCES "ig_posts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ig_autopilot_weeks" ADD CONSTRAINT "ig_autopilot_weeks_plan_id_fkey" FOREIGN KEY ("plan_id") REFERENCES "ig_content_plans"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ig_account_insights" ADD CONSTRAINT "ig_account_insights_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ig_auto_runs" ADD CONSTRAINT "ig_auto_runs_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ig_auto_runs" ADD CONSTRAINT "ig_auto_runs_plan_id_fkey" FOREIGN KEY ("plan_id") REFERENCES "ig_content_plans"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ig_auto_runs" ADD CONSTRAINT "ig_auto_runs_parent_id_fkey" FOREIGN KEY ("parent_id") REFERENCES "ig_auto_runs"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ig_auto_runs" ADD CONSTRAINT "ig_auto_runs_campaign_id_fkey" FOREIGN KEY ("campaign_id") REFERENCES "campaigns"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "meta_accounts" ADD CONSTRAINT "meta_accounts_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "meta_campaigns" ADD CONSTRAINT "meta_campaigns_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "meta_campaigns" ADD CONSTRAINT "meta_campaigns_campaign_id_fkey" FOREIGN KEY ("campaign_id") REFERENCES "campaigns"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "meta_adsets" ADD CONSTRAINT "meta_adsets_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "meta_adsets" ADD CONSTRAINT "meta_adsets_meta_campaign_id_fkey" FOREIGN KEY ("meta_campaign_id") REFERENCES "meta_campaigns"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "meta_ads" ADD CONSTRAINT "meta_ads_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "meta_ads" ADD CONSTRAINT "meta_ads_meta_adset_id_fkey" FOREIGN KEY ("meta_adset_id") REFERENCES "meta_adsets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "meta_ads" ADD CONSTRAINT "meta_ads_creative_id_fkey" FOREIGN KEY ("creative_id") REFERENCES "creatives"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "performance_daily" ADD CONSTRAINT "performance_daily_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "performance_daily" ADD CONSTRAINT "performance_daily_campaign_id_fkey" FOREIGN KEY ("campaign_id") REFERENCES "campaigns"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "performance_daily" ADD CONSTRAINT "performance_daily_creative_id_fkey" FOREIGN KEY ("creative_id") REFERENCES "creatives"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "conversions" ADD CONSTRAINT "conversions_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "conversions" ADD CONSTRAINT "conversions_campaign_id_fkey" FOREIGN KEY ("campaign_id") REFERENCES "campaigns"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "campaign_costs" ADD CONSTRAINT "campaign_costs_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "campaign_costs" ADD CONSTRAINT "campaign_costs_campaign_id_fkey" FOREIGN KEY ("campaign_id") REFERENCES "campaigns"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "media_assets" ADD CONSTRAINT "media_assets_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "media_assets" ADD CONSTRAINT "media_assets_brand_id_fkey" FOREIGN KEY ("brand_id") REFERENCES "brands"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "media_assets" ADD CONSTRAINT "media_assets_campaign_id_fkey" FOREIGN KEY ("campaign_id") REFERENCES "campaigns"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "media_assets" ADD CONSTRAINT "media_assets_creative_id_fkey" FOREIGN KEY ("creative_id") REFERENCES "creatives"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "media_assets" ADD CONSTRAINT "media_assets_ig_post_id_fkey" FOREIGN KEY ("ig_post_id") REFERENCES "ig_posts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "media_assets" ADD CONSTRAINT "media_assets_parent_id_fkey" FOREIGN KEY ("parent_id") REFERENCES "media_assets"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "crm_pipelines" ADD CONSTRAINT "crm_pipelines_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "crm_stages" ADD CONSTRAINT "crm_stages_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "crm_stages" ADD CONSTRAINT "crm_stages_pipeline_id_fkey" FOREIGN KEY ("pipeline_id") REFERENCES "crm_pipelines"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "crm_loss_reasons" ADD CONSTRAINT "crm_loss_reasons_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "crm_tags" ADD CONSTRAINT "crm_tags_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "crm_settings" ADD CONSTRAINT "crm_settings_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "crm_leads" ADD CONSTRAINT "crm_leads_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "crm_leads" ADD CONSTRAINT "crm_leads_pipeline_id_fkey" FOREIGN KEY ("pipeline_id") REFERENCES "crm_pipelines"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "crm_leads" ADD CONSTRAINT "crm_leads_stage_id_fkey" FOREIGN KEY ("stage_id") REFERENCES "crm_stages"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "crm_interactions" ADD CONSTRAINT "crm_interactions_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "crm_interactions" ADD CONSTRAINT "crm_interactions_lead_id_fkey" FOREIGN KEY ("lead_id") REFERENCES "crm_leads"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "crm_tasks" ADD CONSTRAINT "crm_tasks_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "crm_tasks" ADD CONSTRAINT "crm_tasks_lead_id_fkey" FOREIGN KEY ("lead_id") REFERENCES "crm_leads"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "crm_stage_history" ADD CONSTRAINT "crm_stage_history_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "crm_stage_history" ADD CONSTRAINT "crm_stage_history_lead_id_fkey" FOREIGN KEY ("lead_id") REFERENCES "crm_leads"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "crm_integrations" ADD CONSTRAINT "crm_integrations_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "crm_cadences" ADD CONSTRAINT "crm_cadences_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "crm_cadence_runs" ADD CONSTRAINT "crm_cadence_runs_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "crm_cadence_runs" ADD CONSTRAINT "crm_cadence_runs_cadence_id_fkey" FOREIGN KEY ("cadence_id") REFERENCES "crm_cadences"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "crm_cadence_runs" ADD CONSTRAINT "crm_cadence_runs_lead_id_fkey" FOREIGN KEY ("lead_id") REFERENCES "crm_leads"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "crm_cadence_events" ADD CONSTRAINT "crm_cadence_events_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "crm_cadence_events" ADD CONSTRAINT "crm_cadence_events_cadence_id_fkey" FOREIGN KEY ("cadence_id") REFERENCES "crm_cadences"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "crm_cadence_events" ADD CONSTRAINT "crm_cadence_events_run_id_fkey" FOREIGN KEY ("run_id") REFERENCES "crm_cadence_runs"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "crm_cadence_events" ADD CONSTRAINT "crm_cadence_events_lead_id_fkey" FOREIGN KEY ("lead_id") REFERENCES "crm_leads"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "crm_cadence_events" ADD CONSTRAINT "crm_cadence_events_message_id_fkey" FOREIGN KEY ("message_id") REFERENCES "crm_messages"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "crm_conversations" ADD CONSTRAINT "crm_conversations_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "crm_conversations" ADD CONSTRAINT "crm_conversations_lead_id_fkey" FOREIGN KEY ("lead_id") REFERENCES "crm_leads"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "crm_messages" ADD CONSTRAINT "crm_messages_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "crm_messages" ADD CONSTRAINT "crm_messages_conversation_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "crm_conversations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "crm_messages" ADD CONSTRAINT "crm_messages_lead_id_fkey" FOREIGN KEY ("lead_id") REFERENCES "crm_leads"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "crm_quick_replies" ADD CONSTRAINT "crm_quick_replies_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "crm_wa_templates" ADD CONSTRAINT "crm_wa_templates_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "crm_campaign_costs" ADD CONSTRAINT "crm_campaign_costs_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "crm_webhook_events" ADD CONSTRAINT "crm_webhook_events_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "crm_sdr_agents" ADD CONSTRAINT "crm_sdr_agents_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "crm_sdr_documents" ADD CONSTRAINT "crm_sdr_documents_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "crm_sdr_documents" ADD CONSTRAINT "crm_sdr_documents_agent_id_fkey" FOREIGN KEY ("agent_id") REFERENCES "crm_sdr_agents"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "crm_sdr_runs" ADD CONSTRAINT "crm_sdr_runs_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "crm_sdr_runs" ADD CONSTRAINT "crm_sdr_runs_agent_id_fkey" FOREIGN KEY ("agent_id") REFERENCES "crm_sdr_agents"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "crm_sdr_runs" ADD CONSTRAINT "crm_sdr_runs_lead_id_fkey" FOREIGN KEY ("lead_id") REFERENCES "crm_leads"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "crm_sdr_runs" ADD CONSTRAINT "crm_sdr_runs_conversation_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "crm_conversations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "integration_connections" ADD CONSTRAINT "integration_connections_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "mcp_connections" ADD CONSTRAINT "mcp_connections_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "app_credentials" ADD CONSTRAINT "app_credentials_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- Escrito à mão (o Prisma não gera)
-- ---------------------------------------------------------------------------

-- Gatilho touch_updated_at (19 tabelas, como no protótipo)
CREATE OR REPLACE FUNCTION touch_updated_at() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER touch_updated_at BEFORE UPDATE ON "brands" FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
CREATE TRIGGER touch_updated_at BEFORE UPDATE ON "campaigns" FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
CREATE TRIGGER touch_updated_at BEFORE UPDATE ON "creatives" FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
CREATE TRIGGER touch_updated_at BEFORE UPDATE ON "instagram_accounts" FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
CREATE TRIGGER touch_updated_at BEFORE UPDATE ON "ig_content_plans" FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
CREATE TRIGGER touch_updated_at BEFORE UPDATE ON "ig_posts" FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
CREATE TRIGGER touch_updated_at BEFORE UPDATE ON "ig_post_metrics" FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
CREATE TRIGGER touch_updated_at BEFORE UPDATE ON "media_assets" FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
CREATE TRIGGER touch_updated_at BEFORE UPDATE ON "crm_pipelines" FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
CREATE TRIGGER touch_updated_at BEFORE UPDATE ON "crm_stages" FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
CREATE TRIGGER touch_updated_at BEFORE UPDATE ON "crm_settings" FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
CREATE TRIGGER touch_updated_at BEFORE UPDATE ON "crm_leads" FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
CREATE TRIGGER touch_updated_at BEFORE UPDATE ON "crm_tasks" FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
CREATE TRIGGER touch_updated_at BEFORE UPDATE ON "crm_integrations" FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
CREATE TRIGGER touch_updated_at BEFORE UPDATE ON "crm_cadences" FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
CREATE TRIGGER touch_updated_at BEFORE UPDATE ON "crm_cadence_runs" FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
CREATE TRIGGER touch_updated_at BEFORE UPDATE ON "crm_conversations" FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
CREATE TRIGGER touch_updated_at BEFORE UPDATE ON "crm_sdr_agents" FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
CREATE TRIGGER touch_updated_at BEFORE UPDATE ON "mcp_connections" FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

-- CHECK constraints
ALTER TABLE "publishing_jobs" ADD CONSTRAINT "publishing_jobs_channel_check" CHECK (channel IN ('meta_ads','instagram_organic'));
ALTER TABLE "instagram_accounts" ADD CONSTRAINT "instagram_accounts_status_check" CHECK (status IN ('connected','error','disconnected'));
ALTER TABLE "ig_content_plans" ADD CONSTRAINT "ig_content_plans_status_check" CHECK (status IN ('draft','active','paused'));
ALTER TABLE "ig_posts" ADD CONSTRAINT "ig_posts_format_check" CHECK (format IN ('feed_image','feed_carousel','reel','story_image','story_video'));
ALTER TABLE "ig_posts" ADD CONSTRAINT "ig_posts_status_check" CHECK (status IN ('idea','generating','ready','pending_approval','approved','scheduled','publishing','published','failed','cancelled'));
ALTER TABLE "ig_posts" ADD CONSTRAINT "ig_posts_automation_check" CHECK (automation IN ('publish','approval'));
ALTER TABLE "ig_auto_runs" ADD CONSTRAINT "ig_auto_runs_mode_check" CHECK (mode IN ('publish','approval'));
ALTER TABLE "ig_auto_runs" ADD CONSTRAINT "ig_auto_runs_status_check" CHECK (status IN ('planning','active','done','cancelled','failed'));
ALTER TABLE "media_assets" ADD CONSTRAINT "media_assets_kind_check" CHECK (kind IN ('image','video'));
ALTER TABLE "media_assets" ADD CONSTRAINT "media_assets_source_check" CHECK (source IN ('higgsfield','chatgpt','gemini','upload','mock','other','canva','instagram'));
ALTER TABLE "media_assets" ADD CONSTRAINT "media_assets_target_format_check" CHECK (target_format IN ('ig_feed_square','ig_feed_portrait','ig_story','ig_reel','meta_ad_square','meta_ad_vertical','meta_ad_landscape','other'));
ALTER TABLE "media_assets" ADD CONSTRAINT "media_assets_status_check" CHECK (status IN ('draft','approved','rejected','archived'));
ALTER TABLE "crm_integrations" ADD CONSTRAINT "crm_integrations_kind_check" CHECK (kind IN ('meta_lead_ads','whatsapp','instagram','site_form','email','calendar'));
ALTER TABLE "crm_integrations" ADD CONSTRAINT "crm_integrations_provider_check" CHECK (provider IN ('meta','whatsapp_cloud','zapi','evolution','site','resend','calcom'));
ALTER TABLE "crm_integrations" ADD CONSTRAINT "crm_integrations_status_check" CHECK (status IN ('disconnected','connecting','connected','expired','error'));
ALTER TABLE "crm_cadence_runs" ADD CONSTRAINT "crm_cadence_runs_status_check" CHECK (status IN ('running','done','stopped','failed'));
ALTER TABLE "crm_messages" ADD CONSTRAINT "crm_messages_direction_check" CHECK (direction IN ('in','out'));
ALTER TABLE "crm_messages" ADD CONSTRAINT "crm_messages_message_type_check" CHECK (message_type IN ('text','image','audio','video','document','template','sticker','other'));
ALTER TABLE "crm_messages" ADD CONSTRAINT "crm_messages_status_check" CHECK (status IN ('queued','sent','delivered','read','failed','received'));
ALTER TABLE "crm_messages" ADD CONSTRAINT "crm_messages_author_type_check" CHECK (author_type IN ('user','ai','system','contact'));
ALTER TABLE "mcp_connections" ADD CONSTRAINT "mcp_connections_provider_check" CHECK (provider IN ('higgsfield','meta','canva'));

-- Colunas array são NOT NULL no banco original
ALTER TABLE "brands" ALTER COLUMN "preferred_words" SET NOT NULL;
ALTER TABLE "brands" ALTER COLUMN "banned_words" SET NOT NULL;
ALTER TABLE "campaigns" ALTER COLUMN "formats" SET NOT NULL;
ALTER TABLE "campaigns" ALTER COLUMN "meta_ad_ids" SET NOT NULL;
ALTER TABLE "campaigns" ALTER COLUMN "meta_adset_ids" SET NOT NULL;
ALTER TABLE "ig_content_plans" ALTER COLUMN "posting_days" SET NOT NULL;
ALTER TABLE "ig_posts" ALTER COLUMN "hashtags" SET NOT NULL;
ALTER TABLE "ig_auto_runs" ALTER COLUMN "weekdays" SET NOT NULL;
ALTER TABLE "ig_auto_runs" ALTER COLUMN "times" SET NOT NULL;
ALTER TABLE "ig_auto_runs" ALTER COLUMN "story_times" SET NOT NULL;
ALTER TABLE "ig_auto_runs" ALTER COLUMN "formats" SET NOT NULL;
ALTER TABLE "meta_adsets" ALTER COLUMN "placements" SET NOT NULL;
ALTER TABLE "media_assets" ALTER COLUMN "tags" SET NOT NULL;
ALTER TABLE "crm_leads" ALTER COLUMN "tags" SET NOT NULL;

-- Índices únicos/parciais
CREATE UNIQUE INDEX "ig_posts_ws_media_uidx" ON "ig_posts"("workspace_id", "ig_media_id") WHERE "ig_media_id" IS NOT NULL;
CREATE INDEX "ig_posts_automation_idx" ON "ig_posts"("status", "scheduled_at") WHERE "automation" IS NOT NULL;
CREATE UNIQUE INDEX "ig_auto_runs_recurring_uidx" ON "ig_auto_runs"("parent_id", "start_date") WHERE "parent_id" IS NOT NULL;
CREATE UNIQUE INDEX "crm_messages_external_idx" ON "crm_messages"("workspace_id", "external_id") WHERE "external_id" IS NOT NULL;
CREATE UNIQUE INDEX "crm_webhook_events_dedup_idx" ON "crm_webhook_events"("source", "external_id") WHERE "external_id" IS NOT NULL;
CREATE UNIQUE INDEX "crm_leads_instagram_key" ON "crm_leads"("workspace_id", "instagram_id") WHERE "instagram_id" IS NOT NULL;
