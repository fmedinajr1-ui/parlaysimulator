-- PP Whale Proxy Tables

-- Store PrizePicks prop line snapshots
CREATE TABLE public.pp_snapshot (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  market_key TEXT NOT NULL,
  sport TEXT NOT NULL,
  league TEXT,
  event_id TEXT,
  player_name TEXT NOT NULL,
  stat_type TEXT NOT NULL,
  period TEXT DEFAULT 'FULL_GAME',
  pp_line NUMERIC NOT NULL,
  is_active BOOLEAN DEFAULT true,
  start_time TIMESTAMPTZ,
  matchup TEXT,
  captured_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Store sportsbook consensus lines
CREATE TABLE public.book_snapshot (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  market_key TEXT NOT NULL,
  consensus_line NUMERIC NOT NULL,
  sample_size INTEGER DEFAULT 1,
  captured_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Detected sharp signals
CREATE TABLE public.whale_signals (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  market_key TEXT NOT NULL,
  signal_type TEXT NOT NULL,
  sharp_score INTEGER NOT NULL DEFAULT 0,
  divergence_score INTEGER DEFAULT 0,
  move_speed_score INTEGER DEFAULT 0,
  confirmation_score INTEGER DEFAULT 0,
  board_behavior_score INTEGER DEFAULT 0,
  reasons_json JSONB DEFAULT '[]'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Auto-dispensed picks with confidence grades
CREATE TABLE public.whale_picks (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  market_key TEXT NOT NULL,
  player_name TEXT NOT NULL,
  matchup TEXT,
  sport TEXT NOT NULL,
  stat_type TEXT NOT NULL,
  period TEXT DEFAULT 'FULL_GAME',
  pick_side TEXT NOT NULL,
  pp_line NUMERIC NOT NULL,
  confidence TEXT NOT NULL,
  sharp_score INTEGER NOT NULL,
  signal_type TEXT NOT NULL,
  why_short TEXT[] DEFAULT '{}',
  start_time TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ,
  is_expired BOOLEAN DEFAULT false
);

-- Indexes for performance
CREATE INDEX idx_pp_snapshot_market_key ON public.pp_snapshot(market_key);
CREATE INDEX idx_pp_snapshot_captured_at ON public.pp_snapshot(captured_at DESC);
CREATE INDEX idx_book_snapshot_market_key ON public.book_snapshot(market_key);
CREATE INDEX idx_whale_signals_market_key ON public.whale_signals(market_key);
CREATE INDEX idx_whale_picks_confidence ON public.whale_picks(confidence);
CREATE INDEX idx_whale_picks_is_expired ON public.whale_picks(is_expired);
CREATE INDEX idx_whale_picks_start_time ON public.whale_picks(start_time);

-- Enable RLS (public read for now, can be restricted later)
ALTER TABLE public.pp_snapshot ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.book_snapshot ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.whale_signals ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.whale_picks ENABLE ROW LEVEL SECURITY;

-- Public read policies
CREATE POLICY "Allow public read on pp_snapshot" ON public.pp_snapshot FOR SELECT USING (true);
CREATE POLICY "Allow public read on book_snapshot" ON public.book_snapshot FOR SELECT USING (true);
CREATE POLICY "Allow public read on whale_signals" ON public.whale_signals FOR SELECT USING (true);
CREATE POLICY "Allow public read on whale_picks" ON public.whale_picks FOR SELECT USING (true);

-- Service role insert policies (for edge functions)
CREATE POLICY "Allow service insert on pp_snapshot" ON public.pp_snapshot FOR INSERT WITH CHECK (true);
CREATE POLICY "Allow service insert on book_snapshot" ON public.book_snapshot FOR INSERT WITH CHECK (true);
CREATE POLICY "Allow service insert on whale_signals" ON public.whale_signals FOR INSERT WITH CHECK (true);
CREATE POLICY "Allow service insert on whale_picks" ON public.whale_picks FOR INSERT WITH CHECK (true);