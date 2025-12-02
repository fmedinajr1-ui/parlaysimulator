-- Create player_stats_cache table for historical player data
CREATE TABLE public.player_stats_cache (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  player_name TEXT NOT NULL,
  player_id TEXT,
  sport TEXT NOT NULL,
  game_date DATE NOT NULL,
  opponent TEXT,
  stat_type TEXT NOT NULL,
  stat_value NUMERIC NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  UNIQUE(player_name, sport, game_date, stat_type)
);

-- Create player_prop_hitrates table for analyzed hit rates
CREATE TABLE public.player_prop_hitrates (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  player_name TEXT NOT NULL,
  sport TEXT NOT NULL,
  prop_type TEXT NOT NULL,
  current_line NUMERIC NOT NULL,
  over_price NUMERIC,
  under_price NUMERIC,
  games_analyzed INTEGER NOT NULL DEFAULT 5,
  over_hits INTEGER NOT NULL DEFAULT 0,
  under_hits INTEGER NOT NULL DEFAULT 0,
  hit_rate_over NUMERIC NOT NULL DEFAULT 0,
  hit_rate_under NUMERIC NOT NULL DEFAULT 0,
  game_logs JSONB DEFAULT '[]'::jsonb,
  recommended_side TEXT,
  confidence_score NUMERIC DEFAULT 0,
  event_id TEXT,
  game_description TEXT,
  bookmaker TEXT,
  commence_time TIMESTAMP WITH TIME ZONE,
  analyzed_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  expires_at TIMESTAMP WITH TIME ZONE,
  UNIQUE(player_name, sport, prop_type, current_line, event_id)
);

-- Create hitrate_parlays table for generated parlays
CREATE TABLE public.hitrate_parlays (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  legs JSONB NOT NULL DEFAULT '[]'::jsonb,
  combined_probability NUMERIC NOT NULL,
  total_odds NUMERIC NOT NULL,
  min_hit_rate NUMERIC NOT NULL DEFAULT 0.8,
  strategy_type TEXT NOT NULL DEFAULT '5/5_streak',
  sharp_optimized BOOLEAN DEFAULT false,
  sharp_analysis JSONB,
  sport TEXT,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  expires_at TIMESTAMP WITH TIME ZONE NOT NULL
);

-- Enable RLS
ALTER TABLE public.player_stats_cache ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.player_prop_hitrates ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.hitrate_parlays ENABLE ROW LEVEL SECURITY;

-- RLS policies for player_stats_cache (public read)
CREATE POLICY "Anyone can view player stats" ON public.player_stats_cache
  FOR SELECT USING (true);

-- RLS policies for player_prop_hitrates (public read)
CREATE POLICY "Anyone can view hit rates" ON public.player_prop_hitrates
  FOR SELECT USING (true);

-- RLS policies for hitrate_parlays (public read)
CREATE POLICY "Anyone can view hit rate parlays" ON public.hitrate_parlays
  FOR SELECT USING (true);

-- Create indexes for performance
CREATE INDEX idx_player_stats_player_sport ON public.player_stats_cache(player_name, sport);
CREATE INDEX idx_player_stats_date ON public.player_stats_cache(game_date DESC);
CREATE INDEX idx_hitrates_sport_hitrate ON public.player_prop_hitrates(sport, hit_rate_over DESC);
CREATE INDEX idx_hitrates_expires ON public.player_prop_hitrates(expires_at);
CREATE INDEX idx_hitrate_parlays_active ON public.hitrate_parlays(is_active, expires_at);