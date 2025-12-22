-- Create table for upcoming games cache
CREATE TABLE public.upcoming_games_cache (
  event_id TEXT PRIMARY KEY,
  sport TEXT NOT NULL,
  home_team TEXT NOT NULL,
  away_team TEXT NOT NULL,
  commence_time TIMESTAMPTZ NOT NULL,
  news_count INTEGER DEFAULT 0,
  last_news_at TIMESTAMPTZ,
  activity_score NUMERIC DEFAULT 0,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Create table for game news feed
CREATE TABLE public.game_news_feed (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id TEXT NOT NULL,
  sport TEXT NOT NULL,
  home_team TEXT NOT NULL,
  away_team TEXT NOT NULL,
  commence_time TIMESTAMPTZ NOT NULL,
  news_type TEXT NOT NULL,
  headline TEXT NOT NULL,
  impact_level TEXT DEFAULT 'low',
  market_impact BOOLEAN DEFAULT FALSE,
  source_table TEXT,
  source_id UUID,
  player_name TEXT,
  affected_props JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  expires_at TIMESTAMPTZ
);

-- Create indexes for performance
CREATE INDEX idx_game_news_event ON public.game_news_feed(event_id, created_at DESC);
CREATE INDEX idx_game_news_sport ON public.game_news_feed(sport, commence_time);
CREATE INDEX idx_upcoming_games_sport ON public.upcoming_games_cache(sport, commence_time);

-- Enable RLS
ALTER TABLE public.upcoming_games_cache ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.game_news_feed ENABLE ROW LEVEL SECURITY;

-- RLS Policies - Anyone can read
CREATE POLICY "Anyone can view upcoming games" ON public.upcoming_games_cache
  FOR SELECT USING (true);

CREATE POLICY "Anyone can view game news" ON public.game_news_feed
  FOR SELECT USING (true);

CREATE POLICY "Service role can manage upcoming games" ON public.upcoming_games_cache
  FOR ALL USING (true) WITH CHECK (true);

CREATE POLICY "Service role can manage game news" ON public.game_news_feed
  FOR ALL USING (true) WITH CHECK (true);

-- Enable realtime for both tables
ALTER PUBLICATION supabase_realtime ADD TABLE public.game_news_feed;
ALTER PUBLICATION supabase_realtime ADD TABLE public.upcoming_games_cache;