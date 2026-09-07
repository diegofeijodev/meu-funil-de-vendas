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
          campaign_id: string | null
          created_at: string
          estimated_impact: string | null
          id: string
          reason: string
          requires_approval: boolean
          severity: string
          status: string
          title: string
          workspace_id: string
        }
        Insert: {
          action: string
          campaign_id?: string | null
          created_at?: string
          estimated_impact?: string | null
          id?: string
          reason: string
          requires_approval?: boolean
          severity?: string
          status?: string
          title: string
          workspace_id: string
        }
        Update: {
          action?: string
          campaign_id?: string | null
          created_at?: string
          estimated_impact?: string | null
          id?: string
          reason?: string
          requires_approval?: boolean
          severity?: string
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
          url: string | null
          workspace_id: string
        }
        Insert: {
          brand_id: string
          created_at?: string
          id?: string
          kind?: string
          name?: string | null
          url?: string | null
          workspace_id: string
        }
        Update: {
          brand_id?: string
          created_at?: string
          id?: string
          kind?: string
          name?: string | null
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
          audience: Json
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
          margin_percent: number | null
          max_cac: number | null
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
          audience?: Json
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
          margin_percent?: number | null
          max_cac?: number | null
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
          audience?: Json
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
          margin_percent?: number | null
          max_cac?: number | null
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
          estimated_cost: number | null
          id: string
          preview_url: string | null
          prompt: string | null
          provider: string
          real_cost: number | null
          status: string
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
          estimated_cost?: number | null
          id?: string
          preview_url?: string | null
          prompt?: string | null
          provider?: string
          real_cost?: number | null
          status?: string
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
          estimated_cost?: number | null
          id?: string
          preview_url?: string | null
          prompt?: string | null
          provider?: string
          real_cost?: number | null
          status?: string
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
          reach: number
          revenue: number
          spend: number
          workspace_id: string
        }
        Insert: {
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
          reach?: number
          revenue?: number
          spend?: number
          workspace_id: string
        }
        Update: {
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
          reach?: number
          revenue?: number
          spend?: number
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
          campaign_id: string | null
          created_at: string
          id: string
          log: string | null
          mode: string
          post_id: string | null
          status: string
          target: string
          workspace_id: string
        }
        Insert: {
          campaign_id?: string | null
          created_at?: string
          id?: string
          log?: string | null
          mode?: string
          post_id?: string | null
          status?: string
          target?: string
          workspace_id: string
        }
        Update: {
          campaign_id?: string | null
          created_at?: string
          id?: string
          log?: string | null
          mode?: string
          post_id?: string | null
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
          created_at: string
          id: string
          name: string
          owner_id: string
          plan: string
          slug: string
        }
        Insert: {
          created_at?: string
          id?: string
          name: string
          owner_id: string
          plan?: string
          slug: string
        }
        Update: {
          created_at?: string
          id?: string
          name?: string
          owner_id?: string
          plan?: string
          slug?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
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
