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
      ai_avoid_patterns: {
        Row: {
          accuracy_rate: number | null
          avoid_reason: string | null
          created_at: string | null
          description: string | null
          engine_source: string | null
          formula_name: string | null
          id: string
          is_active: boolean | null
          last_loss_at: string | null
          loss_count: number | null
          pattern_key: string
          pattern_type: string
          sport: string | null
          total_count: number | null
          updated_at: string | null
        }
        Insert: {
          accuracy_rate?: number | null
          avoid_reason?: string | null
          created_at?: string | null
          description?: string | null
          engine_source?: string | null
          formula_name?: string | null
          id?: string
          is_active?: boolean | null
          last_loss_at?: string | null
          loss_count?: number | null
          pattern_key: string
          pattern_type: string
          sport?: string | null
          total_count?: number | null
          updated_at?: string | null
        }
        Update: {
          accuracy_rate?: number | null
          avoid_reason?: string | null
          created_at?: string | null
          description?: string | null
          engine_source?: string | null
          formula_name?: string | null
          id?: string
          is_active?: boolean | null
          last_loss_at?: string | null
          loss_count?: number | null
          pattern_key?: string
          pattern_type?: string
          sport?: string | null
          total_count?: number | null
          updated_at?: string | null
        }
        Relationships: []
      }
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
      ai_compound_formulas: {
        Row: {
          accuracy_rate: number | null
          avg_odds: number | null
          combination: string
          created_at: string | null
          id: string
          is_preferred: boolean | null
          last_loss_at: string | null
          last_win_at: string | null
          losses: number | null
          roi_percentage: number | null
          sports: Json | null
          total_picks: number | null
          updated_at: string | null
          wins: number | null
        }
        Insert: {
          accuracy_rate?: number | null
          avg_odds?: number | null
          combination: string
          created_at?: string | null
          id?: string
          is_preferred?: boolean | null
          last_loss_at?: string | null
          last_win_at?: string | null
          losses?: number | null
          roi_percentage?: number | null
          sports?: Json | null
          total_picks?: number | null
          updated_at?: string | null
          wins?: number | null
        }
        Update: {
          accuracy_rate?: number | null
          avg_odds?: number | null
          combination?: string
          created_at?: string | null
          id?: string
          is_preferred?: boolean | null
          last_loss_at?: string | null
          last_win_at?: string | null
          losses?: number | null
          roi_percentage?: number | null
          sports?: Json | null
          total_picks?: number | null
          updated_at?: string | null
          wins?: number | null
        }
        Relationships: []
      }
      ai_cross_engine_performance: {
        Row: {
          both_losses: number | null
          both_wins: number | null
          created_at: string | null
          engine_a: string
          engine_a_wins: number | null
          engine_b: string
          engine_b_wins: number | null
          event_type: string | null
          id: string
          preference_score: number | null
          sport: string | null
          total_comparisons: number | null
          updated_at: string | null
        }
        Insert: {
          both_losses?: number | null
          both_wins?: number | null
          created_at?: string | null
          engine_a: string
          engine_a_wins?: number | null
          engine_b: string
          engine_b_wins?: number | null
          event_type?: string | null
          id?: string
          preference_score?: number | null
          sport?: string | null
          total_comparisons?: number | null
          updated_at?: string | null
        }
        Update: {
          both_losses?: number | null
          both_wins?: number | null
          created_at?: string | null
          engine_a?: string
          engine_a_wins?: number | null
          engine_b?: string
          engine_b_wins?: number | null
          event_type?: string | null
          id?: string
          preference_score?: number | null
          sport?: string | null
          total_comparisons?: number | null
          updated_at?: string | null
        }
        Relationships: []
      }
      ai_formula_performance: {
        Row: {
          compound_formulas: Json | null
          created_at: string | null
          current_accuracy: number | null
          current_weight: number | null
          engine_source: string
          formula_name: string
          id: string
          last_loss_streak: number | null
          last_win_streak: number | null
          loss_patterns: Json | null
          losses: number | null
          optimal_threshold: number | null
          sport_breakdown: Json | null
          total_picks: number | null
          updated_at: string | null
          wins: number | null
        }
        Insert: {
          compound_formulas?: Json | null
          created_at?: string | null
          current_accuracy?: number | null
          current_weight?: number | null
          engine_source: string
          formula_name: string
          id?: string
          last_loss_streak?: number | null
          last_win_streak?: number | null
          loss_patterns?: Json | null
          losses?: number | null
          optimal_threshold?: number | null
          sport_breakdown?: Json | null
          total_picks?: number | null
          updated_at?: string | null
          wins?: number | null
        }
        Update: {
          compound_formulas?: Json | null
          created_at?: string | null
          current_accuracy?: number | null
          current_weight?: number | null
          engine_source?: string
          formula_name?: string
          id?: string
          last_loss_streak?: number | null
          last_win_streak?: number | null
          loss_patterns?: Json | null
          losses?: number | null
          optimal_threshold?: number | null
          sport_breakdown?: Json | null
          total_picks?: number | null
          updated_at?: string | null
          wins?: number | null
        }
        Relationships: []
      }
      ai_generated_parlays: {
        Row: {
          accuracy_at_generation: number | null
          ai_reasoning: string | null
          confidence_score: number
          created_at: string
          formula_breakdown: Json | null
          generation_round: number
          id: string
          leg_sources: Json | null
          legs: Json
          outcome: string
          settled_at: string | null
          signals_used: string[]
          source_engines: string[] | null
          sport: string | null
          strategy_used: string
          total_odds: number
        }
        Insert: {
          accuracy_at_generation?: number | null
          ai_reasoning?: string | null
          confidence_score?: number
          created_at?: string
          formula_breakdown?: Json | null
          generation_round?: number
          id?: string
          leg_sources?: Json | null
          legs?: Json
          outcome?: string
          settled_at?: string | null
          signals_used?: string[]
          source_engines?: string[] | null
          sport?: string | null
          strategy_used: string
          total_odds?: number
        }
        Update: {
          accuracy_at_generation?: number | null
          ai_reasoning?: string | null
          confidence_score?: number
          created_at?: string
          formula_breakdown?: Json | null
          generation_round?: number
          id?: string
          leg_sources?: Json | null
          legs?: Json
          outcome?: string
          settled_at?: string | null
          signals_used?: string[]
          source_engines?: string[] | null
          sport?: string | null
          strategy_used?: string
          total_odds?: number
        }
        Relationships: []
      }
      ai_learning_progress: {
        Row: {
          created_at: string
          current_accuracy: number
          generation_round: number
          id: string
          is_milestone: boolean
          learned_patterns: Json
          losses: number
          milestone_reached: string | null
          parlays_generated: number
          parlays_settled: number
          strategy_weights: Json
          target_accuracy: number
          wins: number
        }
        Insert: {
          created_at?: string
          current_accuracy?: number
          generation_round: number
          id?: string
          is_milestone?: boolean
          learned_patterns?: Json
          losses?: number
          milestone_reached?: string | null
          parlays_generated?: number
          parlays_settled?: number
          strategy_weights?: Json
          target_accuracy?: number
          wins?: number
        }
        Update: {
          created_at?: string
          current_accuracy?: number
          generation_round?: number
          id?: string
          is_milestone?: boolean
          learned_patterns?: Json
          losses?: number
          milestone_reached?: string | null
          parlays_generated?: number
          parlays_settled?: number
          strategy_weights?: Json
          target_accuracy?: number
          wins?: number
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
      approved_odds_users: {
        Row: {
          approved_at: string | null
          approved_by: string | null
          created_at: string | null
          email: string
          id: string
          is_active: boolean | null
          notes: string | null
        }
        Insert: {
          approved_at?: string | null
          approved_by?: string | null
          created_at?: string | null
          email: string
          id?: string
          is_active?: boolean | null
          notes?: string | null
        }
        Update: {
          approved_at?: string | null
          approved_by?: string | null
          created_at?: string | null
          email?: string
          id?: string
          is_active?: boolean | null
          notes?: string | null
        }
        Relationships: []
      }
      bdl_player_cache: {
        Row: {
          bdl_player_id: number | null
          college: string | null
          country: string | null
          created_at: string | null
          draft_number: number | null
          draft_round: number | null
          draft_year: number | null
          height: string | null
          id: string
          jersey_number: string | null
          last_updated: string | null
          player_name: string
          position: string | null
          team_name: string | null
          weight: string | null
        }
        Insert: {
          bdl_player_id?: number | null
          college?: string | null
          country?: string | null
          created_at?: string | null
          draft_number?: number | null
          draft_round?: number | null
          draft_year?: number | null
          height?: string | null
          id?: string
          jersey_number?: string | null
          last_updated?: string | null
          player_name: string
          position?: string | null
          team_name?: string | null
          weight?: string | null
        }
        Update: {
          bdl_player_id?: number | null
          college?: string | null
          country?: string | null
          created_at?: string | null
          draft_number?: number | null
          draft_round?: number | null
          draft_year?: number | null
          height?: string | null
          id?: string
          jersey_number?: string | null
          last_updated?: string | null
          player_name?: string
          position?: string | null
          team_name?: string | null
          weight?: string | null
        }
        Relationships: []
      }
      best_bets_log: {
        Row: {
          accuracy_at_time: number | null
          created_at: string | null
          description: string | null
          event_id: string
          id: string
          odds: number | null
          outcome: boolean | null
          prediction: string
          sample_size_at_time: number | null
          signal_type: string
          sport: string
          verified_at: string | null
        }
        Insert: {
          accuracy_at_time?: number | null
          created_at?: string | null
          description?: string | null
          event_id: string
          id?: string
          odds?: number | null
          outcome?: boolean | null
          prediction: string
          sample_size_at_time?: number | null
          signal_type: string
          sport: string
          verified_at?: string | null
        }
        Update: {
          accuracy_at_time?: number | null
          created_at?: string | null
          description?: string | null
          event_id?: string
          id?: string
          odds?: number | null
          outcome?: boolean | null
          prediction?: string
          sample_size_at_time?: number | null
          signal_type?: string
          sport?: string
          verified_at?: string | null
        }
        Relationships: []
      }
      calibration_buckets: {
        Row: {
          actual_avg: number
          bucket_end: number
          bucket_start: number
          confidence_lower: number | null
          confidence_upper: number | null
          created_at: string
          engine_name: string
          id: string
          predicted_avg: number
          sample_count: number
          sport: string | null
          updated_at: string
        }
        Insert: {
          actual_avg: number
          bucket_end: number
          bucket_start: number
          confidence_lower?: number | null
          confidence_upper?: number | null
          created_at?: string
          engine_name: string
          id?: string
          predicted_avg: number
          sample_count?: number
          sport?: string | null
          updated_at?: string
        }
        Update: {
          actual_avg?: number
          bucket_end?: number
          bucket_start?: number
          confidence_lower?: number | null
          confidence_upper?: number | null
          created_at?: string
          engine_name?: string
          id?: string
          predicted_avg?: number
          sample_count?: number
          sport?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      cron_job_history: {
        Row: {
          completed_at: string | null
          duration_ms: number | null
          error_message: string | null
          id: string
          job_name: string
          result: Json | null
          started_at: string
          status: string
        }
        Insert: {
          completed_at?: string | null
          duration_ms?: number | null
          error_message?: string | null
          id?: string
          job_name: string
          result?: Json | null
          started_at?: string
          status?: string
        }
        Update: {
          completed_at?: string | null
          duration_ms?: number | null
          error_message?: string | null
          id?: string
          job_name?: string
          result?: Json | null
          started_at?: string
          status?: string
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
      engine_brier_scores: {
        Row: {
          bet_type: string | null
          brier_score: number
          calibration_error: number | null
          created_at: string
          engine_name: string
          id: string
          log_loss: number | null
          period_end: string
          period_start: string
          reliability_score: number | null
          resolution_score: number | null
          sample_size: number
          sport: string | null
          updated_at: string
        }
        Insert: {
          bet_type?: string | null
          brier_score?: number
          calibration_error?: number | null
          created_at?: string
          engine_name: string
          id?: string
          log_loss?: number | null
          period_end: string
          period_start: string
          reliability_score?: number | null
          resolution_score?: number | null
          sample_size?: number
          sport?: string | null
          updated_at?: string
        }
        Update: {
          bet_type?: string | null
          brier_score?: number
          calibration_error?: number | null
          created_at?: string
          engine_name?: string
          id?: string
          log_loss?: number | null
          period_end?: string
          period_start?: string
          reliability_score?: number | null
          resolution_score?: number | null
          sample_size?: number
          sport?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      engine_live_tracker: {
        Row: {
          confidence: number | null
          confidence_level: string | null
          created_at: string | null
          engine_name: string
          event_id: string | null
          game_time: string | null
          id: string
          line: number | null
          odds: number | null
          pick_description: string
          player_name: string | null
          prop_type: string | null
          settled_at: string | null
          side: string | null
          signals: Json | null
          sport: string
          status: string | null
          team_name: string | null
          updated_at: string | null
        }
        Insert: {
          confidence?: number | null
          confidence_level?: string | null
          created_at?: string | null
          engine_name: string
          event_id?: string | null
          game_time?: string | null
          id?: string
          line?: number | null
          odds?: number | null
          pick_description: string
          player_name?: string | null
          prop_type?: string | null
          settled_at?: string | null
          side?: string | null
          signals?: Json | null
          sport: string
          status?: string | null
          team_name?: string | null
          updated_at?: string | null
        }
        Update: {
          confidence?: number | null
          confidence_level?: string | null
          created_at?: string | null
          engine_name?: string
          event_id?: string | null
          game_time?: string | null
          id?: string
          line?: number | null
          odds?: number | null
          pick_description?: string
          player_name?: string | null
          prop_type?: string | null
          settled_at?: string | null
          side?: string | null
          signals?: Json | null
          sport?: string
          status?: string | null
          team_name?: string | null
          updated_at?: string | null
        }
        Relationships: []
      }
      extreme_movement_alerts: {
        Row: {
          alert_level: string
          bookmaker: string | null
          commence_time: string | null
          created_at: string | null
          current_price: number | null
          description: string
          direction: string | null
          event_id: string
          id: string
          is_trap_indicator: boolean | null
          movement_percentage: number | null
          movement_type: string
          opening_price: number | null
          player_name: string | null
          prop_type: string | null
          reasons: Json | null
          sport: string
          total_movement: number
        }
        Insert: {
          alert_level: string
          bookmaker?: string | null
          commence_time?: string | null
          created_at?: string | null
          current_price?: number | null
          description: string
          direction?: string | null
          event_id: string
          id?: string
          is_trap_indicator?: boolean | null
          movement_percentage?: number | null
          movement_type: string
          opening_price?: number | null
          player_name?: string | null
          prop_type?: string | null
          reasons?: Json | null
          sport: string
          total_movement: number
        }
        Update: {
          alert_level?: string
          bookmaker?: string | null
          commence_time?: string | null
          created_at?: string | null
          current_price?: number | null
          description?: string
          direction?: string | null
          event_id?: string
          id?: string
          is_trap_indicator?: boolean | null
          movement_percentage?: number | null
          movement_type?: string
          opening_price?: number | null
          player_name?: string | null
          prop_type?: string | null
          reasons?: Json | null
          sport?: string
          total_movement?: number
        }
        Relationships: []
      }
      fanduel_daily_parlay: {
        Row: {
          confidence_score: number | null
          created_at: string | null
          id: string
          legs: Json
          movement_analysis: Json | null
          outcome: string | null
          parlay_date: string
          reasoning_summary: string | null
          scans_completed: number | null
          settled_at: string | null
          target_odds: number | null
          total_movements_analyzed: number | null
          total_odds: number
          trap_patterns_found: number | null
          updated_at: string | null
        }
        Insert: {
          confidence_score?: number | null
          created_at?: string | null
          id?: string
          legs?: Json
          movement_analysis?: Json | null
          outcome?: string | null
          parlay_date: string
          reasoning_summary?: string | null
          scans_completed?: number | null
          settled_at?: string | null
          target_odds?: number | null
          total_movements_analyzed?: number | null
          total_odds?: number
          trap_patterns_found?: number | null
          updated_at?: string | null
        }
        Update: {
          confidence_score?: number | null
          created_at?: string | null
          id?: string
          legs?: Json
          movement_analysis?: Json | null
          outcome?: string | null
          parlay_date?: string
          reasoning_summary?: string | null
          scans_completed?: number | null
          settled_at?: string | null
          target_odds?: number | null
          total_movements_analyzed?: number | null
          total_odds?: number
          trap_patterns_found?: number | null
          updated_at?: string | null
        }
        Relationships: []
      }
      fanduel_trap_accuracy_metrics: {
        Row: {
          accuracy_rate: number | null
          avg_odds: number | null
          avg_trap_score: number | null
          correct_predictions: number | null
          created_at: string | null
          id: string
          roi_percentage: number | null
          signal_type: string
          sport: string
          total_predictions: number | null
          trap_type: string
          updated_at: string | null
          verified_predictions: number | null
        }
        Insert: {
          accuracy_rate?: number | null
          avg_odds?: number | null
          avg_trap_score?: number | null
          correct_predictions?: number | null
          created_at?: string | null
          id?: string
          roi_percentage?: number | null
          signal_type: string
          sport: string
          total_predictions?: number | null
          trap_type: string
          updated_at?: string | null
          verified_predictions?: number | null
        }
        Update: {
          accuracy_rate?: number | null
          avg_odds?: number | null
          avg_trap_score?: number | null
          correct_predictions?: number | null
          created_at?: string | null
          id?: string
          roi_percentage?: number | null
          signal_type?: string
          sport?: string
          total_predictions?: number | null
          trap_type?: string
          updated_at?: string | null
          verified_predictions?: number | null
        }
        Relationships: []
      }
      fanduel_trap_analysis: {
        Row: {
          actual_closing_price: number | null
          commence_time: string | null
          confidence_score: number | null
          created_at: string | null
          current_price: number | null
          description: string | null
          event_id: string
          fade_the_public_pick: string | null
          fade_won: boolean | null
          hourly_movements: Json | null
          id: string
          is_public_bait: boolean | null
          market_type: string
          movement_count: number | null
          movement_direction: string | null
          odds_for_fade: number | null
          opening_price: number | null
          opposite_side_also_moved: boolean | null
          outcome: string | null
          outcome_name: string
          outcome_verified_at: string | null
          player_name: string | null
          price_only_move: boolean | null
          public_bait_reason: string | null
          recommended_side: string | null
          scan_date: string
          scan_round: number
          scanned_at: string | null
          signals_detected: string[] | null
          sport: string
          total_movement: number | null
          trap_score: number | null
        }
        Insert: {
          actual_closing_price?: number | null
          commence_time?: string | null
          confidence_score?: number | null
          created_at?: string | null
          current_price?: number | null
          description?: string | null
          event_id: string
          fade_the_public_pick?: string | null
          fade_won?: boolean | null
          hourly_movements?: Json | null
          id?: string
          is_public_bait?: boolean | null
          market_type: string
          movement_count?: number | null
          movement_direction?: string | null
          odds_for_fade?: number | null
          opening_price?: number | null
          opposite_side_also_moved?: boolean | null
          outcome?: string | null
          outcome_name: string
          outcome_verified_at?: string | null
          player_name?: string | null
          price_only_move?: boolean | null
          public_bait_reason?: string | null
          recommended_side?: string | null
          scan_date?: string
          scan_round?: number
          scanned_at?: string | null
          signals_detected?: string[] | null
          sport: string
          total_movement?: number | null
          trap_score?: number | null
        }
        Update: {
          actual_closing_price?: number | null
          commence_time?: string | null
          confidence_score?: number | null
          created_at?: string | null
          current_price?: number | null
          description?: string | null
          event_id?: string
          fade_the_public_pick?: string | null
          fade_won?: boolean | null
          hourly_movements?: Json | null
          id?: string
          is_public_bait?: boolean | null
          market_type?: string
          movement_count?: number | null
          movement_direction?: string | null
          odds_for_fade?: number | null
          opening_price?: number | null
          opposite_side_also_moved?: boolean | null
          outcome?: string | null
          outcome_name?: string
          outcome_verified_at?: string | null
          player_name?: string | null
          price_only_move?: boolean | null
          public_bait_reason?: string | null
          recommended_side?: string | null
          scan_date?: string
          scan_round?: number
          scanned_at?: string | null
          signals_detected?: string[] | null
          sport?: string
          total_movement?: number | null
          trap_score?: number | null
        }
        Relationships: []
      }
      fatigue_edge_tracking: {
        Row: {
          actual_spread: number | null
          actual_total: number | null
          away_fatigue_score: number
          away_team: string
          created_at: string
          event_id: string
          fatigue_differential: number
          game_date: string
          game_result: string | null
          home_fatigue_score: number
          home_team: string
          id: string
          recommended_angle: string | null
          recommended_side: string
          recommended_side_won: boolean | null
          spread_covered: boolean | null
          total_result: string | null
          updated_at: string
          verified_at: string | null
        }
        Insert: {
          actual_spread?: number | null
          actual_total?: number | null
          away_fatigue_score: number
          away_team: string
          created_at?: string
          event_id: string
          fatigue_differential: number
          game_date: string
          game_result?: string | null
          home_fatigue_score: number
          home_team: string
          id?: string
          recommended_angle?: string | null
          recommended_side: string
          recommended_side_won?: boolean | null
          spread_covered?: boolean | null
          total_result?: string | null
          updated_at?: string
          verified_at?: string | null
        }
        Update: {
          actual_spread?: number | null
          actual_total?: number | null
          away_fatigue_score?: number
          away_team?: string
          created_at?: string
          event_id?: string
          fatigue_differential?: number
          game_date?: string
          game_result?: string | null
          home_fatigue_score?: number
          home_team?: string
          id?: string
          recommended_angle?: string | null
          recommended_side?: string
          recommended_side_won?: boolean | null
          spread_covered?: boolean | null
          total_result?: string | null
          updated_at?: string
          verified_at?: string | null
        }
        Relationships: []
      }
      god_mode_accuracy_metrics: {
        Row: {
          accuracy_rate: number
          avg_upset_score: number
          chaos_mode_active: boolean
          confidence_level: string
          correct_predictions: number
          created_at: string
          id: string
          roi_percentage: number
          sport: string | null
          total_predictions: number
          updated_at: string
        }
        Insert: {
          accuracy_rate?: number
          avg_upset_score?: number
          chaos_mode_active?: boolean
          confidence_level: string
          correct_predictions?: number
          created_at?: string
          id?: string
          roi_percentage?: number
          sport?: string | null
          total_predictions?: number
          updated_at?: string
        }
        Update: {
          accuracy_rate?: number
          avg_upset_score?: number
          chaos_mode_active?: boolean
          confidence_level?: string
          correct_predictions?: number
          created_at?: string
          id?: string
          roi_percentage?: number
          sport?: string | null
          total_predictions?: number
          updated_at?: string
        }
        Relationships: []
      }
      god_mode_upset_predictions: {
        Row: {
          ai_reasoning: string | null
          away_team: string
          chaos_mode_active: boolean
          chaos_percentage: number
          chess_ev: number
          commence_time: string
          confidence: string
          created_at: string
          event_id: string
          favorite: string
          favorite_odds: number
          final_upset_score: number
          game_completed: boolean
          historical_day_boost: number
          home_court_advantage: number
          home_team: string
          id: string
          is_live: boolean
          last_odds_update: string | null
          monte_carlo_boost: number
          odds_change_direction: string | null
          parlay_impact: Json
          previous_odds: number | null
          reasons: Json
          risk_level: number
          sharp_pct: number
          signals: Json
          sport: string
          suggestion: string
          trap_on_favorite: boolean
          underdog: string
          underdog_odds: number
          updated_at: string
          upset_probability: number
          upset_value_score: number
          verified_at: string | null
          was_upset: boolean | null
        }
        Insert: {
          ai_reasoning?: string | null
          away_team: string
          chaos_mode_active?: boolean
          chaos_percentage?: number
          chess_ev?: number
          commence_time: string
          confidence?: string
          created_at?: string
          event_id: string
          favorite: string
          favorite_odds: number
          final_upset_score?: number
          game_completed?: boolean
          historical_day_boost?: number
          home_court_advantage?: number
          home_team: string
          id?: string
          is_live?: boolean
          last_odds_update?: string | null
          monte_carlo_boost?: number
          odds_change_direction?: string | null
          parlay_impact?: Json
          previous_odds?: number | null
          reasons?: Json
          risk_level?: number
          sharp_pct?: number
          signals?: Json
          sport: string
          suggestion?: string
          trap_on_favorite?: boolean
          underdog: string
          underdog_odds: number
          updated_at?: string
          upset_probability?: number
          upset_value_score?: number
          verified_at?: string | null
          was_upset?: boolean | null
        }
        Update: {
          ai_reasoning?: string | null
          away_team?: string
          chaos_mode_active?: boolean
          chaos_percentage?: number
          chess_ev?: number
          commence_time?: string
          confidence?: string
          created_at?: string
          event_id?: string
          favorite?: string
          favorite_odds?: number
          final_upset_score?: number
          game_completed?: boolean
          historical_day_boost?: number
          home_court_advantage?: number
          home_team?: string
          id?: string
          is_live?: boolean
          last_odds_update?: string | null
          monte_carlo_boost?: number
          odds_change_direction?: string | null
          parlay_impact?: Json
          previous_odds?: number | null
          reasons?: Json
          risk_level?: number
          sharp_pct?: number
          signals?: Json
          sport?: string
          suggestion?: string
          trap_on_favorite?: boolean
          underdog?: string
          underdog_odds?: number
          updated_at?: string
          upset_probability?: number
          upset_value_score?: number
          verified_at?: string | null
          was_upset?: boolean | null
        }
        Relationships: []
      }
      hitrate_accuracy_metrics: {
        Row: {
          avg_actual_probability: number
          avg_predicted_probability: number
          calibration_factor: number
          created_at: string
          id: string
          prop_type: string | null
          sport: string | null
          strategy_type: string
          total_lost: number
          total_parlays: number
          total_won: number
          updated_at: string
          win_rate: number
        }
        Insert: {
          avg_actual_probability?: number
          avg_predicted_probability?: number
          calibration_factor?: number
          created_at?: string
          id?: string
          prop_type?: string | null
          sport?: string | null
          strategy_type: string
          total_lost?: number
          total_parlays?: number
          total_won?: number
          updated_at?: string
          win_rate?: number
        }
        Update: {
          avg_actual_probability?: number
          avg_predicted_probability?: number
          calibration_factor?: number
          created_at?: string
          id?: string
          prop_type?: string | null
          sport?: string | null
          strategy_type?: string
          total_lost?: number
          total_parlays?: number
          total_won?: number
          updated_at?: string
          win_rate?: number
        }
        Relationships: []
      }
      hitrate_parlays: {
        Row: {
          actual_win_rate: number | null
          combined_probability: number
          created_at: string
          expires_at: string
          hit_streak: string | null
          id: string
          is_active: boolean | null
          legs: Json
          min_hit_rate: number
          outcome: string | null
          result_details: Json | null
          settled_at: string | null
          sharp_analysis: Json | null
          sharp_optimized: boolean | null
          sport: string | null
          strategy_type: string
          total_odds: number
        }
        Insert: {
          actual_win_rate?: number | null
          combined_probability: number
          created_at?: string
          expires_at: string
          hit_streak?: string | null
          id?: string
          is_active?: boolean | null
          legs?: Json
          min_hit_rate?: number
          outcome?: string | null
          result_details?: Json | null
          settled_at?: string | null
          sharp_analysis?: Json | null
          sharp_optimized?: boolean | null
          sport?: string | null
          strategy_type?: string
          total_odds: number
        }
        Update: {
          actual_win_rate?: number | null
          combined_probability?: number
          created_at?: string
          expires_at?: string
          hit_streak?: string | null
          id?: string
          is_active?: boolean | null
          legs?: Json
          min_hit_rate?: number
          outcome?: string | null
          result_details?: Json | null
          settled_at?: string | null
          sharp_analysis?: Json | null
          sharp_optimized?: boolean | null
          sport?: string | null
          strategy_type?: string
          total_odds?: number
        }
        Relationships: []
      }
      home_court_advantage_stats: {
        Row: {
          avg_home_margin: number
          away_upset_rate: number
          created_at: string
          home_cover_rate: number
          home_over_rate: number
          home_upset_rate: number
          home_win_rate: number
          id: string
          sample_size: number
          sport: string
          team_name: string
          updated_at: string
          venue_name: string | null
        }
        Insert: {
          avg_home_margin?: number
          away_upset_rate?: number
          created_at?: string
          home_cover_rate?: number
          home_over_rate?: number
          home_upset_rate?: number
          home_win_rate?: number
          id?: string
          sample_size?: number
          sport: string
          team_name: string
          updated_at?: string
          venue_name?: string | null
        }
        Update: {
          avg_home_margin?: number
          away_upset_rate?: number
          created_at?: string
          home_cover_rate?: number
          home_over_rate?: number
          home_upset_rate?: number
          home_win_rate?: number
          id?: string
          sample_size?: number
          sport?: string
          team_name?: string
          updated_at?: string
          venue_name?: string | null
        }
        Relationships: []
      }
      isotonic_calibration: {
        Row: {
          bet_type: string | null
          calibrated_probability: number
          created_at: string
          engine_name: string
          id: string
          raw_probability: number
          sample_size: number | null
          sport: string | null
          updated_at: string
        }
        Insert: {
          bet_type?: string | null
          calibrated_probability: number
          created_at?: string
          engine_name: string
          id?: string
          raw_probability: number
          sample_size?: number | null
          sport?: string | null
          updated_at?: string
        }
        Update: {
          bet_type?: string | null
          calibrated_probability?: number
          created_at?: string
          engine_name?: string
          id?: string
          raw_probability?: number
          sample_size?: number | null
          sport?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      juiced_prop_movement_history: {
        Row: {
          cumulative_over_moves: number | null
          cumulative_under_moves: number | null
          id: string
          juiced_prop_id: string | null
          line: number
          movement_direction: string | null
          over_price: number
          player_name: string
          price_delta: number | null
          prop_type: string
          snapshot_time: string | null
          under_price: number
        }
        Insert: {
          cumulative_over_moves?: number | null
          cumulative_under_moves?: number | null
          id?: string
          juiced_prop_id?: string | null
          line: number
          movement_direction?: string | null
          over_price: number
          player_name: string
          price_delta?: number | null
          prop_type: string
          snapshot_time?: string | null
          under_price: number
        }
        Update: {
          cumulative_over_moves?: number | null
          cumulative_under_moves?: number | null
          id?: string
          juiced_prop_id?: string | null
          line?: number
          movement_direction?: string | null
          over_price?: number
          player_name?: string
          price_delta?: number | null
          prop_type?: string
          snapshot_time?: string | null
          under_price?: number
        }
        Relationships: [
          {
            foreignKeyName: "juiced_prop_movement_history_juiced_prop_id_fkey"
            columns: ["juiced_prop_id"]
            isOneToOne: false
            referencedRelation: "juiced_props"
            referencedColumns: ["id"]
          },
        ]
      }
      juiced_props: {
        Row: {
          actual_value: number | null
          bookmaker: string
          commence_time: string
          consistent_direction_moves: number | null
          created_at: string | null
          dominant_movement_direction: string | null
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
          movement_consistency_score: number | null
          opening_over_price: number | null
          outcome: string | null
          over_price: number
          player_name: string
          prop_type: string
          sport: string
          total_movement_snapshots: number | null
          under_price: number
          unified_composite_score: number | null
          unified_confidence: number | null
          unified_pvs_tier: string | null
          unified_recommendation: string | null
          unified_trap_score: number | null
          used_unified_intelligence: boolean | null
          verified_at: string | null
        }
        Insert: {
          actual_value?: number | null
          bookmaker: string
          commence_time: string
          consistent_direction_moves?: number | null
          created_at?: string | null
          dominant_movement_direction?: string | null
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
          movement_consistency_score?: number | null
          opening_over_price?: number | null
          outcome?: string | null
          over_price: number
          player_name: string
          prop_type: string
          sport: string
          total_movement_snapshots?: number | null
          under_price: number
          unified_composite_score?: number | null
          unified_confidence?: number | null
          unified_pvs_tier?: string | null
          unified_recommendation?: string | null
          unified_trap_score?: number | null
          used_unified_intelligence?: boolean | null
          verified_at?: string | null
        }
        Update: {
          actual_value?: number | null
          bookmaker?: string
          commence_time?: string
          consistent_direction_moves?: number | null
          created_at?: string | null
          dominant_movement_direction?: string | null
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
          movement_consistency_score?: number | null
          opening_over_price?: number | null
          outcome?: string | null
          over_price?: number
          player_name?: string
          prop_type?: string
          sport?: string
          total_movement_snapshots?: number | null
          under_price?: number
          unified_composite_score?: number | null
          unified_confidence?: number | null
          unified_pvs_tier?: string | null
          unified_recommendation?: string | null
          unified_trap_score?: number | null
          used_unified_intelligence?: boolean | null
          verified_at?: string | null
        }
        Relationships: []
      }
      juiced_props_accuracy_metrics: {
        Row: {
          avg_juice_amount: number
          created_at: string
          id: string
          juice_direction: string
          juice_level: string
          prop_type: string | null
          roi_percentage: number
          sport: string | null
          total_lost: number
          total_picks: number
          total_push: number
          total_won: number
          updated_at: string
          win_rate: number
        }
        Insert: {
          avg_juice_amount?: number
          created_at?: string
          id?: string
          juice_direction: string
          juice_level: string
          prop_type?: string | null
          roi_percentage?: number
          sport?: string | null
          total_lost?: number
          total_picks?: number
          total_push?: number
          total_won?: number
          updated_at?: string
          win_rate?: number
        }
        Update: {
          avg_juice_amount?: number
          created_at?: string
          id?: string
          juice_direction?: string
          juice_level?: string
          prop_type?: string | null
          roi_percentage?: number
          sport?: string | null
          total_lost?: number
          total_picks?: number
          total_push?: number
          total_won?: number
          updated_at?: string
          win_rate?: number
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
          detected_signals: Json | null
          determination_status: string | null
          engine_version: string | null
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
          movement_weight: number | null
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
          sharp_edge_score: number | null
          sharp_indicator: string | null
          sharp_pressure: number | null
          sharp_probability: number | null
          sport: string
          time_weight: number | null
          trap_pressure: number | null
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
          detected_signals?: Json | null
          determination_status?: string | null
          engine_version?: string | null
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
          movement_weight?: number | null
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
          sharp_edge_score?: number | null
          sharp_indicator?: string | null
          sharp_pressure?: number | null
          sharp_probability?: number | null
          sport: string
          time_weight?: number | null
          trap_pressure?: number | null
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
          detected_signals?: Json | null
          determination_status?: string | null
          engine_version?: string | null
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
          movement_weight?: number | null
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
          sharp_edge_score?: number | null
          sharp_indicator?: string | null
          sharp_pressure?: number | null
          sharp_probability?: number | null
          sport?: string
          time_weight?: number | null
          trap_pressure?: number | null
          trap_score?: number | null
          verified_at?: string | null
        }
        Relationships: []
      }
      median_lock_backtest_results: {
        Row: {
          avg_confidence_score: number | null
          avg_edge: number | null
          avg_minutes: number | null
          block_count: number | null
          created_at: string | null
          defense_bucket_stats: Json | null
          home_away_stats: Json | null
          id: string
          juice_lag_win_rate: number | null
          lock_count: number | null
          lock_only_hit_rate: number | null
          lock_strong_hit_rate: number | null
          minutes_bucket_stats: Json | null
          parameters: Json | null
          run_date: string | null
          shock_flag_rate: number | null
          shock_pass_rate: number | null
          slates_analyzed: number | null
          slip_2_count: number | null
          slip_2_hit_rate: number | null
          slip_3_count: number | null
          slip_3_hit_rate: number | null
          strong_count: number | null
          top_fail_reasons: Json | null
          tuned_edge_min: number | null
          tuned_hit_rate_min: number | null
          tuned_minutes_floor: number | null
        }
        Insert: {
          avg_confidence_score?: number | null
          avg_edge?: number | null
          avg_minutes?: number | null
          block_count?: number | null
          created_at?: string | null
          defense_bucket_stats?: Json | null
          home_away_stats?: Json | null
          id?: string
          juice_lag_win_rate?: number | null
          lock_count?: number | null
          lock_only_hit_rate?: number | null
          lock_strong_hit_rate?: number | null
          minutes_bucket_stats?: Json | null
          parameters?: Json | null
          run_date?: string | null
          shock_flag_rate?: number | null
          shock_pass_rate?: number | null
          slates_analyzed?: number | null
          slip_2_count?: number | null
          slip_2_hit_rate?: number | null
          slip_3_count?: number | null
          slip_3_hit_rate?: number | null
          strong_count?: number | null
          top_fail_reasons?: Json | null
          tuned_edge_min?: number | null
          tuned_hit_rate_min?: number | null
          tuned_minutes_floor?: number | null
        }
        Update: {
          avg_confidence_score?: number | null
          avg_edge?: number | null
          avg_minutes?: number | null
          block_count?: number | null
          created_at?: string | null
          defense_bucket_stats?: Json | null
          home_away_stats?: Json | null
          id?: string
          juice_lag_win_rate?: number | null
          lock_count?: number | null
          lock_only_hit_rate?: number | null
          lock_strong_hit_rate?: number | null
          minutes_bucket_stats?: Json | null
          parameters?: Json | null
          run_date?: string | null
          shock_flag_rate?: number | null
          shock_pass_rate?: number | null
          slates_analyzed?: number | null
          slip_2_count?: number | null
          slip_2_hit_rate?: number | null
          slip_3_count?: number | null
          slip_3_hit_rate?: number | null
          strong_count?: number | null
          top_fail_reasons?: Json | null
          tuned_edge_min?: number | null
          tuned_hit_rate_min?: number | null
          tuned_minutes_floor?: number | null
        }
        Relationships: []
      }
      median_lock_candidates: {
        Row: {
          actual_value: number | null
          adjusted_edge: number | null
          block_reason: string | null
          book_line: number
          classification: string | null
          confidence_score: number | null
          consistency_score: number | null
          created_at: string | null
          current_price: number | null
          defense_adjustment: number | null
          event_id: string | null
          failed_checks: Json | null
          hit_rate: number | null
          hit_rate_last_5: number | null
          home_away_last_10: Json | null
          id: string
          is_shock_flagged: boolean | null
          juice_lag_bonus: number | null
          location: string | null
          median_minutes: number | null
          median_points: number | null
          median_shots: number | null
          median_usage: number | null
          minutes_last_10: Json | null
          minutes_shock: boolean | null
          opening_price: number | null
          opponent: string | null
          opponent_defense_rank: number | null
          outcome: string | null
          passed_checks: Json | null
          player_name: string
          points_last_10: Json | null
          prop_type: string
          raw_edge: number | null
          shock_passed_validation: boolean | null
          shock_reasons: Json | null
          shots_last_10: Json | null
          shots_shock: boolean | null
          slate_date: string
          split_edge: number | null
          team_name: string | null
          teammates_out_count: number | null
          updated_at: string | null
          usage_last_10: Json | null
          usage_shock: boolean | null
          verified_at: string | null
        }
        Insert: {
          actual_value?: number | null
          adjusted_edge?: number | null
          block_reason?: string | null
          book_line: number
          classification?: string | null
          confidence_score?: number | null
          consistency_score?: number | null
          created_at?: string | null
          current_price?: number | null
          defense_adjustment?: number | null
          event_id?: string | null
          failed_checks?: Json | null
          hit_rate?: number | null
          hit_rate_last_5?: number | null
          home_away_last_10?: Json | null
          id?: string
          is_shock_flagged?: boolean | null
          juice_lag_bonus?: number | null
          location?: string | null
          median_minutes?: number | null
          median_points?: number | null
          median_shots?: number | null
          median_usage?: number | null
          minutes_last_10?: Json | null
          minutes_shock?: boolean | null
          opening_price?: number | null
          opponent?: string | null
          opponent_defense_rank?: number | null
          outcome?: string | null
          passed_checks?: Json | null
          player_name: string
          points_last_10?: Json | null
          prop_type: string
          raw_edge?: number | null
          shock_passed_validation?: boolean | null
          shock_reasons?: Json | null
          shots_last_10?: Json | null
          shots_shock?: boolean | null
          slate_date: string
          split_edge?: number | null
          team_name?: string | null
          teammates_out_count?: number | null
          updated_at?: string | null
          usage_last_10?: Json | null
          usage_shock?: boolean | null
          verified_at?: string | null
        }
        Update: {
          actual_value?: number | null
          adjusted_edge?: number | null
          block_reason?: string | null
          book_line?: number
          classification?: string | null
          confidence_score?: number | null
          consistency_score?: number | null
          created_at?: string | null
          current_price?: number | null
          defense_adjustment?: number | null
          event_id?: string | null
          failed_checks?: Json | null
          hit_rate?: number | null
          hit_rate_last_5?: number | null
          home_away_last_10?: Json | null
          id?: string
          is_shock_flagged?: boolean | null
          juice_lag_bonus?: number | null
          location?: string | null
          median_minutes?: number | null
          median_points?: number | null
          median_shots?: number | null
          median_usage?: number | null
          minutes_last_10?: Json | null
          minutes_shock?: boolean | null
          opening_price?: number | null
          opponent?: string | null
          opponent_defense_rank?: number | null
          outcome?: string | null
          passed_checks?: Json | null
          player_name?: string
          points_last_10?: Json | null
          prop_type?: string
          raw_edge?: number | null
          shock_passed_validation?: boolean | null
          shock_reasons?: Json | null
          shots_last_10?: Json | null
          shots_shock?: boolean | null
          slate_date?: string
          split_edge?: number | null
          team_name?: string | null
          teammates_out_count?: number | null
          updated_at?: string | null
          usage_last_10?: Json | null
          usage_shock?: boolean | null
          verified_at?: string | null
        }
        Relationships: []
      }
      median_lock_slips: {
        Row: {
          created_at: string | null
          id: string
          leg_ids: string[] | null
          legs: Json
          legs_hit: number | null
          outcome: string | null
          probability: number | null
          slate_date: string
          slip_score: number | null
          slip_type: string
          stake_tier: string | null
          verified_at: string | null
        }
        Insert: {
          created_at?: string | null
          id?: string
          leg_ids?: string[] | null
          legs?: Json
          legs_hit?: number | null
          outcome?: string | null
          probability?: number | null
          slate_date: string
          slip_score?: number | null
          slip_type: string
          stake_tier?: string | null
          verified_at?: string | null
        }
        Update: {
          created_at?: string | null
          id?: string
          leg_ids?: string[] | null
          legs?: Json
          legs_hit?: number | null
          outcome?: string | null
          probability?: number | null
          slate_date?: string
          slip_score?: number | null
          slip_type?: string
          stake_tier?: string | null
          verified_at?: string | null
        }
        Relationships: []
      }
      nba_fatigue_scores: {
        Row: {
          assists_adjustment_pct: number
          betting_edge_summary: string | null
          blocks_adjustment_pct: number
          created_at: string
          event_id: string
          fatigue_category: string
          fatigue_score: number
          game_date: string
          game_time: string
          id: string
          is_altitude_game: boolean
          is_back_to_back: boolean
          is_early_start: boolean
          is_four_in_six: boolean
          is_home: boolean
          is_road_back_to_back: boolean
          is_three_in_four: boolean
          ml_adjustment_pct: number
          opponent: string
          points_adjustment_pct: number
          rebounds_adjustment_pct: number
          recommended_angle: string | null
          spread_adjustment: number
          team_name: string
          three_pt_adjustment_pct: number
          timezone_changes: number
          travel_miles: number
          updated_at: string
        }
        Insert: {
          assists_adjustment_pct?: number
          betting_edge_summary?: string | null
          blocks_adjustment_pct?: number
          created_at?: string
          event_id: string
          fatigue_category?: string
          fatigue_score?: number
          game_date: string
          game_time: string
          id?: string
          is_altitude_game?: boolean
          is_back_to_back?: boolean
          is_early_start?: boolean
          is_four_in_six?: boolean
          is_home: boolean
          is_road_back_to_back?: boolean
          is_three_in_four?: boolean
          ml_adjustment_pct?: number
          opponent: string
          points_adjustment_pct?: number
          rebounds_adjustment_pct?: number
          recommended_angle?: string | null
          spread_adjustment?: number
          team_name: string
          three_pt_adjustment_pct?: number
          timezone_changes?: number
          travel_miles?: number
          updated_at?: string
        }
        Update: {
          assists_adjustment_pct?: number
          betting_edge_summary?: string | null
          blocks_adjustment_pct?: number
          created_at?: string
          event_id?: string
          fatigue_category?: string
          fatigue_score?: number
          game_date?: string
          game_time?: string
          id?: string
          is_altitude_game?: boolean
          is_back_to_back?: boolean
          is_early_start?: boolean
          is_four_in_six?: boolean
          is_home?: boolean
          is_road_back_to_back?: boolean
          is_three_in_four?: boolean
          ml_adjustment_pct?: number
          opponent?: string
          points_adjustment_pct?: number
          rebounds_adjustment_pct?: number
          recommended_angle?: string | null
          spread_adjustment?: number
          team_name?: string
          three_pt_adjustment_pct?: number
          timezone_changes?: number
          travel_miles?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "nba_fatigue_scores_team_name_fkey"
            columns: ["team_name"]
            isOneToOne: false
            referencedRelation: "nba_team_locations"
            referencedColumns: ["team_name"]
          },
        ]
      }
      nba_injury_reports: {
        Row: {
          affects_rotation: boolean | null
          created_at: string
          game_date: string
          id: string
          impact_level: string | null
          injury_type: string | null
          player_name: string
          status: string
          team_name: string
          updated_at: string
        }
        Insert: {
          affects_rotation?: boolean | null
          created_at?: string
          game_date: string
          id?: string
          impact_level?: string | null
          injury_type?: string | null
          player_name: string
          status?: string
          team_name: string
          updated_at?: string
        }
        Update: {
          affects_rotation?: boolean | null
          created_at?: string
          game_date?: string
          id?: string
          impact_level?: string | null
          injury_type?: string | null
          player_name?: string
          status?: string
          team_name?: string
          updated_at?: string
        }
        Relationships: []
      }
      nba_opponent_defense_stats: {
        Row: {
          assists_allowed_avg: number | null
          blocks_allowed_avg: number | null
          created_at: string
          defense_rank: number
          defense_rating: number
          id: string
          points_allowed_avg: number | null
          rebounds_allowed_avg: number | null
          stat_category: string
          team_name: string
          threes_allowed_avg: number | null
          updated_at: string
        }
        Insert: {
          assists_allowed_avg?: number | null
          blocks_allowed_avg?: number | null
          created_at?: string
          defense_rank?: number
          defense_rating?: number
          id?: string
          points_allowed_avg?: number | null
          rebounds_allowed_avg?: number | null
          stat_category: string
          team_name: string
          threes_allowed_avg?: number | null
          updated_at?: string
        }
        Update: {
          assists_allowed_avg?: number | null
          blocks_allowed_avg?: number | null
          created_at?: string
          defense_rank?: number
          defense_rating?: number
          id?: string
          points_allowed_avg?: number | null
          rebounds_allowed_avg?: number | null
          stat_category?: string
          team_name?: string
          threes_allowed_avg?: number | null
          updated_at?: string
        }
        Relationships: []
      }
      nba_player_game_logs: {
        Row: {
          assists: number | null
          blocks: number | null
          created_at: string
          field_goals_attempted: number | null
          game_date: string
          id: string
          is_home: boolean | null
          is_starter: boolean | null
          minutes_played: number | null
          opponent: string
          player_name: string
          points: number | null
          rebounds: number | null
          steals: number | null
          teammates_out: Json | null
          threes_made: number | null
          turnovers: number | null
          usage_rate: number | null
        }
        Insert: {
          assists?: number | null
          blocks?: number | null
          created_at?: string
          field_goals_attempted?: number | null
          game_date: string
          id?: string
          is_home?: boolean | null
          is_starter?: boolean | null
          minutes_played?: number | null
          opponent: string
          player_name: string
          points?: number | null
          rebounds?: number | null
          steals?: number | null
          teammates_out?: Json | null
          threes_made?: number | null
          turnovers?: number | null
          usage_rate?: number | null
        }
        Update: {
          assists?: number | null
          blocks?: number | null
          created_at?: string
          field_goals_attempted?: number | null
          game_date?: string
          id?: string
          is_home?: boolean | null
          is_starter?: boolean | null
          minutes_played?: number | null
          opponent?: string
          player_name?: string
          points?: number | null
          rebounds?: number | null
          steals?: number | null
          teammates_out?: Json | null
          threes_made?: number | null
          turnovers?: number | null
          usage_rate?: number | null
        }
        Relationships: []
      }
      nba_schedule_cache: {
        Row: {
          created_at: string
          game_date: string
          game_time: string
          id: string
          is_home: boolean
          opponent: string
          team_name: string
          venue_city: string
        }
        Insert: {
          created_at?: string
          game_date: string
          game_time: string
          id?: string
          is_home: boolean
          opponent: string
          team_name: string
          venue_city: string
        }
        Update: {
          created_at?: string
          game_date?: string
          game_time?: string
          id?: string
          is_home?: boolean
          opponent?: string
          team_name?: string
          venue_city?: string
        }
        Relationships: [
          {
            foreignKeyName: "nba_schedule_cache_team_name_fkey"
            columns: ["team_name"]
            isOneToOne: false
            referencedRelation: "nba_team_locations"
            referencedColumns: ["team_name"]
          },
        ]
      }
      nba_team_locations: {
        Row: {
          altitude_feet: number
          arena: string
          city: string
          conference: string
          created_at: string
          division: string
          id: string
          latitude: number
          longitude: number
          team_name: string
          timezone: string
        }
        Insert: {
          altitude_feet?: number
          arena: string
          city: string
          conference: string
          created_at?: string
          division: string
          id?: string
          latitude: number
          longitude: number
          team_name: string
          timezone: string
        }
        Update: {
          altitude_feet?: number
          arena?: string
          city?: string
          conference?: string
          created_at?: string
          division?: string
          id?: string
          latitude?: number
          longitude?: number
          team_name?: string
          timezone?: string
        }
        Relationships: []
      }
      nba_team_pace_projections: {
        Row: {
          created_at: string
          id: string
          pace_rank: number
          pace_rating: number
          possessions_per_game: number | null
          team_name: string
          tempo_factor: number | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          pace_rank?: number
          pace_rating?: number
          possessions_per_game?: number | null
          team_name: string
          tempo_factor?: number | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          pace_rank?: number
          pace_rating?: number
          possessions_per_game?: number | null
          team_name?: string
          tempo_factor?: number | null
          updated_at?: string
        }
        Relationships: []
      }
      nfl_player_game_logs: {
        Row: {
          attempts: number | null
          completions: number | null
          created_at: string
          game_date: string
          id: string
          interceptions: number | null
          is_home: boolean | null
          opponent: string
          passing_tds: number | null
          passing_yards: number | null
          player_name: string
          receiving_tds: number | null
          receiving_yards: number | null
          receptions: number | null
          rushing_tds: number | null
          rushing_yards: number | null
          targets: number | null
          team: string | null
        }
        Insert: {
          attempts?: number | null
          completions?: number | null
          created_at?: string
          game_date: string
          id?: string
          interceptions?: number | null
          is_home?: boolean | null
          opponent: string
          passing_tds?: number | null
          passing_yards?: number | null
          player_name: string
          receiving_tds?: number | null
          receiving_yards?: number | null
          receptions?: number | null
          rushing_tds?: number | null
          rushing_yards?: number | null
          targets?: number | null
          team?: string | null
        }
        Update: {
          attempts?: number | null
          completions?: number | null
          created_at?: string
          game_date?: string
          id?: string
          interceptions?: number | null
          is_home?: boolean | null
          opponent?: string
          passing_tds?: number | null
          passing_yards?: number | null
          player_name?: string
          receiving_tds?: number | null
          receiving_yards?: number | null
          receptions?: number | null
          rushing_tds?: number | null
          rushing_yards?: number | null
          targets?: number | null
          team?: string | null
        }
        Relationships: []
      }
      nfl_player_season_stats: {
        Row: {
          away_passing_yards_avg: number | null
          away_receptions_avg: number | null
          away_rushing_yards_avg: number | null
          consistency_score: number | null
          created_at: string
          games_played: number | null
          home_passing_yards_avg: number | null
          home_receptions_avg: number | null
          home_rushing_yards_avg: number | null
          id: string
          last10_passing_yards_avg: number | null
          last10_receptions_avg: number | null
          last10_rushing_yards_avg: number | null
          passing_tds_avg: number | null
          passing_yards_avg: number | null
          passing_yards_std: number | null
          player_name: string
          position: string | null
          receiving_yards_avg: number | null
          receiving_yards_std: number | null
          receptions_avg: number | null
          receptions_std: number | null
          rushing_yards_avg: number | null
          rushing_yards_std: number | null
          team: string | null
          trend_direction: string | null
          updated_at: string
        }
        Insert: {
          away_passing_yards_avg?: number | null
          away_receptions_avg?: number | null
          away_rushing_yards_avg?: number | null
          consistency_score?: number | null
          created_at?: string
          games_played?: number | null
          home_passing_yards_avg?: number | null
          home_receptions_avg?: number | null
          home_rushing_yards_avg?: number | null
          id?: string
          last10_passing_yards_avg?: number | null
          last10_receptions_avg?: number | null
          last10_rushing_yards_avg?: number | null
          passing_tds_avg?: number | null
          passing_yards_avg?: number | null
          passing_yards_std?: number | null
          player_name: string
          position?: string | null
          receiving_yards_avg?: number | null
          receiving_yards_std?: number | null
          receptions_avg?: number | null
          receptions_std?: number | null
          rushing_yards_avg?: number | null
          rushing_yards_std?: number | null
          team?: string | null
          trend_direction?: string | null
          updated_at?: string
        }
        Update: {
          away_passing_yards_avg?: number | null
          away_receptions_avg?: number | null
          away_rushing_yards_avg?: number | null
          consistency_score?: number | null
          created_at?: string
          games_played?: number | null
          home_passing_yards_avg?: number | null
          home_receptions_avg?: number | null
          home_rushing_yards_avg?: number | null
          id?: string
          last10_passing_yards_avg?: number | null
          last10_receptions_avg?: number | null
          last10_rushing_yards_avg?: number | null
          passing_tds_avg?: number | null
          passing_yards_avg?: number | null
          passing_yards_std?: number | null
          player_name?: string
          position?: string | null
          receiving_yards_avg?: number | null
          receiving_yards_std?: number | null
          receptions_avg?: number | null
          receptions_std?: number | null
          rushing_yards_avg?: number | null
          rushing_yards_std?: number | null
          team?: string | null
          trend_direction?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      nhl_player_game_logs: {
        Row: {
          assists: number | null
          blocked_shots: number | null
          created_at: string
          game_date: string
          goals: number | null
          id: string
          is_home: boolean | null
          minutes_played: number | null
          opponent: string
          penalty_minutes: number | null
          player_name: string
          plus_minus: number | null
          points: number | null
          power_play_points: number | null
          shots_on_goal: number | null
        }
        Insert: {
          assists?: number | null
          blocked_shots?: number | null
          created_at?: string
          game_date: string
          goals?: number | null
          id?: string
          is_home?: boolean | null
          minutes_played?: number | null
          opponent: string
          penalty_minutes?: number | null
          player_name: string
          plus_minus?: number | null
          points?: number | null
          power_play_points?: number | null
          shots_on_goal?: number | null
        }
        Update: {
          assists?: number | null
          blocked_shots?: number | null
          created_at?: string
          game_date?: string
          goals?: number | null
          id?: string
          is_home?: boolean | null
          minutes_played?: number | null
          opponent?: string
          penalty_minutes?: number | null
          player_name?: string
          plus_minus?: number | null
          points?: number | null
          power_play_points?: number | null
          shots_on_goal?: number | null
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
          juiced_picks_email: boolean
          last_juiced_email_at: string | null
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
          juiced_picks_email?: boolean
          last_juiced_email_at?: string | null
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
          juiced_picks_email?: boolean
          last_juiced_email_at?: string | null
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
      parlay_leg_correlations: {
        Row: {
          confidence_interval_high: number | null
          confidence_interval_low: number | null
          correlation_coefficient: number
          correlation_type: string
          created_at: string
          id: string
          last_calculated_at: string | null
          market_type_1: string
          market_type_2: string
          sample_size: number
          sport: string
          updated_at: string
        }
        Insert: {
          confidence_interval_high?: number | null
          confidence_interval_low?: number | null
          correlation_coefficient?: number
          correlation_type?: string
          created_at?: string
          id?: string
          last_calculated_at?: string | null
          market_type_1: string
          market_type_2: string
          sample_size?: number
          sport: string
          updated_at?: string
        }
        Update: {
          confidence_interval_high?: number | null
          confidence_interval_low?: number | null
          correlation_coefficient?: number
          correlation_type?: string
          created_at?: string
          id?: string
          last_calculated_at?: string | null
          market_type_1?: string
          market_type_2?: string
          sample_size?: number
          sport?: string
          updated_at?: string
        }
        Relationships: []
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
      performance_snapshots: {
        Row: {
          brier_score: number | null
          calibration_error: number | null
          confidence_level: string | null
          correct_predictions: number | null
          created_at: string | null
          engine_name: string
          hit_rate: number | null
          id: string
          log_loss: number | null
          roi_percentage: number | null
          sample_size: number | null
          snapshot_date: string
          sport: string | null
          total_predictions: number | null
          total_profit: number | null
          total_staked: number | null
          updated_at: string | null
          window_days: number
        }
        Insert: {
          brier_score?: number | null
          calibration_error?: number | null
          confidence_level?: string | null
          correct_predictions?: number | null
          created_at?: string | null
          engine_name: string
          hit_rate?: number | null
          id?: string
          log_loss?: number | null
          roi_percentage?: number | null
          sample_size?: number | null
          snapshot_date: string
          sport?: string | null
          total_predictions?: number | null
          total_profit?: number | null
          total_staked?: number | null
          updated_at?: string | null
          window_days: number
        }
        Update: {
          brier_score?: number | null
          calibration_error?: number | null
          confidence_level?: string | null
          correct_predictions?: number | null
          created_at?: string | null
          engine_name?: string
          hit_rate?: number | null
          id?: string
          log_loss?: number | null
          roi_percentage?: number | null
          sample_size?: number | null
          snapshot_date?: string
          sport?: string | null
          total_predictions?: number | null
          total_profit?: number | null
          total_staked?: number | null
          updated_at?: string | null
          window_days?: number
        }
        Relationships: []
      }
      pilot_user_quotas: {
        Row: {
          created_at: string
          free_compares_remaining: number
          free_scans_remaining: number
          id: string
          paid_scan_balance: number
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          free_compares_remaining?: number
          free_scans_remaining?: number
          id?: string
          paid_scan_balance?: number
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          free_compares_remaining?: number
          free_scans_remaining?: number
          id?: string
          paid_scan_balance?: number
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      player_prop_hitrates: {
        Row: {
          analyzed_at: string
          bookmaker: string | null
          commence_time: string | null
          confidence_score: number | null
          consistency_score: number | null
          current_line: number
          event_id: string | null
          expires_at: string | null
          fatigue_impact: number | null
          game_description: string | null
          game_logs: Json | null
          games_analyzed: number
          hit_rate_over: number
          hit_rate_under: number
          hit_streak: string | null
          home_away_adjustment: number | null
          id: string
          is_perfect_streak: boolean | null
          last_5_avg: number | null
          last_5_results: Json | null
          line_value_label: string | null
          line_value_score: number | null
          line_vs_season_pct: number | null
          opponent_defense_rank: number | null
          opponent_name: string | null
          over_hits: number
          over_price: number | null
          player_name: string
          projected_value: number | null
          projection_margin: number | null
          prop_type: string
          recommended_side: string | null
          rest_days_factor: number | null
          season_avg: number | null
          season_games_played: number | null
          season_trend_pct: number | null
          sport: string
          trend_direction: string | null
          under_hits: number
          under_price: number | null
          vs_opponent_avg: number | null
          vs_opponent_games: number | null
          vs_opponent_hit_rate: number | null
        }
        Insert: {
          analyzed_at?: string
          bookmaker?: string | null
          commence_time?: string | null
          confidence_score?: number | null
          consistency_score?: number | null
          current_line: number
          event_id?: string | null
          expires_at?: string | null
          fatigue_impact?: number | null
          game_description?: string | null
          game_logs?: Json | null
          games_analyzed?: number
          hit_rate_over?: number
          hit_rate_under?: number
          hit_streak?: string | null
          home_away_adjustment?: number | null
          id?: string
          is_perfect_streak?: boolean | null
          last_5_avg?: number | null
          last_5_results?: Json | null
          line_value_label?: string | null
          line_value_score?: number | null
          line_vs_season_pct?: number | null
          opponent_defense_rank?: number | null
          opponent_name?: string | null
          over_hits?: number
          over_price?: number | null
          player_name: string
          projected_value?: number | null
          projection_margin?: number | null
          prop_type: string
          recommended_side?: string | null
          rest_days_factor?: number | null
          season_avg?: number | null
          season_games_played?: number | null
          season_trend_pct?: number | null
          sport: string
          trend_direction?: string | null
          under_hits?: number
          under_price?: number | null
          vs_opponent_avg?: number | null
          vs_opponent_games?: number | null
          vs_opponent_hit_rate?: number | null
        }
        Update: {
          analyzed_at?: string
          bookmaker?: string | null
          commence_time?: string | null
          confidence_score?: number | null
          consistency_score?: number | null
          current_line?: number
          event_id?: string | null
          expires_at?: string | null
          fatigue_impact?: number | null
          game_description?: string | null
          game_logs?: Json | null
          games_analyzed?: number
          hit_rate_over?: number
          hit_rate_under?: number
          hit_streak?: string | null
          home_away_adjustment?: number | null
          id?: string
          is_perfect_streak?: boolean | null
          last_5_avg?: number | null
          last_5_results?: Json | null
          line_value_label?: string | null
          line_value_score?: number | null
          line_vs_season_pct?: number | null
          opponent_defense_rank?: number | null
          opponent_name?: string | null
          over_hits?: number
          over_price?: number | null
          player_name?: string
          projected_value?: number | null
          projection_margin?: number | null
          prop_type?: string
          recommended_side?: string | null
          rest_days_factor?: number | null
          season_avg?: number | null
          season_games_played?: number | null
          season_trend_pct?: number | null
          sport?: string
          trend_direction?: string | null
          under_hits?: number
          under_price?: number | null
          vs_opponent_avg?: number | null
          vs_opponent_games?: number | null
          vs_opponent_hit_rate?: number | null
        }
        Relationships: []
      }
      player_season_stats: {
        Row: {
          assists_std_dev: number
          avg_assists: number
          avg_blocks: number
          avg_minutes: number
          avg_points: number
          avg_rebounds: number
          avg_steals: number
          avg_threes: number
          away_avg_assists: number
          away_avg_points: number
          away_avg_rebounds: number
          away_avg_threes: number
          away_games: number
          b2b_avg_points: number
          b2b_games: number
          consistency_score: number
          created_at: string
          games_played: number
          home_avg_assists: number
          home_avg_points: number
          home_avg_rebounds: number
          home_avg_threes: number
          home_games: number
          id: string
          last_10_avg_assists: number
          last_10_avg_points: number
          last_10_avg_rebounds: number
          last_10_avg_threes: number
          player_name: string
          points_std_dev: number
          rebounds_std_dev: number
          rest_avg_points: number
          rest_games: number
          season: string
          sport: string
          team_name: string | null
          threes_std_dev: number
          trend_direction: string
          updated_at: string
        }
        Insert: {
          assists_std_dev?: number
          avg_assists?: number
          avg_blocks?: number
          avg_minutes?: number
          avg_points?: number
          avg_rebounds?: number
          avg_steals?: number
          avg_threes?: number
          away_avg_assists?: number
          away_avg_points?: number
          away_avg_rebounds?: number
          away_avg_threes?: number
          away_games?: number
          b2b_avg_points?: number
          b2b_games?: number
          consistency_score?: number
          created_at?: string
          games_played?: number
          home_avg_assists?: number
          home_avg_points?: number
          home_avg_rebounds?: number
          home_avg_threes?: number
          home_games?: number
          id?: string
          last_10_avg_assists?: number
          last_10_avg_points?: number
          last_10_avg_rebounds?: number
          last_10_avg_threes?: number
          player_name: string
          points_std_dev?: number
          rebounds_std_dev?: number
          rest_avg_points?: number
          rest_games?: number
          season?: string
          sport?: string
          team_name?: string | null
          threes_std_dev?: number
          trend_direction?: string
          updated_at?: string
        }
        Update: {
          assists_std_dev?: number
          avg_assists?: number
          avg_blocks?: number
          avg_minutes?: number
          avg_points?: number
          avg_rebounds?: number
          avg_steals?: number
          avg_threes?: number
          away_avg_assists?: number
          away_avg_points?: number
          away_avg_rebounds?: number
          away_avg_threes?: number
          away_games?: number
          b2b_avg_points?: number
          b2b_games?: number
          consistency_score?: number
          created_at?: string
          games_played?: number
          home_avg_assists?: number
          home_avg_points?: number
          home_avg_rebounds?: number
          home_avg_threes?: number
          home_games?: number
          id?: string
          last_10_avg_assists?: number
          last_10_avg_points?: number
          last_10_avg_rebounds?: number
          last_10_avg_threes?: number
          player_name?: string
          points_std_dev?: number
          rebounds_std_dev?: number
          rest_avg_points?: number
          rest_games?: number
          season?: string
          sport?: string
          team_name?: string | null
          threes_std_dev?: number
          trend_direction?: string
          updated_at?: string
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
      player_usage_metrics: {
        Row: {
          ast_per_min: number
          avg_assists: number
          avg_minutes: number
          avg_points: number
          avg_rebounds: number
          calculated_at: string
          created_at: string
          games_analyzed: number
          id: string
          player_name: string
          pts_per_min: number
          reb_per_min: number
          recent_game_logs: Json | null
          sport: string
          updated_at: string
          usage_trend: string | null
        }
        Insert: {
          ast_per_min?: number
          avg_assists?: number
          avg_minutes?: number
          avg_points?: number
          avg_rebounds?: number
          calculated_at?: string
          created_at?: string
          games_analyzed?: number
          id?: string
          player_name: string
          pts_per_min?: number
          reb_per_min?: number
          recent_game_logs?: Json | null
          sport?: string
          updated_at?: string
          usage_trend?: string | null
        }
        Update: {
          ast_per_min?: number
          avg_assists?: number
          avg_minutes?: number
          avg_points?: number
          avg_rebounds?: number
          calculated_at?: string
          created_at?: string
          games_analyzed?: number
          id?: string
          player_name?: string
          pts_per_min?: number
          reb_per_min?: number
          recent_game_logs?: Json | null
          sport?: string
          updated_at?: string
          usage_trend?: string | null
        }
        Relationships: []
      }
      profiles: {
        Row: {
          avatar_url: string | null
          bio: string | null
          created_at: string
          hints_enabled: boolean | null
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
          hints_enabled?: boolean | null
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
          hints_enabled?: boolean | null
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
      pvs_parlays: {
        Row: {
          combined_probability: number | null
          combined_pvs_score: number | null
          created_at: string
          expires_at: string
          id: string
          is_active: boolean | null
          legs: Json
          parlay_type: string
          total_odds: number | null
        }
        Insert: {
          combined_probability?: number | null
          combined_pvs_score?: number | null
          created_at?: string
          expires_at: string
          id?: string
          is_active?: boolean | null
          legs?: Json
          parlay_type?: string
          total_odds?: number | null
        }
        Update: {
          combined_probability?: number | null
          combined_pvs_score?: number | null
          created_at?: string
          expires_at?: string
          id?: string
          is_active?: boolean | null
          legs?: Json
          parlay_type?: string
          total_odds?: number | null
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
      sharp_engine_config: {
        Row: {
          category: string | null
          config_key: string
          config_value: number
          created_at: string | null
          description: string | null
          id: string
          updated_at: string | null
        }
        Insert: {
          category?: string | null
          config_key: string
          config_value: number
          created_at?: string | null
          description?: string | null
          id?: string
          updated_at?: string | null
        }
        Update: {
          category?: string | null
          config_key?: string
          config_value?: number
          created_at?: string | null
          description?: string | null
          id?: string
          updated_at?: string | null
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
      sharp_signal_calibration: {
        Row: {
          created_at: string
          description: string | null
          factor_key: string
          factor_value: number
          id: string
          last_accuracy: number | null
          sample_size: number | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          description?: string | null
          factor_key: string
          factor_value?: number
          id?: string
          last_accuracy?: number | null
          sample_size?: number | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          description?: string | null
          factor_key?: string
          factor_value?: number
          id?: string
          last_accuracy?: number | null
          sample_size?: number | null
          updated_at?: string
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
      team_season_standings: {
        Row: {
          away_record: string | null
          conference: string | null
          conference_rank: number | null
          created_at: string | null
          division: string | null
          division_rank: number | null
          home_record: string | null
          id: string
          last_10: string | null
          losses: number | null
          point_differential: number | null
          points_against: number | null
          points_for: number | null
          season: string
          sport: string
          streak: string | null
          team_name: string
          ties: number | null
          updated_at: string | null
          win_pct: number | null
          wins: number | null
        }
        Insert: {
          away_record?: string | null
          conference?: string | null
          conference_rank?: number | null
          created_at?: string | null
          division?: string | null
          division_rank?: number | null
          home_record?: string | null
          id?: string
          last_10?: string | null
          losses?: number | null
          point_differential?: number | null
          points_against?: number | null
          points_for?: number | null
          season: string
          sport: string
          streak?: string | null
          team_name: string
          ties?: number | null
          updated_at?: string | null
          win_pct?: number | null
          wins?: number | null
        }
        Update: {
          away_record?: string | null
          conference?: string | null
          conference_rank?: number | null
          created_at?: string | null
          division?: string | null
          division_rank?: number | null
          home_record?: string | null
          id?: string
          last_10?: string | null
          losses?: number | null
          point_differential?: number | null
          points_against?: number | null
          points_for?: number | null
          season?: string
          sport?: string
          streak?: string | null
          team_name?: string
          ties?: number | null
          updated_at?: string | null
          win_pct?: number | null
          wins?: number | null
        }
        Relationships: []
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
      unified_props: {
        Row: {
          away_team_record: string | null
          away_team_win_pct: number | null
          bookmaker: string
          category: string
          commence_time: string
          composite_score: number | null
          confidence: number | null
          created_at: string
          current_line: number
          event_id: string
          fatigue_score: number | null
          game_description: string
          hit_rate_score: number | null
          home_team_record: string | null
          home_team_win_pct: number | null
          id: string
          is_active: boolean | null
          is_trap_favorite: boolean | null
          outcome: string | null
          over_price: number | null
          player_name: string
          prop_type: string
          pvs_accuracy_score: number | null
          pvs_confidence_score: number | null
          pvs_final_score: number | null
          pvs_injury_tax: number | null
          pvs_matchup_score: number | null
          pvs_minutes_score: number | null
          pvs_pace_score: number | null
          pvs_sharp_score: number | null
          pvs_tier: string | null
          pvs_value_score: number | null
          recommendation: string | null
          recommended_side: string | null
          record_differential: number | null
          record_score: number | null
          settled_at: string | null
          sharp_money_score: number | null
          signal_sources: Json | null
          sport: string
          trap_score: number | null
          true_line: number | null
          true_line_diff: number | null
          under_price: number | null
          updated_at: string
          upset_score: number | null
        }
        Insert: {
          away_team_record?: string | null
          away_team_win_pct?: number | null
          bookmaker: string
          category?: string
          commence_time: string
          composite_score?: number | null
          confidence?: number | null
          created_at?: string
          current_line: number
          event_id: string
          fatigue_score?: number | null
          game_description: string
          hit_rate_score?: number | null
          home_team_record?: string | null
          home_team_win_pct?: number | null
          id?: string
          is_active?: boolean | null
          is_trap_favorite?: boolean | null
          outcome?: string | null
          over_price?: number | null
          player_name: string
          prop_type: string
          pvs_accuracy_score?: number | null
          pvs_confidence_score?: number | null
          pvs_final_score?: number | null
          pvs_injury_tax?: number | null
          pvs_matchup_score?: number | null
          pvs_minutes_score?: number | null
          pvs_pace_score?: number | null
          pvs_sharp_score?: number | null
          pvs_tier?: string | null
          pvs_value_score?: number | null
          recommendation?: string | null
          recommended_side?: string | null
          record_differential?: number | null
          record_score?: number | null
          settled_at?: string | null
          sharp_money_score?: number | null
          signal_sources?: Json | null
          sport: string
          trap_score?: number | null
          true_line?: number | null
          true_line_diff?: number | null
          under_price?: number | null
          updated_at?: string
          upset_score?: number | null
        }
        Update: {
          away_team_record?: string | null
          away_team_win_pct?: number | null
          bookmaker?: string
          category?: string
          commence_time?: string
          composite_score?: number | null
          confidence?: number | null
          created_at?: string
          current_line?: number
          event_id?: string
          fatigue_score?: number | null
          game_description?: string
          hit_rate_score?: number | null
          home_team_record?: string | null
          home_team_win_pct?: number | null
          id?: string
          is_active?: boolean | null
          is_trap_favorite?: boolean | null
          outcome?: string | null
          over_price?: number | null
          player_name?: string
          prop_type?: string
          pvs_accuracy_score?: number | null
          pvs_confidence_score?: number | null
          pvs_final_score?: number | null
          pvs_injury_tax?: number | null
          pvs_matchup_score?: number | null
          pvs_minutes_score?: number | null
          pvs_pace_score?: number | null
          pvs_sharp_score?: number | null
          pvs_tier?: string | null
          pvs_value_score?: number | null
          recommendation?: string | null
          recommended_side?: string | null
          record_differential?: number | null
          record_score?: number | null
          settled_at?: string | null
          sharp_money_score?: number | null
          signal_sources?: Json | null
          sport?: string
          trap_score?: number | null
          true_line?: number | null
          true_line_diff?: number | null
          under_price?: number | null
          updated_at?: string
          upset_score?: number | null
        }
        Relationships: []
      }
      upset_calibration_factors: {
        Row: {
          accuracy_rate: number
          avg_odds: number
          calibration_factor: number
          confidence_level: string
          correct_predictions: number
          created_at: string
          expected_accuracy: number
          id: string
          roi_percentage: number
          score_range_max: number
          score_range_min: number
          sport: string
          total_predictions: number
          updated_at: string
        }
        Insert: {
          accuracy_rate?: number
          avg_odds?: number
          calibration_factor?: number
          confidence_level: string
          correct_predictions?: number
          created_at?: string
          expected_accuracy?: number
          id?: string
          roi_percentage?: number
          score_range_max?: number
          score_range_min?: number
          sport: string
          total_predictions?: number
          updated_at?: string
        }
        Update: {
          accuracy_rate?: number
          avg_odds?: number
          calibration_factor?: number
          confidence_level?: string
          correct_predictions?: number
          created_at?: string
          expected_accuracy?: number
          id?: string
          roi_percentage?: number
          score_range_max?: number
          score_range_min?: number
          sport?: string
          total_predictions?: number
          updated_at?: string
        }
        Relationships: []
      }
      upset_predictions: {
        Row: {
          ai_reasoning: string | null
          away_team: string
          calibration_factor: number | null
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
          signal_sources: Json | null
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
          calibration_factor?: number | null
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
          signal_sources?: Json | null
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
          calibration_factor?: number | null
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
          signal_sources?: Json | null
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
      user_bankroll: {
        Row: {
          bankroll_amount: number | null
          created_at: string | null
          current_loss_streak: number | null
          current_win_streak: number | null
          default_unit_size: number | null
          id: string
          kelly_multiplier: number | null
          max_bet_percent: number | null
          peak_bankroll: number | null
          total_bets: number | null
          total_lost: number | null
          total_won: number | null
          updated_at: string | null
          user_id: string
        }
        Insert: {
          bankroll_amount?: number | null
          created_at?: string | null
          current_loss_streak?: number | null
          current_win_streak?: number | null
          default_unit_size?: number | null
          id?: string
          kelly_multiplier?: number | null
          max_bet_percent?: number | null
          peak_bankroll?: number | null
          total_bets?: number | null
          total_lost?: number | null
          total_won?: number | null
          updated_at?: string | null
          user_id: string
        }
        Update: {
          bankroll_amount?: number | null
          created_at?: string | null
          current_loss_streak?: number | null
          current_win_streak?: number | null
          default_unit_size?: number | null
          id?: string
          kelly_multiplier?: number | null
          max_bet_percent?: number | null
          peak_bankroll?: number | null
          total_bets?: number | null
          total_lost?: number | null
          total_won?: number | null
          updated_at?: string | null
          user_id?: string
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
      add_paid_scans: {
        Args: { p_amount: number; p_user_id: string }
        Returns: boolean
      }
      calculate_calibration_factors: { Args: never; Returns: undefined }
      check_scan_access: { Args: { p_user_id: string }; Returns: Json }
      decrement_pilot_quota: {
        Args: { p_quota_type: string; p_user_id: string }
        Returns: Json
      }
      detect_sharp_money: {
        Args: { p_point_change?: number; p_price_change: number }
        Returns: {
          indicator: string
          is_sharp: boolean
        }[]
      }
      get_accuracy_trends: {
        Args: never
        Returns: {
          category: string
          current_period_accuracy: number
          current_period_verified: number
          previous_period_accuracy: number
          previous_period_verified: number
          trend_change: number
          trend_direction: string
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
      get_complete_accuracy_summary: {
        Args: never
        Returns: {
          accuracy_rate: number
          category: string
          correct_predictions: number
          roi_percentage: number
          sample_confidence: string
          system_name: string
          total_predictions: number
          verified_predictions: number
        }[]
      }
      get_fatigue_edge_accuracy: {
        Args: never
        Returns: {
          avg_differential: number
          differential_bucket: string
          losses: number
          roi_percentage: number
          total_games: number
          verified_games: number
          win_rate: number
          wins: number
        }[]
      }
      get_hitrate_accuracy_stats: {
        Args: never
        Returns: {
          calibration_needed: string
          predicted_vs_actual: number
          sport: string
          strategy_type: string
          total_lost: number
          total_parlays: number
          total_won: number
          win_rate: number
        }[]
      }
      get_hitrate_prop_accuracy: {
        Args: never
        Returns: {
          avg_hit_rate: number
          leg_win_rate: number
          lost_legs: number
          prop_type: string
          total_legs: number
          won_legs: number
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
      get_rolling_performance_stats: {
        Args: {
          p_engine_name?: string
          p_sport?: string
          p_window_days?: number
        }
        Returns: {
          avg_odds: number
          correct_predictions: number
          engine_name: string
          hit_rate: number
          roi_percentage: number
          sample_confidence: string
          sport: string
          total_predictions: number
          window_days: number
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
      get_unified_accuracy_stats: {
        Args: never
        Returns: {
          accuracy_rate: number
          category: string
          correct_predictions: number
          sample_confidence: string
          subcategory: string
          total_predictions: number
          verified_predictions: number
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
      update_upset_calibration: { Args: never; Returns: undefined }
    }
    Enums: {
      app_role: "admin" | "moderator" | "user" | "collaborator" | "pilot"
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
      app_role: ["admin", "moderator", "user", "collaborator", "pilot"],
    },
  },
} as const
