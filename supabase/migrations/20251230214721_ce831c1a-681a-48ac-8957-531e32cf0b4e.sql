-- Create live_game_scores table for real-time score tracking
CREATE TABLE public.live_game_scores (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id text NOT NULL UNIQUE,
  sport text NOT NULL,
  home_team text NOT NULL,
  away_team text NOT NULL,
  home_score integer DEFAULT 0,
  away_score integer DEFAULT 0,
  game_status text DEFAULT 'scheduled',
  period text,
  clock text,
  start_time timestamptz NOT NULL,
  last_updated timestamptz DEFAULT now(),
  player_stats jsonb DEFAULT '[]'::jsonb,
  quarter_scores jsonb DEFAULT '{}'::jsonb,
  created_at timestamptz DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.live_game_scores ENABLE ROW LEVEL SECURITY;

-- Create policy for public read access (live scores should be public)
CREATE POLICY "Live scores are publicly readable"
  ON public.live_game_scores
  FOR SELECT
  USING (true);

-- Create policy for service role to insert/update
CREATE POLICY "Service role can manage live scores"
  ON public.live_game_scores
  FOR ALL
  USING (true)
  WITH CHECK (true);

-- Create indexes for fast lookups
CREATE INDEX idx_live_scores_status ON public.live_game_scores(game_status);
CREATE INDEX idx_live_scores_sport ON public.live_game_scores(sport);
CREATE INDEX idx_live_scores_event ON public.live_game_scores(event_id);
CREATE INDEX idx_live_scores_updated ON public.live_game_scores(last_updated DESC);

-- Enable realtime for this table
ALTER PUBLICATION supabase_realtime ADD TABLE public.live_game_scores;