
-- Create Sharp Engine v2 Configuration Table
CREATE TABLE IF NOT EXISTS public.sharp_engine_config (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  config_key TEXT NOT NULL UNIQUE,
  config_value NUMERIC NOT NULL,
  description TEXT,
  category TEXT DEFAULT 'general',
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.sharp_engine_config ENABLE ROW LEVEL SECURITY;

-- Allow anyone to view config
CREATE POLICY "Anyone can view engine config" ON public.sharp_engine_config
  FOR SELECT USING (true);

-- Only admins can modify config
CREATE POLICY "Admins can manage engine config" ON public.sharp_engine_config
  FOR ALL USING (has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (has_role(auth.uid(), 'admin'::app_role));

-- Insert v2 calibration defaults
INSERT INTO public.sharp_engine_config (config_key, config_value, description, category) VALUES
  ('BASE_MOVE_SHARP', 40, 'Base sharp score for movement', 'movement'),
  ('BASE_NOISE', 25, 'Base noise/trap score', 'movement'),
  ('PICK_SES_THRESHOLD', 30, 'SES threshold for PICK recommendation', 'thresholds'),
  ('FADE_SES_THRESHOLD', -30, 'SES threshold for FADE recommendation', 'thresholds'),
  ('PICK_SHARP_PCT', 65, 'Sharp% minimum for PICK', 'thresholds'),
  ('FADE_SHARP_PCT', 35, 'Sharp% maximum for FADE', 'thresholds'),
  ('LOGISTIC_K', 25, 'K value for sigmoid curve', 'formula'),
  ('MW_EXTREME', 0.4, 'Movement weight: Extreme ≥50pts', 'weights'),
  ('MW_LARGE', 1.0, 'Movement weight: Large 30-49pts', 'weights'),
  ('MW_MODERATE', 0.7, 'Movement weight: Moderate 15-29pts', 'weights'),
  ('MW_SMALL', 0.3, 'Movement weight: Small 10-14pts', 'weights'),
  ('MW_MINIMAL', 0.1, 'Movement weight: Minimal <10pts', 'weights'),
  ('TW_LATE', 1.25, 'Time weight: 1-3 hours before game', 'weights'),
  ('TW_MID', 1.0, 'Time weight: 3-6 hours before game', 'weights'),
  ('TW_EARLY', 0.6, 'Time weight: >6 hours before game', 'weights'),
  ('SIGNAL_LINE_AND_JUICE', 25, 'Bonus: Line and juice moved together', 'signals'),
  ('SIGNAL_STEAM_MOVE', 20, 'Bonus: Steam move detected', 'signals'),
  ('SIGNAL_LATE_MONEY', 15, 'Bonus: Late money window', 'signals'),
  ('SIGNAL_RLM', 25, 'Bonus: Reverse line movement', 'signals'),
  ('SIGNAL_CONSENSUS_HIGH', 20, 'Bonus: High market consensus', 'signals'),
  ('SIGNAL_CLV_POSITIVE', 10, 'Bonus: Positive CLV', 'signals'),
  ('SIGNAL_MULTI_MARKET', 15, 'Bonus: Multi-market alignment', 'signals'),
  ('TRAP_PRICE_ONLY', 25, 'Penalty: Price only move', 'traps'),
  ('TRAP_EARLY_MORNING', 15, 'Penalty: Early morning action', 'traps'),
  ('TRAP_BOTH_SIDES', 30, 'Penalty: Both sides moved', 'traps'),
  ('TRAP_INSIGNIFICANT', 20, 'Penalty: Insignificant movement', 'traps'),
  ('TRAP_FAVORITE_SHORT', 20, 'Penalty: Favorite shortening', 'traps'),
  ('TRAP_EXTREME_JUICE', 15, 'Penalty: Extreme juice warning', 'traps'),
  ('TRAP_ISOLATED', 20, 'Penalty: Isolated signal', 'traps'),
  ('TRAP_CLV_NEGATIVE', 10, 'Penalty: Negative CLV', 'traps')
ON CONFLICT (config_key) DO NOTHING;

-- Add new columns to line_movements for v2 engine metrics
ALTER TABLE public.line_movements 
  ADD COLUMN IF NOT EXISTS sharp_pressure NUMERIC DEFAULT 0,
  ADD COLUMN IF NOT EXISTS trap_pressure NUMERIC DEFAULT 0,
  ADD COLUMN IF NOT EXISTS sharp_edge_score NUMERIC DEFAULT 0,
  ADD COLUMN IF NOT EXISTS sharp_probability NUMERIC DEFAULT 50,
  ADD COLUMN IF NOT EXISTS movement_weight NUMERIC DEFAULT 0,
  ADD COLUMN IF NOT EXISTS time_weight NUMERIC DEFAULT 1,
  ADD COLUMN IF NOT EXISTS detected_signals JSONB DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS engine_version TEXT DEFAULT 'v1';

-- Create updated_at trigger for config table
CREATE OR REPLACE FUNCTION update_sharp_engine_config_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER update_sharp_engine_config_timestamp
  BEFORE UPDATE ON public.sharp_engine_config
  FOR EACH ROW
  EXECUTE FUNCTION update_sharp_engine_config_updated_at();
