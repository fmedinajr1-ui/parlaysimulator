-- Retire underperforming engines by updating engine_status
UPDATE engine_status SET is_active = false, retirement_reason = '25.6% accuracy - well below break-even', updated_at = NOW() WHERE engine_name = 'hitrate_unified_pipeline';
UPDATE engine_status SET is_active = false, retirement_reason = '35.9% accuracy - consistently losing', updated_at = NOW() WHERE engine_name = 'juiced_heavy_over';
UPDATE engine_status SET is_active = false, retirement_reason = '25% accuracy - worst performer', updated_at = NOW() WHERE engine_name = 'medianlock_block';
UPDATE engine_status SET is_active = false, retirement_reason = '51.8% accuracy - converted to trap warning', updated_at = NOW() WHERE engine_name = 'caution_recommendation';

-- Insert missing retired engines if they don't exist
INSERT INTO engine_status (engine_name, is_active, accuracy_rate, retirement_reason)
VALUES 
  ('hitrate_unified_pipeline', false, 25.6, '25.6% accuracy - well below break-even'),
  ('juiced_heavy_over', false, 35.9, '35.9% accuracy - consistently losing'),
  ('medianlock_block', false, 25.0, '25% accuracy - worst performer'),
  ('caution_recommendation', false, 51.8, '51.8% accuracy - converted to trap warning')
ON CONFLICT (engine_name) DO UPDATE SET 
  is_active = EXCLUDED.is_active,
  retirement_reason = EXCLUDED.retirement_reason,
  updated_at = NOW();

-- Create trap probability analysis table
CREATE TABLE IF NOT EXISTS trap_probability_analysis (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id TEXT NOT NULL,
  outcome_name TEXT NOT NULL,
  player_name TEXT,
  market_type TEXT,
  sport TEXT,
  
  -- Input data
  opening_odds INTEGER,
  current_odds INTEGER,
  opening_line NUMERIC,
  current_line NUMERIC,
  line_movement_magnitude NUMERIC,
  both_sides_moved BOOLEAN DEFAULT false,
  price_only_move BOOLEAN DEFAULT false,
  public_bet_percentage NUMERIC,
  is_primetime BOOLEAN DEFAULT false,
  is_star_player BOOLEAN DEFAULT false,
  has_narrative_angle BOOLEAN DEFAULT false,
  
  -- Trap signal scores (positive = trap indicators)
  both_sides_score INTEGER DEFAULT 0,
  price_freeze_score INTEGER DEFAULT 0,
  favorite_shorten_score INTEGER DEFAULT 0,
  round_number_score INTEGER DEFAULT 0,
  star_boost_score INTEGER DEFAULT 0,
  
  -- Anti-trap scores (negative = safe indicators)
  sharp_only_movement_score INTEGER DEFAULT 0,
  reverse_line_movement_score INTEGER DEFAULT 0,
  multi_book_early_score INTEGER DEFAULT 0,
  
  -- Final calculation
  trap_probability INTEGER CHECK (trap_probability >= 0 AND trap_probability <= 100),
  risk_label TEXT CHECK (risk_label IN ('Low', 'Medium', 'High')),
  recommendation TEXT CHECK (recommendation IN ('Play', 'Reduce Line', 'Avoid')),
  explanation TEXT,
  triggered_signals JSONB DEFAULT '[]'::jsonb,
  
  -- Outcome tracking
  outcome TEXT CHECK (outcome IN ('won', 'lost', 'push', 'pending')),
  was_actually_trap BOOLEAN,
  verified_at TIMESTAMPTZ,
  
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Create indexes for performance
CREATE INDEX IF NOT EXISTS idx_trap_analysis_event ON trap_probability_analysis(event_id);
CREATE INDEX IF NOT EXISTS idx_trap_analysis_risk ON trap_probability_analysis(risk_label);
CREATE INDEX IF NOT EXISTS idx_trap_analysis_probability ON trap_probability_analysis(trap_probability);
CREATE INDEX IF NOT EXISTS idx_trap_analysis_outcome ON trap_probability_analysis(outcome);

-- Create trap probability accuracy metrics table
CREATE TABLE IF NOT EXISTS trap_probability_accuracy (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  risk_label TEXT NOT NULL,
  probability_bucket TEXT NOT NULL,
  total_predictions INTEGER DEFAULT 0,
  correct_predictions INTEGER DEFAULT 0,
  accuracy_rate NUMERIC,
  avg_trap_probability NUMERIC,
  calibration_factor NUMERIC DEFAULT 1.0,
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(risk_label, probability_bucket)
);

-- Enable RLS
ALTER TABLE trap_probability_analysis ENABLE ROW LEVEL SECURITY;
ALTER TABLE trap_probability_accuracy ENABLE ROW LEVEL SECURITY;

-- Allow public read access
CREATE POLICY "Allow public read trap_probability_analysis" ON trap_probability_analysis FOR SELECT USING (true);
CREATE POLICY "Allow public read trap_probability_accuracy" ON trap_probability_accuracy FOR SELECT USING (true);