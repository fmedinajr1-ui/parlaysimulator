-- Engine Status Table - Track which engines are active/retired
CREATE TABLE IF NOT EXISTS engine_status (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  engine_name TEXT NOT NULL UNIQUE,
  is_active BOOLEAN DEFAULT true,
  accuracy_rate NUMERIC,
  roi_percentage NUMERIC,
  sample_size INTEGER DEFAULT 0,
  last_evaluated_at TIMESTAMPTZ,
  retirement_reason TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Enable RLS
ALTER TABLE engine_status ENABLE ROW LEVEL SECURITY;

-- Anyone can view engine status
CREATE POLICY "Anyone can view engine status" ON engine_status
FOR SELECT USING (true);

-- Market Signals Table - Store calculated market signal scores
CREATE TABLE IF NOT EXISTS market_signals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id TEXT NOT NULL,
  outcome_name TEXT NOT NULL,
  player_name TEXT,
  market_type TEXT,
  sport TEXT,
  
  -- Opening data
  opening_price INTEGER,
  opening_point NUMERIC,
  opening_ts TIMESTAMPTZ,
  
  -- Current data  
  current_price INTEGER,
  current_point NUMERIC,
  current_ts TIMESTAMPTZ,
  
  -- Calculated scores (0-100 scale)
  line_move_score INTEGER DEFAULT 0,
  juice_move_score INTEGER DEFAULT 0,
  timing_sharpness_score INTEGER DEFAULT 0,
  multi_book_consensus_score INTEGER DEFAULT 0,
  public_fade_score INTEGER DEFAULT 0,
  
  -- Final computed score
  market_score INTEGER DEFAULT 0,
  signal_label TEXT DEFAULT 'neutral',
  rationale TEXT,
  
  -- Metadata
  hours_to_game NUMERIC,
  confirming_books INTEGER DEFAULT 1,
  outcome_verified BOOLEAN DEFAULT false,
  outcome_correct BOOLEAN,
  verified_at TIMESTAMPTZ,
  
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  
  -- Unique constraint to prevent duplicates
  UNIQUE(event_id, outcome_name, player_name)
);

-- Enable RLS
ALTER TABLE market_signals ENABLE ROW LEVEL SECURITY;

-- Anyone can view market signals
CREATE POLICY "Anyone can view market signals" ON market_signals
FOR SELECT USING (true);

-- Create indexes for performance
CREATE INDEX IF NOT EXISTS idx_market_signals_event ON market_signals(event_id);
CREATE INDEX IF NOT EXISTS idx_market_signals_score ON market_signals(market_score);
CREATE INDEX IF NOT EXISTS idx_market_signals_label ON market_signals(signal_label);
CREATE INDEX IF NOT EXISTS idx_market_signals_sport ON market_signals(sport);

-- Market Signal Weights Table - For self-calibration
CREATE TABLE IF NOT EXISTS market_signal_weights (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  weight_key TEXT NOT NULL UNIQUE,
  weight_value NUMERIC DEFAULT 0.2,
  last_accuracy NUMERIC,
  sample_size INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Enable RLS
ALTER TABLE market_signal_weights ENABLE ROW LEVEL SECURITY;

-- Anyone can view weights
CREATE POLICY "Anyone can view market signal weights" ON market_signal_weights
FOR SELECT USING (true);

-- Insert default weights
INSERT INTO market_signal_weights (weight_key, weight_value) VALUES
  ('line_move', 0.35),
  ('juice_move', 0.20),
  ('timing_sharpness', 0.15),
  ('multi_book_consensus', 0.15),
  ('public_fade', 0.15)
ON CONFLICT (weight_key) DO NOTHING;

-- Insert initial engine status for underperforming engines (retired)
INSERT INTO engine_status (engine_name, is_active, accuracy_rate, sample_size, retirement_reason) VALUES
  ('hitrate_5_5_streak', false, 8.6, 58, 'Extremely low accuracy - 8.6% vs 50% baseline'),
  ('medianlock_over', false, 37.9, 203, 'Below break-even accuracy - 37.9%'),
  ('movement_authenticity_real', false, 45.4, 324, 'Underperforming - inverse logic recommended'),
  ('pick_recommendation', false, 45.4, 324, 'Below break-even - fade logic outperforms')
ON CONFLICT (engine_name) DO NOTHING;

-- Insert active engines
INSERT INTO engine_status (engine_name, is_active, accuracy_rate, sample_size) VALUES
  ('fade_signal', true, 54.4, 324),
  ('god_mode_high', true, 61.5, 142),
  ('market_signal_engine', true, NULL, 0)
ON CONFLICT (engine_name) DO NOTHING;