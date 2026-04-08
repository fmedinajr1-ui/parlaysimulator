CREATE TABLE IF NOT EXISTS public.fanduel_prediction_alerts (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  player_name TEXT NOT NULL,
  event_id TEXT NOT NULL,
  signal_type TEXT NOT NULL,
  prediction TEXT NOT NULL,
  confidence INTEGER NOT NULL DEFAULT 0,
  prop_type TEXT,
  sport TEXT,
  bookmaker TEXT DEFAULT 'fanduel',
  event_description TEXT,
  commence_time TIMESTAMPTZ,
  metadata JSONB DEFAULT '{}'::jsonb,
  was_correct BOOLEAN,
  actual_outcome TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  settled_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_fpa_alerts_bookmaker ON public.fanduel_prediction_alerts(bookmaker);
CREATE INDEX IF NOT EXISTS idx_fpa_alerts_created ON public.fanduel_prediction_alerts(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_fpa_alerts_player_event ON public.fanduel_prediction_alerts(player_name, event_id);