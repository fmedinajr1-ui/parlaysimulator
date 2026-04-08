CREATE TABLE public.hrb_rbi_line_timeline (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  event_id text NOT NULL,
  player_name text NOT NULL,
  prop_type text NOT NULL DEFAULT 'batter_rbis',
  line numeric NOT NULL,
  over_price numeric,
  under_price numeric,
  opening_line numeric,
  opening_over_price numeric,
  opening_under_price numeric,
  line_change_from_open numeric,
  price_change_from_open numeric,
  drift_velocity numeric,
  snapshot_phase text DEFAULT 'live',
  snapshot_time timestamptz NOT NULL DEFAULT now(),
  hours_to_tip numeric,
  event_description text,
  commence_time timestamptz,
  sport text NOT NULL DEFAULT 'MLB',
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.hrb_rbi_line_timeline ENABLE ROW LEVEL SECURITY;

CREATE INDEX idx_hrb_rbi_timeline_lookup ON public.hrb_rbi_line_timeline (player_name, prop_type, snapshot_time DESC);
CREATE INDEX idx_hrb_rbi_timeline_event ON public.hrb_rbi_line_timeline (event_id, player_name);