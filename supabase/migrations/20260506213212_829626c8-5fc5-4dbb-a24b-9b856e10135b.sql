-- Nuke Parlay Scout Phase 2: cross-sport rosters table
CREATE TABLE IF NOT EXISTS public.rosters (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sport text NOT NULL,
  player_name text NOT NULL,
  player_name_normalized text NOT NULL,
  team text NOT NULL,
  position text,
  last_synced_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS rosters_lookup_idx
  ON public.rosters(sport, player_name_normalized);

CREATE INDEX IF NOT EXISTS rosters_team_idx
  ON public.rosters(sport, team);

ALTER TABLE public.rosters ENABLE ROW LEVEL SECURITY;

-- Service role full access (edge functions)
DROP POLICY IF EXISTS "service role full access" ON public.rosters;
CREATE POLICY "service role full access" ON public.rosters
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- Admin read (uses existing has_role helper if present; otherwise authenticated read is fine for a lookup table)
DROP POLICY IF EXISTS "authenticated read" ON public.rosters;
CREATE POLICY "authenticated read" ON public.rosters
  FOR SELECT TO authenticated USING (true);
