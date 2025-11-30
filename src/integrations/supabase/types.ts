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
      line_movements: {
        Row: {
          bookmaker: string
          commence_time: string | null
          created_at: string
          description: string
          detected_at: string
          event_id: string
          id: string
          is_sharp_action: boolean | null
          market_type: string
          movement_type: string
          new_point: number | null
          new_price: number
          old_point: number | null
          old_price: number
          outcome_name: string
          point_change: number | null
          price_change: number
          sharp_indicator: string | null
          sport: string
        }
        Insert: {
          bookmaker: string
          commence_time?: string | null
          created_at?: string
          description: string
          detected_at?: string
          event_id: string
          id?: string
          is_sharp_action?: boolean | null
          market_type: string
          movement_type?: string
          new_point?: number | null
          new_price: number
          old_point?: number | null
          old_price: number
          outcome_name: string
          point_change?: number | null
          price_change: number
          sharp_indicator?: string | null
          sport: string
        }
        Update: {
          bookmaker?: string
          commence_time?: string | null
          created_at?: string
          description?: string
          detected_at?: string
          event_id?: string
          id?: string
          is_sharp_action?: boolean | null
          market_type?: string
          movement_type?: string
          new_point?: number | null
          new_price?: number
          old_point?: number | null
          old_price?: number
          outcome_name?: string
          point_change?: number | null
          price_change?: number
          sharp_indicator?: string | null
          sport?: string
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
          combined_probability: number
          confidence_score: number
          created_at: string
          expires_at: string
          id: string
          is_active: boolean
          legs: Json
          sport: string
          suggestion_reason: string
          total_odds: number
          user_id: string | null
        }
        Insert: {
          combined_probability: number
          confidence_score?: number
          created_at?: string
          expires_at: string
          id?: string
          is_active?: boolean
          legs: Json
          sport: string
          suggestion_reason: string
          total_odds: number
          user_id?: string | null
        }
        Update: {
          combined_probability?: number
          confidence_score?: number
          created_at?: string
          expires_at?: string
          id?: string
          is_active?: boolean
          legs?: Json
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
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
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
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
      increment_scan_count: { Args: { p_user_id: string }; Returns: undefined }
    }
    Enums: {
      app_role: "admin" | "moderator" | "user"
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
      app_role: ["admin", "moderator", "user"],
    },
  },
} as const
