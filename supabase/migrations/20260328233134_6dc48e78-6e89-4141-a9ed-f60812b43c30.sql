
-- Table 1: FanDuel Line Timeline - persistent 30-day snapshots
CREATE TABLE public.fanduel_line_timeline (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sport TEXT NOT NULL,
  event_id TEXT NOT NULL,
  player_name TEXT NOT NULL,
  prop_type TEXT NOT NULL,
  line NUMERIC NOT NULL,
  over_price NUMERIC,
  under_price NUMERIC,
  snapshot_phase TEXT NOT NULL DEFAULT 'unknown',
  snapshot_time TIMESTAMPTZ NOT NULL DEFAULT now(),
  hours_to_tip NUMERIC,
  line_change_from_open NUMERIC DEFAULT 0,
  price_change_from_open NUMERIC DEFAULT 0,
  drift_velocity NUMERIC DEFAULT 0,
  opening_line NUMERIC,
  opening_over_price NUMERIC,
  opening_under_price NUMERIC,
  event_description TEXT,
  commence_time TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_flt_event_player ON public.fanduel_line_timeline(event_id, player_name, prop_type);
CREATE INDEX idx_flt_sport_time ON public.fanduel_line_timeline(sport, snapshot_time DESC);
CREATE INDEX idx_flt_snapshot_phase ON public.fanduel_line_timeline(snapshot_phase);
CREATE INDEX idx_flt_created ON public.fanduel_line_timeline(created_at);

ALTER TABLE public.fanduel_line_timeline ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Service role full access on fanduel_line_timeline" ON public.fanduel_line_timeline FOR ALL USING (true) WITH CHECK (true);

-- Table 2: FanDuel Behavior Patterns - accumulated permanently
CREATE TABLE public.fanduel_behavior_patterns (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sport TEXT NOT NULL,
  prop_type TEXT NOT NULL,
  pattern_type TEXT NOT NULL,
  avg_reaction_time_minutes NUMERIC DEFAULT 0,
  avg_move_size NUMERIC DEFAULT 0,
  confidence NUMERIC DEFAULT 0,
  sample_size INTEGER DEFAULT 0,
  cascade_sequence JSONB,
  velocity_threshold NUMERIC,
  snapback_pct NUMERIC,
  timing_window TEXT,
  last_updated TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_fbp_sport_prop ON public.fanduel_behavior_patterns(sport, prop_type);
CREATE INDEX idx_fbp_pattern ON public.fanduel_behavior_patterns(pattern_type);
CREATE UNIQUE INDEX idx_fbp_unique ON public.fanduel_behavior_patterns(sport, prop_type, pattern_type);

ALTER TABLE public.fanduel_behavior_patterns ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Service role full access on fanduel_behavior_patterns" ON public.fanduel_behavior_patterns FOR ALL USING (true) WITH CHECK (true);

-- Table 3: FanDuel Prediction Accuracy - feedback loop
CREATE TABLE public.fanduel_prediction_accuracy (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  signal_type TEXT NOT NULL,
  sport TEXT NOT NULL,
  prop_type TEXT NOT NULL,
  player_name TEXT,
  event_id TEXT,
  prediction TEXT NOT NULL,
  predicted_direction TEXT,
  predicted_magnitude NUMERIC,
  actual_outcome TEXT,
  actual_value NUMERIC,
  was_correct BOOLEAN,
  edge_at_signal NUMERIC,
  time_to_tip_hours NUMERIC,
  velocity_at_signal NUMERIC,
  confidence_at_signal NUMERIC,
  signal_factors JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  verified_at TIMESTAMPTZ
);

CREATE INDEX idx_fpa_signal ON public.fanduel_prediction_accuracy(signal_type, sport);
CREATE INDEX idx_fpa_correct ON public.fanduel_prediction_accuracy(was_correct);
CREATE INDEX idx_fpa_created ON public.fanduel_prediction_accuracy(created_at DESC);

ALTER TABLE public.fanduel_prediction_accuracy ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Service role full access on fanduel_prediction_accuracy" ON public.fanduel_prediction_accuracy FOR ALL USING (true) WITH CHECK (true);
