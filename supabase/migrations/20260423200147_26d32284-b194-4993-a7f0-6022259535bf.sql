-- Sessions
CREATE TABLE public.ocr_scan_sessions (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  telegram_chat_id BIGINT,
  sport TEXT NOT NULL,
  book TEXT NOT NULL,
  capture_mode TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  finalized_at TIMESTAMPTZ
);

CREATE INDEX idx_ocr_sessions_user ON public.ocr_scan_sessions(user_id, status, created_at DESC);
CREATE INDEX idx_ocr_sessions_tg ON public.ocr_scan_sessions(telegram_chat_id, status) WHERE telegram_chat_id IS NOT NULL;

ALTER TABLE public.ocr_scan_sessions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "owners read sessions" ON public.ocr_scan_sessions
  FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "owners insert sessions" ON public.ocr_scan_sessions
  FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "owners update sessions" ON public.ocr_scan_sessions
  FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "owners delete sessions" ON public.ocr_scan_sessions
  FOR DELETE USING (auth.uid() = user_id);

-- Props
CREATE TABLE public.ocr_scanned_props (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  session_id UUID NOT NULL REFERENCES public.ocr_scan_sessions(id) ON DELETE CASCADE,
  player_name TEXT NOT NULL,
  prop_type TEXT NOT NULL,
  side TEXT NOT NULL,
  line NUMERIC NOT NULL,
  over_price INT,
  under_price INT,
  raw_ocr_text TEXT,
  confidence NUMERIC,
  matched_unified_prop_id UUID,
  market_price_delta INT,
  l10_hit_rate NUMERIC,
  l10_avg NUMERIC,
  opp_def_rank INT,
  sweet_spot_id UUID,
  dna_score INT,
  composite_score INT,
  correlation_tags TEXT[],
  blocked BOOLEAN NOT NULL DEFAULT false,
  block_reason TEXT,
  selected_for_parlay BOOLEAN NOT NULL DEFAULT false,
  source_origin TEXT NOT NULL DEFAULT 'ocr_scan',
  source_channel TEXT NOT NULL DEFAULT 'web',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (session_id, player_name, prop_type, side, line)
);

CREATE INDEX idx_ocr_props_session ON public.ocr_scanned_props(session_id, created_at DESC);
CREATE INDEX idx_ocr_props_selected ON public.ocr_scanned_props(session_id) WHERE selected_for_parlay = true;

ALTER TABLE public.ocr_scanned_props ENABLE ROW LEVEL SECURITY;

CREATE POLICY "owners read props" ON public.ocr_scanned_props
  FOR SELECT USING (
    EXISTS (SELECT 1 FROM public.ocr_scan_sessions s
            WHERE s.id = session_id AND s.user_id = auth.uid())
  );
CREATE POLICY "owners insert props" ON public.ocr_scanned_props
  FOR INSERT WITH CHECK (
    EXISTS (SELECT 1 FROM public.ocr_scan_sessions s
            WHERE s.id = session_id AND s.user_id = auth.uid())
  );
CREATE POLICY "owners update props" ON public.ocr_scanned_props
  FOR UPDATE USING (
    EXISTS (SELECT 1 FROM public.ocr_scan_sessions s
            WHERE s.id = session_id AND s.user_id = auth.uid())
  );
CREATE POLICY "owners delete props" ON public.ocr_scanned_props
  FOR DELETE USING (
    EXISTS (SELECT 1 FROM public.ocr_scan_sessions s
            WHERE s.id = session_id AND s.user_id = auth.uid())
  );

-- Realtime
ALTER PUBLICATION supabase_realtime ADD TABLE public.ocr_scanned_props;
ALTER TABLE public.ocr_scanned_props REPLICA IDENTITY FULL;