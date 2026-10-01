export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      activity_logs: {
        Row: {
          action: string
          actor_id: string | null
          created_at: string
          entity_id: string | null
          entity_type: string | null
          id: string
          metadata: Json
          workspace_id: string
        }
        Insert: {
          action: string
          actor_id?: string | null
          created_at?: string
          entity_id?: string | null
          entity_type?: string | null
          id?: string
          metadata?: Json
          workspace_id: string
        }
        Update: {
          action?: string
          actor_id?: string | null
          created_at?: string
          entity_id?: string | null
          entity_type?: string | null
          id?: string
          metadata?: Json
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "activity_logs_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      ai_recommendations: {
        Row: {
          action: string
          applied_at: string | null
          applied_by: string | null
          campaign_id: string | null
          created_at: string
          estimated_impact: string | null
          id: string
          payload: Json
          reason: string
          requires_approval: boolean
          result: string | null
          severity: string
          source: string
          status: string
          title: string
          workspace_id: string
        }
        Insert: {
          action: string
          applied_at?: string | null
          applied_by?: string | null
          campaign_id?: string | null
          created_at?: string
          estimated_impact?: string | null
          id?: string
          payload?: Json
          reason: string
          requires_approval?: boolean
          result?: string | null
          severity?: string
          source?: string
          status?: string
          title: string
          workspace_id: string
        }
        Update: {
          action?: string
          applied_at?: string | null
          applied_by?: string | null
          campaign_id?: string | null
          created_at?: string
          estimated_impact?: string | null
          id?: string
          payload?: Json
          reason?: string
          requires_approval?: boolean
          result?: string | null
          severity?: string
          source?: string
          status?: string
          title?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "ai_recommendations_campaign_id_fkey"
            columns: ["campaign_id"]
            isOneToOne: false
            referencedRelation: "campaigns"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ai_recommendations_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      app_credentials: {
        Row: {
          id: string
          key: string
          updated_at: string
          value: string
          workspace_id: string | null
        }
        Insert: {
          id?: string
          key: string
          updated_at?: string
          value: string
          workspace_id?: string | null
        }
        Update: {
          id?: string
          key?: string
          updated_at?: string
          value?: string
          workspace_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "app_credentials_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      approval_requests: {
        Row: {
          campaign_id: string | null
          created_at: string
          decided_at: string | null
          decided_by: string | null
          entity_id: string | null
          entity_type: string
          id: string
          requested_by: string | null
          status: string
          summary: string | null
          title: string
          workspace_id: string
        }
        Insert: {
          campaign_id?: string | null
          created_at?: string
          decided_at?: string | null
          decided_by?: string | null
          entity_id?: string | null
          entity_type: string
          id?: string
          requested_by?: string | null
          status?: string
          summary?: string | null
          title: string
          workspace_id: string
        }
        Update: {
          campaign_id?: string | null
          created_at?: string
          decided_at?: string | null
          decided_by?: string | null
          entity_id?: string | null
          entity_type?: string
          id?: string
          requested_by?: string | null
          status?: string
          summary?: string | null
          title?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "approval_requests_campaign_id_fkey"
            columns: ["campaign_id"]
            isOneToOne: false
            referencedRelation: "campaigns"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "approval_requests_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      brand_assets: {
        Row: {
          brand_id: string
          created_at: string
          id: string
          kind: string
          name: string | null
          storage_path: string | null
          tag: string | null
          url: string | null
          workspace_id: string
        }
        Insert: {
          brand_id: string
          created_at?: string
          id?: string
          kind?: string
          name?: string | null
          storage_path?: string | null
          tag?: string | null
          url?: string | null
          workspace_id: string
        }
        Update: {
          brand_id?: string
          created_at?: string
          id?: string
          kind?: string
          name?: string | null
          storage_path?: string | null
          tag?: string | null
          url?: string | null
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "brand_assets_brand_id_fkey"
            columns: ["brand_id"]
            isOneToOne: false
            referencedRelation: "brands"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "brand_assets_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      brand_learnings: {
        Row: {
          brand_id: string
          category: string
          created_at: string
          id: string
          metric: string | null
          score: number | null
          value: string
          workspace_id: string
        }
        Insert: {
          brand_id: string
          category: string
          created_at?: string
          id?: string
          metric?: string | null
          score?: number | null
          value: string
          workspace_id: string
        }
        Update: {
          brand_id?: string
          category?: string
          created_at?: string
          id?: string
          metric?: string | null
          score?: number | null
          value?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "brand_learnings_brand_id_fkey"
            columns: ["brand_id"]
            isOneToOne: false
            referencedRelation: "brands"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "brand_learnings_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      brands: {
        Row: {
          banned_words: string[]
          competitors: string | null
          created_at: string
          description: string | null
          differentials: string | null
          id: string
          logo_url: string | null
          name: string
          past_campaigns: string | null
          preferred_words: string[]
          primary_color: string | null
          region: string | null
          secondary_color: string | null
          segment: string | null
          target_audience: string | null
          tone_of_voice: string | null
          typography: string | null
          updated_at: string
          visual_style: Json
          website: string | null
          workspace_id: string
        }
        Insert: {
          banned_words?: string[]
          competitors?: string | null
          created_at?: string
          description?: string | null
          differentials?: string | null
          id?: string
          logo_url?: string | null
          name: string
          past_campaigns?: string | null
          preferred_words?: string[]
          primary_color?: string | null
          region?: string | null
          secondary_color?: string | null
          segment?: string | null
          target_audience?: string | null
          tone_of_voice?: string | null
          typography?: string | null
          updated_at?: string
          visual_style?: Json
          website?: string | null
          workspace_id: string
        }
        Update: {
          banned_words?: string[]
          competitors?: string | null
          created_at?: string
          description?: string | null
          differentials?: string | null
          id?: string
          logo_url?: string | null
          name?: string
          past_campaigns?: string | null
          preferred_words?: string[]
          primary_color?: string | null
          region?: string | null
          secondary_color?: string | null
          segment?: string | null
          target_audience?: string | null
          tone_of_voice?: string | null
          typography?: string | null
          updated_at?: string
          visual_style?: Json
          website?: string | null
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "brands_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      campaign_costs: {
        Row: {
          amount: number
          campaign_id: string
          created_at: string
          description: string | null
          id: string
          kind: string
          workspace_id: string
        }
        Insert: {
          amount?: number
          campaign_id: string
          created_at?: string
          description?: string | null
          id?: string
          kind?: string
          workspace_id: string
        }
        Update: {
          amount?: number
          campaign_id?: string
          created_at?: string
          description?: string | null
          id?: string
          kind?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "campaign_costs_campaign_id_fkey"
            columns: ["campaign_id"]
            isOneToOne: false
            referencedRelation: "campaigns"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "campaign_costs_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      campaign_strategies: {
        Row: {
          campaign_id: string
          content: Json
          created_at: string
          id: string
          status: string
          version: number
          workspace_id: string
        }
        Insert: {
          campaign_id: string
          content?: Json
          created_at?: string
          id?: string
          status?: string
          version?: number
          workspace_id: string
        }
        Update: {
          campaign_id?: string
          content?: Json
          created_at?: string
          id?: string
          status?: string
          version?: number
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "campaign_strategies_campaign_id_fkey"
            columns: ["campaign_id"]
            isOneToOne: false
            referencedRelation: "campaigns"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "campaign_strategies_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      campaigns: {
        Row: {
          ads_config: Json
          audience: Json
          automation_rules: Json
          avg_ticket: number | null
          brand_id: string
          budget_daily: number | null
          budget_total: number | null
          created_at: string
          end_date: string | null
          formats: string[]
          goal_leads: number | null
          goal_sales: number | null
          id: string
          landing_url: string | null
          last_insights_sync_at: string | null
          margin_percent: number | null
          max_cac: number | null
          meta_ad_ids: string[]
          meta_ad_map: Json
          meta_adset_id: string | null
          meta_adset_ids: string[]
          meta_campaign_id: string | null
          meta_delivery_status: string | null
          meta_lead_form_id: string | null
          name: string
          objective: string
          offer_price: number | null
          offer_product: string | null
          offer_promise: string | null
          start_date: string | null
          status: string
          updated_at: string
          workspace_id: string
        }
        Insert: {
          ads_config?: Json
          audience?: Json
          automation_rules?: Json
          avg_ticket?: number | null
          brand_id: string
          budget_daily?: number | null
          budget_total?: number | null
          created_at?: string
          end_date?: string | null
          formats?: string[]
          goal_leads?: number | null
          goal_sales?: number | null
          id?: string
          landing_url?: string | null
          last_insights_sync_at?: string | null
          margin_percent?: number | null
          max_cac?: number | null
          meta_ad_ids?: string[]
          meta_ad_map?: Json
          meta_adset_id?: string | null
          meta_adset_ids?: string[]
          meta_campaign_id?: string | null
          meta_delivery_status?: string | null
          meta_lead_form_id?: string | null
          name: string
          objective?: string
          offer_price?: number | null
          offer_product?: string | null
          offer_promise?: string | null
          start_date?: string | null
          status?: string
          updated_at?: string
          workspace_id: string
        }
        Update: {
          ads_config?: Json
          audience?: Json
          automation_rules?: Json
          avg_ticket?: number | null
          brand_id?: string
          budget_daily?: number | null
          budget_total?: number | null
          created_at?: string
          end_date?: string | null
          formats?: string[]
          goal_leads?: number | null
          goal_sales?: number | null
          id?: string
          landing_url?: string | null
          last_insights_sync_at?: string | null
          margin_percent?: number | null
          max_cac?: number | null
          meta_ad_ids?: string[]
          meta_ad_map?: Json
          meta_adset_id?: string | null
          meta_adset_ids?: string[]
          meta_campaign_id?: string | null
          meta_delivery_status?: string | null
          meta_lead_form_id?: string | null
          name?: string
          objective?: string
          offer_price?: number | null
          offer_product?: string | null
          offer_promise?: string | null
          start_date?: string | null
          status?: string
          updated_at?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "campaigns_brand_id_fkey"
            columns: ["brand_id"]
            isOneToOne: false
            referencedRelation: "brands"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "campaigns_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      conversions: {
        Row: {
          campaign_id: string
          id: string
          occurred_at: string
          source: string | null
          value: number
          workspace_id: string
        }
        Insert: {
          campaign_id: string
          id?: string
          occurred_at?: string
          source?: string | null
          value?: number
          workspace_id: string
        }
        Update: {
          campaign_id?: string
          id?: string
          occurred_at?: string
          source?: string | null
          value?: number
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "conversions_campaign_id_fkey"
            columns: ["campaign_id"]
            isOneToOne: false
            referencedRelation: "campaigns"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "conversions_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      copies: {
        Row: {
          campaign_id: string
          content: Json
          created_at: string
          id: string
          status: string
          version: number
          workspace_id: string
        }
        Insert: {
          campaign_id: string
          content?: Json
          created_at?: string
          id?: string
          status?: string
          version?: number
          workspace_id: string
        }
        Update: {
          campaign_id?: string
          content?: Json
          created_at?: string
          id?: string
          status?: string
          version?: number
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "copies_campaign_id_fkey"
            columns: ["campaign_id"]
            isOneToOne: false
            referencedRelation: "campaigns"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "copies_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      creative_generation_jobs: {
        Row: {
          actual_cost: number | null
          aspect_ratio: string | null
          asset_url: string | null
          brand_id: string | null
          campaign_id: string | null
          completed_at: string | null
          created_at: string
          created_by: string | null
          creative_id: string | null
          error_message: string | null
          estimated_cost: number | null
          external_job_id: string | null
          final_prompt: string | null
          id: string
          options: Json
          prompt: string | null
          provider: string
          provider_log: string | null
          status: string
          thumbnail_url: string | null
          type: string
          workspace_id: string
        }
        Insert: {
          actual_cost?: number | null
          aspect_ratio?: string | null
          asset_url?: string | null
          brand_id?: string | null
          campaign_id?: string | null
          completed_at?: string | null
          created_at?: string
          created_by?: string | null
          creative_id?: string | null
          error_message?: string | null
          estimated_cost?: number | null
          external_job_id?: string | null
          final_prompt?: string | null
          id?: string
          options?: Json
          prompt?: string | null
          provider?: string
          provider_log?: string | null
          status?: string
          thumbnail_url?: string | null
          type?: string
          workspace_id: string
        }
        Update: {
          actual_cost?: number | null
          aspect_ratio?: string | null
          asset_url?: string | null
          brand_id?: string | null
          campaign_id?: string | null
          completed_at?: string | null
          created_at?: string
          created_by?: string | null
          creative_id?: string | null
          error_message?: string | null
          estimated_cost?: number | null
          external_job_id?: string | null
          final_prompt?: string | null
          id?: string
          options?: Json
          prompt?: string | null
          provider?: string
          provider_log?: string | null
          status?: string
          thumbnail_url?: string | null
          type?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "creative_generation_jobs_brand_id_fkey"
            columns: ["brand_id"]
            isOneToOne: false
            referencedRelation: "brands"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "creative_generation_jobs_campaign_id_fkey"
            columns: ["campaign_id"]
            isOneToOne: false
            referencedRelation: "campaigns"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "creative_generation_jobs_creative_id_fkey"
            columns: ["creative_id"]
            isOneToOne: false
            referencedRelation: "creatives"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "creative_generation_jobs_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      creative_versions: {
        Row: {
          created_at: string
          creative_id: string
          id: string
          preview_url: string | null
          prompt: string | null
          version: number
          workspace_id: string
        }
        Insert: {
          created_at?: string
          creative_id: string
          id?: string
          preview_url?: string | null
          prompt?: string | null
          version?: number
          workspace_id: string
        }
        Update: {
          created_at?: string
          creative_id?: string
          id?: string
          preview_url?: string | null
          prompt?: string | null
          version?: number
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "creative_versions_creative_id_fkey"
            columns: ["creative_id"]
            isOneToOne: false
            referencedRelation: "creatives"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "creative_versions_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      creatives: {
        Row: {
          aspect_ratio: string | null
          brand_id: string | null
          campaign_id: string | null
          copy_text: string | null
          created_at: string
          error_message: string | null
          estimated_cost: number | null
          external_job_id: string | null
          extras: Json
          final_prompt: string | null
          id: string
          preview_url: string | null
          prompt: string | null
          provider: string
          real_cost: number | null
          status: string
          thumbnail_url: string | null
          title: string
          type: string
          updated_at: string
          version: number
          workspace_id: string
        }
        Insert: {
          aspect_ratio?: string | null
          brand_id?: string | null
          campaign_id?: string | null
          copy_text?: string | null
          created_at?: string
          error_message?: string | null
          estimated_cost?: number | null
          external_job_id?: string | null
          extras?: Json
          final_prompt?: string | null
          id?: string
          preview_url?: string | null
          prompt?: string | null
          provider?: string
          real_cost?: number | null
          status?: string
          thumbnail_url?: string | null
          title: string
          type?: string
          updated_at?: string
          version?: number
          workspace_id: string
        }
        Update: {
          aspect_ratio?: string | null
          brand_id?: string | null
          campaign_id?: string | null
          copy_text?: string | null
          created_at?: string
          error_message?: string | null
          estimated_cost?: number | null
          external_job_id?: string | null
          extras?: Json
          final_prompt?: string | null
          id?: string
          preview_url?: string | null
          prompt?: string | null
          provider?: string
          real_cost?: number | null
          status?: string
          thumbnail_url?: string | null
          title?: string
          type?: string
          updated_at?: string
          version?: number
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "creatives_brand_id_fkey"
            columns: ["brand_id"]
            isOneToOne: false
            referencedRelation: "brands"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "creatives_campaign_id_fkey"
            columns: ["campaign_id"]
            isOneToOne: false
            referencedRelation: "campaigns"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "creatives_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      crm_cadence_events: {
        Row: {
          cadence_id: string
          channel: string
          created_at: string
          detail: string | null
          event: string
          id: string
          lead_id: string | null
          message_id: string | null
          run_id: string | null
          step_index: number
          workspace_id: string
        }
        Insert: {
          cadence_id: string
          channel?: string
          created_at?: string
          detail?: string | null
          event: string
          id?: string
          lead_id?: string | null
          message_id?: string | null
          run_id?: string | null
          step_index?: number
          workspace_id: string
        }
        Update: {
          cadence_id?: string
          channel?: string
          created_at?: string
          detail?: string | null
          event?: string
          id?: string
          lead_id?: string | null
          message_id?: string | null
          run_id?: string | null
          step_index?: number
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "crm_cadence_events_cadence_id_fkey"
            columns: ["cadence_id"]
            isOneToOne: false
            referencedRelation: "crm_cadences"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "crm_cadence_events_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "crm_leads"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "crm_cadence_events_message_id_fkey"
            columns: ["message_id"]
            isOneToOne: false
            referencedRelation: "crm_messages"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "crm_cadence_events_run_id_fkey"
            columns: ["run_id"]
            isOneToOne: false
            referencedRelation: "crm_cadence_runs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "crm_cadence_events_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      crm_cadence_runs: {
        Row: {
          cadence_id: string
          created_at: string
          entered_at: string
          entry_stage_id: string | null
          id: string
          last_error: string | null
          last_step_at: string | null
          lead_id: string
          next_run_at: string
          status: string
          step_index: number
          stop_reason: string | null
          updated_at: string
          workspace_id: string
        }
        Insert: {
          cadence_id: string
          created_at?: string
          entered_at?: string
          entry_stage_id?: string | null
          id?: string
          last_error?: string | null
          last_step_at?: string | null
          lead_id: string
          next_run_at?: string
          status?: string
          step_index?: number
          stop_reason?: string | null
          updated_at?: string
          workspace_id: string
        }
        Update: {
          cadence_id?: string
          created_at?: string
          entered_at?: string
          entry_stage_id?: string | null
          id?: string
          last_error?: string | null
          last_step_at?: string | null
          lead_id?: string
          next_run_at?: string
          status?: string
          step_index?: number
          stop_reason?: string | null
          updated_at?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "crm_cadence_runs_cadence_id_fkey"
            columns: ["cadence_id"]
            isOneToOne: false
            referencedRelation: "crm_cadences"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "crm_cadence_runs_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "crm_leads"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "crm_cadence_runs_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      crm_cadences: {
        Row: {
          created_at: string
          description: string
          exit_rules: Json
          id: string
          is_active: boolean
          name: string
          source: string
          steps: Json
          template_key: string | null
          trigger_type: string
          trigger_value: string | null
          updated_at: string
          workspace_id: string
        }
        Insert: {
          created_at?: string
          description?: string
          exit_rules?: Json
          id?: string
          is_active?: boolean
          name: string
          source?: string
          steps?: Json
          template_key?: string | null
          trigger_type?: string
          trigger_value?: string | null
          updated_at?: string
          workspace_id: string
        }
        Update: {
          created_at?: string
          description?: string
          exit_rules?: Json
          id?: string
          is_active?: boolean
          name?: string
          source?: string
          steps?: Json
          template_key?: string | null
          trigger_type?: string
          trigger_value?: string | null
          updated_at?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "crm_cadences_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      crm_campaign_costs: {
        Row: {
          campaign_id: string
          campaign_name: string | null
          clicks: number
          created_at: string
          date: string
          id: string
          impressions: number
          leads: number
          spend: number
          workspace_id: string
        }
        Insert: {
          campaign_id: string
          campaign_name?: string | null
          clicks?: number
          created_at?: string
          date: string
          id?: string
          impressions?: number
          leads?: number
          spend?: number
          workspace_id: string
        }
        Update: {
          campaign_id?: string
          campaign_name?: string | null
          clicks?: number
          created_at?: string
          date?: string
          id?: string
          impressions?: number
          leads?: number
          spend?: number
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "crm_campaign_costs_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      crm_conversations: {
        Row: {
          created_at: string
          id: string
          last_message_at: string | null
          last_message_preview: string | null
          lead_id: string | null
          phone: string
          provider: string
          unread_count: number
          updated_at: string
          wa_id: string | null
          window_expires_at: string | null
          workspace_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          last_message_at?: string | null
          last_message_preview?: string | null
          lead_id?: string | null
          phone: string
          provider?: string
          unread_count?: number
          updated_at?: string
          wa_id?: string | null
          window_expires_at?: string | null
          workspace_id: string
        }
        Update: {
          created_at?: string
          id?: string
          last_message_at?: string | null
          last_message_preview?: string | null
          lead_id?: string | null
          phone?: string
          provider?: string
          unread_count?: number
          updated_at?: string
          wa_id?: string | null
          window_expires_at?: string | null
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "crm_conversations_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "crm_leads"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "crm_conversations_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      crm_integrations: {
        Row: {
          config: Json
          created_at: string
          field_mapping: Json
          id: string
          kind: string
          last_error: string | null
          last_event_at: string | null
          provider: string
          status: string
          updated_at: string
          verify_token: string
          webhook_token: string
          workspace_id: string
        }
        Insert: {
          config?: Json
          created_at?: string
          field_mapping?: Json
          id?: string
          kind: string
          last_error?: string | null
          last_event_at?: string | null
          provider: string
          status?: string
          updated_at?: string
          verify_token?: string
          webhook_token?: string
          workspace_id: string
        }
        Update: {
          config?: Json
          created_at?: string
          field_mapping?: Json
          id?: string
          kind?: string
          last_error?: string | null
          last_event_at?: string | null
          provider?: string
          status?: string
          updated_at?: string
          verify_token?: string
          webhook_token?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "crm_integrations_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      crm_interactions: {
        Row: {
          author_id: string | null
          author_type: string
          content: string | null
          created_at: string
          id: string
          kind: string
          lead_id: string
          metadata: Json
          workspace_id: string
        }
        Insert: {
          author_id?: string | null
          author_type?: string
          content?: string | null
          created_at?: string
          id?: string
          kind?: string
          lead_id: string
          metadata?: Json
          workspace_id: string
        }
        Update: {
          author_id?: string | null
          author_type?: string
          content?: string | null
          created_at?: string
          id?: string
          kind?: string
          lead_id?: string
          metadata?: Json
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "crm_interactions_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "crm_leads"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "crm_interactions_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      crm_leads: {
        Row: {
          ad_name: string | null
          adset_name: string | null
          ai_active: boolean
          campaign_name: string | null
          city: string | null
          created_at: string
          email: string | null
          estimated_value: number
          external_id: string | null
          first_response_at: string | null
          form_id: string | null
          form_name: string | null
          id: string
          instagram_id: string | null
          instagram_username: string | null
          last_interaction_at: string | null
          lgpd_consent: boolean
          lgpd_consent_at: string | null
          loss_reason: string | null
          name: string
          owner_id: string | null
          phone: string | null
          pipeline_id: string | null
          raw_payload: Json | null
          referral_ad_id: string | null
          score: number
          source: string
          stage_entered_at: string
          stage_id: string | null
          tags: string[]
          temperature: string
          unsubscribed: boolean
          updated_at: string
          utm_campaign: string | null
          utm_medium: string | null
          utm_source: string | null
          wa_id: string | null
          workspace_id: string
        }
        Insert: {
          ad_name?: string | null
          adset_name?: string | null
          ai_active?: boolean
          campaign_name?: string | null
          city?: string | null
          created_at?: string
          email?: string | null
          estimated_value?: number
          external_id?: string | null
          first_response_at?: string | null
          form_id?: string | null
          form_name?: string | null
          id?: string
          instagram_id?: string | null
          instagram_username?: string | null
          last_interaction_at?: string | null
          lgpd_consent?: boolean
          lgpd_consent_at?: string | null
          loss_reason?: string | null
          name: string
          owner_id?: string | null
          phone?: string | null
          pipeline_id?: string | null
          raw_payload?: Json | null
          referral_ad_id?: string | null
          score?: number
          source?: string
          stage_entered_at?: string
          stage_id?: string | null
          tags?: string[]
          temperature?: string
          unsubscribed?: boolean
          updated_at?: string
          utm_campaign?: string | null
          utm_medium?: string | null
          utm_source?: string | null
          wa_id?: string | null
          workspace_id: string
        }
        Update: {
          ad_name?: string | null
          adset_name?: string | null
          ai_active?: boolean
          campaign_name?: string | null
          city?: string | null
          created_at?: string
          email?: string | null
          estimated_value?: number
          external_id?: string | null
          first_response_at?: string | null
          form_id?: string | null
          form_name?: string | null
          id?: string
          instagram_id?: string | null
          instagram_username?: string | null
          last_interaction_at?: string | null
          lgpd_consent?: boolean
          lgpd_consent_at?: string | null
          loss_reason?: string | null
          name?: string
          owner_id?: string | null
          phone?: string | null
          pipeline_id?: string | null
          raw_payload?: Json | null
          referral_ad_id?: string | null
          score?: number
          source?: string
          stage_entered_at?: string
          stage_id?: string | null
          tags?: string[]
          temperature?: string
          unsubscribed?: boolean
          updated_at?: string
          utm_campaign?: string | null
          utm_medium?: string | null
          utm_source?: string | null
          wa_id?: string | null
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "crm_leads_pipeline_id_fkey"
            columns: ["pipeline_id"]
            isOneToOne: false
            referencedRelation: "crm_pipelines"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "crm_leads_stage_id_fkey"
            columns: ["stage_id"]
            isOneToOne: false
            referencedRelation: "crm_stages"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "crm_leads_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      crm_loss_reasons: {
        Row: {
          created_at: string
          id: string
          name: string
          workspace_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          name: string
          workspace_id: string
        }
        Update: {
          created_at?: string
          id?: string
          name?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "crm_loss_reasons_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      crm_messages: {
        Row: {
          author_type: string
          body: string | null
          conversation_id: string
          created_at: string
          direction: string
          error_message: string | null
          external_id: string | null
          id: string
          lead_id: string | null
          media_url: string | null
          message_type: string
          sent_by: string | null
          status: string
          template_name: string | null
          workspace_id: string
        }
        Insert: {
          author_type?: string
          body?: string | null
          conversation_id: string
          created_at?: string
          direction: string
          error_message?: string | null
          external_id?: string | null
          id?: string
          lead_id?: string | null
          media_url?: string | null
          message_type?: string
          sent_by?: string | null
          status?: string
          template_name?: string | null
          workspace_id: string
        }
        Update: {
          author_type?: string
          body?: string | null
          conversation_id?: string
          created_at?: string
          direction?: string
          error_message?: string | null
          external_id?: string | null
          id?: string
          lead_id?: string | null
          media_url?: string | null
          message_type?: string
          sent_by?: string | null
          status?: string
          template_name?: string | null
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "crm_messages_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "crm_conversations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "crm_messages_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "crm_leads"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "crm_messages_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      crm_pipelines: {
        Row: {
          created_at: string
          id: string
          is_default: boolean
          name: string
          updated_at: string
          workspace_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          is_default?: boolean
          name: string
          updated_at?: string
          workspace_id: string
        }
        Update: {
          created_at?: string
          id?: string
          is_default?: boolean
          name?: string
          updated_at?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "crm_pipelines_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      crm_quick_replies: {
        Row: {
          body: string
          created_at: string
          id: string
          title: string
          workspace_id: string
        }
        Insert: {
          body: string
          created_at?: string
          id?: string
          title: string
          workspace_id: string
        }
        Update: {
          body?: string
          created_at?: string
          id?: string
          title?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "crm_quick_replies_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      crm_sdr_agents: {
        Row: {
          available_slots: Json
          business_hours: Json
          created_at: string
          goal: string
          handoff_triggers: Json
          id: string
          is_active: boolean
          knowledge_text: string
          max_messages: number
          min_score: number
          model: string
          name: string
          offhours_message: string
          persona: string
          questions: Json
          scheduling_link: string | null
          tone: string
          updated_at: string
          workspace_id: string
        }
        Insert: {
          available_slots?: Json
          business_hours?: Json
          created_at?: string
          goal?: string
          handoff_triggers?: Json
          id?: string
          is_active?: boolean
          knowledge_text?: string
          max_messages?: number
          min_score?: number
          model?: string
          name?: string
          offhours_message?: string
          persona?: string
          questions?: Json
          scheduling_link?: string | null
          tone?: string
          updated_at?: string
          workspace_id: string
        }
        Update: {
          available_slots?: Json
          business_hours?: Json
          created_at?: string
          goal?: string
          handoff_triggers?: Json
          id?: string
          is_active?: boolean
          knowledge_text?: string
          max_messages?: number
          min_score?: number
          model?: string
          name?: string
          offhours_message?: string
          persona?: string
          questions?: Json
          scheduling_link?: string | null
          tone?: string
          updated_at?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "crm_sdr_agents_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: true
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      crm_sdr_documents: {
        Row: {
          agent_id: string
          created_at: string
          extracted_text: string
          file_name: string
          id: string
          mime_type: string
          size_bytes: number
          workspace_id: string
        }
        Insert: {
          agent_id: string
          created_at?: string
          extracted_text?: string
          file_name: string
          id?: string
          mime_type?: string
          size_bytes?: number
          workspace_id: string
        }
        Update: {
          agent_id?: string
          created_at?: string
          extracted_text?: string
          file_name?: string
          id?: string
          mime_type?: string
          size_bytes?: number
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "crm_sdr_documents_agent_id_fkey"
            columns: ["agent_id"]
            isOneToOne: false
            referencedRelation: "crm_sdr_agents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "crm_sdr_documents_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      crm_sdr_runs: {
        Row: {
          agent_id: string | null
          conversation_id: string | null
          created_at: string
          decision: Json
          duration_ms: number | null
          error_message: string | null
          handoff: boolean
          id: string
          inbound_text: string | null
          input_tokens: number | null
          lead_id: string | null
          mode: string
          model: string | null
          output_tokens: number | null
          reply_text: string | null
          score: number | null
          status: string
          workspace_id: string
        }
        Insert: {
          agent_id?: string | null
          conversation_id?: string | null
          created_at?: string
          decision?: Json
          duration_ms?: number | null
          error_message?: string | null
          handoff?: boolean
          id?: string
          inbound_text?: string | null
          input_tokens?: number | null
          lead_id?: string | null
          mode?: string
          model?: string | null
          output_tokens?: number | null
          reply_text?: string | null
          score?: number | null
          status?: string
          workspace_id: string
        }
        Update: {
          agent_id?: string | null
          conversation_id?: string | null
          created_at?: string
          decision?: Json
          duration_ms?: number | null
          error_message?: string | null
          handoff?: boolean
          id?: string
          inbound_text?: string | null
          input_tokens?: number | null
          lead_id?: string | null
          mode?: string
          model?: string | null
          output_tokens?: number | null
          reply_text?: string | null
          score?: number | null
          status?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "crm_sdr_runs_agent_id_fkey"
            columns: ["agent_id"]
            isOneToOne: false
            referencedRelation: "crm_sdr_agents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "crm_sdr_runs_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "crm_conversations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "crm_sdr_runs_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "crm_leads"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "crm_sdr_runs_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      crm_settings: {
        Row: {
          created_at: string
          default_owner_id: string | null
          distribution: string
          updated_at: string
          wa_hourly_limit: number
          workspace_id: string
        }
        Insert: {
          created_at?: string
          default_owner_id?: string | null
          distribution?: string
          updated_at?: string
          wa_hourly_limit?: number
          workspace_id: string
        }
        Update: {
          created_at?: string
          default_owner_id?: string | null
          distribution?: string
          updated_at?: string
          wa_hourly_limit?: number
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "crm_settings_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: true
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      crm_stage_history: {
        Row: {
          created_at: string
          from_stage_id: string | null
          id: string
          lead_id: string
          moved_by: string | null
          to_stage_id: string | null
          workspace_id: string
        }
        Insert: {
          created_at?: string
          from_stage_id?: string | null
          id?: string
          lead_id: string
          moved_by?: string | null
          to_stage_id?: string | null
          workspace_id: string
        }
        Update: {
          created_at?: string
          from_stage_id?: string | null
          id?: string
          lead_id?: string
          moved_by?: string | null
          to_stage_id?: string | null
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "crm_stage_history_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "crm_leads"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "crm_stage_history_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      crm_stages: {
        Row: {
          color: string
          created_at: string
          id: string
          is_lost: boolean
          is_won: boolean
          name: string
          pipeline_id: string
          position: number
          sla_hours: number
          updated_at: string
          workspace_id: string
        }
        Insert: {
          color?: string
          created_at?: string
          id?: string
          is_lost?: boolean
          is_won?: boolean
          name: string
          pipeline_id: string
          position?: number
          sla_hours?: number
          updated_at?: string
          workspace_id: string
        }
        Update: {
          color?: string
          created_at?: string
          id?: string
          is_lost?: boolean
          is_won?: boolean
          name?: string
          pipeline_id?: string
          position?: number
          sla_hours?: number
          updated_at?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "crm_stages_pipeline_id_fkey"
            columns: ["pipeline_id"]
            isOneToOne: false
            referencedRelation: "crm_pipelines"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "crm_stages_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      crm_tags: {
        Row: {
          color: string
          created_at: string
          id: string
          name: string
          workspace_id: string
        }
        Insert: {
          color?: string
          created_at?: string
          id?: string
          name: string
          workspace_id: string
        }
        Update: {
          color?: string
          created_at?: string
          id?: string
          name?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "crm_tags_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      crm_tasks: {
        Row: {
          assignee_id: string | null
          created_at: string
          due_at: string | null
          id: string
          lead_id: string | null
          status: string
          title: string
          updated_at: string
          workspace_id: string
        }
        Insert: {
          assignee_id?: string | null
          created_at?: string
          due_at?: string | null
          id?: string
          lead_id?: string | null
          status?: string
          title: string
          updated_at?: string
          workspace_id: string
        }
        Update: {
          assignee_id?: string | null
          created_at?: string
          due_at?: string | null
          id?: string
          lead_id?: string | null
          status?: string
          title?: string
          updated_at?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "crm_tasks_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "crm_leads"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "crm_tasks_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      crm_wa_templates: {
        Row: {
          body_preview: string | null
          category: string | null
          id: string
          language: string
          name: string
          status: string
          synced_at: string
          variables: number
          workspace_id: string
        }
        Insert: {
          body_preview?: string | null
          category?: string | null
          id?: string
          language?: string
          name: string
          status?: string
          synced_at?: string
          variables?: number
          workspace_id: string
        }
        Update: {
          body_preview?: string | null
          category?: string | null
          id?: string
          language?: string
          name?: string
          status?: string
          synced_at?: string
          variables?: number
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "crm_wa_templates_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      crm_webhook_events: {
        Row: {
          created_at: string
          error_message: string | null
          external_id: string | null
          id: string
          payload: Json | null
          source: string
          status: string
          workspace_id: string | null
        }
        Insert: {
          created_at?: string
          error_message?: string | null
          external_id?: string | null
          id?: string
          payload?: Json | null
          source: string
          status?: string
          workspace_id?: string | null
        }
        Update: {
          created_at?: string
          error_message?: string | null
          external_id?: string | null
          id?: string
          payload?: Json | null
          source?: string
          status?: string
          workspace_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "crm_webhook_events_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      cron_tokens: {
        Row: {
          created_at: string
          name: string
          token: string
        }
        Insert: {
          created_at?: string
          name: string
          token: string
        }
        Update: {
          created_at?: string
          name?: string
          token?: string
        }
        Relationships: []
      }
      ig_account_insights: {
        Row: {
          accounts_engaged: number | null
          created_at: string
          date: string
          followers_total: number | null
          id: string
          interactions: number | null
          new_followers: number | null
          profile_views: number | null
          reach: number | null
          updated_at: string
          views: number | null
          website_clicks: number | null
          workspace_id: string
        }
        Insert: {
          accounts_engaged?: number | null
          created_at?: string
          date: string
          followers_total?: number | null
          id?: string
          interactions?: number | null
          new_followers?: number | null
          profile_views?: number | null
          reach?: number | null
          updated_at?: string
          views?: number | null
          website_clicks?: number | null
          workspace_id: string
        }
        Update: {
          accounts_engaged?: number | null
          created_at?: string
          date?: string
          followers_total?: number | null
          id?: string
          interactions?: number | null
          new_followers?: number | null
          profile_views?: number | null
          reach?: number | null
          updated_at?: string
          views?: number | null
          website_clicks?: number | null
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "ig_account_insights_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      ig_autopilot_events: {
        Row: {
          created_at: string
          id: string
          kind: string
          level: string
          message: string
          plan_id: string | null
          post_id: string | null
          workspace_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          kind: string
          level?: string
          message: string
          plan_id?: string | null
          post_id?: string | null
          workspace_id: string
        }
        Update: {
          created_at?: string
          id?: string
          kind?: string
          level?: string
          message?: string
          plan_id?: string | null
          post_id?: string | null
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "ig_autopilot_events_plan_id_fkey"
            columns: ["plan_id"]
            isOneToOne: false
            referencedRelation: "ig_content_plans"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ig_autopilot_events_post_id_fkey"
            columns: ["post_id"]
            isOneToOne: false
            referencedRelation: "ig_posts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ig_autopilot_events_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      ig_autopilot_weeks: {
        Row: {
          created_at: string
          plan_id: string
          week_start: string
        }
        Insert: {
          created_at?: string
          plan_id: string
          week_start: string
        }
        Update: {
          created_at?: string
          plan_id?: string
          week_start?: string
        }
        Relationships: [
          {
            foreignKeyName: "ig_autopilot_weeks_plan_id_fkey"
            columns: ["plan_id"]
            isOneToOne: false
            referencedRelation: "ig_content_plans"
            referencedColumns: ["id"]
          },
        ]
      }
      ig_content_plans: {
        Row: {
          ai_notes: Json
          auto_publish: boolean
          brand_id: string | null
          content_pillars: Json
          created_at: string
          cta_default: string | null
          hashtag_strategy: Json
          id: string
          last_autopilot_at: string | null
          name: string
          objective: string | null
          pillar_weights: Json
          posting_frequency: Json
          preferred_times: Json
          requires_approval: boolean
          status: string
          tone_of_voice: string | null
          updated_at: string
          workspace_id: string
        }
        Insert: {
          ai_notes?: Json
          auto_publish?: boolean
          brand_id?: string | null
          content_pillars?: Json
          created_at?: string
          cta_default?: string | null
          hashtag_strategy?: Json
          id?: string
          last_autopilot_at?: string | null
          name: string
          objective?: string | null
          pillar_weights?: Json
          posting_frequency?: Json
          preferred_times?: Json
          requires_approval?: boolean
          status?: string
          tone_of_voice?: string | null
          updated_at?: string
          workspace_id: string
        }
        Update: {
          ai_notes?: Json
          auto_publish?: boolean
          brand_id?: string | null
          content_pillars?: Json
          created_at?: string
          cta_default?: string | null
          hashtag_strategy?: Json
          id?: string
          last_autopilot_at?: string | null
          name?: string
          objective?: string | null
          pillar_weights?: Json
          posting_frequency?: Json
          preferred_times?: Json
          requires_approval?: boolean
          status?: string
          tone_of_voice?: string | null
          updated_at?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "ig_content_plans_brand_id_fkey"
            columns: ["brand_id"]
            isOneToOne: false
            referencedRelation: "brands"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ig_content_plans_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      ig_post_metrics: {
        Row: {
          collected_at: string
          comments: number | null
          created_at: string
          id: string
          impressions: number | null
          likes: number | null
          plays: number | null
          post_id: string
          profile_visits: number | null
          raw: Json
          reach: number | null
          saves: number | null
          shares: number | null
          updated_at: string
          workspace_id: string
        }
        Insert: {
          collected_at?: string
          comments?: number | null
          created_at?: string
          id?: string
          impressions?: number | null
          likes?: number | null
          plays?: number | null
          post_id: string
          profile_visits?: number | null
          raw?: Json
          reach?: number | null
          saves?: number | null
          shares?: number | null
          updated_at?: string
          workspace_id: string
        }
        Update: {
          collected_at?: string
          comments?: number | null
          created_at?: string
          id?: string
          impressions?: number | null
          likes?: number | null
          plays?: number | null
          post_id?: string
          profile_visits?: number | null
          raw?: Json
          reach?: number | null
          saves?: number | null
          shares?: number | null
          updated_at?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "ig_post_metrics_post_id_fkey"
            columns: ["post_id"]
            isOneToOne: false
            referencedRelation: "ig_posts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ig_post_metrics_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      ig_posts: {
        Row: {
          ai_generation_log: Json
          ai_provider: string | null
          approved_at: string | null
          caption: string | null
          created_at: string
          creative_brief: Json
          cta: string | null
          format: string
          hashtags: string[]
          hook: string | null
          id: string
          ig_creation_id: string | null
          ig_media_id: string | null
          ig_permalink: string | null
          last_error: string | null
          media: Json
          metrics_collected: Json
          plan_id: string | null
          published_at: string | null
          rejection_reason: string | null
          retry_count: number
          scheduled_at: string | null
          source: string
          status: string
          theme: string | null
          updated_at: string
          workspace_id: string
        }
        Insert: {
          ai_generation_log?: Json
          ai_provider?: string | null
          approved_at?: string | null
          caption?: string | null
          created_at?: string
          creative_brief?: Json
          cta?: string | null
          format: string
          hashtags?: string[]
          hook?: string | null
          id?: string
          ig_creation_id?: string | null
          ig_media_id?: string | null
          ig_permalink?: string | null
          last_error?: string | null
          media?: Json
          metrics_collected?: Json
          plan_id?: string | null
          published_at?: string | null
          rejection_reason?: string | null
          retry_count?: number
          scheduled_at?: string | null
          source?: string
          status?: string
          theme?: string | null
          updated_at?: string
          workspace_id: string
        }
        Update: {
          ai_generation_log?: Json
          ai_provider?: string | null
          approved_at?: string | null
          caption?: string | null
          created_at?: string
          creative_brief?: Json
          cta?: string | null
          format?: string
          hashtags?: string[]
          hook?: string | null
          id?: string
          ig_creation_id?: string | null
          ig_media_id?: string | null
          ig_permalink?: string | null
          last_error?: string | null
          media?: Json
          metrics_collected?: Json
          plan_id?: string | null
          published_at?: string | null
          rejection_reason?: string | null
          retry_count?: number
          scheduled_at?: string | null
          source?: string
          status?: string
          theme?: string | null
          updated_at?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "ig_posts_plan_id_fkey"
            columns: ["plan_id"]
            isOneToOne: false
            referencedRelation: "ig_content_plans"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ig_posts_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      instagram_accounts: {
        Row: {
          connected_at: string | null
          created_at: string
          facebook_page_id: string | null
          id: string
          ig_user_id: string | null
          last_error: string | null
          profile_picture_url: string | null
          status: string
          updated_at: string
          username: string | null
          workspace_id: string
        }
        Insert: {
          connected_at?: string | null
          created_at?: string
          facebook_page_id?: string | null
          id?: string
          ig_user_id?: string | null
          last_error?: string | null
          profile_picture_url?: string | null
          status?: string
          updated_at?: string
          username?: string | null
          workspace_id: string
        }
        Update: {
          connected_at?: string | null
          created_at?: string
          facebook_page_id?: string | null
          id?: string
          ig_user_id?: string | null
          last_error?: string | null
          profile_picture_url?: string | null
          status?: string
          updated_at?: string
          username?: string | null
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "instagram_accounts_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: true
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      integration_connections: {
        Row: {
          account_label: string | null
          connected_at: string | null
          created_at: string
          id: string
          mode: string
          provider: string
          status: string
          workspace_id: string
        }
        Insert: {
          account_label?: string | null
          connected_at?: string | null
          created_at?: string
          id?: string
          mode?: string
          provider: string
          status?: string
          workspace_id: string
        }
        Update: {
          account_label?: string | null
          connected_at?: string | null
          created_at?: string
          id?: string
          mode?: string
          provider?: string
          status?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "integration_connections_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      mcp_connections: {
        Row: {
          access_token: string | null
          connected_at: string | null
          created_at: string
          expires_at: string | null
          id: string
          label: string | null
          last_error: string | null
          oauth_authorization_endpoint: string | null
          oauth_client_id: string | null
          oauth_client_secret: string | null
          oauth_code_verifier: string | null
          oauth_redirect_uri: string | null
          oauth_resource: string | null
          oauth_scope: string | null
          oauth_state: string | null
          oauth_token_endpoint: string | null
          provider: string
          refresh_token: string | null
          server_url: string
          status: string
          tools: Json
          updated_at: string
          workspace_id: string
        }
        Insert: {
          access_token?: string | null
          connected_at?: string | null
          created_at?: string
          expires_at?: string | null
          id?: string
          label?: string | null
          last_error?: string | null
          oauth_authorization_endpoint?: string | null
          oauth_client_id?: string | null
          oauth_client_secret?: string | null
          oauth_code_verifier?: string | null
          oauth_redirect_uri?: string | null
          oauth_resource?: string | null
          oauth_scope?: string | null
          oauth_state?: string | null
          oauth_token_endpoint?: string | null
          provider: string
          refresh_token?: string | null
          server_url: string
          status?: string
          tools?: Json
          updated_at?: string
          workspace_id: string
        }
        Update: {
          access_token?: string | null
          connected_at?: string | null
          created_at?: string
          expires_at?: string | null
          id?: string
          label?: string | null
          last_error?: string | null
          oauth_authorization_endpoint?: string | null
          oauth_client_id?: string | null
          oauth_client_secret?: string | null
          oauth_code_verifier?: string | null
          oauth_redirect_uri?: string | null
          oauth_resource?: string | null
          oauth_scope?: string | null
          oauth_state?: string | null
          oauth_token_endpoint?: string | null
          provider?: string
          refresh_token?: string | null
          server_url?: string
          status?: string
          tools?: Json
          updated_at?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "mcp_connections_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      media_assets: {
        Row: {
          aspect_ratio: string | null
          brand_id: string | null
          campaign_id: string | null
          cost: number | null
          created_at: string
          created_by: string | null
          creative_id: string | null
          duration_seconds: number | null
          folder: string | null
          height: number | null
          id: string
          ig_post_id: string | null
          ig_ready: boolean
          kind: string
          mime: string | null
          parent_id: string | null
          prompt: string | null
          provider: string | null
          quality_report: Json
          size_bytes: number | null
          source: string
          status: string
          storage_path: string | null
          tags: string[]
          target_format: string
          thumbnail_path: string | null
          thumbnail_url: string | null
          title: string
          updated_at: string
          url: string | null
          width: number | null
          workspace_id: string
        }
        Insert: {
          aspect_ratio?: string | null
          brand_id?: string | null
          campaign_id?: string | null
          cost?: number | null
          created_at?: string
          created_by?: string | null
          creative_id?: string | null
          duration_seconds?: number | null
          folder?: string | null
          height?: number | null
          id?: string
          ig_post_id?: string | null
          ig_ready?: boolean
          kind?: string
          mime?: string | null
          parent_id?: string | null
          prompt?: string | null
          provider?: string | null
          quality_report?: Json
          size_bytes?: number | null
          source?: string
          status?: string
          storage_path?: string | null
          tags?: string[]
          target_format?: string
          thumbnail_path?: string | null
          thumbnail_url?: string | null
          title?: string
          updated_at?: string
          url?: string | null
          width?: number | null
          workspace_id: string
        }
        Update: {
          aspect_ratio?: string | null
          brand_id?: string | null
          campaign_id?: string | null
          cost?: number | null
          created_at?: string
          created_by?: string | null
          creative_id?: string | null
          duration_seconds?: number | null
          folder?: string | null
          height?: number | null
          id?: string
          ig_post_id?: string | null
          ig_ready?: boolean
          kind?: string
          mime?: string | null
          parent_id?: string | null
          prompt?: string | null
          provider?: string | null
          quality_report?: Json
          size_bytes?: number | null
          source?: string
          status?: string
          storage_path?: string | null
          tags?: string[]
          target_format?: string
          thumbnail_path?: string | null
          thumbnail_url?: string | null
          title?: string
          updated_at?: string
          url?: string | null
          width?: number | null
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "media_assets_brand_id_fkey"
            columns: ["brand_id"]
            isOneToOne: false
            referencedRelation: "brands"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "media_assets_campaign_id_fkey"
            columns: ["campaign_id"]
            isOneToOne: false
            referencedRelation: "campaigns"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "media_assets_creative_id_fkey"
            columns: ["creative_id"]
            isOneToOne: false
            referencedRelation: "creatives"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "media_assets_ig_post_id_fkey"
            columns: ["ig_post_id"]
            isOneToOne: false
            referencedRelation: "ig_posts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "media_assets_parent_id_fkey"
            columns: ["parent_id"]
            isOneToOne: false
            referencedRelation: "media_assets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "media_assets_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      meta_accounts: {
        Row: {
          ad_account_id: string | null
          created_at: string
          facebook_page: string | null
          id: string
          instagram_account: string | null
          pixel_id: string | null
          status: string
          workspace_id: string
        }
        Insert: {
          ad_account_id?: string | null
          created_at?: string
          facebook_page?: string | null
          id?: string
          instagram_account?: string | null
          pixel_id?: string | null
          status?: string
          workspace_id: string
        }
        Update: {
          ad_account_id?: string | null
          created_at?: string
          facebook_page?: string | null
          id?: string
          instagram_account?: string | null
          pixel_id?: string | null
          status?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "meta_accounts_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      meta_ads: {
        Row: {
          created_at: string
          creative_id: string | null
          id: string
          meta_adset_id: string
          name: string
          status: string
          utm: string | null
          workspace_id: string
        }
        Insert: {
          created_at?: string
          creative_id?: string | null
          id?: string
          meta_adset_id: string
          name: string
          status?: string
          utm?: string | null
          workspace_id: string
        }
        Update: {
          created_at?: string
          creative_id?: string | null
          id?: string
          meta_adset_id?: string
          name?: string
          status?: string
          utm?: string | null
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "meta_ads_creative_id_fkey"
            columns: ["creative_id"]
            isOneToOne: false
            referencedRelation: "creatives"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "meta_ads_meta_adset_id_fkey"
            columns: ["meta_adset_id"]
            isOneToOne: false
            referencedRelation: "meta_adsets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "meta_ads_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      meta_adsets: {
        Row: {
          created_at: string
          daily_budget: number | null
          id: string
          meta_campaign_id: string
          name: string
          placements: string[]
          status: string
          targeting: Json
          workspace_id: string
        }
        Insert: {
          created_at?: string
          daily_budget?: number | null
          id?: string
          meta_campaign_id: string
          name: string
          placements?: string[]
          status?: string
          targeting?: Json
          workspace_id: string
        }
        Update: {
          created_at?: string
          daily_budget?: number | null
          id?: string
          meta_campaign_id?: string
          name?: string
          placements?: string[]
          status?: string
          targeting?: Json
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "meta_adsets_meta_campaign_id_fkey"
            columns: ["meta_campaign_id"]
            isOneToOne: false
            referencedRelation: "meta_campaigns"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "meta_adsets_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      meta_campaigns: {
        Row: {
          campaign_id: string
          created_at: string
          external_id: string | null
          id: string
          name: string
          objective: string | null
          status: string
          workspace_id: string
        }
        Insert: {
          campaign_id: string
          created_at?: string
          external_id?: string | null
          id?: string
          name: string
          objective?: string | null
          status?: string
          workspace_id: string
        }
        Update: {
          campaign_id?: string
          created_at?: string
          external_id?: string | null
          id?: string
          name?: string
          objective?: string | null
          status?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "meta_campaigns_campaign_id_fkey"
            columns: ["campaign_id"]
            isOneToOne: false
            referencedRelation: "campaigns"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "meta_campaigns_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      performance_daily: {
        Row: {
          ad_name: string | null
          adset_name: string | null
          campaign_id: string
          clicks: number
          conversions: number
          created_at: string
          creative_id: string | null
          date: string
          id: string
          impressions: number
          leads: number
          meta_ad_id: string | null
          meta_adset_id: string | null
          reach: number
          revenue: number
          source: string
          spend: number
          synced_at: string | null
          workspace_id: string
        }
        Insert: {
          ad_name?: string | null
          adset_name?: string | null
          campaign_id: string
          clicks?: number
          conversions?: number
          created_at?: string
          creative_id?: string | null
          date: string
          id?: string
          impressions?: number
          leads?: number
          meta_ad_id?: string | null
          meta_adset_id?: string | null
          reach?: number
          revenue?: number
          source?: string
          spend?: number
          synced_at?: string | null
          workspace_id: string
        }
        Update: {
          ad_name?: string | null
          adset_name?: string | null
          campaign_id?: string
          clicks?: number
          conversions?: number
          created_at?: string
          creative_id?: string | null
          date?: string
          id?: string
          impressions?: number
          leads?: number
          meta_ad_id?: string | null
          meta_adset_id?: string | null
          reach?: number
          revenue?: number
          source?: string
          spend?: number
          synced_at?: string | null
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "performance_daily_campaign_id_fkey"
            columns: ["campaign_id"]
            isOneToOne: false
            referencedRelation: "campaigns"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "performance_daily_creative_id_fkey"
            columns: ["creative_id"]
            isOneToOne: false
            referencedRelation: "creatives"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "performance_daily_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      personas: {
        Row: {
          age_range: string | null
          brand_id: string
          created_at: string
          desires: string | null
          id: string
          interests: string | null
          location: string | null
          name: string
          pains: string | null
          segment_type: string | null
          workspace_id: string
        }
        Insert: {
          age_range?: string | null
          brand_id: string
          created_at?: string
          desires?: string | null
          id?: string
          interests?: string | null
          location?: string | null
          name: string
          pains?: string | null
          segment_type?: string | null
          workspace_id: string
        }
        Update: {
          age_range?: string | null
          brand_id?: string
          created_at?: string
          desires?: string | null
          id?: string
          interests?: string | null
          location?: string | null
          name?: string
          pains?: string | null
          segment_type?: string | null
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "personas_brand_id_fkey"
            columns: ["brand_id"]
            isOneToOne: false
            referencedRelation: "brands"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "personas_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      products: {
        Row: {
          brand_id: string
          created_at: string
          description: string | null
          id: string
          margin_percent: number | null
          name: string
          price: number | null
          workspace_id: string
        }
        Insert: {
          brand_id: string
          created_at?: string
          description?: string | null
          id?: string
          margin_percent?: number | null
          name: string
          price?: number | null
          workspace_id: string
        }
        Update: {
          brand_id?: string
          created_at?: string
          description?: string | null
          id?: string
          margin_percent?: number | null
          name?: string
          price?: number | null
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "products_brand_id_fkey"
            columns: ["brand_id"]
            isOneToOne: false
            referencedRelation: "brands"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "products_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          avatar_url: string | null
          created_at: string
          email: string | null
          full_name: string | null
          id: string
        }
        Insert: {
          avatar_url?: string | null
          created_at?: string
          email?: string | null
          full_name?: string | null
          id: string
        }
        Update: {
          avatar_url?: string | null
          created_at?: string
          email?: string | null
          full_name?: string | null
          id?: string
        }
        Relationships: []
      }
      publishing_jobs: {
        Row: {
          attempts: number
          campaign_id: string | null
          channel: string
          created_at: string
          id: string
          ig_post_id: string | null
          locked_at: string | null
          log: string | null
          mode: string
          post_id: string | null
          run_at: string | null
          status: string
          target: string
          workspace_id: string
        }
        Insert: {
          attempts?: number
          campaign_id?: string | null
          channel?: string
          created_at?: string
          id?: string
          ig_post_id?: string | null
          locked_at?: string | null
          log?: string | null
          mode?: string
          post_id?: string | null
          run_at?: string | null
          status?: string
          target?: string
          workspace_id: string
        }
        Update: {
          attempts?: number
          campaign_id?: string | null
          channel?: string
          created_at?: string
          id?: string
          ig_post_id?: string | null
          locked_at?: string | null
          log?: string | null
          mode?: string
          post_id?: string | null
          run_at?: string | null
          status?: string
          target?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "publishing_jobs_campaign_id_fkey"
            columns: ["campaign_id"]
            isOneToOne: false
            referencedRelation: "campaigns"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "publishing_jobs_ig_post_id_fkey"
            columns: ["ig_post_id"]
            isOneToOne: false
            referencedRelation: "ig_posts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "publishing_jobs_post_id_fkey"
            columns: ["post_id"]
            isOneToOne: false
            referencedRelation: "social_posts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "publishing_jobs_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      social_posts: {
        Row: {
          brand_id: string | null
          campaign_id: string | null
          channel: string
          copy_text: string | null
          created_at: string
          creative_id: string | null
          id: string
          scheduled_at: string | null
          status: string
          title: string
          workspace_id: string
        }
        Insert: {
          brand_id?: string | null
          campaign_id?: string | null
          channel?: string
          copy_text?: string | null
          created_at?: string
          creative_id?: string | null
          id?: string
          scheduled_at?: string | null
          status?: string
          title: string
          workspace_id: string
        }
        Update: {
          brand_id?: string | null
          campaign_id?: string | null
          channel?: string
          copy_text?: string | null
          created_at?: string
          creative_id?: string | null
          id?: string
          scheduled_at?: string | null
          status?: string
          title?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "social_posts_brand_id_fkey"
            columns: ["brand_id"]
            isOneToOne: false
            referencedRelation: "brands"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "social_posts_campaign_id_fkey"
            columns: ["campaign_id"]
            isOneToOne: false
            referencedRelation: "campaigns"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "social_posts_creative_id_fkey"
            columns: ["creative_id"]
            isOneToOne: false
            referencedRelation: "creatives"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "social_posts_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      workspace_members: {
        Row: {
          created_at: string
          id: string
          role: Database["public"]["Enums"]["workspace_role"]
          user_id: string
          workspace_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          role?: Database["public"]["Enums"]["workspace_role"]
          user_id: string
          workspace_id: string
        }
        Update: {
          created_at?: string
          id?: string
          role?: Database["public"]["Enums"]["workspace_role"]
          user_id?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "workspace_members_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      workspaces: {
        Row: {
          ai_inherit_from: string | null
          created_at: string
          id: string
          name: string
          owner_id: string
          plan: string
          slug: string
        }
        Insert: {
          ai_inherit_from?: string | null
          created_at?: string
          id?: string
          name: string
          owner_id: string
          plan?: string
          slug: string
        }
        Update: {
          ai_inherit_from?: string | null
          created_at?: string
          id?: string
          name?: string
          owner_id?: string
          plan?: string
          slug?: string
        }
        Relationships: [
          {
            foreignKeyName: "workspaces_ai_inherit_from_fkey"
            columns: ["ai_inherit_from"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      create_workspace: { Args: { _name: string }; Returns: string }
      has_workspace_role: {
        Args: {
          _roles: Database["public"]["Enums"]["workspace_role"][]
          _ws: string
        }
        Returns: boolean
      }
      is_workspace_member: { Args: { _ws: string }; Returns: boolean }
    }
    Enums: {
      workspace_role: "owner" | "admin" | "marketing" | "viewer"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {
      workspace_role: ["owner", "admin", "marketing", "viewer"],
    },
  },
} as const
