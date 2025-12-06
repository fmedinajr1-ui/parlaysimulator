-- Create player_usage_metrics table for caching usage calculations
CREATE TABLE public.player_usage_metrics (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  player_name TEXT NOT NULL,
  sport TEXT NOT NULL DEFAULT 'basketball_nba',
  avg_minutes NUMERIC NOT NULL DEFAULT 0,
  avg_points NUMERIC NOT NULL DEFAULT 0,
  avg_rebounds NUMERIC NOT NULL DEFAULT 0,
  avg_assists NUMERIC NOT NULL DEFAULT 0,
  pts_per_min NUMERIC NOT NULL DEFAULT 0,
  reb_per_min NUMERIC NOT NULL DEFAULT 0,
  ast_per_min NUMERIC NOT NULL DEFAULT 0,
  games_analyzed INTEGER NOT NULL DEFAULT 0,
  usage_trend TEXT DEFAULT 'stable',
  recent_game_logs JSONB DEFAULT '[]'::jsonb,
  calculated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  UNIQUE(player_name, sport)
);

-- Enable RLS
ALTER TABLE public.player_usage_metrics ENABLE ROW LEVEL SECURITY;

-- Anyone can view usage metrics
CREATE POLICY "Anyone can view player usage metrics"
ON public.player_usage_metrics
FOR SELECT
USING (true);

-- Create index for faster lookups
CREATE INDEX idx_player_usage_metrics_player ON public.player_usage_metrics(player_name);
CREATE INDEX idx_player_usage_metrics_calculated ON public.player_usage_metrics(calculated_at);