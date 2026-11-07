CREATE TABLE public.research_minutes_log (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 game_date date NOT NULL,
 player_name text NOT NULL,
 team text NOT NULL,
 forecast_version text NOT NULL DEFAULT 'minutes-v1',
 projected_minutes numeric NOT NULL CHECK (projected_minutes > 0 AND projected_minutes <= 48),
 baseline_minutes numeric NOT NULL CHECK (baseline_minutes > 0),
 actual_minutes numeric,
 status text NOT NULL DEFAULT 'open' CHECK (status IN ('open','graded','excluded')),
 logged_at timestamptz NOT NULL DEFAULT now(),
 settled_at timestamptz,
 UNIQUE(game_date,player_name,forecast_version)
);
GRANT ALL ON public.research_minutes_log TO service_role;
ALTER TABLE public.research_minutes_log ENABLE ROW LEVEL SECURITY;
COMMENT ON TABLE public.research_minutes_log IS 'Private pregame minutes snapshots; passcode-checked desk-bets access only. DNP/missing games excluded from accuracy.';