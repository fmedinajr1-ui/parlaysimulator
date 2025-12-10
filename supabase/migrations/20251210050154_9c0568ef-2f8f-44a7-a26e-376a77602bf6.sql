-- Create best_bets_log table for tracking best bets outcomes
CREATE TABLE public.best_bets_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  signal_type TEXT NOT NULL, -- 'nhl_sharp', 'ncaab_steam', 'fade_signal', 'nba_fatigue'
  event_id TEXT NOT NULL,
  sport TEXT NOT NULL,
  prediction TEXT NOT NULL,
  description TEXT,
  accuracy_at_time NUMERIC,
  sample_size_at_time INTEGER,
  odds NUMERIC,
  outcome BOOLEAN,
  created_at TIMESTAMPTZ DEFAULT now(),
  verified_at TIMESTAMPTZ
);

-- Enable RLS
ALTER TABLE public.best_bets_log ENABLE ROW LEVEL SECURITY;

-- Anyone can view best bets log
CREATE POLICY "Anyone can view best bets log" 
ON public.best_bets_log 
FOR SELECT 
USING (true);

-- Create index for faster queries
CREATE INDEX idx_best_bets_log_signal_type ON public.best_bets_log(signal_type);
CREATE INDEX idx_best_bets_log_sport ON public.best_bets_log(sport);
CREATE INDEX idx_best_bets_log_created_at ON public.best_bets_log(created_at DESC);