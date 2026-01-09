-- Heat Prop Engine: Time-Series Storage
CREATE TABLE heat_prop_tracker (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id TEXT NOT NULL,
  sport TEXT NOT NULL,
  league TEXT,
  start_time_utc TIMESTAMPTZ NOT NULL,
  home_team TEXT,
  away_team TEXT,
  player_id TEXT,
  player_name TEXT NOT NULL,
  market_type TEXT NOT NULL,
  
  -- Opening State
  opening_line NUMERIC NOT NULL,
  opening_price INTEGER NOT NULL,
  opening_time TIMESTAMPTZ NOT NULL,
  
  -- Current State
  latest_line NUMERIC NOT NULL,
  latest_price INTEGER NOT NULL,
  latest_time TIMESTAMPTZ NOT NULL,
  
  -- Movement Deltas
  line_delta NUMERIC DEFAULT 0,
  price_delta INTEGER DEFAULT 0,
  update_count INTEGER DEFAULT 1,
  
  -- Movement Windows
  movement_15m JSONB,
  movement_60m JSONB,
  movement_6h JSONB,
  movement_since_open JSONB,
  
  -- Public Data
  public_pct_tickets NUMERIC,
  public_pct_handle NUMERIC,
  promo_flag BOOLEAN DEFAULT FALSE,
  
  -- Player Context
  projected_minutes NUMERIC,
  player_role_tag TEXT,
  
  -- Engine Scores
  market_signal_score INTEGER DEFAULT 0,
  signal_label TEXT,
  base_role_score INTEGER DEFAULT 0,
  final_score INTEGER DEFAULT 0,
  
  -- Validation Flags
  passes_stat_safety BOOLEAN DEFAULT TRUE,
  passes_role_validation BOOLEAN DEFAULT TRUE,
  is_eligible_core BOOLEAN DEFAULT FALSE,
  is_eligible_upside BOOLEAN DEFAULT FALSE,
  
  book_name TEXT NOT NULL,
  side TEXT NOT NULL,
  
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  
  UNIQUE(event_id, player_name, market_type, book_name, side)
);

-- Heat Prop Snapshots (Time-Series History)
CREATE TABLE heat_prop_snapshots (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tracker_id UUID REFERENCES heat_prop_tracker(id) ON DELETE CASCADE,
  line NUMERIC NOT NULL,
  price INTEGER NOT NULL,
  snapshot_time TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_snapshots_tracker_time ON heat_prop_snapshots(tracker_id, snapshot_time DESC);
CREATE INDEX idx_heat_tracker_sport_date ON heat_prop_tracker(sport, start_time_utc);
CREATE INDEX idx_heat_tracker_eligible ON heat_prop_tracker(is_eligible_core, is_eligible_upside);

-- Heat Parlays (CORE + UPSIDE output)
CREATE TABLE heat_parlays (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  parlay_date DATE NOT NULL,
  parlay_type TEXT NOT NULL,
  
  leg_1 JSONB NOT NULL,
  leg_2 JSONB NOT NULL,
  
  summary TEXT,
  risk_level TEXT,
  no_bet_flags TEXT[],
  
  estimated_odds INTEGER,
  combined_probability NUMERIC,
  
  outcome TEXT DEFAULT 'pending',
  settled_at TIMESTAMPTZ,
  
  engine_version TEXT DEFAULT 'v1',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  
  UNIQUE(parlay_date, parlay_type, engine_version)
);

-- Heat Watchlist
CREATE TABLE heat_watchlist (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  watchlist_date DATE NOT NULL,
  player_name TEXT NOT NULL,
  market_type TEXT NOT NULL,
  line NUMERIC,
  side TEXT,
  sport TEXT,
  event_id TEXT,
  signal_label TEXT,
  approaching_entry BOOLEAN DEFAULT FALSE,
  final_score INTEGER,
  reason TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_watchlist_date ON heat_watchlist(watchlist_date);

-- Heat Do-Not-Bet List
CREATE TABLE heat_do_not_bet (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  dnb_date DATE NOT NULL,
  player_name TEXT NOT NULL,
  market_type TEXT NOT NULL,
  line NUMERIC,
  side TEXT,
  sport TEXT,
  event_id TEXT,
  trap_reason TEXT,
  final_score INTEGER,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_dnb_date ON heat_do_not_bet(dnb_date);

-- Enable RLS
ALTER TABLE heat_prop_tracker ENABLE ROW LEVEL SECURITY;
ALTER TABLE heat_prop_snapshots ENABLE ROW LEVEL SECURITY;
ALTER TABLE heat_parlays ENABLE ROW LEVEL SECURITY;
ALTER TABLE heat_watchlist ENABLE ROW LEVEL SECURITY;
ALTER TABLE heat_do_not_bet ENABLE ROW LEVEL SECURITY;

-- Public read policies
CREATE POLICY "Anyone can read heat_prop_tracker" ON heat_prop_tracker FOR SELECT USING (true);
CREATE POLICY "Anyone can read heat_prop_snapshots" ON heat_prop_snapshots FOR SELECT USING (true);
CREATE POLICY "Anyone can read heat_parlays" ON heat_parlays FOR SELECT USING (true);
CREATE POLICY "Anyone can read heat_watchlist" ON heat_watchlist FOR SELECT USING (true);
CREATE POLICY "Anyone can read heat_do_not_bet" ON heat_do_not_bet FOR SELECT USING (true);

-- Service role insert/update policies
CREATE POLICY "Service can insert heat_prop_tracker" ON heat_prop_tracker FOR INSERT WITH CHECK (true);
CREATE POLICY "Service can update heat_prop_tracker" ON heat_prop_tracker FOR UPDATE USING (true);
CREATE POLICY "Service can insert heat_prop_snapshots" ON heat_prop_snapshots FOR INSERT WITH CHECK (true);
CREATE POLICY "Service can insert heat_parlays" ON heat_parlays FOR INSERT WITH CHECK (true);
CREATE POLICY "Service can update heat_parlays" ON heat_parlays FOR UPDATE USING (true);
CREATE POLICY "Service can delete heat_parlays" ON heat_parlays FOR DELETE USING (true);
CREATE POLICY "Service can insert heat_watchlist" ON heat_watchlist FOR INSERT WITH CHECK (true);
CREATE POLICY "Service can delete heat_watchlist" ON heat_watchlist FOR DELETE USING (true);
CREATE POLICY "Service can insert heat_do_not_bet" ON heat_do_not_bet FOR INSERT WITH CHECK (true);
CREATE POLICY "Service can delete heat_do_not_bet" ON heat_do_not_bet FOR DELETE USING (true);