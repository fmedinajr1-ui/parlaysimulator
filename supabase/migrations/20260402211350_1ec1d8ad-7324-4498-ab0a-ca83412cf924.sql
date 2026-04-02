CREATE TABLE public.accuracy_flip_parlay_tracking (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  parlay_date DATE NOT NULL DEFAULT CURRENT_DATE,
  best_leg_player TEXT NOT NULL,
  best_leg_prop_type TEXT,
  best_leg_sport TEXT,
  best_leg_signal_type TEXT,
  best_leg_prediction TEXT,
  best_leg_accuracy NUMERIC,
  best_leg_outcome TEXT DEFAULT 'pending',
  flip_leg_player TEXT NOT NULL,
  flip_leg_prop_type TEXT,
  flip_leg_sport TEXT,
  flip_leg_signal_type TEXT,
  flip_leg_original_prediction TEXT,
  flip_leg_flipped_prediction TEXT,
  flip_leg_original_accuracy NUMERIC,
  flip_leg_outcome TEXT DEFAULT 'pending',
  parlay_outcome TEXT DEFAULT 'pending',
  best_leg_line NUMERIC,
  flip_leg_line NUMERIC,
  strategy TEXT DEFAULT 'accuracy_flip',
  settled_at TIMESTAMPTZ,
  notes TEXT
);

ALTER TABLE public.accuracy_flip_parlay_tracking ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow public read" ON public.accuracy_flip_parlay_tracking FOR SELECT USING (true);
