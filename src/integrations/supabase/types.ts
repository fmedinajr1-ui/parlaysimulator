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
      ai_formula_auto_bans: {
        Row: {
          accuracy_at_ban: number | null
          ban_reason: string
          created_at: string | null
          engine_source: string
          formula_name: string
          id: string
          is_active: boolean
          lifted_at: string | null
          total_picks: number | null
          updated_at: string | null
        }
        Insert: {
          accuracy_at_ban?: number | null
          ban_reason?: string
          created_at?: string | null
          engine_source: string
          formula_name: string
          id?: string
          is_active?: boolean
          lifted_at?: string | null
          total_picks?: number | null
          updated_at?: string | null
        }
        Update: {
          accuracy_at_ban?: number | null
          ban_reason?: string
          created_at?: string | null
          engine_source?: string
          formula_name?: string
          id?: string
          is_active?: boolean
          lifted_at?: string | null
          total_picks?: number | null
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
          disable_reason: string | null
          disabled_at: string | null
          engine_source: string
          formula_name: string
          id: string
          is_disabled: boolean | null
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
          disable_reason?: string | null
          disabled_at?: string | null
          engine_source: string
          formula_name: string
          id?: string
          is_disabled?: boolean | null
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
          disable_reason?: string | null
          disabled_at?: string | null
          engine_source?: string
          formula_name?: string
          id?: string
          is_disabled?: boolean | null
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
          cross_validated: boolean | null
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
          validation_signals: Json | null
        }
        Insert: {
          accuracy_at_generation?: number | null
          ai_reasoning?: string | null
          confidence_score?: number
          created_at?: string
          cross_validated?: boolean | null
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
          validation_signals?: Json | null
        }
        Update: {
          accuracy_at_generation?: number | null
          ai_reasoning?: string | null
          confidence_score?: number
          created_at?: string
          cross_validated?: boolean | null
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
          validation_signals?: Json | null
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
      analytics_events: {
        Row: {
          created_at: string
          device_fingerprint: string | null
          event_type: string
          id: string
          metadata: Json | null
          page_path: string | null
          referrer: string | null
          user_agent: string | null
          user_id: string | null
        }
        Insert: {
          created_at?: string
          device_fingerprint?: string | null
          event_type: string
          id?: string
          metadata?: Json | null
          page_path?: string | null
          referrer?: string | null
          user_agent?: string | null
          user_id?: string | null
        }
        Update: {
          created_at?: string
          device_fingerprint?: string | null
          event_type?: string
          id?: string
          metadata?: Json | null
          page_path?: string | null
          referrer?: string | null
          user_agent?: string | null
          user_id?: string | null
        }
        Relationships: []
      }
      api_budget_tracker: {
        Row: {
          calls_limit: number
          calls_used: number
          created_at: string
          date: string
          id: string
          last_full_scrape: string | null
          last_scout: string | null
          last_targeted: string | null
          warning_sent: boolean
        }
        Insert: {
          calls_limit?: number
          calls_used?: number
          created_at?: string
          date: string
          id?: string
          last_full_scrape?: string | null
          last_scout?: string | null
          last_targeted?: string | null
          warning_sent?: boolean
        }
        Update: {
          calls_limit?: number
          calls_used?: number
          created_at?: string
          date?: string
          id?: string
          last_full_scrape?: string | null
          last_scout?: string | null
          last_targeted?: string | null
          warning_sent?: boolean
        }
        Relationships: []
      }
      app_releases: {
        Row: {
          body: string | null
          created_at: string
          id: string
          is_published: boolean
          notifications_sent: boolean
          published_at: string | null
          release_type: string
          summary: string
          title: string
          version: string
        }
        Insert: {
          body?: string | null
          created_at?: string
          id?: string
          is_published?: boolean
          notifications_sent?: boolean
          published_at?: string | null
          release_type?: string
          summary: string
          title: string
          version: string
        }
        Update: {
          body?: string | null
          created_at?: string
          id?: string
          is_published?: boolean
          notifications_sent?: boolean
          published_at?: string | null
          release_type?: string
          summary?: string
          title?: string
          version?: string
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
      backtest_parlay_results: {
        Row: {
          all_legs_hit: boolean | null
          avg_edge_value: number | null
          conflicts_detected: number | null
          created_at: string | null
          edge_blocked_count: number | null
          id: string
          leg_count: number | null
          legs: Json
          legs_hit: number | null
          legs_missed: number | null
          legs_pushed: number | null
          parlay_type: string
          run_id: string | null
          slate_date: string
          total_synergy_score: number | null
        }
        Insert: {
          all_legs_hit?: boolean | null
          avg_edge_value?: number | null
          conflicts_detected?: number | null
          created_at?: string | null
          edge_blocked_count?: number | null
          id?: string
          leg_count?: number | null
          legs?: Json
          legs_hit?: number | null
          legs_missed?: number | null
          legs_pushed?: number | null
          parlay_type: string
          run_id?: string | null
          slate_date: string
          total_synergy_score?: number | null
        }
        Update: {
          all_legs_hit?: boolean | null
          avg_edge_value?: number | null
          conflicts_detected?: number | null
          created_at?: string | null
          edge_blocked_count?: number | null
          id?: string
          leg_count?: number | null
          legs?: Json
          legs_hit?: number | null
          legs_missed?: number | null
          legs_pushed?: number | null
          parlay_type?: string
          run_id?: string | null
          slate_date?: string
          total_synergy_score?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "backtest_parlay_results_run_id_fkey"
            columns: ["run_id"]
            isOneToOne: false
            referencedRelation: "backtest_runs"
            referencedColumns: ["id"]
          },
        ]
      }
      backtest_runs: {
        Row: {
          avg_edge_value: number | null
          avg_synergy_score: number | null
          baseline_run_id: string | null
          builder_version: string
          completed_at: string | null
          config: Json
          created_at: string | null
          date_range_end: string
          date_range_start: string
          id: string
          improvement_vs_baseline: number | null
          leg_hit_rate: number | null
          legs_hit: number | null
          legs_missed: number | null
          legs_pushed: number | null
          parlay_win_rate: number | null
          picks_blocked_by_edge: number | null
          picks_blocked_by_synergy: number | null
          run_name: string | null
          total_legs: number | null
          total_parlays_built: number | null
          total_slates: number | null
        }
        Insert: {
          avg_edge_value?: number | null
          avg_synergy_score?: number | null
          baseline_run_id?: string | null
          builder_version: string
          completed_at?: string | null
          config?: Json
          created_at?: string | null
          date_range_end: string
          date_range_start: string
          id?: string
          improvement_vs_baseline?: number | null
          leg_hit_rate?: number | null
          legs_hit?: number | null
          legs_missed?: number | null
          legs_pushed?: number | null
          parlay_win_rate?: number | null
          picks_blocked_by_edge?: number | null
          picks_blocked_by_synergy?: number | null
          run_name?: string | null
          total_legs?: number | null
          total_parlays_built?: number | null
          total_slates?: number | null
        }
        Update: {
          avg_edge_value?: number | null
          avg_synergy_score?: number | null
          baseline_run_id?: string | null
          builder_version?: string
          completed_at?: string | null
          config?: Json
          created_at?: string | null
          date_range_end?: string
          date_range_start?: string
          id?: string
          improvement_vs_baseline?: number | null
          leg_hit_rate?: number | null
          legs_hit?: number | null
          legs_missed?: number | null
          legs_pushed?: number | null
          parlay_win_rate?: number | null
          picks_blocked_by_edge?: number | null
          picks_blocked_by_synergy?: number | null
          run_name?: string | null
          total_legs?: number | null
          total_parlays_built?: number | null
          total_slates?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "backtest_runs_baseline_run_id_fkey"
            columns: ["baseline_run_id"]
            isOneToOne: false
            referencedRelation: "backtest_runs"
            referencedColumns: ["id"]
          },
        ]
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
          is_active: boolean | null
          jersey_number: string | null
          last_updated: string | null
          normalized_name: string | null
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
          is_active?: boolean | null
          jersey_number?: string | null
          last_updated?: string | null
          normalized_name?: string | null
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
          is_active?: boolean | null
          jersey_number?: string | null
          last_updated?: string | null
          normalized_name?: string | null
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
      book_snapshot: {
        Row: {
          captured_at: string
          consensus_line: number
          id: string
          market_key: string
          sample_size: number | null
        }
        Insert: {
          captured_at?: string
          consensus_line: number
          id?: string
          market_key: string
          sample_size?: number | null
        }
        Update: {
          captured_at?: string
          consensus_line?: number
          id?: string
          market_key?: string
          sample_size?: number | null
        }
        Relationships: []
      }
      bot_activation_status: {
        Row: {
          activated_at: string | null
          check_date: string
          consecutive_profitable_days: number | null
          created_at: string | null
          daily_profit_loss: number | null
          id: string
          is_profitable_day: boolean | null
          is_real_mode_ready: boolean | null
          parlays_generated: number | null
          parlays_lost: number | null
          parlays_won: number | null
          real_bankroll: number | null
          simulated_bankroll: number | null
        }
        Insert: {
          activated_at?: string | null
          check_date?: string
          consecutive_profitable_days?: number | null
          created_at?: string | null
          daily_profit_loss?: number | null
          id?: string
          is_profitable_day?: boolean | null
          is_real_mode_ready?: boolean | null
          parlays_generated?: number | null
          parlays_lost?: number | null
          parlays_won?: number | null
          real_bankroll?: number | null
          simulated_bankroll?: number | null
        }
        Update: {
          activated_at?: string | null
          check_date?: string
          consecutive_profitable_days?: number | null
          created_at?: string | null
          daily_profit_loss?: number | null
          id?: string
          is_profitable_day?: boolean | null
          is_real_mode_ready?: boolean | null
          parlays_generated?: number | null
          parlays_lost?: number | null
          parlays_won?: number | null
          real_bankroll?: number | null
          simulated_bankroll?: number | null
        }
        Relationships: []
      }
      bot_activity_log: {
        Row: {
          created_at: string | null
          event_type: string
          id: string
          message: string
          metadata: Json | null
          severity: string | null
        }
        Insert: {
          created_at?: string | null
          event_type: string
          id?: string
          message: string
          metadata?: Json | null
          severity?: string | null
        }
        Update: {
          created_at?: string | null
          event_type?: string
          id?: string
          message?: string
          metadata?: Json | null
          severity?: string | null
        }
        Relationships: []
      }
      bot_adaptation_state: {
        Row: {
          adaptation_date: string
          adaptation_score: number | null
          correlation_matrix: Json | null
          created_at: string
          current_regime: string
          gate_overrides: Json | null
          id: string
          modules_run: Json | null
          regime_confidence: number | null
          regime_weights: Json | null
          tier_recommendations: Json | null
        }
        Insert: {
          adaptation_date: string
          adaptation_score?: number | null
          correlation_matrix?: Json | null
          created_at?: string
          current_regime?: string
          gate_overrides?: Json | null
          id?: string
          modules_run?: Json | null
          regime_confidence?: number | null
          regime_weights?: Json | null
          tier_recommendations?: Json | null
        }
        Update: {
          adaptation_date?: string
          adaptation_score?: number | null
          correlation_matrix?: Json | null
          created_at?: string
          current_regime?: string
          gate_overrides?: Json | null
          id?: string
          modules_run?: Json | null
          regime_confidence?: number | null
          regime_weights?: Json | null
          tier_recommendations?: Json | null
        }
        Relationships: []
      }
      bot_category_weights: {
        Row: {
          bayesian_hit_rate: number | null
          best_streak: number | null
          block_reason: string | null
          category: string
          created_at: string | null
          current_hit_rate: number | null
          current_streak: number | null
          id: string
          is_blocked: boolean | null
          last_calibrated_at: string | null
          recency_hit_rate: number | null
          regime_multiplier: number | null
          side: string
          sport: string | null
          total_hits: number | null
          total_picks: number | null
          updated_at: string | null
          weight: number | null
          worst_streak: number | null
        }
        Insert: {
          bayesian_hit_rate?: number | null
          best_streak?: number | null
          block_reason?: string | null
          category: string
          created_at?: string | null
          current_hit_rate?: number | null
          current_streak?: number | null
          id?: string
          is_blocked?: boolean | null
          last_calibrated_at?: string | null
          recency_hit_rate?: number | null
          regime_multiplier?: number | null
          side?: string
          sport?: string | null
          total_hits?: number | null
          total_picks?: number | null
          updated_at?: string | null
          weight?: number | null
          worst_streak?: number | null
        }
        Update: {
          bayesian_hit_rate?: number | null
          best_streak?: number | null
          block_reason?: string | null
          category?: string
          created_at?: string | null
          current_hit_rate?: number | null
          current_streak?: number | null
          id?: string
          is_blocked?: boolean | null
          last_calibrated_at?: string | null
          recency_hit_rate?: number | null
          regime_multiplier?: number | null
          side?: string
          sport?: string | null
          total_hits?: number | null
          total_picks?: number | null
          updated_at?: string | null
          weight?: number | null
          worst_streak?: number | null
        }
        Relationships: []
      }
      bot_conversations: {
        Row: {
          content: string
          created_at: string | null
          id: string
          role: string
          telegram_chat_id: string
        }
        Insert: {
          content: string
          created_at?: string | null
          id?: string
          role: string
          telegram_chat_id: string
        }
        Update: {
          content?: string
          created_at?: string | null
          id?: string
          role?: string
          telegram_chat_id?: string
        }
        Relationships: []
      }
      bot_daily_parlays: {
        Row: {
          category_weights_snapshot: Json | null
          combined_probability: number
          created_at: string
          expected_odds: number
          id: string
          is_simulated: boolean | null
          leg_count: number
          legs: Json
          legs_hit: number | null
          legs_missed: number | null
          legs_voided: number | null
          lesson_learned: string | null
          outcome: string | null
          parlay_date: string
          profit_loss: number | null
          selection_rationale: string | null
          settled_at: string | null
          simulated_edge: number | null
          simulated_payout: number | null
          simulated_sharpe: number | null
          simulated_stake: number | null
          simulated_win_rate: number | null
          strategy_name: string
          strategy_version: number | null
          tier: string | null
        }
        Insert: {
          category_weights_snapshot?: Json | null
          combined_probability?: number
          created_at?: string
          expected_odds?: number
          id?: string
          is_simulated?: boolean | null
          leg_count?: number
          legs?: Json
          legs_hit?: number | null
          legs_missed?: number | null
          legs_voided?: number | null
          lesson_learned?: string | null
          outcome?: string | null
          parlay_date?: string
          profit_loss?: number | null
          selection_rationale?: string | null
          settled_at?: string | null
          simulated_edge?: number | null
          simulated_payout?: number | null
          simulated_sharpe?: number | null
          simulated_stake?: number | null
          simulated_win_rate?: number | null
          strategy_name: string
          strategy_version?: number | null
          tier?: string | null
        }
        Update: {
          category_weights_snapshot?: Json | null
          combined_probability?: number
          created_at?: string
          expected_odds?: number
          id?: string
          is_simulated?: boolean | null
          leg_count?: number
          legs?: Json
          legs_hit?: number | null
          legs_missed?: number | null
          legs_voided?: number | null
          lesson_learned?: string | null
          outcome?: string | null
          parlay_date?: string
          profit_loss?: number | null
          selection_rationale?: string | null
          settled_at?: string | null
          simulated_edge?: number | null
          simulated_payout?: number | null
          simulated_sharpe?: number | null
          simulated_stake?: number | null
          simulated_win_rate?: number | null
          strategy_name?: string
          strategy_version?: number | null
          tier?: string | null
        }
        Relationships: []
      }
      bot_diagnostic_runs: {
        Row: {
          checks_failed: number
          checks_passed: number
          checks_warned: number
          created_at: string
          id: string
          improvement_metrics: Json
          overall_status: string
          results: Json
          run_date: string
        }
        Insert: {
          checks_failed?: number
          checks_passed?: number
          checks_warned?: number
          created_at?: string
          id?: string
          improvement_metrics?: Json
          overall_status?: string
          results?: Json
          run_date?: string
        }
        Update: {
          checks_failed?: number
          checks_passed?: number
          checks_warned?: number
          created_at?: string
          id?: string
          improvement_metrics?: Json
          overall_status?: string
          results?: Json
          run_date?: string
        }
        Relationships: []
      }
      bot_learning_metrics: {
        Row: {
          ci_lower: number | null
          ci_upper: number | null
          created_at: string | null
          days_to_convergence: number | null
          id: string
          losses: number | null
          sample_sufficiency: number | null
          snapshot_date: string
          tier: string
          total_generated: number | null
          total_settled: number | null
          win_rate: number | null
          wins: number | null
        }
        Insert: {
          ci_lower?: number | null
          ci_upper?: number | null
          created_at?: string | null
          days_to_convergence?: number | null
          id?: string
          losses?: number | null
          sample_sufficiency?: number | null
          snapshot_date: string
          tier?: string
          total_generated?: number | null
          total_settled?: number | null
          win_rate?: number | null
          wins?: number | null
        }
        Update: {
          ci_lower?: number | null
          ci_upper?: number | null
          created_at?: string | null
          days_to_convergence?: number | null
          id?: string
          losses?: number | null
          sample_sufficiency?: number | null
          snapshot_date?: string
          tier?: string
          total_generated?: number | null
          total_settled?: number | null
          win_rate?: number | null
          wins?: number | null
        }
        Relationships: []
      }
      bot_notification_settings: {
        Row: {
          created_at: string | null
          id: string
          notify_activation_ready: boolean | null
          notify_parlays_generated: boolean | null
          notify_settlement: boolean | null
          notify_strategy_updates: boolean | null
          notify_weight_changes: boolean | null
          quiet_end_hour: number | null
          quiet_start_hour: number | null
          telegram_chat_id: string | null
          telegram_enabled: boolean | null
          updated_at: string | null
          user_id: string | null
        }
        Insert: {
          created_at?: string | null
          id?: string
          notify_activation_ready?: boolean | null
          notify_parlays_generated?: boolean | null
          notify_settlement?: boolean | null
          notify_strategy_updates?: boolean | null
          notify_weight_changes?: boolean | null
          quiet_end_hour?: number | null
          quiet_start_hour?: number | null
          telegram_chat_id?: string | null
          telegram_enabled?: boolean | null
          updated_at?: string | null
          user_id?: string | null
        }
        Update: {
          created_at?: string | null
          id?: string
          notify_activation_ready?: boolean | null
          notify_parlays_generated?: boolean | null
          notify_settlement?: boolean | null
          notify_strategy_updates?: boolean | null
          notify_weight_changes?: boolean | null
          quiet_end_hour?: number | null
          quiet_start_hour?: number | null
          telegram_chat_id?: string | null
          telegram_enabled?: boolean | null
          updated_at?: string | null
          user_id?: string | null
        }
        Relationships: []
      }
      bot_research_findings: {
        Row: {
          action_taken: string | null
          actionable: boolean | null
          category: string
          created_at: string
          id: string
          key_insights: Json | null
          relevance_score: number | null
          research_date: string
          sources: string[] | null
          summary: string
          title: string
          updated_at: string
        }
        Insert: {
          action_taken?: string | null
          actionable?: boolean | null
          category: string
          created_at?: string
          id?: string
          key_insights?: Json | null
          relevance_score?: number | null
          research_date?: string
          sources?: string[] | null
          summary: string
          title: string
          updated_at?: string
        }
        Update: {
          action_taken?: string | null
          actionable?: boolean | null
          category?: string
          created_at?: string
          id?: string
          key_insights?: Json | null
          relevance_score?: number | null
          research_date?: string
          sources?: string[] | null
          summary?: string
          title?: string
          updated_at?: string
        }
        Relationships: []
      }
      bot_stake_config: {
        Row: {
          bankroll_doubler_stake: number
          block_two_leg_parlays: boolean | null
          execution_stake: number
          exploration_stake: number
          id: string
          max_daily_parlays_execution: number | null
          max_daily_parlays_exploration: number | null
          max_daily_parlays_validation: number | null
          updated_at: string | null
          validation_stake: number
        }
        Insert: {
          bankroll_doubler_stake?: number
          block_two_leg_parlays?: boolean | null
          execution_stake?: number
          exploration_stake?: number
          id?: string
          max_daily_parlays_execution?: number | null
          max_daily_parlays_exploration?: number | null
          max_daily_parlays_validation?: number | null
          updated_at?: string | null
          validation_stake?: number
        }
        Update: {
          bankroll_doubler_stake?: number
          block_two_leg_parlays?: boolean | null
          execution_stake?: number
          exploration_stake?: number
          id?: string
          max_daily_parlays_execution?: number | null
          max_daily_parlays_exploration?: number | null
          max_daily_parlays_validation?: number | null
          updated_at?: string | null
          validation_stake?: number
        }
        Relationships: []
      }
      bot_strategies: {
        Row: {
          auto_generated: boolean | null
          created_at: string
          description: string | null
          id: string
          is_active: boolean | null
          parent_strategy: string | null
          retire_reason: string | null
          retired_at: string | null
          roi: number | null
          rules: Json
          strategy_name: string
          times_used: number | null
          times_won: number | null
          updated_at: string | null
          version: number | null
          win_rate: number | null
        }
        Insert: {
          auto_generated?: boolean | null
          created_at?: string
          description?: string | null
          id?: string
          is_active?: boolean | null
          parent_strategy?: string | null
          retire_reason?: string | null
          retired_at?: string | null
          roi?: number | null
          rules?: Json
          strategy_name: string
          times_used?: number | null
          times_won?: number | null
          updated_at?: string | null
          version?: number | null
          win_rate?: number | null
        }
        Update: {
          auto_generated?: boolean | null
          created_at?: string
          description?: string | null
          id?: string
          is_active?: boolean | null
          parent_strategy?: string | null
          retire_reason?: string | null
          retired_at?: string | null
          roi?: number | null
          rules?: Json
          strategy_name?: string
          times_used?: number | null
          times_won?: number | null
          updated_at?: string | null
          version?: number | null
          win_rate?: number | null
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
      category_sweet_spots: {
        Row: {
          actual_hit_rate: number | null
          actual_line: number | null
          actual_value: number | null
          analysis_date: string | null
          archetype: string | null
          bookmaker: string | null
          bounce_back_score: number | null
          category: string
          confidence_score: number | null
          created_at: string | null
          eligibility_type: string | null
          engine_version: string | null
          games_played: number | null
          h2h_avg_vs_opponent: number | null
          h2h_matchup_boost: number | null
          id: string
          is_active: boolean | null
          l10_avg: number | null
          l10_hit_rate: number | null
          l10_max: number | null
          l10_median: number | null
          l10_min: number | null
          l10_std_dev: number | null
          l5_three_pct: number | null
          line_difference: number | null
          matchup_adjustment: number | null
          outcome: string | null
          pace_adjustment: number | null
          player_name: string
          projected_value: number | null
          projection_source: string | null
          prop_type: string
          quality_tier: string | null
          recommendation: string | null
          recommended_line: number | null
          recommended_side: string | null
          risk_level: string | null
          season_avg: number | null
          settled_at: string | null
          shooting_efficiency_tier: string | null
          updated_at: string | null
          verified_source: string | null
        }
        Insert: {
          actual_hit_rate?: number | null
          actual_line?: number | null
          actual_value?: number | null
          analysis_date?: string | null
          archetype?: string | null
          bookmaker?: string | null
          bounce_back_score?: number | null
          category: string
          confidence_score?: number | null
          created_at?: string | null
          eligibility_type?: string | null
          engine_version?: string | null
          games_played?: number | null
          h2h_avg_vs_opponent?: number | null
          h2h_matchup_boost?: number | null
          id?: string
          is_active?: boolean | null
          l10_avg?: number | null
          l10_hit_rate?: number | null
          l10_max?: number | null
          l10_median?: number | null
          l10_min?: number | null
          l10_std_dev?: number | null
          l5_three_pct?: number | null
          line_difference?: number | null
          matchup_adjustment?: number | null
          outcome?: string | null
          pace_adjustment?: number | null
          player_name: string
          projected_value?: number | null
          projection_source?: string | null
          prop_type: string
          quality_tier?: string | null
          recommendation?: string | null
          recommended_line?: number | null
          recommended_side?: string | null
          risk_level?: string | null
          season_avg?: number | null
          settled_at?: string | null
          shooting_efficiency_tier?: string | null
          updated_at?: string | null
          verified_source?: string | null
        }
        Update: {
          actual_hit_rate?: number | null
          actual_line?: number | null
          actual_value?: number | null
          analysis_date?: string | null
          archetype?: string | null
          bookmaker?: string | null
          bounce_back_score?: number | null
          category?: string
          confidence_score?: number | null
          created_at?: string | null
          eligibility_type?: string | null
          engine_version?: string | null
          games_played?: number | null
          h2h_avg_vs_opponent?: number | null
          h2h_matchup_boost?: number | null
          id?: string
          is_active?: boolean | null
          l10_avg?: number | null
          l10_hit_rate?: number | null
          l10_max?: number | null
          l10_median?: number | null
          l10_min?: number | null
          l10_std_dev?: number | null
          l5_three_pct?: number | null
          line_difference?: number | null
          matchup_adjustment?: number | null
          outcome?: string | null
          pace_adjustment?: number | null
          player_name?: string
          projected_value?: number | null
          projection_source?: string | null
          prop_type?: string
          quality_tier?: string | null
          recommendation?: string | null
          recommended_line?: number | null
          recommended_side?: string | null
          risk_level?: string | null
          season_avg?: number | null
          settled_at?: string | null
          shooting_efficiency_tier?: string | null
          updated_at?: string | null
          verified_source?: string | null
        }
        Relationships: []
      }
      coach_game_tendencies: {
        Row: {
          coach_id: string | null
          created_at: string | null
          event_id: string | null
          game_date: string
          id: string
          lineup_experiments: number | null
          pace: number | null
          rotation_size: number | null
          situation: string
          star_minutes_pct: number | null
          total_possessions: number | null
        }
        Insert: {
          coach_id?: string | null
          created_at?: string | null
          event_id?: string | null
          game_date: string
          id?: string
          lineup_experiments?: number | null
          pace?: number | null
          rotation_size?: number | null
          situation: string
          star_minutes_pct?: number | null
          total_possessions?: number | null
        }
        Update: {
          coach_id?: string | null
          created_at?: string | null
          event_id?: string | null
          game_date?: string
          id?: string
          lineup_experiments?: number | null
          pace?: number | null
          rotation_size?: number | null
          situation?: string
          star_minutes_pct?: number | null
          total_possessions?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "coach_game_tendencies_coach_id_fkey"
            columns: ["coach_id"]
            isOneToOne: false
            referencedRelation: "coach_profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      coach_profiles: {
        Row: {
          b2b_rest_tendency: string | null
          blowout_minutes_reduction: number | null
          bullpen_usage: string | null
          coach_name: string
          created_at: string | null
          empty_net_tendency: string | null
          fourth_down_aggression: string | null
          fourth_quarter_pattern: string | null
          garbage_time_behavior: string | null
          goalie_pull_tendency: string | null
          id: string
          is_active: boolean | null
          line_matching: string | null
          lineup_consistency: string | null
          pace_preference: string | null
          pinch_hit_frequency: string | null
          platoon_tendency: string | null
          pp_aggression: string | null
          qb_usage_style: string | null
          red_zone_tendency: string | null
          rotation_depth: number | null
          run_pass_tendency: string | null
          sport: string
          star_usage_pct: number | null
          team_name: string
          tenure_end_date: string | null
          tenure_start_date: string
          updated_at: string | null
        }
        Insert: {
          b2b_rest_tendency?: string | null
          blowout_minutes_reduction?: number | null
          bullpen_usage?: string | null
          coach_name: string
          created_at?: string | null
          empty_net_tendency?: string | null
          fourth_down_aggression?: string | null
          fourth_quarter_pattern?: string | null
          garbage_time_behavior?: string | null
          goalie_pull_tendency?: string | null
          id?: string
          is_active?: boolean | null
          line_matching?: string | null
          lineup_consistency?: string | null
          pace_preference?: string | null
          pinch_hit_frequency?: string | null
          platoon_tendency?: string | null
          pp_aggression?: string | null
          qb_usage_style?: string | null
          red_zone_tendency?: string | null
          rotation_depth?: number | null
          run_pass_tendency?: string | null
          sport?: string
          star_usage_pct?: number | null
          team_name: string
          tenure_end_date?: string | null
          tenure_start_date: string
          updated_at?: string | null
        }
        Update: {
          b2b_rest_tendency?: string | null
          blowout_minutes_reduction?: number | null
          bullpen_usage?: string | null
          coach_name?: string
          created_at?: string | null
          empty_net_tendency?: string | null
          fourth_down_aggression?: string | null
          fourth_quarter_pattern?: string | null
          garbage_time_behavior?: string | null
          goalie_pull_tendency?: string | null
          id?: string
          is_active?: boolean | null
          line_matching?: string | null
          lineup_consistency?: string | null
          pace_preference?: string | null
          pinch_hit_frequency?: string | null
          platoon_tendency?: string | null
          pp_aggression?: string | null
          qb_usage_style?: string | null
          red_zone_tendency?: string | null
          rotation_depth?: number | null
          run_pass_tendency?: string | null
          sport?: string
          star_usage_pct?: number | null
          team_name?: string
          tenure_end_date?: string | null
          tenure_start_date?: string
          updated_at?: string | null
        }
        Relationships: []
      }
      coaching_accuracy_metrics: {
        Row: {
          avg_confidence: number | null
          calibration_factor: number | null
          coach_id: string | null
          coach_name: string
          correct_predictions: number | null
          created_at: string
          id: string
          prop_type: string
          roi_percentage: number | null
          situation: string
          team_name: string
          total_predictions: number | null
          updated_at: string
          win_rate: number | null
        }
        Insert: {
          avg_confidence?: number | null
          calibration_factor?: number | null
          coach_id?: string | null
          coach_name: string
          correct_predictions?: number | null
          created_at?: string
          id?: string
          prop_type?: string
          roi_percentage?: number | null
          situation?: string
          team_name: string
          total_predictions?: number | null
          updated_at?: string
          win_rate?: number | null
        }
        Update: {
          avg_confidence?: number | null
          calibration_factor?: number | null
          coach_id?: string | null
          coach_name?: string
          correct_predictions?: number | null
          created_at?: string
          id?: string
          prop_type?: string
          roi_percentage?: number | null
          situation?: string
          team_name?: string
          total_predictions?: number | null
          updated_at?: string
          win_rate?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "coaching_accuracy_metrics_coach_id_fkey"
            columns: ["coach_id"]
            isOneToOne: false
            referencedRelation: "coach_profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      coaching_predictions: {
        Row: {
          actual_stat_value: number | null
          coach_id: string | null
          coach_name: string
          confidence: number
          created_at: string
          event_id: string
          game_date: string
          id: string
          outcome: string | null
          outcome_verified: boolean | null
          player_name: string | null
          predicted_direction: string | null
          prediction_accurate: boolean | null
          prop_adjustments: Json | null
          prop_line: number | null
          prop_type: string
          recommendation: string
          situation: string
          team_name: string
          updated_at: string
          verified_at: string | null
        }
        Insert: {
          actual_stat_value?: number | null
          coach_id?: string | null
          coach_name: string
          confidence?: number
          created_at?: string
          event_id: string
          game_date: string
          id?: string
          outcome?: string | null
          outcome_verified?: boolean | null
          player_name?: string | null
          predicted_direction?: string | null
          prediction_accurate?: boolean | null
          prop_adjustments?: Json | null
          prop_line?: number | null
          prop_type: string
          recommendation: string
          situation?: string
          team_name: string
          updated_at?: string
          verified_at?: string | null
        }
        Update: {
          actual_stat_value?: number | null
          coach_id?: string | null
          coach_name?: string
          confidence?: number
          created_at?: string
          event_id?: string
          game_date?: string
          id?: string
          outcome?: string | null
          outcome_verified?: boolean | null
          player_name?: string | null
          predicted_direction?: string | null
          prediction_accurate?: boolean | null
          prop_adjustments?: Json | null
          prop_line?: number | null
          prop_type?: string
          recommendation?: string
          situation?: string
          team_name?: string
          updated_at?: string
          verified_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "coaching_predictions_coach_id_fkey"
            columns: ["coach_id"]
            isOneToOne: false
            referencedRelation: "coach_profiles"
            referencedColumns: ["id"]
          },
        ]
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
      daily_elite_leg_outcomes: {
        Row: {
          actual_value: number | null
          created_at: string | null
          engine_signals: Json | null
          id: string
          leg_index: number
          line: number
          opponent_defense_rank: number | null
          opponent_defense_rating: number | null
          opponent_name: string | null
          outcome: string | null
          parlay_id: string | null
          player_name: string
          predicted_probability: number | null
          prop_type: string
          side: string
          sport: string | null
          verified_at: string | null
        }
        Insert: {
          actual_value?: number | null
          created_at?: string | null
          engine_signals?: Json | null
          id?: string
          leg_index: number
          line: number
          opponent_defense_rank?: number | null
          opponent_defense_rating?: number | null
          opponent_name?: string | null
          outcome?: string | null
          parlay_id?: string | null
          player_name: string
          predicted_probability?: number | null
          prop_type: string
          side: string
          sport?: string | null
          verified_at?: string | null
        }
        Update: {
          actual_value?: number | null
          created_at?: string | null
          engine_signals?: Json | null
          id?: string
          leg_index?: number
          line?: number
          opponent_defense_rank?: number | null
          opponent_defense_rating?: number | null
          opponent_name?: string | null
          outcome?: string | null
          parlay_id?: string | null
          player_name?: string
          predicted_probability?: number | null
          prop_type?: string
          side?: string
          sport?: string | null
          verified_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "daily_elite_leg_outcomes_parlay_id_fkey"
            columns: ["parlay_id"]
            isOneToOne: false
            referencedRelation: "daily_elite_parlays"
            referencedColumns: ["id"]
          },
        ]
      }
      daily_elite_parlays: {
        Row: {
          actual_result: Json | null
          combined_probability: number | null
          created_at: string
          engine_consensus: Json | null
          generation_round: number | null
          id: string
          leg_count: number | null
          leg_edges: Json | null
          leg_probabilities: Json | null
          legs: Json
          model_version: string | null
          outcome: string
          parlay_date: string
          rank: number | null
          selection_rationale: string | null
          settled_at: string | null
          slip_score: number | null
          source_engines: Json | null
          sports: Json | null
          total_edge: number | null
          total_odds: number | null
          variance_penalty: number | null
        }
        Insert: {
          actual_result?: Json | null
          combined_probability?: number | null
          created_at?: string
          engine_consensus?: Json | null
          generation_round?: number | null
          id?: string
          leg_count?: number | null
          leg_edges?: Json | null
          leg_probabilities?: Json | null
          legs?: Json
          model_version?: string | null
          outcome?: string
          parlay_date: string
          rank?: number | null
          selection_rationale?: string | null
          settled_at?: string | null
          slip_score?: number | null
          source_engines?: Json | null
          sports?: Json | null
          total_edge?: number | null
          total_odds?: number | null
          variance_penalty?: number | null
        }
        Update: {
          actual_result?: Json | null
          combined_probability?: number | null
          created_at?: string
          engine_consensus?: Json | null
          generation_round?: number | null
          id?: string
          leg_count?: number | null
          leg_edges?: Json | null
          leg_probabilities?: Json | null
          legs?: Json
          model_version?: string | null
          outcome?: string
          parlay_date?: string
          rank?: number | null
          selection_rationale?: string | null
          settled_at?: string | null
          slip_score?: number | null
          source_engines?: Json | null
          sports?: Json | null
          total_edge?: number | null
          total_odds?: number | null
          variance_penalty?: number | null
        }
        Relationships: []
      }
      device_limits: {
        Row: {
          created_at: string | null
          id: string
          is_active: boolean | null
          limit_type: string
          max_accounts: number
          updated_at: string | null
        }
        Insert: {
          created_at?: string | null
          id?: string
          is_active?: boolean | null
          limit_type: string
          max_accounts?: number
          updated_at?: string | null
        }
        Update: {
          created_at?: string | null
          id?: string
          is_active?: boolean | null
          limit_type?: string
          max_accounts?: number
          updated_at?: string | null
        }
        Relationships: []
      }
      device_registrations: {
        Row: {
          block_reason: string | null
          created_at: string | null
          device_fingerprint: string
          id: string
          ip_address: string | null
          is_blocked: boolean | null
          user_agent: string | null
          user_id: string
        }
        Insert: {
          block_reason?: string | null
          created_at?: string | null
          device_fingerprint: string
          id?: string
          ip_address?: string | null
          is_blocked?: boolean | null
          user_agent?: string | null
          user_id: string
        }
        Update: {
          block_reason?: string | null
          created_at?: string | null
          device_fingerprint?: string
          id?: string
          ip_address?: string | null
          is_blocked?: boolean | null
          user_agent?: string | null
          user_id?: string
        }
        Relationships: []
      }
      draft_suggestions: {
        Row: {
          created_at: string
          draft_id: string
          id: string
          note: string | null
          side: string
          status: string
          suggested_leg: Json
          user_id: string | null
        }
        Insert: {
          created_at?: string
          draft_id: string
          id?: string
          note?: string | null
          side: string
          status?: string
          suggested_leg: Json
          user_id?: string | null
        }
        Update: {
          created_at?: string
          draft_id?: string
          id?: string
          note?: string | null
          side?: string
          status?: string
          suggested_leg?: Json
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "draft_suggestions_draft_id_fkey"
            columns: ["draft_id"]
            isOneToOne: false
            referencedRelation: "parlay_drafts"
            referencedColumns: ["id"]
          },
        ]
      }
      elite_hitter_loss_patterns: {
        Row: {
          accuracy_rate: number | null
          created_at: string
          description: string | null
          example_losses: Json | null
          hit_count: number
          id: string
          is_active: boolean | null
          loss_count: number
          pattern_key: string
          pattern_type: string
          penalty_amount: number | null
          severity: string
          total_count: number
          updated_at: string
        }
        Insert: {
          accuracy_rate?: number | null
          created_at?: string
          description?: string | null
          example_losses?: Json | null
          hit_count?: number
          id?: string
          is_active?: boolean | null
          loss_count?: number
          pattern_key: string
          pattern_type: string
          penalty_amount?: number | null
          severity?: string
          total_count?: number
          updated_at?: string
        }
        Update: {
          accuracy_rate?: number | null
          created_at?: string
          description?: string | null
          example_losses?: Json | null
          hit_count?: number
          id?: string
          is_active?: boolean | null
          loss_count?: number
          pattern_key?: string
          pattern_type?: string
          penalty_amount?: number | null
          severity?: string
          total_count?: number
          updated_at?: string
        }
        Relationships: []
      }
      elite_hitter_matchup_patterns: {
        Row: {
          accuracy_rate: number | null
          avg_actual_value: number | null
          avg_line: number | null
          avg_miss_margin: number | null
          created_at: string | null
          defense_tier: string
          example_matchups: Json | null
          hit_count: number | null
          id: string
          is_active: boolean | null
          is_boost: boolean | null
          miss_count: number | null
          penalty_amount: number | null
          prop_type: string
          side: string
          sport: string
          total_count: number | null
          updated_at: string | null
        }
        Insert: {
          accuracy_rate?: number | null
          avg_actual_value?: number | null
          avg_line?: number | null
          avg_miss_margin?: number | null
          created_at?: string | null
          defense_tier: string
          example_matchups?: Json | null
          hit_count?: number | null
          id?: string
          is_active?: boolean | null
          is_boost?: boolean | null
          miss_count?: number | null
          penalty_amount?: number | null
          prop_type: string
          side: string
          sport?: string
          total_count?: number | null
          updated_at?: string | null
        }
        Update: {
          accuracy_rate?: number | null
          avg_actual_value?: number | null
          avg_line?: number | null
          avg_miss_margin?: number | null
          created_at?: string | null
          defense_tier?: string
          example_matchups?: Json | null
          hit_count?: number | null
          id?: string
          is_active?: boolean | null
          is_boost?: boolean | null
          miss_count?: number | null
          penalty_amount?: number | null
          prop_type?: string
          side?: string
          sport?: string
          total_count?: number | null
          updated_at?: string | null
        }
        Relationships: []
      }
      elite_parlay_accuracy_metrics: {
        Row: {
          accuracy_rate: number | null
          avg_predicted_probability: number | null
          calibration_factor: number | null
          correct_predictions: number | null
          created_at: string | null
          id: string
          metric_key: string
          metric_type: string
          sample_confidence: string | null
          total_predictions: number | null
          updated_at: string | null
        }
        Insert: {
          accuracy_rate?: number | null
          avg_predicted_probability?: number | null
          calibration_factor?: number | null
          correct_predictions?: number | null
          created_at?: string | null
          id?: string
          metric_key: string
          metric_type: string
          sample_confidence?: string | null
          total_predictions?: number | null
          updated_at?: string | null
        }
        Update: {
          accuracy_rate?: number | null
          avg_predicted_probability?: number | null
          calibration_factor?: number | null
          correct_predictions?: number | null
          created_at?: string | null
          id?: string
          metric_key?: string
          metric_type?: string
          sample_confidence?: string | null
          total_predictions?: number | null
          updated_at?: string | null
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
      email_verification_codes: {
        Row: {
          attempts: number | null
          code: string
          created_at: string | null
          email: string
          expires_at: string
          id: string
          user_id: string
          verified: boolean | null
        }
        Insert: {
          attempts?: number | null
          code: string
          created_at?: string | null
          email: string
          expires_at: string
          id?: string
          user_id: string
          verified?: boolean | null
        }
        Update: {
          attempts?: number | null
          code?: string
          created_at?: string | null
          email?: string
          expires_at?: string
          id?: string
          user_id?: string
          verified?: boolean | null
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
      engine_status: {
        Row: {
          accuracy_rate: number | null
          created_at: string | null
          engine_name: string
          id: string
          is_active: boolean | null
          last_evaluated_at: string | null
          retirement_reason: string | null
          roi_percentage: number | null
          sample_size: number | null
          updated_at: string | null
        }
        Insert: {
          accuracy_rate?: number | null
          created_at?: string | null
          engine_name: string
          id?: string
          is_active?: boolean | null
          last_evaluated_at?: string | null
          retirement_reason?: string | null
          roi_percentage?: number | null
          sample_size?: number | null
          updated_at?: string | null
        }
        Update: {
          accuracy_rate?: number | null
          created_at?: string | null
          engine_name?: string
          id?: string
          is_active?: boolean | null
          last_evaluated_at?: string | null
          retirement_reason?: string | null
          roi_percentage?: number | null
          sample_size?: number | null
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
      fatigue_training_data: {
        Row: {
          actual_spread: number | null
          actual_total: number | null
          archived_at: string
          away_fatigue_factors: Json | null
          away_fatigue_score: number
          away_team: string
          created_at: string
          event_id: string
          fatigue_differential: number
          game_date: string
          game_result: string | null
          home_fatigue_factors: Json | null
          home_fatigue_score: number
          home_team: string
          id: string
          recommended_angle: string | null
          recommended_side: string
          recommended_side_won: boolean | null
          sport: string
        }
        Insert: {
          actual_spread?: number | null
          actual_total?: number | null
          archived_at?: string
          away_fatigue_factors?: Json | null
          away_fatigue_score: number
          away_team: string
          created_at?: string
          event_id: string
          fatigue_differential: number
          game_date: string
          game_result?: string | null
          home_fatigue_factors?: Json | null
          home_fatigue_score: number
          home_team: string
          id?: string
          recommended_angle?: string | null
          recommended_side: string
          recommended_side_won?: boolean | null
          sport?: string
        }
        Update: {
          actual_spread?: number | null
          actual_total?: number | null
          archived_at?: string
          away_fatigue_factors?: Json | null
          away_fatigue_score?: number
          away_team?: string
          created_at?: string
          event_id?: string
          fatigue_differential?: number
          game_date?: string
          game_result?: string | null
          home_fatigue_factors?: Json | null
          home_fatigue_score?: number
          home_team?: string
          id?: string
          recommended_angle?: string | null
          recommended_side?: string
          recommended_side_won?: boolean | null
          sport?: string
        }
        Relationships: []
      }
      first_scorer_props: {
        Row: {
          actual_first_scorer: string | null
          ai_probability: number | null
          analysis_factors: Json | null
          away_team: string | null
          confidence_score: number | null
          created_at: string | null
          edge: number | null
          expires_at: string | null
          game_id: string
          game_time: string | null
          home_team: string | null
          id: string
          implied_probability: number | null
          is_active: boolean | null
          odds: number | null
          outcome: string | null
          prop_type: string
          recommendation: string | null
          selection: string
          sport: string
          verified_at: string | null
        }
        Insert: {
          actual_first_scorer?: string | null
          ai_probability?: number | null
          analysis_factors?: Json | null
          away_team?: string | null
          confidence_score?: number | null
          created_at?: string | null
          edge?: number | null
          expires_at?: string | null
          game_id: string
          game_time?: string | null
          home_team?: string | null
          id?: string
          implied_probability?: number | null
          is_active?: boolean | null
          odds?: number | null
          outcome?: string | null
          prop_type: string
          recommendation?: string | null
          selection: string
          sport: string
          verified_at?: string | null
        }
        Update: {
          actual_first_scorer?: string | null
          ai_probability?: number | null
          analysis_factors?: Json | null
          away_team?: string | null
          confidence_score?: number | null
          created_at?: string | null
          edge?: number | null
          expires_at?: string | null
          game_id?: string
          game_time?: string | null
          home_team?: string | null
          id?: string
          implied_probability?: number | null
          is_active?: boolean | null
          odds?: number | null
          outcome?: string | null
          prop_type?: string
          recommendation?: string | null
          selection?: string
          sport?: string
          verified_at?: string | null
        }
        Relationships: []
      }
      game_bets: {
        Row: {
          away_odds: number | null
          away_team: string
          bet_type: string
          bookmaker: string
          commence_time: string
          composite_score: number | null
          created_at: string | null
          game_id: string
          home_odds: number | null
          home_team: string
          id: string
          is_active: boolean | null
          line: number | null
          outcome: string | null
          over_odds: number | null
          recommended_side: string | null
          score_breakdown: Json | null
          settled_at: string | null
          sharp_score: number | null
          signal_sources: Json | null
          sport: string
          under_odds: number | null
          updated_at: string | null
        }
        Insert: {
          away_odds?: number | null
          away_team: string
          bet_type: string
          bookmaker: string
          commence_time: string
          composite_score?: number | null
          created_at?: string | null
          game_id: string
          home_odds?: number | null
          home_team: string
          id?: string
          is_active?: boolean | null
          line?: number | null
          outcome?: string | null
          over_odds?: number | null
          recommended_side?: string | null
          score_breakdown?: Json | null
          settled_at?: string | null
          sharp_score?: number | null
          signal_sources?: Json | null
          sport: string
          under_odds?: number | null
          updated_at?: string | null
        }
        Update: {
          away_odds?: number | null
          away_team?: string
          bet_type?: string
          bookmaker?: string
          commence_time?: string
          composite_score?: number | null
          created_at?: string | null
          game_id?: string
          home_odds?: number | null
          home_team?: string
          id?: string
          is_active?: boolean | null
          line?: number | null
          outcome?: string | null
          over_odds?: number | null
          recommended_side?: string | null
          score_breakdown?: Json | null
          settled_at?: string | null
          sharp_score?: number | null
          signal_sources?: Json | null
          sport?: string
          under_odds?: number | null
          updated_at?: string | null
        }
        Relationships: []
      }
      game_environment: {
        Row: {
          away_implied_total: number | null
          away_team: string
          away_team_abbrev: string | null
          blowout_probability: number | null
          commence_time: string | null
          created_at: string | null
          game_date: string
          game_id: string
          game_script: string | null
          game_script_confidence: number | null
          garbage_time_risk: number | null
          grind_factor: number | null
          home_implied_total: number | null
          home_team: string
          home_team_abbrev: string | null
          id: string
          moneyline_away: number | null
          moneyline_home: number | null
          pace_rating: string | null
          shootout_factor: number | null
          updated_at: string | null
          vegas_spread: number | null
          vegas_total: number | null
        }
        Insert: {
          away_implied_total?: number | null
          away_team: string
          away_team_abbrev?: string | null
          blowout_probability?: number | null
          commence_time?: string | null
          created_at?: string | null
          game_date: string
          game_id: string
          game_script?: string | null
          game_script_confidence?: number | null
          garbage_time_risk?: number | null
          grind_factor?: number | null
          home_implied_total?: number | null
          home_team: string
          home_team_abbrev?: string | null
          id?: string
          moneyline_away?: number | null
          moneyline_home?: number | null
          pace_rating?: string | null
          shootout_factor?: number | null
          updated_at?: string | null
          vegas_spread?: number | null
          vegas_total?: number | null
        }
        Update: {
          away_implied_total?: number | null
          away_team?: string
          away_team_abbrev?: string | null
          blowout_probability?: number | null
          commence_time?: string | null
          created_at?: string | null
          game_date?: string
          game_id?: string
          game_script?: string | null
          game_script_confidence?: number | null
          garbage_time_risk?: number | null
          grind_factor?: number | null
          home_implied_total?: number | null
          home_team?: string
          home_team_abbrev?: string | null
          id?: string
          moneyline_away?: number | null
          moneyline_home?: number | null
          pace_rating?: string | null
          shootout_factor?: number | null
          updated_at?: string | null
          vegas_spread?: number | null
          vegas_total?: number | null
        }
        Relationships: []
      }
      game_environment_validation: {
        Row: {
          avg_minutes: number | null
          confidence_adjustment: number | null
          created_at: string
          defense_check: boolean | null
          expected_game_pace: number | null
          game_date: string
          game_script_check: boolean | null
          id: string
          implied_total_check: boolean | null
          is_starter: boolean | null
          line: number
          opp_defense_rank: number | null
          opp_position_defense_rank: number | null
          opp_stat_allowed: number | null
          opponent_implied_total: number | null
          opponent_pace: number | null
          opponent_team: string | null
          pace_check: boolean | null
          pace_class: string | null
          player_archetype: string | null
          player_name: string
          player_role: string | null
          prop_type: string
          prop_type_check: boolean | null
          rejection_reason: string | null
          role_check: boolean | null
          side: string
          team_implied_total: number | null
          team_name: string | null
          team_pace: number | null
          updated_at: string
          validation_status: string
          vegas_spread: number | null
          vegas_total: number | null
        }
        Insert: {
          avg_minutes?: number | null
          confidence_adjustment?: number | null
          created_at?: string
          defense_check?: boolean | null
          expected_game_pace?: number | null
          game_date?: string
          game_script_check?: boolean | null
          id?: string
          implied_total_check?: boolean | null
          is_starter?: boolean | null
          line: number
          opp_defense_rank?: number | null
          opp_position_defense_rank?: number | null
          opp_stat_allowed?: number | null
          opponent_implied_total?: number | null
          opponent_pace?: number | null
          opponent_team?: string | null
          pace_check?: boolean | null
          pace_class?: string | null
          player_archetype?: string | null
          player_name: string
          player_role?: string | null
          prop_type: string
          prop_type_check?: boolean | null
          rejection_reason?: string | null
          role_check?: boolean | null
          side: string
          team_implied_total?: number | null
          team_name?: string | null
          team_pace?: number | null
          updated_at?: string
          validation_status?: string
          vegas_spread?: number | null
          vegas_total?: number | null
        }
        Update: {
          avg_minutes?: number | null
          confidence_adjustment?: number | null
          created_at?: string
          defense_check?: boolean | null
          expected_game_pace?: number | null
          game_date?: string
          game_script_check?: boolean | null
          id?: string
          implied_total_check?: boolean | null
          is_starter?: boolean | null
          line?: number
          opp_defense_rank?: number | null
          opp_position_defense_rank?: number | null
          opp_stat_allowed?: number | null
          opponent_implied_total?: number | null
          opponent_pace?: number | null
          opponent_team?: string | null
          pace_check?: boolean | null
          pace_class?: string | null
          player_archetype?: string | null
          player_name?: string
          player_role?: string | null
          prop_type?: string
          prop_type_check?: boolean | null
          rejection_reason?: string | null
          role_check?: boolean | null
          side?: string
          team_implied_total?: number | null
          team_name?: string | null
          team_pace?: number | null
          updated_at?: string
          validation_status?: string
          vegas_spread?: number | null
          vegas_total?: number | null
        }
        Relationships: []
      }
      game_news_feed: {
        Row: {
          affected_props: Json | null
          away_team: string
          commence_time: string
          created_at: string | null
          event_id: string
          expires_at: string | null
          headline: string
          home_team: string
          id: string
          impact_level: string | null
          market_impact: boolean | null
          news_type: string
          player_name: string | null
          source_id: string | null
          source_table: string | null
          sport: string
        }
        Insert: {
          affected_props?: Json | null
          away_team: string
          commence_time: string
          created_at?: string | null
          event_id: string
          expires_at?: string | null
          headline: string
          home_team: string
          id?: string
          impact_level?: string | null
          market_impact?: boolean | null
          news_type: string
          player_name?: string | null
          source_id?: string | null
          source_table?: string | null
          sport: string
        }
        Update: {
          affected_props?: Json | null
          away_team?: string
          commence_time?: string
          created_at?: string | null
          event_id?: string
          expires_at?: string | null
          headline?: string
          home_team?: string
          id?: string
          impact_level?: string | null
          market_impact?: boolean | null
          news_type?: string
          player_name?: string | null
          source_id?: string | null
          source_table?: string | null
          sport?: string
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
      god_mode_weights: {
        Row: {
          created_at: string | null
          description: string | null
          id: string
          is_active: boolean | null
          sport: string
          updated_at: string | null
          weight_key: string
          weight_value: number
        }
        Insert: {
          created_at?: string | null
          description?: string | null
          id?: string
          is_active?: boolean | null
          sport: string
          updated_at?: string | null
          weight_key: string
          weight_value?: number
        }
        Update: {
          created_at?: string | null
          description?: string | null
          id?: string
          is_active?: boolean | null
          sport?: string
          updated_at?: string | null
          weight_key?: string
          weight_value?: number
        }
        Relationships: []
      }
      heat_do_not_bet: {
        Row: {
          created_at: string | null
          dnb_date: string
          event_id: string | null
          final_score: number | null
          id: string
          line: number | null
          market_type: string
          player_name: string
          side: string | null
          sport: string | null
          trap_reason: string | null
        }
        Insert: {
          created_at?: string | null
          dnb_date: string
          event_id?: string | null
          final_score?: number | null
          id?: string
          line?: number | null
          market_type: string
          player_name: string
          side?: string | null
          sport?: string | null
          trap_reason?: string | null
        }
        Update: {
          created_at?: string | null
          dnb_date?: string
          event_id?: string | null
          final_score?: number | null
          id?: string
          line?: number | null
          market_type?: string
          player_name?: string
          side?: string | null
          sport?: string | null
          trap_reason?: string | null
        }
        Relationships: []
      }
      heat_parlays: {
        Row: {
          archetype_diversity: number | null
          combined_probability: number | null
          created_at: string | null
          engine_version: string | null
          estimated_odds: number | null
          id: string
          leg_1: Json
          leg_2: Json
          no_bet_flags: string[] | null
          outcome: string | null
          parlay_date: string
          parlay_type: string
          risk_level: string | null
          settled_at: string | null
          summary: string | null
          team_diversity: number | null
          verified_legs_count: number | null
        }
        Insert: {
          archetype_diversity?: number | null
          combined_probability?: number | null
          created_at?: string | null
          engine_version?: string | null
          estimated_odds?: number | null
          id?: string
          leg_1: Json
          leg_2: Json
          no_bet_flags?: string[] | null
          outcome?: string | null
          parlay_date: string
          parlay_type: string
          risk_level?: string | null
          settled_at?: string | null
          summary?: string | null
          team_diversity?: number | null
          verified_legs_count?: number | null
        }
        Update: {
          archetype_diversity?: number | null
          combined_probability?: number | null
          created_at?: string | null
          engine_version?: string | null
          estimated_odds?: number | null
          id?: string
          leg_1?: Json
          leg_2?: Json
          no_bet_flags?: string[] | null
          outcome?: string | null
          parlay_date?: string
          parlay_type?: string
          risk_level?: string | null
          settled_at?: string | null
          summary?: string | null
          team_diversity?: number | null
          verified_legs_count?: number | null
        }
        Relationships: []
      }
      heat_prop_snapshots: {
        Row: {
          created_at: string | null
          id: string
          line: number
          price: number
          snapshot_time: string
          tracker_id: string | null
        }
        Insert: {
          created_at?: string | null
          id?: string
          line: number
          price: number
          snapshot_time: string
          tracker_id?: string | null
        }
        Update: {
          created_at?: string | null
          id?: string
          line?: number
          price?: number
          snapshot_time?: string
          tracker_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "heat_prop_snapshots_tracker_id_fkey"
            columns: ["tracker_id"]
            isOneToOne: false
            referencedRelation: "heat_prop_tracker"
            referencedColumns: ["id"]
          },
        ]
      }
      heat_prop_tracker: {
        Row: {
          away_team: string | null
          base_role_score: number | null
          book_name: string
          created_at: string | null
          event_id: string
          final_score: number | null
          home_team: string | null
          id: string
          is_eligible_core: boolean | null
          is_eligible_upside: boolean | null
          latest_line: number
          latest_price: number
          latest_time: string
          league: string | null
          line_delta: number | null
          market_signal_score: number | null
          market_type: string
          movement_15m: Json | null
          movement_60m: Json | null
          movement_6h: Json | null
          movement_since_open: Json | null
          opening_line: number
          opening_price: number
          opening_time: string
          passes_role_validation: boolean | null
          passes_stat_safety: boolean | null
          player_id: string | null
          player_name: string
          player_role_tag: string | null
          price_delta: number | null
          projected_minutes: number | null
          promo_flag: boolean | null
          public_pct_handle: number | null
          public_pct_tickets: number | null
          side: string
          signal_label: string | null
          sport: string
          start_time_utc: string
          update_count: number | null
          updated_at: string | null
        }
        Insert: {
          away_team?: string | null
          base_role_score?: number | null
          book_name: string
          created_at?: string | null
          event_id: string
          final_score?: number | null
          home_team?: string | null
          id?: string
          is_eligible_core?: boolean | null
          is_eligible_upside?: boolean | null
          latest_line: number
          latest_price: number
          latest_time: string
          league?: string | null
          line_delta?: number | null
          market_signal_score?: number | null
          market_type: string
          movement_15m?: Json | null
          movement_60m?: Json | null
          movement_6h?: Json | null
          movement_since_open?: Json | null
          opening_line: number
          opening_price: number
          opening_time: string
          passes_role_validation?: boolean | null
          passes_stat_safety?: boolean | null
          player_id?: string | null
          player_name: string
          player_role_tag?: string | null
          price_delta?: number | null
          projected_minutes?: number | null
          promo_flag?: boolean | null
          public_pct_handle?: number | null
          public_pct_tickets?: number | null
          side: string
          signal_label?: string | null
          sport: string
          start_time_utc: string
          update_count?: number | null
          updated_at?: string | null
        }
        Update: {
          away_team?: string | null
          base_role_score?: number | null
          book_name?: string
          created_at?: string | null
          event_id?: string
          final_score?: number | null
          home_team?: string | null
          id?: string
          is_eligible_core?: boolean | null
          is_eligible_upside?: boolean | null
          latest_line?: number
          latest_price?: number
          latest_time?: string
          league?: string | null
          line_delta?: number | null
          market_signal_score?: number | null
          market_type?: string
          movement_15m?: Json | null
          movement_60m?: Json | null
          movement_6h?: Json | null
          movement_since_open?: Json | null
          opening_line?: number
          opening_price?: number
          opening_time?: string
          passes_role_validation?: boolean | null
          passes_stat_safety?: boolean | null
          player_id?: string | null
          player_name?: string
          player_role_tag?: string | null
          price_delta?: number | null
          projected_minutes?: number | null
          promo_flag?: boolean | null
          public_pct_handle?: number | null
          public_pct_tickets?: number | null
          side?: string
          signal_label?: string | null
          sport?: string
          start_time_utc?: string
          update_count?: number | null
          updated_at?: string | null
        }
        Relationships: []
      }
      heat_watchlist: {
        Row: {
          approaching_entry: boolean | null
          created_at: string | null
          event_id: string | null
          final_score: number | null
          id: string
          line: number | null
          market_type: string
          player_name: string
          reason: string | null
          side: string | null
          signal_label: string | null
          sport: string | null
          watchlist_date: string
        }
        Insert: {
          approaching_entry?: boolean | null
          created_at?: string | null
          event_id?: string | null
          final_score?: number | null
          id?: string
          line?: number | null
          market_type: string
          player_name: string
          reason?: string | null
          side?: string | null
          signal_label?: string | null
          sport?: string | null
          watchlist_date: string
        }
        Update: {
          approaching_entry?: boolean | null
          created_at?: string | null
          event_id?: string | null
          final_score?: number | null
          id?: string
          line?: number | null
          market_type?: string
          player_name?: string
          reason?: string | null
          side?: string | null
          signal_label?: string | null
          sport?: string | null
          watchlist_date?: string
        }
        Relationships: []
      }
      hedge_parlays: {
        Row: {
          correlation_score: number | null
          created_at: string | null
          h2h_confidence: number | null
          hedge_score: number | null
          id: string
          legs: Json
          outcome: string | null
          parlay_date: string
          parlay_type: string
          settled_at: string | null
          total_odds: number | null
        }
        Insert: {
          correlation_score?: number | null
          created_at?: string | null
          h2h_confidence?: number | null
          hedge_score?: number | null
          id?: string
          legs?: Json
          outcome?: string | null
          parlay_date: string
          parlay_type: string
          settled_at?: string | null
          total_odds?: number | null
        }
        Update: {
          correlation_score?: number | null
          created_at?: string | null
          h2h_confidence?: number | null
          hedge_score?: number | null
          id?: string
          legs?: Json
          outcome?: string | null
          parlay_date?: string
          parlay_type?: string
          settled_at?: string | null
          total_odds?: number | null
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
      injury_reports: {
        Row: {
          created_at: string | null
          event_id: string | null
          game_date: string | null
          id: string
          impact_score: number | null
          injury_detail: string | null
          injury_type: string | null
          is_star_player: boolean | null
          player_name: string
          position: string | null
          source: string | null
          sport: string
          status: string
          team_name: string
          updated_at: string | null
        }
        Insert: {
          created_at?: string | null
          event_id?: string | null
          game_date?: string | null
          id?: string
          impact_score?: number | null
          injury_detail?: string | null
          injury_type?: string | null
          is_star_player?: boolean | null
          player_name: string
          position?: string | null
          source?: string | null
          sport: string
          status: string
          team_name: string
          updated_at?: string | null
        }
        Update: {
          created_at?: string | null
          event_id?: string | null
          game_date?: string | null
          id?: string
          impact_score?: number | null
          injury_detail?: string | null
          injury_type?: string | null
          is_star_player?: boolean | null
          player_name?: string
          position?: string | null
          source?: string | null
          sport?: string
          status?: string
          team_name?: string
          updated_at?: string | null
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
          consensus_ratio: number | null
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
          movement_bucket: string | null
          movement_type: string
          movement_weight: number | null
          new_point: number | null
          new_price: number
          old_point: number | null
          old_price: number
          opening_point: number | null
          opening_price: number | null
          opening_side: string | null
          opposite_side_moved: boolean | null
          outcome_correct: boolean | null
          outcome_name: string
          outcome_verified: boolean | null
          player_name: string | null
          point_change: number | null
          preliminary_confidence: number | null
          price_change: number
          price_direction: string | null
          recommendation: string | null
          recommendation_reason: string | null
          sharp_edge_score: number | null
          sharp_indicator: string | null
          sharp_pressure: number | null
          sharp_probability: number | null
          sport: string
          sport_adjusted: boolean | null
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
          consensus_ratio?: number | null
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
          movement_bucket?: string | null
          movement_type?: string
          movement_weight?: number | null
          new_point?: number | null
          new_price: number
          old_point?: number | null
          old_price: number
          opening_point?: number | null
          opening_price?: number | null
          opening_side?: string | null
          opposite_side_moved?: boolean | null
          outcome_correct?: boolean | null
          outcome_name: string
          outcome_verified?: boolean | null
          player_name?: string | null
          point_change?: number | null
          preliminary_confidence?: number | null
          price_change: number
          price_direction?: string | null
          recommendation?: string | null
          recommendation_reason?: string | null
          sharp_edge_score?: number | null
          sharp_indicator?: string | null
          sharp_pressure?: number | null
          sharp_probability?: number | null
          sport: string
          sport_adjusted?: boolean | null
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
          consensus_ratio?: number | null
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
          movement_bucket?: string | null
          movement_type?: string
          movement_weight?: number | null
          new_point?: number | null
          new_price?: number
          old_point?: number | null
          old_price?: number
          opening_point?: number | null
          opening_price?: number | null
          opening_side?: string | null
          opposite_side_moved?: boolean | null
          outcome_correct?: boolean | null
          outcome_name?: string
          outcome_verified?: boolean | null
          player_name?: string | null
          point_change?: number | null
          preliminary_confidence?: number | null
          price_change?: number
          price_direction?: string | null
          recommendation?: string | null
          recommendation_reason?: string | null
          sharp_edge_score?: number | null
          sharp_indicator?: string | null
          sharp_pressure?: number | null
          sharp_probability?: number | null
          sport?: string
          sport_adjusted?: boolean | null
          time_weight?: number | null
          trap_pressure?: number | null
          trap_score?: number | null
          verified_at?: string | null
        }
        Relationships: []
      }
      lineup_alerts: {
        Row: {
          alert_type: string
          created_at: string | null
          details: string | null
          event_id: string | null
          game_date: string
          id: string
          impact_level: string | null
          injury_note: string | null
          normalized_name: string | null
          player_name: string
          source: string | null
          team: string
          updated_at: string | null
        }
        Insert: {
          alert_type: string
          created_at?: string | null
          details?: string | null
          event_id?: string | null
          game_date: string
          id?: string
          impact_level?: string | null
          injury_note?: string | null
          normalized_name?: string | null
          player_name: string
          source?: string | null
          team: string
          updated_at?: string | null
        }
        Update: {
          alert_type?: string
          created_at?: string | null
          details?: string | null
          event_id?: string | null
          game_date?: string
          id?: string
          impact_level?: string | null
          injury_note?: string | null
          normalized_name?: string | null
          player_name?: string
          source?: string | null
          team?: string
          updated_at?: string | null
        }
        Relationships: []
      }
      live_game_scores: {
        Row: {
          away_score: number | null
          away_team: string
          clock: string | null
          created_at: string | null
          event_id: string
          game_status: string | null
          home_score: number | null
          home_team: string
          id: string
          last_updated: string | null
          period: string | null
          player_stats: Json | null
          quarter_scores: Json | null
          sport: string
          start_time: string
        }
        Insert: {
          away_score?: number | null
          away_team: string
          clock?: string | null
          created_at?: string | null
          event_id: string
          game_status?: string | null
          home_score?: number | null
          home_team: string
          id?: string
          last_updated?: string | null
          period?: string | null
          player_stats?: Json | null
          quarter_scores?: Json | null
          sport: string
          start_time: string
        }
        Update: {
          away_score?: number | null
          away_team?: string
          clock?: string | null
          created_at?: string | null
          event_id?: string
          game_status?: string | null
          home_score?: number | null
          home_team?: string
          id?: string
          last_updated?: string | null
          period?: string | null
          player_stats?: Json | null
          quarter_scores?: Json | null
          sport?: string
          start_time?: string
        }
        Relationships: []
      }
      market_signal_weights: {
        Row: {
          created_at: string | null
          id: string
          last_accuracy: number | null
          sample_size: number | null
          updated_at: string | null
          weight_key: string
          weight_value: number | null
        }
        Insert: {
          created_at?: string | null
          id?: string
          last_accuracy?: number | null
          sample_size?: number | null
          updated_at?: string | null
          weight_key: string
          weight_value?: number | null
        }
        Update: {
          created_at?: string | null
          id?: string
          last_accuracy?: number | null
          sample_size?: number | null
          updated_at?: string | null
          weight_key?: string
          weight_value?: number | null
        }
        Relationships: []
      }
      market_signals: {
        Row: {
          confirming_books: number | null
          created_at: string | null
          current_point: number | null
          current_price: number | null
          current_ts: string | null
          event_id: string
          hours_to_game: number | null
          id: string
          juice_move_score: number | null
          line_move_score: number | null
          market_score: number | null
          market_type: string | null
          multi_book_consensus_score: number | null
          opening_point: number | null
          opening_price: number | null
          opening_ts: string | null
          outcome_correct: boolean | null
          outcome_name: string
          outcome_verified: boolean | null
          player_name: string | null
          public_fade_score: number | null
          rationale: string | null
          signal_label: string | null
          sport: string | null
          timing_sharpness_score: number | null
          updated_at: string | null
          verified_at: string | null
        }
        Insert: {
          confirming_books?: number | null
          created_at?: string | null
          current_point?: number | null
          current_price?: number | null
          current_ts?: string | null
          event_id: string
          hours_to_game?: number | null
          id?: string
          juice_move_score?: number | null
          line_move_score?: number | null
          market_score?: number | null
          market_type?: string | null
          multi_book_consensus_score?: number | null
          opening_point?: number | null
          opening_price?: number | null
          opening_ts?: string | null
          outcome_correct?: boolean | null
          outcome_name: string
          outcome_verified?: boolean | null
          player_name?: string | null
          public_fade_score?: number | null
          rationale?: string | null
          signal_label?: string | null
          sport?: string | null
          timing_sharpness_score?: number | null
          updated_at?: string | null
          verified_at?: string | null
        }
        Update: {
          confirming_books?: number | null
          created_at?: string | null
          current_point?: number | null
          current_price?: number | null
          current_ts?: string | null
          event_id?: string
          hours_to_game?: number | null
          id?: string
          juice_move_score?: number | null
          line_move_score?: number | null
          market_score?: number | null
          market_type?: string | null
          multi_book_consensus_score?: number | null
          opening_point?: number | null
          opening_price?: number | null
          opening_ts?: string | null
          outcome_correct?: boolean | null
          outcome_name?: string
          outcome_verified?: boolean | null
          player_name?: string | null
          public_fade_score?: number | null
          rationale?: string | null
          signal_label?: string | null
          sport?: string | null
          timing_sharpness_score?: number | null
          updated_at?: string | null
          verified_at?: string | null
        }
        Relationships: []
      }
      matchup_history: {
        Row: {
          avg_stat: number | null
          created_at: string | null
          games_played: number | null
          hit_rate_over: number | null
          hit_rate_under: number | null
          id: string
          last_game_date: string | null
          last_game_stat: number | null
          last_updated: string | null
          max_stat: number | null
          min_stat: number | null
          opponent: string
          player_name: string
          prop_type: string
        }
        Insert: {
          avg_stat?: number | null
          created_at?: string | null
          games_played?: number | null
          hit_rate_over?: number | null
          hit_rate_under?: number | null
          id?: string
          last_game_date?: string | null
          last_game_stat?: number | null
          last_updated?: string | null
          max_stat?: number | null
          min_stat?: number | null
          opponent: string
          player_name: string
          prop_type: string
        }
        Update: {
          avg_stat?: number | null
          created_at?: string | null
          games_played?: number | null
          hit_rate_over?: number | null
          hit_rate_under?: number | null
          id?: string
          last_game_date?: string | null
          last_game_stat?: number | null
          last_updated?: string | null
          max_stat?: number | null
          min_stat?: number | null
          opponent?: string
          player_name?: string
          prop_type?: string
        }
        Relationships: []
      }
      matchup_intelligence: {
        Row: {
          block_reason: string | null
          blowout_risk: number | null
          confidence_adjustment: number | null
          created_at: string | null
          game_date: string
          game_script: string | null
          game_script_confidence: number | null
          id: string
          implied_team_total: number | null
          is_blocked: boolean | null
          line: number
          matchup_score: number | null
          opponent_defensive_rank: number | null
          opponent_stat_allowed: number | null
          opponent_team: string
          player_name: string
          player_position: string | null
          position_defense_allowed: number | null
          position_defense_rank: number | null
          position_group: string | null
          prop_implications: Json | null
          prop_type: string
          risk_flags: string[] | null
          side: string
          updated_at: string | null
          vegas_spread: number | null
          vegas_total: number | null
        }
        Insert: {
          block_reason?: string | null
          blowout_risk?: number | null
          confidence_adjustment?: number | null
          created_at?: string | null
          game_date: string
          game_script?: string | null
          game_script_confidence?: number | null
          id?: string
          implied_team_total?: number | null
          is_blocked?: boolean | null
          line: number
          matchup_score?: number | null
          opponent_defensive_rank?: number | null
          opponent_stat_allowed?: number | null
          opponent_team: string
          player_name: string
          player_position?: string | null
          position_defense_allowed?: number | null
          position_defense_rank?: number | null
          position_group?: string | null
          prop_implications?: Json | null
          prop_type: string
          risk_flags?: string[] | null
          side: string
          updated_at?: string | null
          vegas_spread?: number | null
          vegas_total?: number | null
        }
        Update: {
          block_reason?: string | null
          blowout_risk?: number | null
          confidence_adjustment?: number | null
          created_at?: string | null
          game_date?: string
          game_script?: string | null
          game_script_confidence?: number | null
          id?: string
          implied_team_total?: number | null
          is_blocked?: boolean | null
          line?: number
          matchup_score?: number | null
          opponent_defensive_rank?: number | null
          opponent_stat_allowed?: number | null
          opponent_team?: string
          player_name?: string
          player_position?: string | null
          position_defense_allowed?: number | null
          position_defense_rank?: number | null
          position_group?: string | null
          prop_implications?: Json | null
          prop_type?: string
          risk_flags?: string[] | null
          side?: string
          updated_at?: string | null
          vegas_spread?: number | null
          vegas_total?: number | null
        }
        Relationships: []
      }
      median_edge_picks: {
        Row: {
          actual_value: number | null
          adjusted_median: number | null
          adjustments: Json | null
          alt_line_suggestion: number | null
          confidence_flag: string | null
          confidence_tier: string | null
          created_at: string | null
          defense_code: number | null
          defense_multiplier: number | null
          edge: number | null
          engine_version: string | null
          event_id: string | null
          expected_minutes: number | null
          game_date: string | null
          game_time: string | null
          hit_rate_over_10: number | null
          hit_rate_under_10: number | null
          id: string
          injury_context: string | null
          is_volatile: boolean | null
          m1_recent_form: number | null
          m2_matchup: number | null
          m3_minutes_weighted: number | null
          m4_usage: number | null
          m5_location: number | null
          median5: number | null
          odds_current: number | null
          odds_open: number | null
          opponent_team: string | null
          outcome: string | null
          player_name: string
          reason_summary: string | null
          recommendation: string | null
          sport: string | null
          sportsbook_line: number | null
          spread: number | null
          stat_type: string
          std_dev: number | null
          team_name: string | null
          true_median: number | null
          verified_at: string | null
          volatility: number | null
        }
        Insert: {
          actual_value?: number | null
          adjusted_median?: number | null
          adjustments?: Json | null
          alt_line_suggestion?: number | null
          confidence_flag?: string | null
          confidence_tier?: string | null
          created_at?: string | null
          defense_code?: number | null
          defense_multiplier?: number | null
          edge?: number | null
          engine_version?: string | null
          event_id?: string | null
          expected_minutes?: number | null
          game_date?: string | null
          game_time?: string | null
          hit_rate_over_10?: number | null
          hit_rate_under_10?: number | null
          id?: string
          injury_context?: string | null
          is_volatile?: boolean | null
          m1_recent_form?: number | null
          m2_matchup?: number | null
          m3_minutes_weighted?: number | null
          m4_usage?: number | null
          m5_location?: number | null
          median5?: number | null
          odds_current?: number | null
          odds_open?: number | null
          opponent_team?: string | null
          outcome?: string | null
          player_name: string
          reason_summary?: string | null
          recommendation?: string | null
          sport?: string | null
          sportsbook_line?: number | null
          spread?: number | null
          stat_type: string
          std_dev?: number | null
          team_name?: string | null
          true_median?: number | null
          verified_at?: string | null
          volatility?: number | null
        }
        Update: {
          actual_value?: number | null
          adjusted_median?: number | null
          adjustments?: Json | null
          alt_line_suggestion?: number | null
          confidence_flag?: string | null
          confidence_tier?: string | null
          created_at?: string | null
          defense_code?: number | null
          defense_multiplier?: number | null
          edge?: number | null
          engine_version?: string | null
          event_id?: string | null
          expected_minutes?: number | null
          game_date?: string | null
          game_time?: string | null
          hit_rate_over_10?: number | null
          hit_rate_under_10?: number | null
          id?: string
          injury_context?: string | null
          is_volatile?: boolean | null
          m1_recent_form?: number | null
          m2_matchup?: number | null
          m3_minutes_weighted?: number | null
          m4_usage?: number | null
          m5_location?: number | null
          median5?: number | null
          odds_current?: number | null
          odds_open?: number | null
          opponent_team?: string | null
          outcome?: string | null
          player_name?: string
          reason_summary?: string | null
          recommendation?: string | null
          sport?: string | null
          sportsbook_line?: number | null
          spread?: number | null
          stat_type?: string
          std_dev?: number | null
          team_name?: string | null
          true_median?: number | null
          verified_at?: string | null
          volatility?: number | null
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
          away_score: number | null
          away_team: string | null
          bet_side: string | null
          blended_hit_rate: number | null
          blended_median: number | null
          block_reason: string | null
          book_line: number
          book_recommended_side: string | null
          classification: string | null
          confidence_score: number | null
          consistency_score: number | null
          created_at: string | null
          current_price: number | null
          defense_adjustment: number | null
          engine_side_matched_book: boolean | null
          event_id: string | null
          failed_checks: Json | null
          game_clock: string | null
          game_final_time: string | null
          game_period: string | null
          game_start_time: string | null
          game_status: string | null
          hit_rate: number | null
          hit_rate_last_5: number | null
          home_away_last_10: Json | null
          home_score: number | null
          home_team: string | null
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
          opponent_impact: string | null
          outcome: string | null
          parlay_grade: boolean | null
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
          vs_opponent_avg: number | null
          vs_opponent_games: number | null
          vs_opponent_hit_rate: number | null
          vs_opponent_median: number | null
        }
        Insert: {
          actual_value?: number | null
          adjusted_edge?: number | null
          away_score?: number | null
          away_team?: string | null
          bet_side?: string | null
          blended_hit_rate?: number | null
          blended_median?: number | null
          block_reason?: string | null
          book_line: number
          book_recommended_side?: string | null
          classification?: string | null
          confidence_score?: number | null
          consistency_score?: number | null
          created_at?: string | null
          current_price?: number | null
          defense_adjustment?: number | null
          engine_side_matched_book?: boolean | null
          event_id?: string | null
          failed_checks?: Json | null
          game_clock?: string | null
          game_final_time?: string | null
          game_period?: string | null
          game_start_time?: string | null
          game_status?: string | null
          hit_rate?: number | null
          hit_rate_last_5?: number | null
          home_away_last_10?: Json | null
          home_score?: number | null
          home_team?: string | null
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
          opponent_impact?: string | null
          outcome?: string | null
          parlay_grade?: boolean | null
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
          vs_opponent_avg?: number | null
          vs_opponent_games?: number | null
          vs_opponent_hit_rate?: number | null
          vs_opponent_median?: number | null
        }
        Update: {
          actual_value?: number | null
          adjusted_edge?: number | null
          away_score?: number | null
          away_team?: string | null
          bet_side?: string | null
          blended_hit_rate?: number | null
          blended_median?: number | null
          block_reason?: string | null
          book_line?: number
          book_recommended_side?: string | null
          classification?: string | null
          confidence_score?: number | null
          consistency_score?: number | null
          created_at?: string | null
          current_price?: number | null
          defense_adjustment?: number | null
          engine_side_matched_book?: boolean | null
          event_id?: string | null
          failed_checks?: Json | null
          game_clock?: string | null
          game_final_time?: string | null
          game_period?: string | null
          game_start_time?: string | null
          game_status?: string | null
          hit_rate?: number | null
          hit_rate_last_5?: number | null
          home_away_last_10?: Json | null
          home_score?: number | null
          home_team?: string | null
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
          opponent_impact?: string | null
          outcome?: string | null
          parlay_grade?: boolean | null
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
          vs_opponent_avg?: number | null
          vs_opponent_games?: number | null
          vs_opponent_hit_rate?: number | null
          vs_opponent_median?: number | null
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
      median_parlay_picks: {
        Row: {
          combined_hit_rate: number | null
          confidence_score: number | null
          created_at: string | null
          defense_advantage_score: number | null
          duo_stacks: Json | null
          engine_version: string | null
          experiment_id: string | null
          experiment_variant: string | null
          id: string
          leg_outcomes: Json | null
          legs: Json
          legs_lost: number | null
          legs_won: number | null
          outcome: string | null
          parlay_date: string
          parlay_type: string
          stat_breakdown: Json | null
          total_edge: number | null
          verified_at: string | null
        }
        Insert: {
          combined_hit_rate?: number | null
          confidence_score?: number | null
          created_at?: string | null
          defense_advantage_score?: number | null
          duo_stacks?: Json | null
          engine_version?: string | null
          experiment_id?: string | null
          experiment_variant?: string | null
          id?: string
          leg_outcomes?: Json | null
          legs?: Json
          legs_lost?: number | null
          legs_won?: number | null
          outcome?: string | null
          parlay_date: string
          parlay_type: string
          stat_breakdown?: Json | null
          total_edge?: number | null
          verified_at?: string | null
        }
        Update: {
          combined_hit_rate?: number | null
          confidence_score?: number | null
          created_at?: string | null
          defense_advantage_score?: number | null
          duo_stacks?: Json | null
          engine_version?: string | null
          experiment_id?: string | null
          experiment_variant?: string | null
          id?: string
          leg_outcomes?: Json | null
          legs?: Json
          legs_lost?: number | null
          legs_won?: number | null
          outcome?: string | null
          parlay_date?: string
          parlay_type?: string
          stat_breakdown?: Json | null
          total_edge?: number | null
          verified_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "median_parlay_picks_experiment_id_fkey"
            columns: ["experiment_id"]
            isOneToOne: false
            referencedRelation: "parlay_ab_experiments"
            referencedColumns: ["id"]
          },
        ]
      }
      mispriced_lines: {
        Row: {
          analysis_date: string
          book_line: number
          confidence_tier: string | null
          created_at: string
          defense_adjusted_avg: number | null
          edge_pct: number | null
          game_date: string | null
          id: string
          opponent: string | null
          opponent_defense_rank: number | null
          player_avg_l10: number | null
          player_avg_l20: number | null
          player_name: string
          prop_type: string
          shooting_context: Json | null
          signal: string | null
          sport: string
          team_total_alignment: string | null
          team_total_signal: string | null
        }
        Insert: {
          analysis_date?: string
          book_line: number
          confidence_tier?: string | null
          created_at?: string
          defense_adjusted_avg?: number | null
          edge_pct?: number | null
          game_date?: string | null
          id?: string
          opponent?: string | null
          opponent_defense_rank?: number | null
          player_avg_l10?: number | null
          player_avg_l20?: number | null
          player_name: string
          prop_type: string
          shooting_context?: Json | null
          signal?: string | null
          sport?: string
          team_total_alignment?: string | null
          team_total_signal?: string | null
        }
        Update: {
          analysis_date?: string
          book_line?: number
          confidence_tier?: string | null
          created_at?: string
          defense_adjusted_avg?: number | null
          edge_pct?: number | null
          game_date?: string | null
          id?: string
          opponent?: string | null
          opponent_defense_rank?: number | null
          player_avg_l10?: number | null
          player_avg_l20?: number | null
          player_name?: string
          prop_type?: string
          shooting_context?: Json | null
          signal?: string | null
          sport?: string
          team_total_alignment?: string | null
          team_total_signal?: string | null
        }
        Relationships: []
      }
      mlb_player_game_logs: {
        Row: {
          at_bats: number | null
          batting_avg: number | null
          created_at: string
          earned_runs: number | null
          game_date: string
          hits: number | null
          home_runs: number | null
          id: string
          innings_pitched: number | null
          is_home: boolean | null
          opponent: string | null
          pitcher_hits_allowed: number | null
          pitcher_strikeouts: number | null
          player_name: string
          rbis: number | null
          runs: number | null
          stolen_bases: number | null
          strikeouts: number | null
          team: string
          total_bases: number | null
          walks: number | null
        }
        Insert: {
          at_bats?: number | null
          batting_avg?: number | null
          created_at?: string
          earned_runs?: number | null
          game_date: string
          hits?: number | null
          home_runs?: number | null
          id?: string
          innings_pitched?: number | null
          is_home?: boolean | null
          opponent?: string | null
          pitcher_hits_allowed?: number | null
          pitcher_strikeouts?: number | null
          player_name: string
          rbis?: number | null
          runs?: number | null
          stolen_bases?: number | null
          strikeouts?: number | null
          team: string
          total_bases?: number | null
          walks?: number | null
        }
        Update: {
          at_bats?: number | null
          batting_avg?: number | null
          created_at?: string
          earned_runs?: number | null
          game_date?: string
          hits?: number | null
          home_runs?: number | null
          id?: string
          innings_pitched?: number | null
          is_home?: boolean | null
          opponent?: string | null
          pitcher_hits_allowed?: number | null
          pitcher_strikeouts?: number | null
          player_name?: string
          rbis?: number | null
          runs?: number | null
          stolen_bases?: number | null
          strikeouts?: number | null
          team?: string
          total_bases?: number | null
          walks?: number | null
        }
        Relationships: []
      }
      monthly_accuracy_snapshot: {
        Row: {
          created_at: string | null
          engine: string
          hit_rate: number | null
          id: string
          month_year: string
          prop_type_breakdown: Json | null
          signal_breakdown: Json | null
          sport: string | null
          total_hits: number | null
          total_misses: number | null
          total_picks: number | null
          total_pushes: number | null
          updated_at: string | null
        }
        Insert: {
          created_at?: string | null
          engine: string
          hit_rate?: number | null
          id?: string
          month_year: string
          prop_type_breakdown?: Json | null
          signal_breakdown?: Json | null
          sport?: string | null
          total_hits?: number | null
          total_misses?: number | null
          total_picks?: number | null
          total_pushes?: number | null
          updated_at?: string | null
        }
        Update: {
          created_at?: string | null
          engine?: string
          hit_rate?: number | null
          id?: string
          month_year?: string
          prop_type_breakdown?: Json | null
          signal_breakdown?: Json | null
          sport?: string | null
          total_hits?: number | null
          total_misses?: number | null
          total_picks?: number | null
          total_pushes?: number | null
          updated_at?: string | null
        }
        Relationships: []
      }
      nba_defense_codes: {
        Row: {
          created_at: string | null
          id: string
          pace_code: number | null
          season: string | null
          team_abbreviation: string | null
          team_name: string
          updated_at: string | null
          vs_assists_code: number | null
          vs_points_code: number | null
          vs_rebounds_code: number | null
        }
        Insert: {
          created_at?: string | null
          id?: string
          pace_code?: number | null
          season?: string | null
          team_abbreviation?: string | null
          team_name: string
          updated_at?: string | null
          vs_assists_code?: number | null
          vs_points_code?: number | null
          vs_rebounds_code?: number | null
        }
        Update: {
          created_at?: string | null
          id?: string
          pace_code?: number | null
          season?: string | null
          team_abbreviation?: string | null
          team_name?: string
          updated_at?: string | null
          vs_assists_code?: number | null
          vs_points_code?: number | null
          vs_rebounds_code?: number | null
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
          defensive_rebounds: number | null
          field_goals_attempted: number | null
          field_goals_made: number | null
          free_throws_attempted: number | null
          free_throws_made: number | null
          game_date: string
          id: string
          is_home: boolean | null
          is_starter: boolean | null
          min: string | null
          minutes_played: number | null
          offensive_rebounds: number | null
          opponent: string
          player_name: string
          points: number | null
          rebounds: number | null
          steals: number | null
          teammates_out: Json | null
          threes_attempted: number | null
          threes_made: number | null
          turnovers: number | null
          usage_rate: number | null
        }
        Insert: {
          assists?: number | null
          blocks?: number | null
          created_at?: string
          defensive_rebounds?: number | null
          field_goals_attempted?: number | null
          field_goals_made?: number | null
          free_throws_attempted?: number | null
          free_throws_made?: number | null
          game_date: string
          id?: string
          is_home?: boolean | null
          is_starter?: boolean | null
          min?: string | null
          minutes_played?: number | null
          offensive_rebounds?: number | null
          opponent: string
          player_name: string
          points?: number | null
          rebounds?: number | null
          steals?: number | null
          teammates_out?: Json | null
          threes_attempted?: number | null
          threes_made?: number | null
          turnovers?: number | null
          usage_rate?: number | null
        }
        Update: {
          assists?: number | null
          blocks?: number | null
          created_at?: string
          defensive_rebounds?: number | null
          field_goals_attempted?: number | null
          field_goals_made?: number | null
          free_throws_attempted?: number | null
          free_throws_made?: number | null
          game_date?: string
          id?: string
          is_home?: boolean | null
          is_starter?: boolean | null
          min?: string | null
          minutes_played?: number | null
          offensive_rebounds?: number | null
          opponent?: string
          player_name?: string
          points?: number | null
          rebounds?: number | null
          steals?: number | null
          teammates_out?: Json | null
          threes_attempted?: number | null
          threes_made?: number | null
          turnovers?: number | null
          usage_rate?: number | null
        }
        Relationships: []
      }
      nba_risk_engine_picks: {
        Row: {
          actual_value: number | null
          alt_line_reason: string | null
          alt_line_recommendation: number | null
          archetype: string | null
          avg_minutes: number | null
          bad_game_floor: number | null
          bookmaker: string | null
          calibrated_edge: number | null
          confidence_factors: Json | null
          confidence_score: number
          consistency_score: number | null
          created_at: string | null
          current_line: number | null
          edge: number | null
          event_id: string | null
          fade_edge_tag: string | null
          game_date: string
          game_script: string
          h2h_avg: number | null
          h2h_games: number | null
          h2h_hit_rate: number | null
          id: string
          is_ball_dominant: boolean | null
          is_fade_specialist: boolean | null
          is_juiced: boolean | null
          is_pra: boolean | null
          is_star: boolean | null
          is_sweet_spot: boolean | null
          is_trap_indicator: boolean | null
          is_trap_line: boolean | null
          juice_magnitude: number | null
          l10_avg: number | null
          l10_games_used: number | null
          l10_hit_rate: number | null
          line: number
          line_deviation_pct: number | null
          line_warning: string | null
          minutes_class: string
          mode: string | null
          odds_updated_at: string | null
          opponent: string | null
          original_confidence: number | null
          outcome: string | null
          over_price: number | null
          player_hit_rate: number | null
          player_name: string
          player_reliability_tier: string | null
          player_role: string
          prop_type: string
          reason: string | null
          rejection_reason: string | null
          reliability_modifier_applied: number | null
          settled_at: string | null
          sharp_alert: boolean | null
          sharp_alert_level: string | null
          sharp_detected_at: string | null
          sharp_direction: string | null
          sharp_movement_pts: number | null
          side: string
          spread: number | null
          stat_priority: number | null
          sweet_spot_reason: string | null
          team_name: string | null
          trap_type: string | null
          trend_direction: string | null
          true_median: number | null
          under_price: number | null
          usage_rate: number | null
          volatility_pct: number | null
        }
        Insert: {
          actual_value?: number | null
          alt_line_reason?: string | null
          alt_line_recommendation?: number | null
          archetype?: string | null
          avg_minutes?: number | null
          bad_game_floor?: number | null
          bookmaker?: string | null
          calibrated_edge?: number | null
          confidence_factors?: Json | null
          confidence_score: number
          consistency_score?: number | null
          created_at?: string | null
          current_line?: number | null
          edge?: number | null
          event_id?: string | null
          fade_edge_tag?: string | null
          game_date: string
          game_script: string
          h2h_avg?: number | null
          h2h_games?: number | null
          h2h_hit_rate?: number | null
          id?: string
          is_ball_dominant?: boolean | null
          is_fade_specialist?: boolean | null
          is_juiced?: boolean | null
          is_pra?: boolean | null
          is_star?: boolean | null
          is_sweet_spot?: boolean | null
          is_trap_indicator?: boolean | null
          is_trap_line?: boolean | null
          juice_magnitude?: number | null
          l10_avg?: number | null
          l10_games_used?: number | null
          l10_hit_rate?: number | null
          line: number
          line_deviation_pct?: number | null
          line_warning?: string | null
          minutes_class: string
          mode?: string | null
          odds_updated_at?: string | null
          opponent?: string | null
          original_confidence?: number | null
          outcome?: string | null
          over_price?: number | null
          player_hit_rate?: number | null
          player_name: string
          player_reliability_tier?: string | null
          player_role: string
          prop_type: string
          reason?: string | null
          rejection_reason?: string | null
          reliability_modifier_applied?: number | null
          settled_at?: string | null
          sharp_alert?: boolean | null
          sharp_alert_level?: string | null
          sharp_detected_at?: string | null
          sharp_direction?: string | null
          sharp_movement_pts?: number | null
          side: string
          spread?: number | null
          stat_priority?: number | null
          sweet_spot_reason?: string | null
          team_name?: string | null
          trap_type?: string | null
          trend_direction?: string | null
          true_median?: number | null
          under_price?: number | null
          usage_rate?: number | null
          volatility_pct?: number | null
        }
        Update: {
          actual_value?: number | null
          alt_line_reason?: string | null
          alt_line_recommendation?: number | null
          archetype?: string | null
          avg_minutes?: number | null
          bad_game_floor?: number | null
          bookmaker?: string | null
          calibrated_edge?: number | null
          confidence_factors?: Json | null
          confidence_score?: number
          consistency_score?: number | null
          created_at?: string | null
          current_line?: number | null
          edge?: number | null
          event_id?: string | null
          fade_edge_tag?: string | null
          game_date?: string
          game_script?: string
          h2h_avg?: number | null
          h2h_games?: number | null
          h2h_hit_rate?: number | null
          id?: string
          is_ball_dominant?: boolean | null
          is_fade_specialist?: boolean | null
          is_juiced?: boolean | null
          is_pra?: boolean | null
          is_star?: boolean | null
          is_sweet_spot?: boolean | null
          is_trap_indicator?: boolean | null
          is_trap_line?: boolean | null
          juice_magnitude?: number | null
          l10_avg?: number | null
          l10_games_used?: number | null
          l10_hit_rate?: number | null
          line?: number
          line_deviation_pct?: number | null
          line_warning?: string | null
          minutes_class?: string
          mode?: string | null
          odds_updated_at?: string | null
          opponent?: string | null
          original_confidence?: number | null
          outcome?: string | null
          over_price?: number | null
          player_hit_rate?: number | null
          player_name?: string
          player_reliability_tier?: string | null
          player_role?: string
          prop_type?: string
          reason?: string | null
          rejection_reason?: string | null
          reliability_modifier_applied?: number | null
          settled_at?: string | null
          sharp_alert?: boolean | null
          sharp_alert_level?: string | null
          sharp_detected_at?: string | null
          sharp_direction?: string | null
          sharp_movement_pts?: number | null
          side?: string
          spread?: number | null
          stat_priority?: number | null
          sweet_spot_reason?: string | null
          team_name?: string | null
          trap_type?: string | null
          trend_direction?: string | null
          true_median?: number | null
          under_price?: number | null
          usage_rate?: number | null
          volatility_pct?: number | null
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
          defensive_rating: number | null
          games_played: number | null
          id: string
          last_game_date: string | null
          losses: number | null
          net_rating: number | null
          offensive_rating: number | null
          pace_rank: number
          pace_rating: number
          possessions_per_game: number | null
          season: string | null
          source: string | null
          team_abbrev: string | null
          team_name: string
          tempo_factor: number | null
          updated_at: string
          wins: number | null
        }
        Insert: {
          created_at?: string
          defensive_rating?: number | null
          games_played?: number | null
          id?: string
          last_game_date?: string | null
          losses?: number | null
          net_rating?: number | null
          offensive_rating?: number | null
          pace_rank?: number
          pace_rating?: number
          possessions_per_game?: number | null
          season?: string | null
          source?: string | null
          team_abbrev?: string | null
          team_name: string
          tempo_factor?: number | null
          updated_at?: string
          wins?: number | null
        }
        Update: {
          created_at?: string
          defensive_rating?: number | null
          games_played?: number | null
          id?: string
          last_game_date?: string | null
          losses?: number | null
          net_rating?: number | null
          offensive_rating?: number | null
          pace_rank?: number
          pace_rating?: number
          possessions_per_game?: number | null
          season?: string | null
          source?: string | null
          team_abbrev?: string | null
          team_name?: string
          tempo_factor?: number | null
          updated_at?: string
          wins?: number | null
        }
        Relationships: []
      }
      ncaa_baseball_player_game_logs: {
        Row: {
          at_bats: number | null
          batting_avg: number | null
          created_at: string
          earned_runs: number | null
          game_date: string
          hits: number | null
          home_runs: number | null
          id: string
          innings_pitched: number | null
          is_home: boolean | null
          opponent: string
          pitcher_strikeouts: number | null
          player_name: string
          rbis: number | null
          runs: number | null
          stolen_bases: number | null
          strikeouts: number | null
          team: string
          walks: number | null
        }
        Insert: {
          at_bats?: number | null
          batting_avg?: number | null
          created_at?: string
          earned_runs?: number | null
          game_date: string
          hits?: number | null
          home_runs?: number | null
          id?: string
          innings_pitched?: number | null
          is_home?: boolean | null
          opponent: string
          pitcher_strikeouts?: number | null
          player_name: string
          rbis?: number | null
          runs?: number | null
          stolen_bases?: number | null
          strikeouts?: number | null
          team: string
          walks?: number | null
        }
        Update: {
          at_bats?: number | null
          batting_avg?: number | null
          created_at?: string
          earned_runs?: number | null
          game_date?: string
          hits?: number | null
          home_runs?: number | null
          id?: string
          innings_pitched?: number | null
          is_home?: boolean | null
          opponent?: string
          pitcher_strikeouts?: number | null
          player_name?: string
          rbis?: number | null
          runs?: number | null
          stolen_bases?: number | null
          strikeouts?: number | null
          team?: string
          walks?: number | null
        }
        Relationships: []
      }
      ncaa_baseball_team_stats: {
        Row: {
          away_record: string | null
          batting_avg: number | null
          conference: string | null
          era: number | null
          espn_id: string | null
          home_record: string | null
          id: string
          national_rank: number | null
          runs_allowed_per_game: number | null
          runs_per_game: number | null
          team_name: string
          updated_at: string
        }
        Insert: {
          away_record?: string | null
          batting_avg?: number | null
          conference?: string | null
          era?: number | null
          espn_id?: string | null
          home_record?: string | null
          id?: string
          national_rank?: number | null
          runs_allowed_per_game?: number | null
          runs_per_game?: number | null
          team_name: string
          updated_at?: string
        }
        Update: {
          away_record?: string | null
          batting_avg?: number | null
          conference?: string | null
          era?: number | null
          espn_id?: string | null
          home_record?: string | null
          id?: string
          national_rank?: number | null
          runs_allowed_per_game?: number | null
          runs_per_game?: number | null
          team_name?: string
          updated_at?: string
        }
        Relationships: []
      }
      ncaab_fatigue_scores: {
        Row: {
          altitude_differential: number | null
          created_at: string | null
          event_id: string | null
          fatigue_category: string | null
          fatigue_score: number | null
          game_date: string
          id: string
          is_altitude_game: boolean | null
          is_back_to_back: boolean | null
          opponent: string | null
          team_name: string
          timezone_changes: number | null
          travel_miles: number | null
        }
        Insert: {
          altitude_differential?: number | null
          created_at?: string | null
          event_id?: string | null
          fatigue_category?: string | null
          fatigue_score?: number | null
          game_date: string
          id?: string
          is_altitude_game?: boolean | null
          is_back_to_back?: boolean | null
          opponent?: string | null
          team_name: string
          timezone_changes?: number | null
          travel_miles?: number | null
        }
        Update: {
          altitude_differential?: number | null
          created_at?: string | null
          event_id?: string | null
          fatigue_category?: string | null
          fatigue_score?: number | null
          game_date?: string
          id?: string
          is_altitude_game?: boolean | null
          is_back_to_back?: boolean | null
          opponent?: string | null
          team_name?: string
          timezone_changes?: number | null
          travel_miles?: number | null
        }
        Relationships: []
      }
      ncaab_game_referees: {
        Row: {
          away_team: string
          created_at: string | null
          expected_pace_impact: number | null
          expected_total_adjustment: number | null
          game_date: string
          home_team: string
          id: string
          referee_names: Json | null
        }
        Insert: {
          away_team: string
          created_at?: string | null
          expected_pace_impact?: number | null
          expected_total_adjustment?: number | null
          game_date: string
          home_team: string
          id?: string
          referee_names?: Json | null
        }
        Update: {
          away_team?: string
          created_at?: string | null
          expected_pace_impact?: number | null
          expected_total_adjustment?: number | null
          game_date?: string
          home_team?: string
          id?: string
          referee_names?: Json | null
        }
        Relationships: []
      }
      ncaab_player_game_logs: {
        Row: {
          assists: number | null
          blocks: number | null
          created_at: string
          game_date: string
          id: string
          is_home: boolean | null
          minutes_played: number | null
          opponent: string | null
          player_name: string
          points: number | null
          rebounds: number | null
          steals: number | null
          team: string | null
          threes_made: number | null
          turnovers: number | null
        }
        Insert: {
          assists?: number | null
          blocks?: number | null
          created_at?: string
          game_date: string
          id?: string
          is_home?: boolean | null
          minutes_played?: number | null
          opponent?: string | null
          player_name: string
          points?: number | null
          rebounds?: number | null
          steals?: number | null
          team?: string | null
          threes_made?: number | null
          turnovers?: number | null
        }
        Update: {
          assists?: number | null
          blocks?: number | null
          created_at?: string
          game_date?: string
          id?: string
          is_home?: boolean | null
          minutes_played?: number | null
          opponent?: string | null
          player_name?: string
          points?: number | null
          rebounds?: number | null
          steals?: number | null
          team?: string | null
          threes_made?: number | null
          turnovers?: number | null
        }
        Relationships: []
      }
      ncaab_referee_data: {
        Row: {
          avg_fouls_per_game: number | null
          avg_total_points: number | null
          created_at: string | null
          games_officiated: number | null
          id: string
          over_rate: number | null
          pace_tendency: string | null
          referee_name: string
          under_rate: number | null
          updated_at: string | null
        }
        Insert: {
          avg_fouls_per_game?: number | null
          avg_total_points?: number | null
          created_at?: string | null
          games_officiated?: number | null
          id?: string
          over_rate?: number | null
          pace_tendency?: string | null
          referee_name: string
          under_rate?: number | null
          updated_at?: string | null
        }
        Update: {
          avg_fouls_per_game?: number | null
          avg_total_points?: number | null
          created_at?: string | null
          games_officiated?: number | null
          id?: string
          over_rate?: number | null
          pace_tendency?: string | null
          referee_name?: string
          under_rate?: number | null
          updated_at?: string | null
        }
        Relationships: []
      }
      ncaab_team_locations: {
        Row: {
          altitude_feet: number | null
          city: string | null
          conference: string | null
          id: string
          latitude: number | null
          longitude: number | null
          state: string | null
          team_name: string
          timezone: string | null
        }
        Insert: {
          altitude_feet?: number | null
          city?: string | null
          conference?: string | null
          id?: string
          latitude?: number | null
          longitude?: number | null
          state?: string | null
          team_name: string
          timezone?: string | null
        }
        Update: {
          altitude_feet?: number | null
          city?: string | null
          conference?: string | null
          id?: string
          latitude?: number | null
          longitude?: number | null
          state?: string | null
          team_name?: string
          timezone?: string | null
        }
        Relationships: []
      }
      ncaab_team_stats: {
        Row: {
          adj_defense: number | null
          adj_offense: number | null
          adj_tempo: number | null
          ats_record: string | null
          away_record: string | null
          conference: string | null
          home_record: string | null
          id: string
          kenpom_adj_d: number | null
          kenpom_adj_o: number | null
          kenpom_rank: number | null
          kenpom_source: string | null
          last_5_ats: string | null
          last_5_oppg: number | null
          last_5_ppg: number | null
          luck_factor: number | null
          oppg: number | null
          over_under_record: string | null
          ppg: number | null
          sos_rank: number | null
          streak: string | null
          team_name: string
          updated_at: string
        }
        Insert: {
          adj_defense?: number | null
          adj_offense?: number | null
          adj_tempo?: number | null
          ats_record?: string | null
          away_record?: string | null
          conference?: string | null
          home_record?: string | null
          id?: string
          kenpom_adj_d?: number | null
          kenpom_adj_o?: number | null
          kenpom_rank?: number | null
          kenpom_source?: string | null
          last_5_ats?: string | null
          last_5_oppg?: number | null
          last_5_ppg?: number | null
          luck_factor?: number | null
          oppg?: number | null
          over_under_record?: string | null
          ppg?: number | null
          sos_rank?: number | null
          streak?: string | null
          team_name: string
          updated_at?: string
        }
        Update: {
          adj_defense?: number | null
          adj_offense?: number | null
          adj_tempo?: number | null
          ats_record?: string | null
          away_record?: string | null
          conference?: string | null
          home_record?: string | null
          id?: string
          kenpom_adj_d?: number | null
          kenpom_adj_o?: number | null
          kenpom_rank?: number | null
          kenpom_source?: string | null
          last_5_ats?: string | null
          last_5_oppg?: number | null
          last_5_ppg?: number | null
          luck_factor?: number | null
          oppg?: number | null
          over_under_record?: string | null
          ppg?: number | null
          sos_rank?: number | null
          streak?: string | null
          team_name?: string
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
      nfl_team_defense_stats: {
        Row: {
          completions_allowed: number | null
          created_at: string | null
          games_played: number | null
          id: string
          interceptions_forced: number | null
          overall_defense_rank: number | null
          pass_defense_rank: number | null
          pass_tds_allowed: number | null
          pass_yards_allowed_per_game: number | null
          points_allowed_per_game: number | null
          rush_attempts_against: number | null
          rush_defense_rank: number | null
          rush_tds_allowed: number | null
          rush_yards_allowed_per_game: number | null
          rush_yards_per_attempt_allowed: number | null
          season: string | null
          team_abbrev: string
          team_name: string
          total_yards_allowed_per_game: number | null
          updated_at: string | null
          vs_qb_rank: number | null
          vs_rb_rank: number | null
          vs_te_rank: number | null
          vs_wr_rank: number | null
        }
        Insert: {
          completions_allowed?: number | null
          created_at?: string | null
          games_played?: number | null
          id?: string
          interceptions_forced?: number | null
          overall_defense_rank?: number | null
          pass_defense_rank?: number | null
          pass_tds_allowed?: number | null
          pass_yards_allowed_per_game?: number | null
          points_allowed_per_game?: number | null
          rush_attempts_against?: number | null
          rush_defense_rank?: number | null
          rush_tds_allowed?: number | null
          rush_yards_allowed_per_game?: number | null
          rush_yards_per_attempt_allowed?: number | null
          season?: string | null
          team_abbrev: string
          team_name: string
          total_yards_allowed_per_game?: number | null
          updated_at?: string | null
          vs_qb_rank?: number | null
          vs_rb_rank?: number | null
          vs_te_rank?: number | null
          vs_wr_rank?: number | null
        }
        Update: {
          completions_allowed?: number | null
          created_at?: string | null
          games_played?: number | null
          id?: string
          interceptions_forced?: number | null
          overall_defense_rank?: number | null
          pass_defense_rank?: number | null
          pass_tds_allowed?: number | null
          pass_yards_allowed_per_game?: number | null
          points_allowed_per_game?: number | null
          rush_attempts_against?: number | null
          rush_defense_rank?: number | null
          rush_tds_allowed?: number | null
          rush_yards_allowed_per_game?: number | null
          rush_yards_per_attempt_allowed?: number | null
          season?: string | null
          team_abbrev?: string
          team_name?: string
          total_yards_allowed_per_game?: number | null
          updated_at?: string | null
          vs_qb_rank?: number | null
          vs_rb_rank?: number | null
          vs_te_rank?: number | null
          vs_wr_rank?: number | null
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
      nhl_team_pace_stats: {
        Row: {
          created_at: string | null
          games_played: number | null
          goals_against_per_game: number | null
          goals_for_per_game: number | null
          id: string
          losses: number | null
          ot_losses: number | null
          save_pct: number | null
          season: string | null
          shot_differential: number | null
          shot_generation_rank: number | null
          shot_suppression_rank: number | null
          shots_against_per_game: number | null
          shots_for_per_game: number | null
          team_abbrev: string
          team_name: string
          updated_at: string | null
          win_pct: number | null
          wins: number | null
        }
        Insert: {
          created_at?: string | null
          games_played?: number | null
          goals_against_per_game?: number | null
          goals_for_per_game?: number | null
          id?: string
          losses?: number | null
          ot_losses?: number | null
          save_pct?: number | null
          season?: string | null
          shot_differential?: number | null
          shot_generation_rank?: number | null
          shot_suppression_rank?: number | null
          shots_against_per_game?: number | null
          shots_for_per_game?: number | null
          team_abbrev: string
          team_name: string
          updated_at?: string | null
          win_pct?: number | null
          wins?: number | null
        }
        Update: {
          created_at?: string | null
          games_played?: number | null
          goals_against_per_game?: number | null
          goals_for_per_game?: number | null
          id?: string
          losses?: number | null
          ot_losses?: number | null
          save_pct?: number | null
          season?: string | null
          shot_differential?: number | null
          shot_generation_rank?: number | null
          shot_suppression_rank?: number | null
          shots_against_per_game?: number | null
          shots_for_per_game?: number | null
          team_abbrev?: string
          team_name?: string
          updated_at?: string | null
          win_pct?: number | null
          wins?: number | null
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
          push_release_notifications: boolean
          release_notifications: boolean
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
          push_release_notifications?: boolean
          release_notifications?: boolean
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
          push_release_notifications?: boolean
          release_notifications?: boolean
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
      parlay_ab_experiments: {
        Row: {
          completed_at: string | null
          conclusion: string | null
          confidence_interval: Json | null
          control_config: Json
          control_legs_hit_avg: number | null
          control_parlays_total: number | null
          control_parlays_won: number | null
          created_at: string | null
          description: string | null
          end_date: string | null
          experiment_name: string
          hypothesis: string | null
          id: string
          lift_percentage: number | null
          min_sample_size: number | null
          start_date: string
          statistical_significance: number | null
          status: string | null
          test_variables: Json | null
          variant_config: Json
          variant_legs_hit_avg: number | null
          variant_parlays_total: number | null
          variant_parlays_won: number | null
          winner: string | null
        }
        Insert: {
          completed_at?: string | null
          conclusion?: string | null
          confidence_interval?: Json | null
          control_config: Json
          control_legs_hit_avg?: number | null
          control_parlays_total?: number | null
          control_parlays_won?: number | null
          created_at?: string | null
          description?: string | null
          end_date?: string | null
          experiment_name: string
          hypothesis?: string | null
          id?: string
          lift_percentage?: number | null
          min_sample_size?: number | null
          start_date: string
          statistical_significance?: number | null
          status?: string | null
          test_variables?: Json | null
          variant_config: Json
          variant_legs_hit_avg?: number | null
          variant_parlays_total?: number | null
          variant_parlays_won?: number | null
          winner?: string | null
        }
        Update: {
          completed_at?: string | null
          conclusion?: string | null
          confidence_interval?: Json | null
          control_config?: Json
          control_legs_hit_avg?: number | null
          control_parlays_total?: number | null
          control_parlays_won?: number | null
          created_at?: string | null
          description?: string | null
          end_date?: string | null
          experiment_name?: string
          hypothesis?: string | null
          id?: string
          lift_percentage?: number | null
          min_sample_size?: number | null
          start_date?: string
          statistical_significance?: number | null
          status?: string | null
          test_variables?: Json | null
          variant_config?: Json
          variant_legs_hit_avg?: number | null
          variant_parlays_total?: number | null
          variant_parlays_won?: number | null
          winner?: string | null
        }
        Relationships: []
      }
      parlay_drafts: {
        Row: {
          created_at: string
          creator_id: string
          expires_at: string
          id: string
          legs: Json
          name: string
          share_code: string
          status: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          creator_id: string
          expires_at?: string
          id?: string
          legs?: Json
          name?: string
          share_code: string
          status?: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          creator_id?: string
          expires_at?: string
          id?: string
          legs?: Json
          name?: string
          share_code?: string
          status?: string
          updated_at?: string
        }
        Relationships: []
      }
      parlay_experiment_assignments: {
        Row: {
          confidence_at_creation: number | null
          config_snapshot: Json | null
          created_at: string | null
          duo_stacks_count: number | null
          experiment_id: string | null
          id: string
          legs_hit: number | null
          legs_total: number | null
          outcome: string | null
          parlay_id: string
          parlay_type: string | null
          total_edge_at_creation: number | null
          variant: string
          verified_at: string | null
        }
        Insert: {
          confidence_at_creation?: number | null
          config_snapshot?: Json | null
          created_at?: string | null
          duo_stacks_count?: number | null
          experiment_id?: string | null
          id?: string
          legs_hit?: number | null
          legs_total?: number | null
          outcome?: string | null
          parlay_id: string
          parlay_type?: string | null
          total_edge_at_creation?: number | null
          variant: string
          verified_at?: string | null
        }
        Update: {
          confidence_at_creation?: number | null
          config_snapshot?: Json | null
          created_at?: string | null
          duo_stacks_count?: number | null
          experiment_id?: string | null
          id?: string
          legs_hit?: number | null
          legs_total?: number | null
          outcome?: string | null
          parlay_id?: string
          parlay_type?: string | null
          total_edge_at_creation?: number | null
          variant?: string
          verified_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "parlay_experiment_assignments_experiment_id_fkey"
            columns: ["experiment_id"]
            isOneToOne: false
            referencedRelation: "parlay_ab_experiments"
            referencedColumns: ["id"]
          },
        ]
      }
      parlay_experiment_daily_metrics: {
        Row: {
          avg_confidence: number | null
          avg_edge: number | null
          avg_legs_hit: number | null
          cumulative_win_rate: number | null
          experiment_id: string | null
          id: string
          metric_date: string
          parlays_generated: number | null
          parlays_lost: number | null
          parlays_won: number | null
          variant: string
        }
        Insert: {
          avg_confidence?: number | null
          avg_edge?: number | null
          avg_legs_hit?: number | null
          cumulative_win_rate?: number | null
          experiment_id?: string | null
          id?: string
          metric_date: string
          parlays_generated?: number | null
          parlays_lost?: number | null
          parlays_won?: number | null
          variant: string
        }
        Update: {
          avg_confidence?: number | null
          avg_edge?: number | null
          avg_legs_hit?: number | null
          cumulative_win_rate?: number | null
          experiment_id?: string | null
          id?: string
          metric_date?: string
          parlays_generated?: number | null
          parlays_lost?: number | null
          parlays_won?: number | null
          variant?: string
        }
        Relationships: [
          {
            foreignKeyName: "parlay_experiment_daily_metrics_experiment_id_fkey"
            columns: ["experiment_id"]
            isOneToOne: false
            referencedRelation: "parlay_ab_experiments"
            referencedColumns: ["id"]
          },
        ]
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
          slip_image_url: string | null
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
          slip_image_url?: string | null
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
          slip_image_url?: string | null
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
      parlay_pools: {
        Row: {
          combined_odds: number | null
          created_at: string | null
          creator_id: string
          id: string
          invite_code: string
          is_won: boolean | null
          num_legs_required: number
          pool_name: string
          pool_rules: Json | null
          settled_at: string | null
          stake_per_member: number | null
          status: string
        }
        Insert: {
          combined_odds?: number | null
          created_at?: string | null
          creator_id: string
          id?: string
          invite_code?: string
          is_won?: boolean | null
          num_legs_required: number
          pool_name: string
          pool_rules?: Json | null
          settled_at?: string | null
          stake_per_member?: number | null
          status?: string
        }
        Update: {
          combined_odds?: number | null
          created_at?: string | null
          creator_id?: string
          id?: string
          invite_code?: string
          is_won?: boolean | null
          num_legs_required?: number
          pool_name?: string
          pool_rules?: Json | null
          settled_at?: string | null
          stake_per_member?: number | null
          status?: string
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
      phone_verification_audit: {
        Row: {
          attempts_at_time: number | null
          code_age_seconds: number | null
          created_at: string
          event_type: string
          failure_reason: string | null
          id: string
          ip_address: string | null
          phone_number: string
          success: boolean
          user_agent: string | null
          user_id: string
        }
        Insert: {
          attempts_at_time?: number | null
          code_age_seconds?: number | null
          created_at?: string
          event_type: string
          failure_reason?: string | null
          id?: string
          ip_address?: string | null
          phone_number: string
          success?: boolean
          user_agent?: string | null
          user_id: string
        }
        Update: {
          attempts_at_time?: number | null
          code_age_seconds?: number | null
          created_at?: string
          event_type?: string
          failure_reason?: string | null
          id?: string
          ip_address?: string | null
          phone_number?: string
          success?: boolean
          user_agent?: string | null
          user_id?: string
        }
        Relationships: []
      }
      phone_verification_codes: {
        Row: {
          attempts: number | null
          code: string
          created_at: string
          expires_at: string
          id: string
          phone_number: string
          user_id: string
          verified: boolean | null
        }
        Insert: {
          attempts?: number | null
          code: string
          created_at?: string
          expires_at: string
          id?: string
          phone_number: string
          user_id: string
          verified?: boolean | null
        }
        Update: {
          attempts?: number | null
          code?: string
          created_at?: string
          expires_at?: string
          id?: string
          phone_number?: string
          user_id?: string
          verified?: boolean | null
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
      player_archetypes: {
        Row: {
          archetype_confidence: number | null
          avg_assists: number | null
          avg_minutes: number | null
          avg_points: number | null
          avg_rebounds: number | null
          avg_threes: number | null
          created_at: string | null
          games_played: number | null
          id: string
          last_updated: string | null
          manual_override: boolean | null
          player_name: string
          primary_archetype: string
          secondary_archetype: string | null
        }
        Insert: {
          archetype_confidence?: number | null
          avg_assists?: number | null
          avg_minutes?: number | null
          avg_points?: number | null
          avg_rebounds?: number | null
          avg_threes?: number | null
          created_at?: string | null
          games_played?: number | null
          id?: string
          last_updated?: string | null
          manual_override?: boolean | null
          player_name: string
          primary_archetype: string
          secondary_archetype?: string | null
        }
        Update: {
          archetype_confidence?: number | null
          avg_assists?: number | null
          avg_minutes?: number | null
          avg_points?: number | null
          avg_rebounds?: number | null
          avg_threes?: number | null
          created_at?: string | null
          games_played?: number | null
          id?: string
          last_updated?: string | null
          manual_override?: boolean | null
          player_name?: string
          primary_archetype?: string
          secondary_archetype?: string | null
        }
        Relationships: []
      }
      player_behavior_profiles: {
        Row: {
          avg_first_rest_time: string | null
          avg_minutes_per_quarter: Json | null
          avg_second_stint_start: string | null
          best_matchups: Json | null
          blowout_minutes_reduction: number | null
          body_language_notes: string | null
          clutch_performance_vs_average: number | null
          created_at: string
          fatigue_tendency: string | null
          film_sample_count: number | null
          games_analyzed: number | null
          id: string
          last_updated: string | null
          player_name: string
          profile_confidence: number | null
          quarter_production: Json | null
          scoring_zone_preferences: Json | null
          team: string | null
          three_pt_peak_quarters: Json | null
          worst_matchups: Json | null
        }
        Insert: {
          avg_first_rest_time?: string | null
          avg_minutes_per_quarter?: Json | null
          avg_second_stint_start?: string | null
          best_matchups?: Json | null
          blowout_minutes_reduction?: number | null
          body_language_notes?: string | null
          clutch_performance_vs_average?: number | null
          created_at?: string
          fatigue_tendency?: string | null
          film_sample_count?: number | null
          games_analyzed?: number | null
          id?: string
          last_updated?: string | null
          player_name: string
          profile_confidence?: number | null
          quarter_production?: Json | null
          scoring_zone_preferences?: Json | null
          team?: string | null
          three_pt_peak_quarters?: Json | null
          worst_matchups?: Json | null
        }
        Update: {
          avg_first_rest_time?: string | null
          avg_minutes_per_quarter?: Json | null
          avg_second_stint_start?: string | null
          best_matchups?: Json | null
          blowout_minutes_reduction?: number | null
          body_language_notes?: string | null
          clutch_performance_vs_average?: number | null
          created_at?: string
          fatigue_tendency?: string | null
          film_sample_count?: number | null
          games_analyzed?: number | null
          id?: string
          last_updated?: string | null
          player_name?: string
          profile_confidence?: number | null
          quarter_production?: Json | null
          scoring_zone_preferences?: Json | null
          team?: string | null
          three_pt_peak_quarters?: Json | null
          worst_matchups?: Json | null
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
      player_quarter_baselines: {
        Row: {
          created_at: string
          game_avg: number
          h1_pct: number
          h2_pct: number
          id: string
          minutes_avg: number
          player_name: string
          player_tier: string | null
          prop_type: string
          q1_avg: number
          q1_pct: number
          q1_rate: number | null
          q2_avg: number
          q2_pct: number
          q2_rate: number | null
          q3_avg: number
          q3_pct: number
          q3_rate: number | null
          q4_avg: number
          q4_pct: number
          q4_rate: number | null
          sample_size: number
          updated_at: string
        }
        Insert: {
          created_at?: string
          game_avg?: number
          h1_pct?: number
          h2_pct?: number
          id?: string
          minutes_avg?: number
          player_name: string
          player_tier?: string | null
          prop_type: string
          q1_avg?: number
          q1_pct?: number
          q1_rate?: number | null
          q2_avg?: number
          q2_pct?: number
          q2_rate?: number | null
          q3_avg?: number
          q3_pct?: number
          q3_rate?: number | null
          q4_avg?: number
          q4_pct?: number
          q4_rate?: number | null
          sample_size?: number
          updated_at?: string
        }
        Update: {
          created_at?: string
          game_avg?: number
          h1_pct?: number
          h2_pct?: number
          id?: string
          minutes_avg?: number
          player_name?: string
          player_tier?: string | null
          prop_type?: string
          q1_avg?: number
          q1_pct?: number
          q1_rate?: number | null
          q2_avg?: number
          q2_pct?: number
          q2_rate?: number | null
          q3_avg?: number
          q3_pct?: number
          q3_rate?: number | null
          q4_avg?: number
          q4_pct?: number
          q4_rate?: number | null
          sample_size?: number
          updated_at?: string
        }
        Relationships: []
      }
      player_reliability_scores: {
        Row: {
          block_reason: string | null
          confidence_modifier: number | null
          created_at: string | null
          hit_rate: number | null
          id: string
          last_10_hit_rate: number | null
          last_10_hits: number | null
          last_10_misses: number | null
          last_outcome: string | null
          last_pick_date: string | null
          player_name: string
          prop_type: string
          reliability_score: number | null
          reliability_tier: string | null
          should_block: boolean | null
          streak: number | null
          total_hits: number | null
          total_misses: number | null
          total_picks: number | null
          updated_at: string | null
        }
        Insert: {
          block_reason?: string | null
          confidence_modifier?: number | null
          created_at?: string | null
          hit_rate?: number | null
          id?: string
          last_10_hit_rate?: number | null
          last_10_hits?: number | null
          last_10_misses?: number | null
          last_outcome?: string | null
          last_pick_date?: string | null
          player_name: string
          prop_type: string
          reliability_score?: number | null
          reliability_tier?: string | null
          should_block?: boolean | null
          streak?: number | null
          total_hits?: number | null
          total_misses?: number | null
          total_picks?: number | null
          updated_at?: string | null
        }
        Update: {
          block_reason?: string | null
          confidence_modifier?: number | null
          created_at?: string | null
          hit_rate?: number | null
          id?: string
          last_10_hit_rate?: number | null
          last_10_hits?: number | null
          last_10_misses?: number | null
          last_outcome?: string | null
          last_pick_date?: string | null
          player_name?: string
          prop_type?: string
          reliability_score?: number | null
          reliability_tier?: string | null
          should_block?: boolean | null
          streak?: number | null
          total_hits?: number | null
          total_misses?: number | null
          total_picks?: number | null
          updated_at?: string | null
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
          last_5_avg_assists: number | null
          last_5_avg_points: number | null
          last_5_avg_rebounds: number | null
          last_5_avg_threes: number | null
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
          last_5_avg_assists?: number | null
          last_5_avg_points?: number | null
          last_5_avg_rebounds?: number | null
          last_5_avg_threes?: number | null
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
          last_5_avg_assists?: number | null
          last_5_avg_points?: number | null
          last_5_avg_rebounds?: number | null
          last_5_avg_threes?: number | null
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
      player_zone_stats: {
        Row: {
          fg_pct: number | null
          fga: number | null
          fgm: number | null
          frequency: number | null
          id: string
          player_name: string
          season: string
          updated_at: string | null
          zone: string
        }
        Insert: {
          fg_pct?: number | null
          fga?: number | null
          fgm?: number | null
          frequency?: number | null
          id?: string
          player_name: string
          season?: string
          updated_at?: string | null
          zone: string
        }
        Update: {
          fg_pct?: number | null
          fga?: number | null
          fgm?: number | null
          frequency?: number | null
          id?: string
          player_name?: string
          season?: string
          updated_at?: string | null
          zone?: string
        }
        Relationships: []
      }
      pool_leaderboard_stats: {
        Row: {
          current_streak: number | null
          id: string
          legs_submitted: number | null
          legs_won: number | null
          pools_won: number | null
          roi_percentage: number | null
          total_payout: number | null
          total_pools_joined: number | null
          total_staked: number | null
          updated_at: string | null
          user_id: string
        }
        Insert: {
          current_streak?: number | null
          id?: string
          legs_submitted?: number | null
          legs_won?: number | null
          pools_won?: number | null
          roi_percentage?: number | null
          total_payout?: number | null
          total_pools_joined?: number | null
          total_staked?: number | null
          updated_at?: string | null
          user_id: string
        }
        Update: {
          current_streak?: number | null
          id?: string
          legs_submitted?: number | null
          legs_won?: number | null
          pools_won?: number | null
          roi_percentage?: number | null
          total_payout?: number | null
          total_pools_joined?: number | null
          total_staked?: number | null
          updated_at?: string | null
          user_id?: string
        }
        Relationships: []
      }
      pool_legs: {
        Row: {
          bet_type: string
          description: string
          engine_confidence: number | null
          engine_source: string | null
          event_id: string | null
          id: string
          implied_probability: number | null
          leg_index: number
          line: number | null
          odds: number
          player_name: string | null
          pool_id: string
          prop_type: string | null
          settled_at: string | null
          side: string | null
          sport: string | null
          status: string | null
          submitted_at: string | null
          user_id: string
        }
        Insert: {
          bet_type: string
          description: string
          engine_confidence?: number | null
          engine_source?: string | null
          event_id?: string | null
          id?: string
          implied_probability?: number | null
          leg_index: number
          line?: number | null
          odds: number
          player_name?: string | null
          pool_id: string
          prop_type?: string | null
          settled_at?: string | null
          side?: string | null
          sport?: string | null
          status?: string | null
          submitted_at?: string | null
          user_id: string
        }
        Update: {
          bet_type?: string
          description?: string
          engine_confidence?: number | null
          engine_source?: string | null
          event_id?: string | null
          id?: string
          implied_probability?: number | null
          leg_index?: number
          line?: number | null
          odds?: number
          player_name?: string | null
          pool_id?: string
          prop_type?: string | null
          settled_at?: string | null
          side?: string | null
          sport?: string | null
          status?: string | null
          submitted_at?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "pool_legs_pool_id_fkey"
            columns: ["pool_id"]
            isOneToOne: false
            referencedRelation: "parlay_pools"
            referencedColumns: ["id"]
          },
        ]
      }
      pool_memberships: {
        Row: {
          id: string
          joined_at: string | null
          pool_id: string
          role: string | null
          user_id: string
        }
        Insert: {
          id?: string
          joined_at?: string | null
          pool_id: string
          role?: string | null
          user_id: string
        }
        Update: {
          id?: string
          joined_at?: string | null
          pool_id?: string
          role?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "pool_memberships_pool_id_fkey"
            columns: ["pool_id"]
            isOneToOne: false
            referencedRelation: "parlay_pools"
            referencedColumns: ["id"]
          },
        ]
      }
      pp_snapshot: {
        Row: {
          captured_at: string
          created_at: string | null
          event_id: string | null
          id: string
          is_active: boolean | null
          league: string | null
          market_key: string
          matchup: string | null
          period: string | null
          player_name: string
          position: string | null
          pp_line: number
          pp_projection_id: string | null
          previous_line: number | null
          sport: string
          start_time: string | null
          stat_type: string
          team: string | null
        }
        Insert: {
          captured_at?: string
          created_at?: string | null
          event_id?: string | null
          id?: string
          is_active?: boolean | null
          league?: string | null
          market_key: string
          matchup?: string | null
          period?: string | null
          player_name: string
          position?: string | null
          pp_line: number
          pp_projection_id?: string | null
          previous_line?: number | null
          sport: string
          start_time?: string | null
          stat_type: string
          team?: string | null
        }
        Update: {
          captured_at?: string
          created_at?: string | null
          event_id?: string | null
          id?: string
          is_active?: boolean | null
          league?: string | null
          market_key?: string
          matchup?: string | null
          period?: string | null
          player_name?: string
          position?: string | null
          pp_line?: number
          pp_projection_id?: string | null
          previous_line?: number | null
          sport?: string
          start_time?: string | null
          stat_type?: string
          team?: string | null
        }
        Relationships: []
      }
      profiles: {
        Row: {
          avatar_url: string | null
          bio: string | null
          created_at: string
          email: string | null
          email_verification_sent_at: string | null
          email_verified: boolean | null
          hints_enabled: boolean | null
          id: string
          instagram_handle: string | null
          lifetime_degenerate_score: number
          phone_number: string | null
          phone_verification_sent_at: string | null
          phone_verified: boolean | null
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
          email?: string | null
          email_verification_sent_at?: string | null
          email_verified?: boolean | null
          hints_enabled?: boolean | null
          id?: string
          instagram_handle?: string | null
          lifetime_degenerate_score?: number
          phone_number?: string | null
          phone_verification_sent_at?: string | null
          phone_verified?: boolean | null
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
          email?: string | null
          email_verification_sent_at?: string | null
          email_verified?: boolean | null
          hints_enabled?: boolean | null
          id?: string
          instagram_handle?: string | null
          lifetime_degenerate_score?: number
          phone_number?: string | null
          phone_verification_sent_at?: string | null
          phone_verified?: boolean | null
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
      projection_updates: {
        Row: {
          affected_line: number | null
          change_percent: number | null
          change_reason: string | null
          created_at: string | null
          id: string
          is_significant: boolean | null
          new_probability: number | null
          new_projection: number | null
          player_name: string
          previous_probability: number | null
          previous_projection: number | null
          prop_type: string
          sport: string | null
        }
        Insert: {
          affected_line?: number | null
          change_percent?: number | null
          change_reason?: string | null
          created_at?: string | null
          id?: string
          is_significant?: boolean | null
          new_probability?: number | null
          new_projection?: number | null
          player_name: string
          previous_probability?: number | null
          previous_projection?: number | null
          prop_type: string
          sport?: string | null
        }
        Update: {
          affected_line?: number | null
          change_percent?: number | null
          change_reason?: string | null
          created_at?: string | null
          id?: string
          is_significant?: boolean | null
          new_probability?: number | null
          new_projection?: number | null
          player_name?: string
          previous_probability?: number | null
          previous_projection?: number | null
          prop_type?: string
          sport?: string | null
        }
        Relationships: []
      }
      prop_engine_v2_picks: {
        Row: {
          auto_fail_reason: string | null
          blowout_risk: boolean | null
          created_at: string
          decision: string
          decision_emoji: string
          event_id: string | null
          game_date: string
          id: string
          key_reason: string | null
          line: number
          line_structure: string
          market_type: string | null
          median_gap: number | null
          minutes_certainty: string | null
          odds: number | null
          opponent_name: string | null
          outcome: string | null
          player_archetype: string | null
          player_name: string
          prop_type: string
          rolling_median: number | null
          ses_components: Json | null
          ses_score: number
          side: string
          team_name: string | null
          updated_at: string
          verified_at: string | null
        }
        Insert: {
          auto_fail_reason?: string | null
          blowout_risk?: boolean | null
          created_at?: string
          decision?: string
          decision_emoji?: string
          event_id?: string | null
          game_date?: string
          id?: string
          key_reason?: string | null
          line: number
          line_structure?: string
          market_type?: string | null
          median_gap?: number | null
          minutes_certainty?: string | null
          odds?: number | null
          opponent_name?: string | null
          outcome?: string | null
          player_archetype?: string | null
          player_name: string
          prop_type: string
          rolling_median?: number | null
          ses_components?: Json | null
          ses_score?: number
          side: string
          team_name?: string | null
          updated_at?: string
          verified_at?: string | null
        }
        Update: {
          auto_fail_reason?: string | null
          blowout_risk?: boolean | null
          created_at?: string
          decision?: string
          decision_emoji?: string
          event_id?: string | null
          game_date?: string
          id?: string
          key_reason?: string | null
          line?: number
          line_structure?: string
          market_type?: string | null
          median_gap?: number | null
          minutes_certainty?: string | null
          odds?: number | null
          opponent_name?: string | null
          outcome?: string | null
          player_archetype?: string | null
          player_name?: string
          prop_type?: string
          rolling_median?: number | null
          ses_components?: Json | null
          ses_score?: number
          side?: string
          team_name?: string | null
          updated_at?: string
          verified_at?: string | null
        }
        Relationships: []
      }
      prop_results_archive: {
        Row: {
          actual_value: number | null
          archetype: string | null
          archived_at: string | null
          confidence_score: number | null
          created_at: string | null
          edge: number | null
          engine: string
          game_date: string
          game_month: string | null
          id: string
          is_parlay: boolean | null
          line: number
          opponent: string | null
          outcome: string | null
          parlay_legs: Json | null
          parlay_type: string | null
          player_name: string
          prop_type: string
          reason: string | null
          settled_at: string | null
          side: string
          signal_label: string | null
          source_id: string | null
          sport: string | null
          team_name: string | null
        }
        Insert: {
          actual_value?: number | null
          archetype?: string | null
          archived_at?: string | null
          confidence_score?: number | null
          created_at?: string | null
          edge?: number | null
          engine: string
          game_date: string
          game_month?: string | null
          id?: string
          is_parlay?: boolean | null
          line: number
          opponent?: string | null
          outcome?: string | null
          parlay_legs?: Json | null
          parlay_type?: string | null
          player_name: string
          prop_type: string
          reason?: string | null
          settled_at?: string | null
          side: string
          signal_label?: string | null
          source_id?: string | null
          sport?: string | null
          team_name?: string | null
        }
        Update: {
          actual_value?: number | null
          archetype?: string | null
          archived_at?: string | null
          confidence_score?: number | null
          created_at?: string | null
          edge?: number | null
          engine?: string
          game_date?: string
          game_month?: string | null
          id?: string
          is_parlay?: boolean | null
          line?: number
          opponent?: string | null
          outcome?: string | null
          parlay_legs?: Json | null
          parlay_type?: string | null
          player_name?: string
          prop_type?: string
          reason?: string | null
          settled_at?: string | null
          side?: string
          signal_label?: string | null
          source_id?: string | null
          sport?: string | null
          team_name?: string | null
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
      quarter_player_snapshots: {
        Row: {
          assists: number | null
          captured_at: string
          created_at: string
          effort_score: number | null
          espn_event_id: string | null
          event_id: string
          fatigue_score: number | null
          foul_risk_level: string | null
          fouls: number | null
          hands_on_knees_count: number | null
          id: number
          minutes_played: number | null
          on_court_stability: number | null
          player_name: string
          player_role: string | null
          points: number | null
          quarter: number
          rebound_position_score: number | null
          rebounds: number | null
          risk_flags: string[] | null
          rotation_role: string | null
          slow_recovery_count: number | null
          speed_index: number | null
          sprint_count: number | null
          team: string | null
          threes: number | null
          turnovers: number | null
          visual_flags: Json | null
        }
        Insert: {
          assists?: number | null
          captured_at?: string
          created_at?: string
          effort_score?: number | null
          espn_event_id?: string | null
          event_id: string
          fatigue_score?: number | null
          foul_risk_level?: string | null
          fouls?: number | null
          hands_on_knees_count?: number | null
          id?: number
          minutes_played?: number | null
          on_court_stability?: number | null
          player_name: string
          player_role?: string | null
          points?: number | null
          quarter: number
          rebound_position_score?: number | null
          rebounds?: number | null
          risk_flags?: string[] | null
          rotation_role?: string | null
          slow_recovery_count?: number | null
          speed_index?: number | null
          sprint_count?: number | null
          team?: string | null
          threes?: number | null
          turnovers?: number | null
          visual_flags?: Json | null
        }
        Update: {
          assists?: number | null
          captured_at?: string
          created_at?: string
          effort_score?: number | null
          espn_event_id?: string | null
          event_id?: string
          fatigue_score?: number | null
          foul_risk_level?: string | null
          fouls?: number | null
          hands_on_knees_count?: number | null
          id?: number
          minutes_played?: number | null
          on_court_stability?: number | null
          player_name?: string
          player_role?: string | null
          points?: number | null
          quarter?: number
          rebound_position_score?: number | null
          rebounds?: number | null
          risk_flags?: string[] | null
          rotation_role?: string | null
          slow_recovery_count?: number | null
          speed_index?: number | null
          sprint_count?: number | null
          team?: string | null
          threes?: number | null
          turnovers?: number | null
          visual_flags?: Json | null
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
      scout_active_game: {
        Row: {
          away_team: string
          commence_time: string | null
          event_id: string
          game_description: string | null
          home_team: string
          id: string
          set_by: string | null
          updated_at: string | null
        }
        Insert: {
          away_team: string
          commence_time?: string | null
          event_id: string
          game_description?: string | null
          home_team: string
          id?: string
          set_by?: string | null
          updated_at?: string | null
        }
        Update: {
          away_team?: string
          commence_time?: string | null
          event_id?: string
          game_description?: string | null
          home_team?: string
          id?: string
          set_by?: string | null
          updated_at?: string | null
        }
        Relationships: []
      }
      scout_confidence_bucket_map: {
        Row: {
          bucket: number
          calibrated_prob: number
          last_hit_rate: number | null
          sample_size: number | null
          updated_at: string | null
        }
        Insert: {
          bucket: number
          calibrated_prob: number
          last_hit_rate?: number | null
          sample_size?: number | null
          updated_at?: string | null
        }
        Update: {
          bucket?: number
          calibrated_prob?: number
          last_hit_rate?: number | null
          sample_size?: number | null
          updated_at?: string | null
        }
        Relationships: []
      }
      scout_prop_outcomes: {
        Row: {
          actual_final: number | null
          analysis_date: string
          confidence_raw: number
          created_at: string | null
          espn_event_id: string | null
          event_id: string
          id: number
          line: number
          minutes_remaining_est: number | null
          minutes_uncertainty: number | null
          on_court_stability: number | null
          outcome: string | null
          player_name: string
          predicted_final: number
          projection_error: number | null
          prop: string
          rate_modifier: number | null
          risk_flags: Json | null
          rotation_role: string | null
          settled_at: string | null
          side: string
          team: string | null
        }
        Insert: {
          actual_final?: number | null
          analysis_date?: string
          confidence_raw: number
          created_at?: string | null
          espn_event_id?: string | null
          event_id: string
          id?: number
          line: number
          minutes_remaining_est?: number | null
          minutes_uncertainty?: number | null
          on_court_stability?: number | null
          outcome?: string | null
          player_name: string
          predicted_final: number
          projection_error?: number | null
          prop: string
          rate_modifier?: number | null
          risk_flags?: Json | null
          rotation_role?: string | null
          settled_at?: string | null
          side: string
          team?: string | null
        }
        Update: {
          actual_final?: number | null
          analysis_date?: string
          confidence_raw?: number
          created_at?: string | null
          espn_event_id?: string | null
          event_id?: string
          id?: number
          line?: number
          minutes_remaining_est?: number | null
          minutes_uncertainty?: number | null
          on_court_stability?: number | null
          outcome?: string | null
          player_name?: string
          predicted_final?: number
          projection_error?: number | null
          prop?: string
          rate_modifier?: number | null
          risk_flags?: Json | null
          rotation_role?: string | null
          settled_at?: string | null
          side?: string
          team?: string | null
        }
        Relationships: []
      }
      scout_sessions: {
        Row: {
          analysis_count: number | null
          away_team: string
          commercial_skip_count: number | null
          created_at: string | null
          current_game_time: string | null
          current_score: string | null
          event_id: string
          frames_processed: number | null
          halftime_lock: Json | null
          home_team: string
          id: string
          last_updated_at: string | null
          pbp_data: Json | null
          player_states: Json
          projection_snapshots: Json
          prop_edges: Json
        }
        Insert: {
          analysis_count?: number | null
          away_team: string
          commercial_skip_count?: number | null
          created_at?: string | null
          current_game_time?: string | null
          current_score?: string | null
          event_id: string
          frames_processed?: number | null
          halftime_lock?: Json | null
          home_team: string
          id?: string
          last_updated_at?: string | null
          pbp_data?: Json | null
          player_states?: Json
          projection_snapshots?: Json
          prop_edges?: Json
        }
        Update: {
          analysis_count?: number | null
          away_team?: string
          commercial_skip_count?: number | null
          created_at?: string | null
          current_game_time?: string | null
          current_score?: string | null
          event_id?: string
          frames_processed?: number | null
          halftime_lock?: Json | null
          home_team?: string
          id?: string
          last_updated_at?: string | null
          pbp_data?: Json | null
          player_states?: Json
          projection_snapshots?: Json
          prop_edges?: Json
        }
        Relationships: []
      }
      sharp_ai_parlays: {
        Row: {
          archetype_diversity: number | null
          combined_probability: number | null
          created_at: string | null
          generation_round: number | null
          id: string
          is_dream_team: boolean | null
          legs: Json
          model_version: string | null
          outcome: string | null
          parlay_date: string
          parlay_type: string
          rule_compliance: Json | null
          settled_at: string | null
          sport: string | null
          team_diversity: number | null
          total_odds: number | null
          verified_legs_count: number | null
        }
        Insert: {
          archetype_diversity?: number | null
          combined_probability?: number | null
          created_at?: string | null
          generation_round?: number | null
          id?: string
          is_dream_team?: boolean | null
          legs?: Json
          model_version?: string | null
          outcome?: string | null
          parlay_date: string
          parlay_type: string
          rule_compliance?: Json | null
          settled_at?: string | null
          sport?: string | null
          team_diversity?: number | null
          total_odds?: number | null
          verified_legs_count?: number | null
        }
        Update: {
          archetype_diversity?: number | null
          combined_probability?: number | null
          created_at?: string | null
          generation_round?: number | null
          id?: string
          is_dream_team?: boolean | null
          legs?: Json
          model_version?: string | null
          outcome?: string | null
          parlay_date?: string
          parlay_type?: string
          rule_compliance?: Json | null
          settled_at?: string | null
          sport?: string | null
          team_diversity?: number | null
          total_odds?: number | null
          verified_legs_count?: number | null
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
      sharp_engine_sport_config: {
        Row: {
          config_key: string
          config_value: number
          created_at: string | null
          description: string | null
          id: string
          sport: string
          updated_at: string | null
        }
        Insert: {
          config_key: string
          config_value: number
          created_at?: string | null
          description?: string | null
          id?: string
          sport: string
          updated_at?: string | null
        }
        Update: {
          config_key?: string
          config_value?: number
          created_at?: string | null
          description?: string | null
          id?: string
          sport?: string
          updated_at?: string | null
        }
        Relationships: []
      }
      sharp_line_tracker: {
        Row: {
          actual_value: number | null
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
          outcome: string | null
          player_name: string
          price_movement_over: number | null
          price_movement_under: number | null
          prop_type: string
          sport: string
          status: string | null
          verified_at: string | null
          was_correct: boolean | null
        }
        Insert: {
          actual_value?: number | null
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
          outcome?: string | null
          player_name: string
          price_movement_over?: number | null
          price_movement_under?: number | null
          prop_type: string
          sport: string
          status?: string | null
          verified_at?: string | null
          was_correct?: boolean | null
        }
        Update: {
          actual_value?: number | null
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
          outcome?: string | null
          player_name?: string
          price_movement_over?: number | null
          price_movement_under?: number | null
          prop_type?: string
          sport?: string
          status?: string | null
          verified_at?: string | null
          was_correct?: boolean | null
        }
        Relationships: []
      }
      sharp_signal_accuracy: {
        Row: {
          accuracy_rate: number | null
          avg_ses_when_present: number | null
          correct_when_present: number | null
          created_at: string | null
          id: string
          last_calibrated_at: string | null
          signal_name: string
          signal_type: string
          sport: string | null
          suggested_weight: number | null
          total_occurrences: number | null
          updated_at: string | null
        }
        Insert: {
          accuracy_rate?: number | null
          avg_ses_when_present?: number | null
          correct_when_present?: number | null
          created_at?: string | null
          id?: string
          last_calibrated_at?: string | null
          signal_name: string
          signal_type: string
          sport?: string | null
          suggested_weight?: number | null
          total_occurrences?: number | null
          updated_at?: string | null
        }
        Update: {
          accuracy_rate?: number | null
          avg_ses_when_present?: number | null
          correct_when_present?: number | null
          created_at?: string | null
          id?: string
          last_calibrated_at?: string | null
          signal_name?: string
          signal_type?: string
          sport?: string | null
          suggested_weight?: number | null
          total_occurrences?: number | null
          updated_at?: string | null
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
      sharp_tracker_accuracy_metrics: {
        Row: {
          ai_direction: string | null
          ai_recommendation: string | null
          avg_confidence: number | null
          confidence_bucket: string | null
          created_at: string | null
          id: string
          roi_percentage: number | null
          sample_size_confidence: string | null
          sport: string | null
          total_lost: number | null
          total_predictions: number | null
          total_push: number | null
          total_won: number | null
          updated_at: string | null
          win_rate: number | null
        }
        Insert: {
          ai_direction?: string | null
          ai_recommendation?: string | null
          avg_confidence?: number | null
          confidence_bucket?: string | null
          created_at?: string | null
          id?: string
          roi_percentage?: number | null
          sample_size_confidence?: string | null
          sport?: string | null
          total_lost?: number | null
          total_predictions?: number | null
          total_push?: number | null
          total_won?: number | null
          updated_at?: string | null
          win_rate?: number | null
        }
        Update: {
          ai_direction?: string | null
          ai_recommendation?: string | null
          avg_confidence?: number | null
          confidence_bucket?: string | null
          created_at?: string | null
          id?: string
          roi_percentage?: number | null
          sample_size_confidence?: string | null
          sport?: string | null
          total_lost?: number | null
          total_predictions?: number | null
          total_push?: number | null
          total_won?: number | null
          updated_at?: string | null
          win_rate?: number | null
        }
        Relationships: []
      }
      simulation_accuracy: {
        Row: {
          accuracy_rate: number
          avg_composite_score: number
          bet_type: string
          created_at: string
          id: string
          is_production_ready: boolean
          period_end: string
          period_start: string
          predictions_correct: number
          predictions_made: number
          scoring_version: string
          sport: string
        }
        Insert: {
          accuracy_rate?: number
          avg_composite_score?: number
          bet_type: string
          created_at?: string
          id?: string
          is_production_ready?: boolean
          period_end: string
          period_start: string
          predictions_correct?: number
          predictions_made?: number
          scoring_version?: string
          sport: string
        }
        Update: {
          accuracy_rate?: number
          avg_composite_score?: number
          bet_type?: string
          created_at?: string
          id?: string
          is_production_ready?: boolean
          period_end?: string
          period_start?: string
          predictions_correct?: number
          predictions_made?: number
          scoring_version?: string
          sport?: string
        }
        Relationships: []
      }
      simulation_shadow_picks: {
        Row: {
          away_team: string | null
          bet_type: string
          created_at: string
          event_id: string
          home_team: string | null
          id: string
          line: number | null
          odds: number | null
          outcome: string
          predicted_score: number
          score_breakdown: Json | null
          scoring_version: string
          settled_at: string | null
          side: string
          sport: string
        }
        Insert: {
          away_team?: string | null
          bet_type: string
          created_at?: string
          event_id: string
          home_team?: string | null
          id?: string
          line?: number | null
          odds?: number | null
          outcome?: string
          predicted_score: number
          score_breakdown?: Json | null
          scoring_version?: string
          settled_at?: string | null
          side: string
          sport: string
        }
        Update: {
          away_team?: string | null
          bet_type?: string
          created_at?: string
          event_id?: string
          home_team?: string | null
          id?: string
          line?: number | null
          odds?: number | null
          outcome?: string
          predicted_score?: number
          score_breakdown?: Json | null
          scoring_version?: string
          settled_at?: string | null
          side?: string
          sport?: string
        }
        Relationships: []
      }
      sports_fatigue_edge_tracking: {
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
          sport: string
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
          sport?: string
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
          sport?: string
          spread_covered?: boolean | null
          total_result?: string | null
          updated_at?: string
          verified_at?: string | null
        }
        Relationships: []
      }
      sports_fatigue_scores: {
        Row: {
          altitude_factor: number | null
          betting_adjustments: Json | null
          commence_time: string | null
          created_at: string
          event_id: string
          fatigue_category: string
          fatigue_score: number
          game_date: string
          games_last_14_days: number | null
          games_last_7_days: number | null
          id: string
          is_back_to_back: boolean | null
          is_three_in_four: boolean | null
          opponent_name: string | null
          prop_targets: Json | null
          recommended_angle: string | null
          rest_days: number | null
          road_trip_games: number | null
          short_week: boolean | null
          sport: string
          team_name: string
          timezone_changes: number | null
          travel_miles: number | null
          updated_at: string
        }
        Insert: {
          altitude_factor?: number | null
          betting_adjustments?: Json | null
          commence_time?: string | null
          created_at?: string
          event_id: string
          fatigue_category?: string
          fatigue_score?: number
          game_date?: string
          games_last_14_days?: number | null
          games_last_7_days?: number | null
          id?: string
          is_back_to_back?: boolean | null
          is_three_in_four?: boolean | null
          opponent_name?: string | null
          prop_targets?: Json | null
          recommended_angle?: string | null
          rest_days?: number | null
          road_trip_games?: number | null
          short_week?: boolean | null
          sport?: string
          team_name: string
          timezone_changes?: number | null
          travel_miles?: number | null
          updated_at?: string
        }
        Update: {
          altitude_factor?: number | null
          betting_adjustments?: Json | null
          commence_time?: string | null
          created_at?: string
          event_id?: string
          fatigue_category?: string
          fatigue_score?: number
          game_date?: string
          games_last_14_days?: number | null
          games_last_7_days?: number | null
          id?: string
          is_back_to_back?: boolean | null
          is_three_in_four?: boolean | null
          opponent_name?: string | null
          prop_targets?: Json | null
          recommended_angle?: string | null
          rest_days?: number | null
          road_trip_games?: number | null
          short_week?: boolean | null
          sport?: string
          team_name?: string
          timezone_changes?: number | null
          travel_miles?: number | null
          updated_at?: string
        }
        Relationships: []
      }
      sports_team_locations: {
        Row: {
          altitude_ft: number | null
          arena_name: string | null
          city: string
          created_at: string
          id: string
          is_active: boolean | null
          latitude: number
          longitude: number
          sport: string
          state: string | null
          team_abbreviation: string | null
          team_name: string
          timezone: string
          updated_at: string
        }
        Insert: {
          altitude_ft?: number | null
          arena_name?: string | null
          city: string
          created_at?: string
          id?: string
          is_active?: boolean | null
          latitude: number
          longitude: number
          sport: string
          state?: string | null
          team_abbreviation?: string | null
          team_name: string
          timezone?: string
          updated_at?: string
        }
        Update: {
          altitude_ft?: number | null
          arena_name?: string | null
          city?: string
          created_at?: string
          id?: string
          is_active?: boolean | null
          latitude?: number
          longitude?: number
          sport?: string
          state?: string | null
          team_abbreviation?: string | null
          team_name?: string
          timezone?: string
          updated_at?: string
        }
        Relationships: []
      }
      starting_lineups: {
        Row: {
          away_bench: Json | null
          away_starters: Json
          away_team: string
          confirmed: boolean | null
          created_at: string | null
          event_id: string | null
          game_date: string
          home_bench: Json | null
          home_starters: Json
          home_team: string
          id: string
          injuries: Json | null
          scraped_at: string | null
          source: string | null
        }
        Insert: {
          away_bench?: Json | null
          away_starters?: Json
          away_team: string
          confirmed?: boolean | null
          created_at?: string | null
          event_id?: string | null
          game_date: string
          home_bench?: Json | null
          home_starters?: Json
          home_team: string
          id?: string
          injuries?: Json | null
          scraped_at?: string | null
          source?: string | null
        }
        Update: {
          away_bench?: Json | null
          away_starters?: Json
          away_team?: string
          confirmed?: boolean | null
          created_at?: string | null
          event_id?: string | null
          game_date?: string
          home_bench?: Json | null
          home_starters?: Json
          home_team?: string
          id?: string
          injuries?: Json | null
          scraped_at?: string | null
          source?: string | null
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
          leg_outcomes: Json | null
          legs: Json
          matchup_data: Json | null
          outcome: string | null
          parlay_strategy: string | null
          pick_status: string | null
          settled_at: string | null
          sport: string
          suggestion_reason: string
          total_odds: number
          user_id: string | null
          verdict: string | null
          verdict_score: number | null
          verdict_signals: Json | null
          verdict_updated_at: string | null
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
          leg_outcomes?: Json | null
          legs: Json
          matchup_data?: Json | null
          outcome?: string | null
          parlay_strategy?: string | null
          pick_status?: string | null
          settled_at?: string | null
          sport: string
          suggestion_reason: string
          total_odds: number
          user_id?: string | null
          verdict?: string | null
          verdict_score?: number | null
          verdict_signals?: Json | null
          verdict_updated_at?: string | null
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
          leg_outcomes?: Json | null
          legs?: Json
          matchup_data?: Json | null
          outcome?: string | null
          parlay_strategy?: string | null
          pick_status?: string | null
          settled_at?: string | null
          sport?: string
          suggestion_reason?: string
          total_odds?: number
          user_id?: string | null
          verdict?: string | null
          verdict_score?: number | null
          verdict_signals?: Json | null
          verdict_updated_at?: string | null
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
      sweet_spot_hedge_snapshots: {
        Row: {
          actual_final: number | null
          analysis_date: string | null
          captured_at: string
          current_value: number
          game_progress: number
          gap_to_line: number | null
          hedge_status: string
          hit_probability: number
          id: number
          line: number
          line_movement: number | null
          live_book_line: number | null
          outcome: string | null
          pace_rating: number | null
          player_name: string
          projected_final: number
          prop_type: string
          quarter: number
          rate_needed: number | null
          rate_per_minute: number | null
          risk_flags: string[] | null
          rotation_tier: string | null
          side: string
          sweet_spot_id: string | null
          zone_matchup_score: number | null
        }
        Insert: {
          actual_final?: number | null
          analysis_date?: string | null
          captured_at?: string
          current_value: number
          game_progress: number
          gap_to_line?: number | null
          hedge_status: string
          hit_probability: number
          id?: number
          line: number
          line_movement?: number | null
          live_book_line?: number | null
          outcome?: string | null
          pace_rating?: number | null
          player_name: string
          projected_final: number
          prop_type: string
          quarter: number
          rate_needed?: number | null
          rate_per_minute?: number | null
          risk_flags?: string[] | null
          rotation_tier?: string | null
          side: string
          sweet_spot_id?: string | null
          zone_matchup_score?: number | null
        }
        Update: {
          actual_final?: number | null
          analysis_date?: string | null
          captured_at?: string
          current_value?: number
          game_progress?: number
          gap_to_line?: number | null
          hedge_status?: string
          hit_probability?: number
          id?: number
          line?: number
          line_movement?: number | null
          live_book_line?: number | null
          outcome?: string | null
          pace_rating?: number | null
          player_name?: string
          projected_final?: number
          prop_type?: string
          quarter?: number
          rate_needed?: number | null
          rate_per_minute?: number | null
          risk_flags?: string[] | null
          rotation_tier?: string | null
          side?: string
          sweet_spot_id?: string | null
          zone_matchup_score?: number | null
        }
        Relationships: []
      }
      sweet_spot_tracking: {
        Row: {
          actual_value: number | null
          archetype: string | null
          confidence_score: number
          created_at: string | null
          edge: number
          game_date: string
          id: string
          line: number
          outcome: string | null
          pick_id: string | null
          player_name: string
          prop_type: string
          side: string
          sweet_spot_reason: string
          verified_at: string | null
        }
        Insert: {
          actual_value?: number | null
          archetype?: string | null
          confidence_score: number
          created_at?: string | null
          edge: number
          game_date: string
          id?: string
          line: number
          outcome?: string | null
          pick_id?: string | null
          player_name: string
          prop_type: string
          side: string
          sweet_spot_reason: string
          verified_at?: string | null
        }
        Update: {
          actual_value?: number | null
          archetype?: string | null
          confidence_score?: number
          created_at?: string | null
          edge?: number
          game_date?: string
          id?: string
          line?: number
          outcome?: string | null
          pick_id?: string | null
          player_name?: string
          prop_type?: string
          side?: string
          sweet_spot_reason?: string
          verified_at?: string | null
        }
        Relationships: []
      }
      team_aliases: {
        Row: {
          aliases: Json | null
          city: string | null
          created_at: string | null
          id: string
          is_active: boolean | null
          nickname: string | null
          sport: string
          team_abbreviation: string
          team_name: string
          updated_at: string | null
        }
        Insert: {
          aliases?: Json | null
          city?: string | null
          created_at?: string | null
          id?: string
          is_active?: boolean | null
          nickname?: string | null
          sport: string
          team_abbreviation: string
          team_name: string
          updated_at?: string | null
        }
        Update: {
          aliases?: Json | null
          city?: string | null
          created_at?: string | null
          id?: string
          is_active?: boolean | null
          nickname?: string | null
          sport?: string
          team_abbreviation?: string
          team_name?: string
          updated_at?: string | null
        }
        Relationships: []
      }
      team_defense_rankings: {
        Row: {
          created_at: string | null
          efficiency_rank: number | null
          id: string
          is_current: boolean | null
          overall_rank: number
          points_allowed_rank: number | null
          season: string | null
          sport: string
          team_abbreviation: string
          team_name: string | null
          updated_at: string | null
        }
        Insert: {
          created_at?: string | null
          efficiency_rank?: number | null
          id?: string
          is_current?: boolean | null
          overall_rank: number
          points_allowed_rank?: number | null
          season?: string | null
          sport?: string
          team_abbreviation: string
          team_name?: string | null
          updated_at?: string | null
        }
        Update: {
          created_at?: string | null
          efficiency_rank?: number | null
          id?: string
          is_current?: boolean | null
          overall_rank?: number
          points_allowed_rank?: number | null
          season?: string | null
          sport?: string
          team_abbreviation?: string
          team_name?: string | null
          updated_at?: string | null
        }
        Relationships: []
      }
      team_defensive_ratings: {
        Row: {
          created_at: string | null
          defensive_rank: number | null
          games_sample: number | null
          id: string
          position_group: string | null
          season: string | null
          stat_allowed_per_game: number | null
          stat_type: string
          team_abbrev: string | null
          team_name: string
          updated_at: string | null
          vs_bigs_allowed: number | null
          vs_bigs_rank: number | null
          vs_guards_allowed: number | null
          vs_guards_rank: number | null
          vs_wings_allowed: number | null
          vs_wings_rank: number | null
        }
        Insert: {
          created_at?: string | null
          defensive_rank?: number | null
          games_sample?: number | null
          id?: string
          position_group?: string | null
          season?: string | null
          stat_allowed_per_game?: number | null
          stat_type: string
          team_abbrev?: string | null
          team_name: string
          updated_at?: string | null
          vs_bigs_allowed?: number | null
          vs_bigs_rank?: number | null
          vs_guards_allowed?: number | null
          vs_guards_rank?: number | null
          vs_wings_allowed?: number | null
          vs_wings_rank?: number | null
        }
        Update: {
          created_at?: string | null
          defensive_rank?: number | null
          games_sample?: number | null
          id?: string
          position_group?: string | null
          season?: string | null
          stat_allowed_per_game?: number | null
          stat_type?: string
          team_abbrev?: string | null
          team_name?: string
          updated_at?: string | null
          vs_bigs_allowed?: number | null
          vs_bigs_rank?: number | null
          vs_guards_allowed?: number | null
          vs_guards_rank?: number | null
          vs_wings_allowed?: number | null
          vs_wings_rank?: number | null
        }
        Relationships: []
      }
      team_game_results: {
        Row: {
          away_score: number
          away_team: string
          created_at: string
          espn_event_id: string | null
          game_date: string
          home_score: number
          home_team: string
          id: string
          season: string | null
          sport: string
          total_score: number | null
        }
        Insert: {
          away_score: number
          away_team: string
          created_at?: string
          espn_event_id?: string | null
          game_date: string
          home_score: number
          home_team: string
          id?: string
          season?: string | null
          sport: string
          total_score?: number | null
        }
        Update: {
          away_score?: number
          away_team?: string
          created_at?: string
          espn_event_id?: string | null
          game_date?: string
          home_score?: number
          home_team?: string
          id?: string
          season?: string | null
          sport?: string
          total_score?: number | null
        }
        Relationships: []
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
      team_zone_defense: {
        Row: {
          defense_rating: string | null
          id: string
          league_avg_pct: number | null
          opp_fg_pct: number | null
          opp_fga: number | null
          rank: number | null
          season: string
          team_abbrev: string
          updated_at: string | null
          zone: string
        }
        Insert: {
          defense_rating?: string | null
          id?: string
          league_avg_pct?: number | null
          opp_fg_pct?: number | null
          opp_fga?: number | null
          rank?: number | null
          season?: string
          team_abbrev: string
          updated_at?: string | null
          zone: string
        }
        Update: {
          defense_rating?: string | null
          id?: string
          league_avg_pct?: number | null
          opp_fg_pct?: number | null
          opp_fga?: number | null
          rank?: number | null
          season?: string
          team_abbrev?: string
          updated_at?: string | null
          zone?: string
        }
        Relationships: []
      }
      tennis_player_stats: {
        Row: {
          aces: number | null
          created_at: string | null
          double_faults: number | null
          first_serve_pct: number | null
          games_lost: number | null
          games_won: number | null
          id: string
          is_winner: boolean | null
          match_date: string
          opponent: string | null
          player_name: string
          sets_lost: number | null
          sets_won: number | null
          surface: string | null
          tournament: string | null
        }
        Insert: {
          aces?: number | null
          created_at?: string | null
          double_faults?: number | null
          first_serve_pct?: number | null
          games_lost?: number | null
          games_won?: number | null
          id?: string
          is_winner?: boolean | null
          match_date: string
          opponent?: string | null
          player_name: string
          sets_lost?: number | null
          sets_won?: number | null
          surface?: string | null
          tournament?: string | null
        }
        Update: {
          aces?: number | null
          created_at?: string | null
          double_faults?: number | null
          first_serve_pct?: number | null
          games_lost?: number | null
          games_won?: number | null
          id?: string
          is_winner?: boolean | null
          match_date?: string
          opponent?: string | null
          player_name?: string
          sets_lost?: number | null
          sets_won?: number | null
          surface?: string | null
          tournament?: string | null
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
      trap_probability_accuracy: {
        Row: {
          accuracy_rate: number | null
          avg_trap_probability: number | null
          calibration_factor: number | null
          correct_predictions: number | null
          id: string
          probability_bucket: string
          risk_label: string
          total_predictions: number | null
          updated_at: string | null
        }
        Insert: {
          accuracy_rate?: number | null
          avg_trap_probability?: number | null
          calibration_factor?: number | null
          correct_predictions?: number | null
          id?: string
          probability_bucket: string
          risk_label: string
          total_predictions?: number | null
          updated_at?: string | null
        }
        Update: {
          accuracy_rate?: number | null
          avg_trap_probability?: number | null
          calibration_factor?: number | null
          correct_predictions?: number | null
          id?: string
          probability_bucket?: string
          risk_label?: string
          total_predictions?: number | null
          updated_at?: string | null
        }
        Relationships: []
      }
      trap_probability_analysis: {
        Row: {
          both_sides_moved: boolean | null
          both_sides_score: number | null
          created_at: string | null
          current_line: number | null
          current_odds: number | null
          event_id: string
          explanation: string | null
          favorite_shorten_score: number | null
          has_narrative_angle: boolean | null
          id: string
          is_primetime: boolean | null
          is_star_player: boolean | null
          line_movement_magnitude: number | null
          market_type: string | null
          multi_book_early_score: number | null
          opening_line: number | null
          opening_odds: number | null
          outcome: string | null
          outcome_name: string
          player_name: string | null
          price_freeze_score: number | null
          price_only_move: boolean | null
          public_bet_percentage: number | null
          recommendation: string | null
          reverse_line_movement_score: number | null
          risk_label: string | null
          round_number_score: number | null
          sharp_only_movement_score: number | null
          sport: string | null
          star_boost_score: number | null
          trap_probability: number | null
          triggered_signals: Json | null
          updated_at: string | null
          verified_at: string | null
          was_actually_trap: boolean | null
        }
        Insert: {
          both_sides_moved?: boolean | null
          both_sides_score?: number | null
          created_at?: string | null
          current_line?: number | null
          current_odds?: number | null
          event_id: string
          explanation?: string | null
          favorite_shorten_score?: number | null
          has_narrative_angle?: boolean | null
          id?: string
          is_primetime?: boolean | null
          is_star_player?: boolean | null
          line_movement_magnitude?: number | null
          market_type?: string | null
          multi_book_early_score?: number | null
          opening_line?: number | null
          opening_odds?: number | null
          outcome?: string | null
          outcome_name: string
          player_name?: string | null
          price_freeze_score?: number | null
          price_only_move?: boolean | null
          public_bet_percentage?: number | null
          recommendation?: string | null
          reverse_line_movement_score?: number | null
          risk_label?: string | null
          round_number_score?: number | null
          sharp_only_movement_score?: number | null
          sport?: string | null
          star_boost_score?: number | null
          trap_probability?: number | null
          triggered_signals?: Json | null
          updated_at?: string | null
          verified_at?: string | null
          was_actually_trap?: boolean | null
        }
        Update: {
          both_sides_moved?: boolean | null
          both_sides_score?: number | null
          created_at?: string | null
          current_line?: number | null
          current_odds?: number | null
          event_id?: string
          explanation?: string | null
          favorite_shorten_score?: number | null
          has_narrative_angle?: boolean | null
          id?: string
          is_primetime?: boolean | null
          is_star_player?: boolean | null
          line_movement_magnitude?: number | null
          market_type?: string | null
          multi_book_early_score?: number | null
          opening_line?: number | null
          opening_odds?: number | null
          outcome?: string | null
          outcome_name?: string
          player_name?: string | null
          price_freeze_score?: number | null
          price_only_move?: boolean | null
          public_bet_percentage?: number | null
          recommendation?: string | null
          reverse_line_movement_score?: number | null
          risk_label?: string | null
          round_number_score?: number | null
          sharp_only_movement_score?: number | null
          sport?: string | null
          star_boost_score?: number | null
          trap_probability?: number | null
          triggered_signals?: Json | null
          updated_at?: string | null
          verified_at?: string | null
          was_actually_trap?: boolean | null
        }
        Relationships: []
      }
      tt_match_stats: {
        Row: {
          avg_match_total: number | null
          avg_period_total: number | null
          created_at: string
          id: string
          last_updated: string
          league: string | null
          pct_3_sets: number | null
          pct_4_sets: number | null
          pct_5_sets: number | null
          player_name: string
          recent_over_rate: number | null
          sample_size: number | null
          std_dev_total: number | null
        }
        Insert: {
          avg_match_total?: number | null
          avg_period_total?: number | null
          created_at?: string
          id?: string
          last_updated?: string
          league?: string | null
          pct_3_sets?: number | null
          pct_4_sets?: number | null
          pct_5_sets?: number | null
          player_name: string
          recent_over_rate?: number | null
          sample_size?: number | null
          std_dev_total?: number | null
        }
        Update: {
          avg_match_total?: number | null
          avg_period_total?: number | null
          created_at?: string
          id?: string
          last_updated?: string
          league?: string | null
          pct_3_sets?: number | null
          pct_4_sets?: number | null
          pct_5_sets?: number | null
          player_name?: string
          recent_over_rate?: number | null
          sample_size?: number | null
          std_dev_total?: number | null
        }
        Relationships: []
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
          odds_updated_at: string | null
          outcome: string | null
          over_price: number | null
          player_name: string
          preferred_bookmaker: string | null
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
          odds_updated_at?: string | null
          outcome?: string | null
          over_price?: number | null
          player_name: string
          preferred_bookmaker?: string | null
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
          odds_updated_at?: string | null
          outcome?: string | null
          over_price?: number | null
          player_name?: string
          preferred_bookmaker?: string | null
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
      upcoming_games_cache: {
        Row: {
          activity_score: number | null
          away_team: string
          commence_time: string
          event_id: string
          home_team: string
          last_news_at: string | null
          news_count: number | null
          sport: string
          spread: number | null
          updated_at: string | null
        }
        Insert: {
          activity_score?: number | null
          away_team: string
          commence_time: string
          event_id: string
          home_team: string
          last_news_at?: string | null
          news_count?: number | null
          sport: string
          spread?: number | null
          updated_at?: string | null
        }
        Update: {
          activity_score?: number | null
          away_team?: string
          commence_time?: string
          event_id?: string
          home_team?: string
          last_news_at?: string | null
          news_count?: number | null
          sport?: string
          spread?: number | null
          updated_at?: string | null
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
      user_bet_preferences: {
        Row: {
          created_at: string | null
          id: string
          include_coaching_signals: boolean | null
          include_fatigue_edge: boolean | null
          include_god_mode: boolean | null
          max_odds: number | null
          min_accuracy_threshold: number | null
          min_sample_size: number | null
          preferred_sports: string[] | null
          risk_tolerance: string | null
          updated_at: string | null
          user_id: string
        }
        Insert: {
          created_at?: string | null
          id?: string
          include_coaching_signals?: boolean | null
          include_fatigue_edge?: boolean | null
          include_god_mode?: boolean | null
          max_odds?: number | null
          min_accuracy_threshold?: number | null
          min_sample_size?: number | null
          preferred_sports?: string[] | null
          risk_tolerance?: string | null
          updated_at?: string | null
          user_id: string
        }
        Update: {
          created_at?: string | null
          id?: string
          include_coaching_signals?: boolean | null
          include_fatigue_edge?: boolean | null
          include_god_mode?: boolean | null
          max_odds?: number | null
          min_accuracy_threshold?: number | null
          min_sample_size?: number | null
          preferred_sports?: string[] | null
          risk_tolerance?: string | null
          updated_at?: string | null
          user_id?: string
        }
        Relationships: []
      }
      user_parlay_outcomes: {
        Row: {
          created_at: string | null
          id: string
          legs: Json
          notes: string | null
          outcome: string | null
          parlay_date: string
          payout_amount: number | null
          source: string | null
          total_legs: number
          total_odds: string | null
          wager_amount: number | null
        }
        Insert: {
          created_at?: string | null
          id?: string
          legs: Json
          notes?: string | null
          outcome?: string | null
          parlay_date: string
          payout_amount?: number | null
          source?: string | null
          total_legs: number
          total_odds?: string | null
          wager_amount?: number | null
        }
        Update: {
          created_at?: string | null
          id?: string
          legs?: Json
          notes?: string | null
          outcome?: string | null
          parlay_date?: string
          payout_amount?: number | null
          source?: string | null
          total_legs?: number
          total_odds?: string | null
          wager_amount?: number | null
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
      whale_picks: {
        Row: {
          actual_value: number | null
          board_behavior_pts: number | null
          book_consensus: number | null
          confidence: string
          confidence_grade: string | null
          confirmation_pts: number | null
          created_at: string
          divergence_pts: number | null
          expires_at: string | null
          id: string
          is_expired: boolean | null
          market_key: string
          matchup: string | null
          move_speed_pts: number | null
          outcome: string | null
          period: string | null
          pick_side: string
          player_name: string
          pp_line: number
          recommended_side: string | null
          settled_at: string | null
          sharp_score: number
          signal_type: string
          sport: string
          start_time: string | null
          stat_type: string
          updated_at: string | null
          verified_source: string | null
          why_short: string[] | null
        }
        Insert: {
          actual_value?: number | null
          board_behavior_pts?: number | null
          book_consensus?: number | null
          confidence: string
          confidence_grade?: string | null
          confirmation_pts?: number | null
          created_at?: string
          divergence_pts?: number | null
          expires_at?: string | null
          id?: string
          is_expired?: boolean | null
          market_key: string
          matchup?: string | null
          move_speed_pts?: number | null
          outcome?: string | null
          period?: string | null
          pick_side: string
          player_name: string
          pp_line: number
          recommended_side?: string | null
          settled_at?: string | null
          sharp_score: number
          signal_type: string
          sport: string
          start_time?: string | null
          stat_type: string
          updated_at?: string | null
          verified_source?: string | null
          why_short?: string[] | null
        }
        Update: {
          actual_value?: number | null
          board_behavior_pts?: number | null
          book_consensus?: number | null
          confidence?: string
          confidence_grade?: string | null
          confirmation_pts?: number | null
          created_at?: string
          divergence_pts?: number | null
          expires_at?: string | null
          id?: string
          is_expired?: boolean | null
          market_key?: string
          matchup?: string | null
          move_speed_pts?: number | null
          outcome?: string | null
          period?: string | null
          pick_side?: string
          player_name?: string
          pp_line?: number
          recommended_side?: string | null
          settled_at?: string | null
          sharp_score?: number
          signal_type?: string
          sport?: string
          start_time?: string | null
          stat_type?: string
          updated_at?: string | null
          verified_source?: string | null
          why_short?: string[] | null
        }
        Relationships: []
      }
      whale_signals: {
        Row: {
          board_behavior_score: number | null
          confirmation_score: number | null
          created_at: string
          divergence_score: number | null
          id: string
          market_key: string
          move_speed_score: number | null
          reasons_json: Json | null
          sharp_score: number
          signal_type: string
        }
        Insert: {
          board_behavior_score?: number | null
          confirmation_score?: number | null
          created_at?: string
          divergence_score?: number | null
          id?: string
          market_key: string
          move_speed_score?: number | null
          reasons_json?: Json | null
          sharp_score?: number
          signal_type: string
        }
        Update: {
          board_behavior_score?: number | null
          confirmation_score?: number | null
          created_at?: string
          divergence_score?: number | null
          id?: string
          market_key?: string
          move_speed_score?: number | null
          reasons_json?: Json | null
          sharp_score?: number
          signal_type?: string
        }
        Relationships: []
      }
    }
    Views: {
      ncaab_team_accuracy_metrics: {
        Row: {
          bet_type: string | null
          losses: number | null
          pushes: number | null
          sport: string | null
          total_bets: number | null
          unsettled: number | null
          win_rate: number | null
          wins: number | null
        }
        Relationships: []
      }
      scout_confidence_calibration: {
        Row: {
          avg_confidence_raw: number | null
          bucket: number | null
          hit_rate: number | null
          mae: number | null
          settled: number | null
        }
        Relationships: []
      }
      v_3pt_matchup_favorites: {
        Row: {
          avg_3pt_vs_team: number | null
          best_3pt_vs_team: number | null
          games_played: number | null
          matchup_tier: string | null
          opponent: string | null
          player_name: string | null
          worst_3pt_vs_team: number | null
        }
        Insert: {
          avg_3pt_vs_team?: number | null
          best_3pt_vs_team?: number | null
          games_played?: number | null
          matchup_tier?: never
          opponent?: string | null
          player_name?: string | null
          worst_3pt_vs_team?: number | null
        }
        Update: {
          avg_3pt_vs_team?: number | null
          best_3pt_vs_team?: number | null
          games_played?: number | null
          matchup_tier?: never
          opponent?: string | null
          player_name?: string | null
          worst_3pt_vs_team?: number | null
        }
        Relationships: []
      }
      v_player_game_summary: {
        Row: {
          away_games: number | null
          first_game_date: string | null
          games_played: number | null
          home_games: number | null
          last_game_date: string | null
          player_name: string | null
        }
        Relationships: []
      }
    }
    Functions: {
      add_paid_scans: {
        Args: { p_amount: number; p_user_id: string }
        Returns: boolean
      }
      calculate_calibration_factors: { Args: never; Returns: undefined }
      calculate_player_reliability: { Args: never; Returns: Json }
      check_scan_access: { Args: { p_user_id: string }; Returns: Json }
      cleanup_expired_verification_codes: { Args: never; Returns: undefined }
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
      find_team_by_alias: {
        Args: { search_term: string; sport_filter?: string }
        Returns: {
          match_type: string
          nickname: string
          sport: string
          team_abbreviation: string
          team_name: string
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
          slip_image_url: string
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
          email_verified: boolean
          lifetime_degenerate_score: number
          phone_number: string
          phone_verified: boolean
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
      get_category_hit_rates: {
        Args: never
        Returns: {
          category: string
          hit_rate: number
          hits: number
          misses: number
          pushes: number
          total_settled: number
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
      get_hedge_probability_calibration: {
        Args: { days_back?: number }
        Returns: {
          actual_hit_rate: number
          calibration_error: number
          expected_hit_rate: number
          hits: number
          probability_bucket: string
          quarter: number
          total_picks: number
        }[]
      }
      get_hedge_status_accuracy: {
        Args: { days_back?: number }
        Returns: {
          avg_hit_probability: number
          hedge_status: string
          hit_rate: number
          hits: number
          misses: number
          quarter: number
          total_picks: number
        }[]
      }
      get_hedge_status_accuracy_v2: {
        Args: { end_date?: string; start_date?: string }
        Returns: {
          avg_probability: number
          hedge_status: string
          hit_rate: number
          hits: number
          misses: number
          quarter: number
          sample_confidence: string
          total_picks: number
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
      get_line_mismatch_accuracy: {
        Args: { days_back?: number }
        Returns: {
          avg_line_diff: number
          hit_rate: number
          hits: number
          misses: number
          severity_tier: string
          total_picks: number
        }[]
      }
      get_matchup_scanner_accuracy_breakdown: {
        Args: { days_back?: number }
        Returns: {
          avg_edge_score: number
          category: string
          grade: string
          hit_rate: number
          hits: number
          misses: number
          pushes: number
          side: string
          total_picks: number
        }[]
      }
      get_median_lock_accuracy_stats: {
        Args: never
        Returns: {
          category: string
          hit_rate: number
          hits: number
          misses: number
          sample_confidence: string
          total_picks: number
          verified_picks: number
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
      get_projection_accuracy: {
        Args: { days_back?: number }
        Returns: {
          avg_edge: number
          avg_projection_error: number
          prop_type: string
          total_picks: number
          within_3_pct: number
          within_5_pct: number
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
      get_scout_projection_accuracy: {
        Args: { days_back?: number }
        Returns: {
          avg_mae: number
          hit_rate: number
          prop: string
          total_predictions: number
          within_2_pct: number
          within_5_pct: number
        }[]
      }
      get_sharp_signal_accuracy_summary: {
        Args: never
        Returns: {
          accuracy_rate: number
          correct_when_present: number
          performance_rating: string
          signal_name: string
          signal_type: string
          suggested_weight: number
          total_occurrences: number
        }[]
      }
      get_side_performance_tracking: {
        Args: { days_back?: number }
        Returns: {
          avg_ceiling_protection: number
          avg_l10_hit_rate: number
          hit_rate: number
          hits: number
          misses: number
          side: string
          total_picks: number
          week_start: string
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
      get_sweet_spot_accuracy: {
        Args: { days_back?: number }
        Returns: {
          category: string
          hit_rate: number
          hits: number
          misses: number
          no_push_hit_rate: number
          pushes: number
          total_picks: number
        }[]
      }
      get_sweet_spot_accuracy_by_confidence: {
        Args: { days_back?: number }
        Returns: {
          avg_confidence: number
          confidence_bucket: string
          hit_rate: number
          hits: number
          total_picks: number
        }[]
      }
      get_sweet_spot_accuracy_by_l10: {
        Args: { days_back?: number }
        Returns: {
          avg_l10: number
          hit_rate: number
          hits: number
          l10_bucket: string
          total_picks: number
        }[]
      }
      get_time_decayed_accuracy: {
        Args: { p_decay_days?: number; p_signal_type: string }
        Returns: {
          decayed_accuracy: number
          recent_accuracy: number
          recent_sample_size: number
          total_sample_size: number
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
      get_unified_system_accuracy: {
        Args: { days_back?: number }
        Returns: {
          display_name: string
          hit_rate: number
          hits: number
          icon: string
          last_updated: string
          misses: number
          pushes: number
          sample_confidence: string
          system_name: string
          total_picks: number
          verified_picks: number
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
      increment_api_calls: {
        Args: { p_count?: number; p_date: string }
        Returns: {
          daily_limit: number
          is_over_limit: boolean
          new_total: number
        }[]
      }
      increment_scan_count: { Args: { p_user_id: string }; Returns: undefined }
      is_collaborator: { Args: { _user_id: string }; Returns: boolean }
      sync_matchup_history_from_logs: {
        Args: never
        Returns: {
          players_synced: number
          prop_types_synced: number
          total_records: number
        }[]
      }
      sync_sharp_follow_outcomes: { Args: never; Returns: undefined }
      update_strategy_performance: { Args: never; Returns: undefined }
      update_upset_calibration: { Args: never; Returns: undefined }
    }
    Enums: {
      app_role:
        | "admin"
        | "moderator"
        | "user"
        | "collaborator"
        | "pilot"
        | "full_access"
        | "elite_access"
        | "odds_tracker_access"
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
      app_role: [
        "admin",
        "moderator",
        "user",
        "collaborator",
        "pilot",
        "full_access",
        "elite_access",
        "odds_tracker_access",
      ],
    },
  },
} as const
