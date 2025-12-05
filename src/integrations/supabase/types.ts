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
    PostgrestVersion: "13.0.5"
  }
  public: {
    Tables: {
      ai_calibration_factors: {
        Row: {
          actual_win_rate: number
          bet_type: string
          calibration_factor: number
          created_at: string
          id: string
          last_updated: string
          odds_bucket: string
          predicted_probability: number
          sample_size: number
          sport: string
          total_bets: number
          total_wins: number
        }
        Insert: {
          actual_win_rate?: number
          bet_type: string
          calibration_factor?: number
          created_at?: string
          id?: string
          last_updated?: string
          odds_bucket: string
          predicted_probability?: number
          sample_size?: number
          sport: string
          total_bets?: number
          total_wins?: number
        }
        Update: {
          actual_win_rate?: number
          bet_type?: string
          calibration_factor?: number
          created_at?: string
          id?: string
          last_updated?: string
          odds_bucket?: string
          predicted_probability?: number
          sample_size?: number
          sport?: string
          total_bets?: number
          total_wins?: number
        }
        Relationships: []
      }
      ai_performance_metrics: {
        Row: {
          accuracy_rate: number
          avg_odds: number
          bet_type: string
          confidence_level: string
          correct_predictions: number
          id: string
          profit_units: number
          sport: string
          total_predictions: number
          updated_at: string
        }
        Insert: {
          accuracy_rate?: number
          avg_odds?: number
          bet_type: string
          confidence_level: string
          correct_predictions?: number
          id?: string
          profit_units?: number
          sport: string
          total_predictions?: number
          updated_at?: string
        }
        Update: {
          accuracy_rate?: number
          avg_odds?: number
          bet_type?: string
          confidence_level?: string
          correct_predictions?: number
          id?: string
          profit_units?: number
          sport?: string
          total_predictions?: number
          updated_at?: string
        }
        Relationships: []
      }
      email_subscribers: {
        Row: {
          email: string
          id: string
          is_subscribed: boolean | null
          source: string | null
          subscribed_at: string | null
          user_id: string | null
        }
        Insert: {
          email: string
          id?: string
          is_subscribed?: boolean | null
          source?: string | null
          subscribed_at?: string | null
          user_id?: string | null
        }
        Update: {
          email?: string
          id?: string
          is_subscribed?: boolean | null
          source?: string | null
          subscribed_at?: string | null
          user_id?: string | null
        }
        Relationships: []
      }
      hitrate_parlays: {
        Row: {
          combined_probability: number
          created_at: string
          expires_at: string
          id: string
          is_active: boolean | null
          legs: Json
          min_hit_rate: number
          sharp_analysis: Json | null
          sharp_optimized: boolean | null
          sport: string | null
          strategy_type: string
          total_odds: number
        }
        Insert: {
          combined_probability: number
          created_at?: string
          expires_at: string
          id?: string
          is_active?: boolean | null
          legs?: Json
          min_hit_rate?: number
          sharp_analysis?: Json | null
          sharp_optimized?: boolean | null
          sport?: string | null
          strategy_type?: string
          total_odds: number
        }
        Update: {
          combined_probability?: number
          created_at?: string
          expires_at?: string
          id?: string
          is_active?: boolean | null
          legs?: Json
          min_hit_rate?: number
          sharp_analysis?: Json | null
          sharp_optimized?: boolean | null
          sport?: string | null
          strategy_type?: string
          total_odds?: number
        }
        Relationships: []
      }
      juiced_props: {
        Row: {
          bookmaker: string
          commence_time: string
          created_at: string | null
          event_id: string
          final_pick: string | null
          final_pick_confidence: number | null
          final_pick_reason: string | null
          final_pick_time: string | null
          game_description: string
          id: string
          is_locked: boolean | null
          juice_amount: number
          juice_direction: string
          juice_level: string
          line: number
          morning_scan_time: string | null
          opening_over_price: number | null
          over_price: number
          player_name: string
          prop_type: string
          sport: string
          under_price: number
        }
        Insert: {
          bookmaker: string
          commence_time: string
          created_at?: string | null
          event_id: string
          final_pick?: string | null
          final_pick_confidence?: number | null
          final_pick_reason?: string | null
          final_pick_time?: string | null
          game_description: string
          id?: string
          is_locked?: boolean | null
          juice_amount: number
          juice_direction: string
          juice_level: string
          line: number
          morning_scan_time?: string | null
          opening_over_price?: number | null
          over_price: number
          player_name: string
          prop_type: string
          sport: string
          under_price: number
        }
        Update: {
          bookmaker?: string
          commence_time?: string
          created_at?: string | null
          event_id?: string
          final_pick?: string | null
          final_pick_confidence?: number | null
          final_pick_reason?: string | null
          final_pick_time?: string | null
          game_description?: string
          id?: string
          is_locked?: boolean | null
          juice_amount?: number
          juice_direction?: string
          juice_level?: string
          line?: number
          morning_scan_time?: string | null
          opening_over_price?: number | null
          over_price?: number
          player_name?: string
          prop_type?: string
          sport?: string
          under_price?: number
        }
        Relationships: []
      }
      line_movements: {
        Row: {
          authenticity_confidence: number | null
          bookmaker: string
          books_consensus: number | null
          closing_point: number | null
          closing_price: number | null
          clv_direction: string | null
          commence_time: string | null
          created_at: string
          description: string
          detected_at: string
          determination_status: string | null
          event_id: string
          final_determination_time: string | null
          final_pick: string | null
          game_result: string | null
          id: string
          is_primary_record: boolean | null
          is_sharp_action: boolean | null
          linked_parlay_ids: string[] | null
          market_type: string
          movement_authenticity: string | null
          movement_type: string
          new_point: number | null
          new_price: number
          old_point: number | null
          old_price: number
          opening_point: number | null
          opening_price: number | null
          opposite_side_moved: boolean | null
          outcome_correct: boolean | null
          outcome_name: string
          outcome_verified: boolean | null
          player_name: string | null
          point_change: number | null
          preliminary_confidence: number | null
          price_change: number
          recommendation: string | null
          recommendation_reason: string | null
          sharp_indicator: string | null
          sport: string
          trap_score: number | null
          verified_at: string | null
        }
        Insert: {
          authenticity_confidence?: number | null
          bookmaker: string
          books_consensus?: number | null
          closing_point?: number | null
          closing_price?: number | null
          clv_direction?: string | null
          commence_time?: string | null
          created_at?: string
          description: string
          detected_at?: string
          determination_status?: string | null
          event_id: string
          final_determination_time?: string | null
          final_pick?: string | null
          game_result?: string | null
          id?: string
          is_primary_record?: boolean | null
          is_sharp_action?: boolean | null
          linked_parlay_ids?: string[] | null
          market_type: string
          movement_authenticity?: string | null
          movement_type?: string
          new_point?: number | null
          new_price: number
          old_point?: number | null
          old_price: number
          opening_point?: number | null
          opening_price?: number | null
          opposite_side_moved?: boolean | null
          outcome_correct?: boolean | null
          outcome_name: string
          outcome_verified?: boolean | null
          player_name?: string | null
          point_change?: number | null
          preliminary_confidence?: number | null
          price_change: number
          recommendation?: string | null
          recommendation_reason?: string | null
          sharp_indicator?: string | null
          sport: string
          trap_score?: number | null
          verified_at?: string | null
        }
        Update: {
          authenticity_confidence?: number | null
          bookmaker?: string
          books_consensus?: number | null
          closing_point?: number | null
          closing_price?: number | null
          clv_direction?: string | null
          commence_time?: string | null
          created_at?: string
          description?: string
          detected_at?: string
          determination_status?: string | null
          event_id?: string
          final_determination_time?: string | null
          final_pick?: string | null
          game_result?: string | null
          id?: string
          is_primary_record?: boolean | null
          is_sharp_action?: boolean | null
          linked_parlay_ids?: string[] | null
          market_type?: string
          movement_authenticity?: string | null
          movement_type?: string
          new_point?: number | null
          new_price?: number
          old_point?: number | null
          old_price?: number
          opening_point?: number | null
          opening_price?: number | null
          opposite_side_moved?: boolean | null
          outcome_correct?: boolean | null
          outcome_name?: string
          outcome_verified?: boolean | null
          player_name?: string | null
          point_change?: number | null
          preliminary_confidence?: number | null
          price_change?: number
          recommendation?: string | null
          recommendation_reason?: string | null
          sharp_indicator?: string | null
          sport?: string
          trap_score?: number | null
          verified_at?: string | null
        }
        Relationships: []
      }
      notification_preferences: {
        Row: {
          created_at: string
          email: string
          email_notifications: boolean
          favorite_sports: string[] | null
          id: string
          last_notified_at: string | null
          min_confidence_threshold: number
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          email: string
          email_notifications?: boolean
          favorite_sports?: string[] | null
          id?: string
          last_notified_at?: string | null
          min_confidence_threshold?: number
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          email?: string
          email_notifications?: boolean
          favorite_sports?: string[] | null
          id?: string
          last_notified_at?: string | null
          min_confidence_threshold?: number
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      odds_snapshots: {
        Row: {
          away_team: string
          bookmaker: string
          commence_time: string | null
          created_at: string
          event_id: string
          home_team: string
          id: string
          market_type: string
          outcome_name: string
          player_name: string | null
          point: number | null
          price: number
          snapshot_time: string
          sport: string
        }
        Insert: {
          away_team: string
          bookmaker: string
          commence_time?: string | null
          created_at?: string
          event_id: string
          home_team: string
          id?: string
          market_type?: string
          outcome_name: string
          player_name?: string | null
          point?: number | null
          price: number
          snapshot_time?: string
          sport: string
        }
        Update: {
          away_team?: string
          bookmaker?: string
          commence_time?: string | null
          created_at?: string
          event_id?: string
          home_team?: string
          id?: string
          market_type?: string
          outcome_name?: string
          player_name?: string | null
          point?: number | null
          price?: number
          snapshot_time?: string
          sport?: string
        }
        Relationships: []
      }
      parlay_history: {
        Row: {
          ai_roasts: Json | null
          all_games_started: boolean | null
          combined_probability: number
          created_at: string
          degenerate_level: string
          event_start_time: string | null
          id: string
          is_settled: boolean
          is_won: boolean | null
          legs: Json
          potential_payout: number
          settled_at: string | null
          stake: number
          suggested_parlay_id: string | null
          user_id: string
        }
        Insert: {
          ai_roasts?: Json | null
          all_games_started?: boolean | null
          combined_probability: number
          created_at?: string
          degenerate_level: string
          event_start_time?: string | null
          id?: string
          is_settled?: boolean
          is_won?: boolean | null
          legs: Json
          potential_payout: number
          settled_at?: string | null
          stake: number
          suggested_parlay_id?: string | null
          user_id: string
        }
        Update: {
          ai_roasts?: Json | null
          all_games_started?: boolean | null
          combined_probability?: number
          created_at?: string
          degenerate_level?: string
          event_start_time?: string | null
          id?: string
          is_settled?: boolean
          is_won?: boolean | null
          legs?: Json
          potential_payout?: number
          settled_at?: string | null
          stake?: number
          suggested_parlay_id?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "parlay_history_suggested_parlay_id_fkey"
            columns: ["suggested_parlay_id"]
            isOneToOne: false
            referencedRelation: "suggested_parlays"
            referencedColumns: ["id"]
          },
        ]
      }
      parlay_training_data: {
        Row: {
          ai_adjusted_probability: number | null
          ai_confidence: string | null
          ai_trend_direction: string | null
          bet_type: string | null
          created_at: string
          description: string
          event_id: string | null
          event_result: string | null
          event_start_time: string | null
          event_status: string | null
          id: string
          implied_probability: number
          is_correlated: boolean | null
          leg_index: number
          leg_outcome: boolean | null
          odds: number
          parlay_history_id: string
          parlay_outcome: boolean | null
          player: string | null
          settled_at: string | null
          sport: string | null
          team: string | null
          user_id: string
          vegas_juice: number | null
        }
        Insert: {
          ai_adjusted_probability?: number | null
          ai_confidence?: string | null
          ai_trend_direction?: string | null
          bet_type?: string | null
          created_at?: string
          description: string
          event_id?: string | null
          event_result?: string | null
          event_start_time?: string | null
          event_status?: string | null
          id?: string
          implied_probability: number
          is_correlated?: boolean | null
          leg_index: number
          leg_outcome?: boolean | null
          odds: number
          parlay_history_id: string
          parlay_outcome?: boolean | null
          player?: string | null
          settled_at?: string | null
          sport?: string | null
          team?: string | null
          user_id: string
          vegas_juice?: number | null
        }
        Update: {
          ai_adjusted_probability?: number | null
          ai_confidence?: string | null
          ai_trend_direction?: string | null
          bet_type?: string | null
          created_at?: string
          description?: string
          event_id?: string | null
          event_result?: string | null
          event_start_time?: string | null
          event_status?: string | null
          id?: string
          implied_probability?: number
          is_correlated?: boolean | null
          leg_index?: number
          leg_outcome?: boolean | null
          odds?: number
          parlay_history_id?: string
          parlay_outcome?: boolean | null
          player?: string | null
          settled_at?: string | null
          sport?: string | null
          team?: string | null
          user_id?: string
          vegas_juice?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "parlay_training_data_parlay_history_id_fkey"
            columns: ["parlay_history_id"]
            isOneToOne: false
            referencedRelation: "parlay_history"
            referencedColumns: ["id"]
          },
        ]
      }
      player_prop_hitrates: {
        Row: {
          analyzed_at: string
          bookmaker: string | null
          commence_time: string | null
          confidence_score: number | null
          current_line: number
          event_id: string | null
          expires_at: string | null
          game_description: string | null
          game_logs: Json | null
          games_analyzed: number
          hit_rate_over: number
          hit_rate_under: number
          id: string
          over_hits: number
          over_price: number | null
          player_name: string
          prop_type: string
          recommended_side: string | null
          sport: string
          under_hits: number
          under_price: number | null
        }
        Insert: {
          analyzed_at?: string
          bookmaker?: string | null
          commence_time?: string | null
          confidence_score?: number | null
          current_line: number
          event_id?: string | null
          expires_at?: string | null
          game_description?: string | null
          game_logs?: Json | null
          games_analyzed?: number
          hit_rate_over?: number
          hit_rate_under?: number
          id?: string
          over_hits?: number
          over_price?: number | null
          player_name: string
          prop_type: string
          recommended_side?: string | null
          sport: string
          under_hits?: number
          under_price?: number | null
        }
        Update: {
          analyzed_at?: string
          bookmaker?: string | null
          commence_time?: string | null
          confidence_score?: number | null
          current_line?: number
          event_id?: string | null
          expires_at?: string | null
          game_description?: string | null
          game_logs?: Json | null
          games_analyzed?: number
          hit_rate_over?: number
          hit_rate_under?: number
          id?: string
          over_hits?: number
          over_price?: number | null
          player_name?: string
          prop_type?: string
          recommended_side?: string | null
          sport?: string
          under_hits?: number
          under_price?: number | null
        }
        Relationships: []
      }
      player_stats_cache: {
        Row: {
          created_at: string
          game_date: string
          id: string
          opponent: string | null
          player_id: string | null
          player_name: string
          sport: string
          stat_type: string
          stat_value: number
        }
        Insert: {
          created_at?: string
          game_date: string
          id?: string
          opponent?: string | null
          player_id?: string | null
          player_name: string
          sport: string
          stat_type: string
          stat_value: number
        }
        Update: {
          created_at?: string
          game_date?: string
          id?: string
          opponent?: string | null
          player_id?: string | null
          player_name?: string
          sport?: string
          stat_type?: string
          stat_value?: number
        }
        Relationships: []
      }
      profiles: {
        Row: {
          avatar_url: string | null
          bio: string | null
          created_at: string
          id: string
          instagram_handle: string | null
          lifetime_degenerate_score: number
          total_losses: number
          total_payout: number
          total_staked: number
          total_wins: number
          tutorial_completed: Json | null
          twitter_handle: string | null
          updated_at: string
          user_id: string
          username: string | null
        }
        Insert: {
          avatar_url?: string | null
          bio?: string | null
          created_at?: string
          id?: string
          instagram_handle?: string | null
          lifetime_degenerate_score?: number
          total_losses?: number
          total_payout?: number
          total_staked?: number
          total_wins?: number
          tutorial_completed?: Json | null
          twitter_handle?: string | null
          updated_at?: string
          user_id: string
          username?: string | null
        }
        Update: {
          avatar_url?: string | null
          bio?: string | null
          created_at?: string
          id?: string
          instagram_handle?: string | null
          lifetime_degenerate_score?: number
          total_losses?: number
          total_payout?: number
          total_staked?: number
          total_wins?: number
          tutorial_completed?: Json | null
          twitter_handle?: string | null
          updated_at?: string
          user_id?: string
          username?: string | null
        }
        Relationships: []
      }
      push_subscriptions: {
        Row: {
          auth_key: string
          created_at: string
          endpoint: string
          id: string
          is_active: boolean
          p256dh_key: string
          sharp_only: boolean
          sports_filter: string[] | null
          updated_at: string
          user_id: string | null
        }
        Insert: {
          auth_key: string
          created_at?: string
          endpoint: string
          id?: string
          is_active?: boolean
          p256dh_key: string
          sharp_only?: boolean
          sports_filter?: string[] | null
          updated_at?: string
          user_id?: string | null
        }
        Update: {
          auth_key?: string
          created_at?: string
          endpoint?: string
          id?: string
          is_active?: boolean
          p256dh_key?: string
          sharp_only?: boolean
          sports_filter?: string[] | null
          updated_at?: string
          user_id?: string | null
        }
        Relationships: []
      }
      scan_usage: {
        Row: {
          created_at: string | null
          id: string
          last_scan_at: string | null
          scan_count: number | null
          user_id: string
        }
        Insert: {
          created_at?: string | null
          id?: string
          last_scan_at?: string | null
          scan_count?: number | null
          user_id: string
        }
        Update: {
          created_at?: string | null
          id?: string
          last_scan_at?: string | null
          scan_count?: number | null
          user_id?: string
        }
        Relationships: []
      }
      sharp_line_tracker: {
        Row: {
          ai_confidence: number | null
          ai_direction: string | null
          ai_reasoning: string | null
          ai_recommendation: string | null
          ai_signals: Json | null
          bookmaker: string
          commence_time: string | null
          created_at: string | null
          created_by: string | null
          current_line: number | null
          current_over_price: number | null
          current_under_price: number | null
          event_id: string | null
          game_description: string
          id: string
          input_method: string | null
          last_updated: string | null
          line_movement: number | null
          opening_line: number
          opening_over_price: number
          opening_time: string | null
          opening_under_price: number
          player_name: string
          price_movement_over: number | null
          price_movement_under: number | null
          prop_type: string
          sport: string
          status: string | null
        }
        Insert: {
          ai_confidence?: number | null
          ai_direction?: string | null
          ai_reasoning?: string | null
          ai_recommendation?: string | null
          ai_signals?: Json | null
          bookmaker: string
          commence_time?: string | null
          created_at?: string | null
          created_by?: string | null
          current_line?: number | null
          current_over_price?: number | null
          current_under_price?: number | null
          event_id?: string | null
          game_description: string
          id?: string
          input_method?: string | null
          last_updated?: string | null
          line_movement?: number | null
          opening_line: number
          opening_over_price: number
          opening_time?: string | null
          opening_under_price: number
          player_name: string
          price_movement_over?: number | null
          price_movement_under?: number | null
          prop_type: string
          sport: string
          status?: string | null
        }
        Update: {
          ai_confidence?: number | null
          ai_direction?: string | null
          ai_reasoning?: string | null
          ai_recommendation?: string | null
          ai_signals?: Json | null
          bookmaker?: string
          commence_time?: string | null
          created_at?: string | null
          created_by?: string | null
          current_line?: number | null
          current_over_price?: number | null
          current_under_price?: number | null
          event_id?: string | null
          game_description?: string
          id?: string
          input_method?: string | null
          last_updated?: string | null
          line_movement?: number | null
          opening_line?: number
          opening_over_price?: number
          opening_time?: string | null
          opening_under_price?: number
          player_name?: string
          price_movement_over?: number | null
          price_movement_under?: number | null
          prop_type?: string
          sport?: string
          status?: string | null
        }
        Relationships: []
      }
      strategy_performance: {
        Row: {
          avg_odds: number
          confidence_adjustment: number
          created_at: string
          id: string
          last_updated: string
          roi_percentage: number
          strategy_name: string
          total_lost: number
          total_pending: number
          total_suggestions: number
          total_won: number
          win_rate: number
        }
        Insert: {
          avg_odds?: number
          confidence_adjustment?: number
          created_at?: string
          id?: string
          last_updated?: string
          roi_percentage?: number
          strategy_name: string
          total_lost?: number
          total_pending?: number
          total_suggestions?: number
          total_won?: number
          win_rate?: number
        }
        Update: {
          avg_odds?: number
          confidence_adjustment?: number
          created_at?: string
          id?: string
          last_updated?: string
          roi_percentage?: number
          strategy_name?: string
          total_lost?: number
          total_pending?: number
          total_suggestions?: number
          total_won?: number
          win_rate?: number
        }
        Relationships: []
      }
      subscriptions: {
        Row: {
          created_at: string | null
          current_period_end: string | null
          current_period_start: string | null
          id: string
          status: string
          stripe_customer_id: string | null
          stripe_subscription_id: string | null
          updated_at: string | null
          user_id: string
        }
        Insert: {
          created_at?: string | null
          current_period_end?: string | null
          current_period_start?: string | null
          id?: string
          status?: string
          stripe_customer_id?: string | null
          stripe_subscription_id?: string | null
          updated_at?: string | null
          user_id: string
        }
        Update: {
          created_at?: string | null
          current_period_end?: string | null
          current_period_start?: string | null
          id?: string
          status?: string
          stripe_customer_id?: string | null
          stripe_subscription_id?: string | null
          updated_at?: string | null
          user_id?: string
        }
        Relationships: []
      }
      suggested_parlays: {
        Row: {
          clv_score: number | null
          combined_probability: number
          confidence_score: number
          created_at: string
          expires_at: string
          final_recommendation: string | null
          hybrid_scores: Json | null
          id: string
          initial_recommendation: string | null
          is_active: boolean
          is_hybrid: boolean | null
          legs: Json
          pick_status: string | null
          sport: string
          suggestion_reason: string
          total_odds: number
          user_id: string | null
        }
        Insert: {
          clv_score?: number | null
          combined_probability: number
          confidence_score?: number
          created_at?: string
          expires_at: string
          final_recommendation?: string | null
          hybrid_scores?: Json | null
          id?: string
          initial_recommendation?: string | null
          is_active?: boolean
          is_hybrid?: boolean | null
          legs: Json
          pick_status?: string | null
          sport: string
          suggestion_reason: string
          total_odds: number
          user_id?: string | null
        }
        Update: {
          clv_score?: number | null
          combined_probability?: number
          confidence_score?: number
          created_at?: string
          expires_at?: string
          final_recommendation?: string | null
          hybrid_scores?: Json | null
          id?: string
          initial_recommendation?: string | null
          is_active?: boolean
          is_hybrid?: boolean | null
          legs?: Json
          pick_status?: string | null
          sport?: string
          suggestion_reason?: string
          total_odds?: number
          user_id?: string | null
        }
        Relationships: []
      }
      suggestion_accuracy_metrics: {
        Row: {
          accuracy_rate: number
          avg_odds: number
          confidence_level: string
          id: string
          roi_percentage: number
          sport: string
          suggestion_strategy: string
          total_lost: number
          total_suggestions: number
          total_won: number
          updated_at: string
        }
        Insert: {
          accuracy_rate?: number
          avg_odds?: number
          confidence_level: string
          id?: string
          roi_percentage?: number
          sport: string
          suggestion_strategy?: string
          total_lost?: number
          total_suggestions?: number
          total_won?: number
          updated_at?: string
        }
        Update: {
          accuracy_rate?: number
          avg_odds?: number
          confidence_level?: string
          id?: string
          roi_percentage?: number
          sport?: string
          suggestion_strategy?: string
          total_lost?: number
          total_suggestions?: number
          total_won?: number
          updated_at?: string
        }
        Relationships: []
      }
      suggestion_performance: {
        Row: {
          created_at: string
          id: string
          outcome: boolean | null
          parlay_history_id: string
          payout: number | null
          settled_at: string | null
          stake: number
          suggested_parlay_id: string
          user_id: string
          was_followed: boolean
        }
        Insert: {
          created_at?: string
          id?: string
          outcome?: boolean | null
          parlay_history_id: string
          payout?: number | null
          settled_at?: string | null
          stake?: number
          suggested_parlay_id: string
          user_id: string
          was_followed?: boolean
        }
        Update: {
          created_at?: string
          id?: string
          outcome?: boolean | null
          parlay_history_id?: string
          payout?: number | null
          settled_at?: string | null
          stake?: number
          suggested_parlay_id?: string
          user_id?: string
          was_followed?: boolean
        }
        Relationships: [
          {
            foreignKeyName: "suggestion_performance_parlay_history_id_fkey"
            columns: ["parlay_history_id"]
            isOneToOne: false
            referencedRelation: "parlay_history"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "suggestion_performance_suggested_parlay_id_fkey"
            columns: ["suggested_parlay_id"]
            isOneToOne: false
            referencedRelation: "suggested_parlays"
            referencedColumns: ["id"]
          },
        ]
      }
      trap_patterns: {
        Row: {
          bet_type: string
          bookmaker: string | null
          both_sides_moved: boolean | null
          confirmed_trap: boolean | null
          created_at: string | null
          early_morning_move: boolean | null
          id: string
          loss_amount: number | null
          market_type: string
          movement_bucket: string | null
          movement_size: number | null
          original_movement_id: string | null
          parlay_id: string | null
          price_only_move: boolean | null
          sport: string
          time_before_game_hours: number | null
          trap_signature: string | null
          was_single_book: boolean | null
        }
        Insert: {
          bet_type: string
          bookmaker?: string | null
          both_sides_moved?: boolean | null
          confirmed_trap?: boolean | null
          created_at?: string | null
          early_morning_move?: boolean | null
          id?: string
          loss_amount?: number | null
          market_type: string
          movement_bucket?: string | null
          movement_size?: number | null
          original_movement_id?: string | null
          parlay_id?: string | null
          price_only_move?: boolean | null
          sport: string
          time_before_game_hours?: number | null
          trap_signature?: string | null
          was_single_book?: boolean | null
        }
        Update: {
          bet_type?: string
          bookmaker?: string | null
          both_sides_moved?: boolean | null
          confirmed_trap?: boolean | null
          created_at?: string | null
          early_morning_move?: boolean | null
          id?: string
          loss_amount?: number | null
          market_type?: string
          movement_bucket?: string | null
          movement_size?: number | null
          original_movement_id?: string | null
          parlay_id?: string | null
          price_only_move?: boolean | null
          sport?: string
          time_before_game_hours?: number | null
          trap_signature?: string | null
          was_single_book?: boolean | null
        }
        Relationships: [
          {
            foreignKeyName: "trap_patterns_original_movement_id_fkey"
            columns: ["original_movement_id"]
            isOneToOne: false
            referencedRelation: "line_movements"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "trap_patterns_parlay_id_fkey"
            columns: ["parlay_id"]
            isOneToOne: false
            referencedRelation: "parlay_history"
            referencedColumns: ["id"]
          },
        ]
      }
      upset_predictions: {
        Row: {
          ai_reasoning: string | null
          away_team: string
          commence_time: string
          confidence: string
          favorite: string
          favorite_odds: number
          game_completed: boolean | null
          game_id: string
          home_team: string
          id: string
          predicted_at: string
          prediction_date: string
          signals: Json | null
          sport: string
          underdog: string
          underdog_odds: number
          upset_score: number
          verified_at: string | null
          was_upset: boolean | null
          winner: string | null
        }
        Insert: {
          ai_reasoning?: string | null
          away_team: string
          commence_time: string
          confidence?: string
          favorite: string
          favorite_odds: number
          game_completed?: boolean | null
          game_id: string
          home_team: string
          id?: string
          predicted_at?: string
          prediction_date?: string
          signals?: Json | null
          sport: string
          underdog: string
          underdog_odds: number
          upset_score: number
          verified_at?: string | null
          was_upset?: boolean | null
          winner?: string | null
        }
        Update: {
          ai_reasoning?: string | null
          away_team?: string
          commence_time?: string
          confidence?: string
          favorite?: string
          favorite_odds?: number
          game_completed?: boolean | null
          game_id?: string
          home_team?: string
          id?: string
          predicted_at?: string
          prediction_date?: string
          signals?: Json | null
          sport?: string
          underdog?: string
          underdog_odds?: number
          upset_score?: number
          verified_at?: string | null
          was_upset?: boolean | null
          winner?: string | null
        }
        Relationships: []
      }
      user_roles: {
        Row: {
          created_at: string | null
          id: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Insert: {
          created_at?: string | null
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Update: {
          created_at?: string | null
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id?: string
        }
        Relationships: []
      }
      user_sharp_follows: {
        Row: {
          created_at: string
          followed_at: string
          id: string
          line_movement_id: string
          outcome_correct: boolean | null
          outcome_verified: boolean | null
          stake: number | null
          user_id: string
          verified_at: string | null
        }
        Insert: {
          created_at?: string
          followed_at?: string
          id?: string
          line_movement_id: string
          outcome_correct?: boolean | null
          outcome_verified?: boolean | null
          stake?: number | null
          user_id: string
          verified_at?: string | null
        }
        Update: {
          created_at?: string
          followed_at?: string
          id?: string
          line_movement_id?: string
          outcome_correct?: boolean | null
          outcome_verified?: boolean | null
          stake?: number | null
          user_id?: string
          verified_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "user_sharp_follows_line_movement_id_fkey"
            columns: ["line_movement_id"]
            isOneToOne: false
            referencedRelation: "line_movements"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      calculate_calibration_factors: { Args: never; Returns: undefined }
      check_scan_access: { Args: { p_user_id: string }; Returns: Json }
      detect_sharp_money: {
        Args: { p_point_change?: number; p_price_change: number }
        Returns: {
          indicator: string
          is_sharp: boolean
        }[]
      }
      get_ai_accuracy_stats: {
        Args: never
        Returns: {
          accuracy_rate: number
          bet_type: string
          confidence_level: string
          correct_predictions: number
          sport: string
          total_predictions: number
        }[]
      }
      get_all_parlays_admin: {
        Args: never
        Returns: {
          combined_probability: number
          created_at: string
          degenerate_level: string
          event_start_time: string
          id: string
          is_settled: boolean
          is_won: boolean
          legs: Json
          potential_payout: number
          stake: number
          user_id: string
          username: string
        }[]
      }
      get_all_users_admin: {
        Args: never
        Returns: {
          avatar_url: string
          created_at: string
          email: string
          lifetime_degenerate_score: number
          total_losses: number
          total_staked: number
          total_wins: number
          user_id: string
          username: string
        }[]
      }
      get_betting_time_patterns: {
        Args: { p_user_id: string }
        Returns: {
          avg_odds: number
          day_of_week: number
          month: number
          total_bets: number
          upset_wins: number
          win_rate: number
          wins: number
        }[]
      }
      get_calibrated_probability: {
        Args: { p_bet_type: string; p_odds: number; p_sport: string }
        Returns: {
          calibrated_probability: number
          calibration_factor: number
          confidence_level: string
          sample_size: number
        }[]
      }
      get_leaderboard_stats: {
        Args: { time_period?: string }
        Returns: {
          avatar_url: string
          avg_probability: number
          lifetime_degenerate_score: number
          period_parlays: number
          period_staked: number
          total_losses: number
          total_parlays: number
          total_staked: number
          total_wins: number
          user_id: string
          username: string
        }[]
      }
      get_movement_accuracy: {
        Args: {
          p_max_movement: number
          p_min_movement: number
          p_sport: string
        }
        Returns: {
          recommendation: string
          total_patterns: number
          trap_count: number
          trap_rate: number
          win_count: number
        }[]
      }
      get_recent_line_movements: {
        Args: { p_limit?: number; p_sport?: string }
        Returns: {
          bookmaker: string
          commence_time: string
          description: string
          detected_at: string
          event_id: string
          id: string
          is_sharp_action: boolean
          market_type: string
          new_price: number
          old_price: number
          outcome_name: string
          point_change: number
          price_change: number
          sharp_indicator: string
          sport: string
        }[]
      }
      get_similar_historical_patterns: {
        Args: {
          p_bet_type: string
          p_odds_max?: number
          p_odds_min?: number
          p_price_only?: boolean
          p_single_book?: boolean
          p_sport: string
        }
        Returns: {
          avg_loss_when_trap: number
          pattern_count: number
          recommendation: string
          trap_rate: number
          win_rate: number
        }[]
      }
      get_strategy_performance_stats: {
        Args: { p_user_id?: string }
        Returns: {
          avg_odds: number
          roi_percentage: number
          strategy_type: string
          total_followed: number
          total_lost: number
          total_pending: number
          total_profit: number
          total_staked: number
          total_won: number
          win_rate: number
        }[]
      }
      get_suggestion_accuracy_stats: {
        Args: never
        Returns: {
          accuracy_rate: number
          avg_odds: number
          confidence_level: string
          roi_percentage: number
          sport: string
          total_lost: number
          total_suggestions: number
          total_won: number
        }[]
      }
      get_suggestion_performance_stats: {
        Args: { p_user_id?: string }
        Returns: {
          avg_confidence: number
          performance_by_sport: Json
          total_lost: number
          total_pending: number
          total_profit: number
          total_staked: number
          total_suggestions_followed: number
          total_won: number
          win_rate: number
        }[]
      }
      get_upset_accuracy_summary: {
        Args: never
        Returns: {
          by_sport: Json
          correct_predictions: number
          high_confidence_accuracy: number
          low_confidence_accuracy: number
          medium_confidence_accuracy: number
          overall_accuracy: number
          total_predictions: number
          verified_predictions: number
        }[]
      }
      get_upset_prediction_accuracy: {
        Args: never
        Returns: {
          accuracy_rate: number
          avg_upset_score: number
          confidence: string
          correct_predictions: number
          sport: string
          total_predictions: number
          verified_predictions: number
        }[]
      }
      get_user_betting_stats: {
        Args: { p_user_id: string }
        Returns: {
          avg_odds: number
          bet_type: string
          by_confidence: Json
          hit_rate: number
          sport: string
          total_bets: number
          wins: number
        }[]
      }
      get_user_sharp_performance: {
        Args: { p_user_id: string }
        Returns: {
          by_confidence: Json
          by_recommendation: Json
          pending: number
          recent_results: Json
          total_follows: number
          total_losses: number
          total_verified: number
          total_wins: number
          win_rate: number
        }[]
      }
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
      increment_scan_count: { Args: { p_user_id: string }; Returns: undefined }
      is_collaborator: { Args: { _user_id: string }; Returns: boolean }
      sync_sharp_follow_outcomes: { Args: never; Returns: undefined }
      update_strategy_performance: { Args: never; Returns: undefined }
    }
    Enums: {
      app_role: "admin" | "moderator" | "user" | "collaborator"
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
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
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
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
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
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
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
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
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
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
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
      app_role: ["admin", "moderator", "user", "collaborator"],
    },
  },
} as const
