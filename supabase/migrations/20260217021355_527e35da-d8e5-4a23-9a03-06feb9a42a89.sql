
-- Add real KenPom columns to ncaab_team_stats
ALTER TABLE public.ncaab_team_stats 
  ADD COLUMN IF NOT EXISTS kenpom_adj_o numeric,
  ADD COLUMN IF NOT EXISTS kenpom_adj_d numeric,
  ADD COLUMN IF NOT EXISTS sos_rank integer,
  ADD COLUMN IF NOT EXISTS luck_factor numeric,
  ADD COLUMN IF NOT EXISTS kenpom_source text DEFAULT 'derived';

-- NCAAB Referee Data
CREATE TABLE IF NOT EXISTS public.ncaab_referee_data (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  referee_name text NOT NULL UNIQUE,
  games_officiated integer DEFAULT 0,
  avg_fouls_per_game numeric,
  avg_total_points numeric,
  over_rate numeric,
  under_rate numeric,
  pace_tendency text DEFAULT 'neutral',
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);
ALTER TABLE public.ncaab_referee_data ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Public read ncaab_referee_data" ON public.ncaab_referee_data FOR SELECT USING (true);

-- NCAAB Game Referees (upcoming games)
CREATE TABLE IF NOT EXISTS public.ncaab_game_referees (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  game_date date NOT NULL,
  home_team text NOT NULL,
  away_team text NOT NULL,
  referee_names jsonb,
  expected_pace_impact numeric DEFAULT 0,
  expected_total_adjustment numeric DEFAULT 0,
  created_at timestamptz DEFAULT now()
);
ALTER TABLE public.ncaab_game_referees ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Public read ncaab_game_referees" ON public.ncaab_game_referees FOR SELECT USING (true);
CREATE INDEX idx_ncaab_game_referees_date ON public.ncaab_game_referees(game_date);

-- NCAAB Team Locations (venue/altitude/travel)
CREATE TABLE IF NOT EXISTS public.ncaab_team_locations (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  team_name text NOT NULL UNIQUE,
  city text,
  state text,
  latitude numeric,
  longitude numeric,
  timezone text DEFAULT 'America/New_York',
  altitude_feet integer DEFAULT 0,
  conference text
);
ALTER TABLE public.ncaab_team_locations ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Public read ncaab_team_locations" ON public.ncaab_team_locations FOR SELECT USING (true);

-- NCAAB Fatigue Scores
CREATE TABLE IF NOT EXISTS public.ncaab_fatigue_scores (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  team_name text NOT NULL,
  opponent text,
  fatigue_score numeric DEFAULT 0,
  fatigue_category text DEFAULT 'rested',
  is_back_to_back boolean DEFAULT false,
  travel_miles numeric DEFAULT 0,
  timezone_changes integer DEFAULT 0,
  is_altitude_game boolean DEFAULT false,
  altitude_differential integer DEFAULT 0,
  game_date date NOT NULL,
  event_id text,
  created_at timestamptz DEFAULT now()
);
ALTER TABLE public.ncaab_fatigue_scores ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Public read ncaab_fatigue_scores" ON public.ncaab_fatigue_scores FOR SELECT USING (true);
CREATE INDEX idx_ncaab_fatigue_date ON public.ncaab_fatigue_scores(game_date);
CREATE UNIQUE INDEX idx_ncaab_fatigue_team_date ON public.ncaab_fatigue_scores(team_name, game_date);

-- Seed high-altitude team locations
INSERT INTO public.ncaab_team_locations (team_name, city, state, latitude, longitude, timezone, altitude_feet, conference) VALUES
  ('Colorado Buffaloes', 'Boulder', 'CO', 40.0076, -105.2659, 'America/Denver', 5328, 'Big 12'),
  ('Air Force Falcons', 'Colorado Springs', 'CO', 38.8339, -104.8214, 'America/Denver', 6035, 'MWC'),
  ('BYU Cougars', 'Provo', 'UT', 40.2338, -111.6585, 'America/Denver', 4551, 'Big 12'),
  ('Utah Utes', 'Salt Lake City', 'UT', 40.7608, -111.8910, 'America/Denver', 4226, 'Big 12'),
  ('Wyoming Cowboys', 'Laramie', 'WY', 41.3114, -105.5911, 'America/Denver', 7220, 'MWC'),
  ('Nevada Wolf Pack', 'Reno', 'NV', 39.5296, -119.8138, 'America/Los_Angeles', 4505, 'MWC'),
  ('New Mexico Lobos', 'Albuquerque', 'NM', 35.0844, -106.6504, 'America/Denver', 5312, 'MWC'),
  ('Boise State Broncos', 'Boise', 'ID', 43.6150, -116.2023, 'America/Boise', 2730, 'MWC'),
  ('Utah State Aggies', 'Logan', 'UT', 41.7370, -111.8338, 'America/Denver', 4534, 'MWC'),
  ('Colorado State Rams', 'Fort Collins', 'CO', 40.5853, -105.0844, 'America/Denver', 5003, 'MWC'),
  ('UNLV Rebels', 'Las Vegas', 'NV', 36.1699, -115.1398, 'America/Los_Angeles', 2001, 'MWC'),
  ('San Diego State Aztecs', 'San Diego', 'CA', 32.7757, -117.0719, 'America/Los_Angeles', 16, 'MWC'),
  ('Fresno State Bulldogs', 'Fresno', 'CA', 36.8127, -119.7451, 'America/Los_Angeles', 328, 'MWC'),
  ('San Jose State Spartans', 'San Jose', 'CA', 37.3382, -121.8863, 'America/Los_Angeles', 82, 'MWC'),
  ('Duke Blue Devils', 'Durham', 'NC', 35.9940, -78.8986, 'America/New_York', 404, 'ACC'),
  ('North Carolina Tar Heels', 'Chapel Hill', 'NC', 35.9132, -79.0558, 'America/New_York', 502, 'ACC'),
  ('Kentucky Wildcats', 'Lexington', 'KY', 38.0406, -84.5037, 'America/New_York', 978, 'SEC'),
  ('Kansas Jayhawks', 'Lawrence', 'KS', 38.9717, -95.2353, 'America/Chicago', 866, 'Big 12'),
  ('Gonzaga Bulldogs', 'Spokane', 'WA', 47.6588, -117.4260, 'America/Los_Angeles', 1920, 'WCC'),
  ('Auburn Tigers', 'Auburn', 'AL', 32.6099, -85.4808, 'America/Chicago', 709, 'SEC'),
  ('Houston Cougars', 'Houston', 'TX', 29.7604, -95.3698, 'America/Chicago', 80, 'Big 12'),
  ('Florida Gators', 'Gainesville', 'FL', 29.6516, -82.3248, 'America/New_York', 177, 'SEC'),
  ('Alabama Crimson Tide', 'Tuscaloosa', 'AL', 33.2098, -87.5692, 'America/Chicago', 222, 'SEC'),
  ('Tennessee Volunteers', 'Knoxville', 'TN', 35.9606, -83.9207, 'America/New_York', 886, 'SEC'),
  ('Purdue Boilermakers', 'West Lafayette', 'IN', 40.4237, -86.9212, 'America/New_York', 640, 'Big Ten'),
  ('Connecticut Huskies', 'Storrs', 'CT', 41.8084, -72.2495, 'America/New_York', 640, 'Big East'),
  ('Iowa State Cyclones', 'Ames', 'IA', 42.0308, -93.6319, 'America/Chicago', 942, 'Big 12'),
  ('Michigan State Spartans', 'East Lansing', 'MI', 42.7018, -84.4822, 'America/New_York', 841, 'Big Ten'),
  ('Texas Tech Red Raiders', 'Lubbock', 'TX', 33.5779, -101.8552, 'America/Chicago', 3202, 'Big 12'),
  ('Oregon Ducks', 'Eugene', 'OR', 44.0521, -123.0868, 'America/Los_Angeles', 426, 'Big Ten')
ON CONFLICT (team_name) DO NOTHING;
