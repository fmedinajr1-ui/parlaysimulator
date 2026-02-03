-- Player Zone Stats - stores zone-based shooting percentages per player
CREATE TABLE public.player_zone_stats (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  player_name text NOT NULL,
  season text NOT NULL DEFAULT '2024-25',
  zone text NOT NULL CHECK (zone IN ('restricted_area', 'paint', 'mid_range', 'corner_3', 'above_break_3')),
  fga integer DEFAULT 0,
  fgm integer DEFAULT 0,
  fg_pct numeric(5,3),
  frequency numeric(5,3),
  updated_at timestamptz DEFAULT now(),
  UNIQUE(player_name, season, zone)
);

-- Team Zone Defense - stores team defensive efficiency by zone
CREATE TABLE public.team_zone_defense (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  team_abbrev text NOT NULL,
  season text NOT NULL DEFAULT '2024-25',
  zone text NOT NULL CHECK (zone IN ('restricted_area', 'paint', 'mid_range', 'corner_3', 'above_break_3')),
  opp_fga integer DEFAULT 0,
  opp_fg_pct numeric(5,3),
  league_avg_pct numeric(5,3),
  defense_rating text CHECK (defense_rating IN ('elite', 'good', 'average', 'poor', 'weak')),
  rank integer CHECK (rank >= 1 AND rank <= 30),
  updated_at timestamptz DEFAULT now(),
  UNIQUE(team_abbrev, season, zone)
);

-- Create indexes for efficient lookups
CREATE INDEX idx_player_zone_stats_player ON public.player_zone_stats(player_name);
CREATE INDEX idx_player_zone_stats_season ON public.player_zone_stats(season);
CREATE INDEX idx_team_zone_defense_team ON public.team_zone_defense(team_abbrev);
CREATE INDEX idx_team_zone_defense_season ON public.team_zone_defense(season);

-- Enable RLS
ALTER TABLE public.player_zone_stats ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.team_zone_defense ENABLE ROW LEVEL SECURITY;

-- Public read access (stats are public data)
CREATE POLICY "Anyone can read player zone stats"
ON public.player_zone_stats FOR SELECT USING (true);

CREATE POLICY "Anyone can read team zone defense"
ON public.team_zone_defense FOR SELECT USING (true);

-- Service role can insert/update (edge functions)
CREATE POLICY "Service role can manage player zone stats"
ON public.player_zone_stats FOR ALL
USING (auth.role() = 'service_role')
WITH CHECK (auth.role() = 'service_role');

CREATE POLICY "Service role can manage team zone defense"
ON public.team_zone_defense FOR ALL
USING (auth.role() = 'service_role')
WITH CHECK (auth.role() = 'service_role');