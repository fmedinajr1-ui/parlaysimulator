-- NBA Team Locations with coordinates, altitude, and timezone
CREATE TABLE public.nba_team_locations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  team_name text NOT NULL UNIQUE,
  city text NOT NULL,
  arena text NOT NULL,
  latitude numeric NOT NULL,
  longitude numeric NOT NULL,
  altitude_feet integer NOT NULL DEFAULT 0,
  timezone text NOT NULL,
  conference text NOT NULL,
  division text NOT NULL,
  created_at timestamp with time zone NOT NULL DEFAULT now()
);

-- Insert all 30 NBA teams
INSERT INTO public.nba_team_locations (team_name, city, arena, latitude, longitude, altitude_feet, timezone, conference, division) VALUES
('Atlanta Hawks', 'Atlanta', 'State Farm Arena', 33.7573, -84.3963, 1050, 'America/New_York', 'Eastern', 'Southeast'),
('Boston Celtics', 'Boston', 'TD Garden', 42.3662, -71.0621, 20, 'America/New_York', 'Eastern', 'Atlantic'),
('Brooklyn Nets', 'Brooklyn', 'Barclays Center', 40.6826, -73.9754, 30, 'America/New_York', 'Eastern', 'Atlantic'),
('Charlotte Hornets', 'Charlotte', 'Spectrum Center', 35.2251, -80.8392, 751, 'America/New_York', 'Eastern', 'Southeast'),
('Chicago Bulls', 'Chicago', 'United Center', 41.8807, -87.6742, 594, 'America/Chicago', 'Eastern', 'Central'),
('Cleveland Cavaliers', 'Cleveland', 'Rocket Mortgage FieldHouse', 41.4965, -81.6882, 653, 'America/New_York', 'Eastern', 'Central'),
('Dallas Mavericks', 'Dallas', 'American Airlines Center', 32.7905, -96.8103, 430, 'America/Chicago', 'Western', 'Southwest'),
('Denver Nuggets', 'Denver', 'Ball Arena', 39.7486, -104.9908, 5280, 'America/Denver', 'Western', 'Northwest'),
('Detroit Pistons', 'Detroit', 'Little Caesars Arena', 42.3410, -83.0553, 600, 'America/New_York', 'Eastern', 'Central'),
('Golden State Warriors', 'San Francisco', 'Chase Center', 37.7680, -122.3877, 10, 'America/Los_Angeles', 'Western', 'Pacific'),
('Houston Rockets', 'Houston', 'Toyota Center', 29.7508, -95.3621, 50, 'America/Chicago', 'Western', 'Southwest'),
('Indiana Pacers', 'Indianapolis', 'Gainbridge Fieldhouse', 39.7640, -86.1555, 715, 'America/New_York', 'Eastern', 'Central'),
('LA Clippers', 'Los Angeles', 'Intuit Dome', 33.9442, -118.3410, 125, 'America/Los_Angeles', 'Western', 'Pacific'),
('Los Angeles Lakers', 'Los Angeles', 'Crypto.com Arena', 34.0430, -118.2673, 305, 'America/Los_Angeles', 'Western', 'Pacific'),
('Memphis Grizzlies', 'Memphis', 'FedExForum', 35.1382, -90.0506, 337, 'America/Chicago', 'Western', 'Southwest'),
('Miami Heat', 'Miami', 'Kaseya Center', 25.7814, -80.1870, 6, 'America/New_York', 'Eastern', 'Southeast'),
('Milwaukee Bucks', 'Milwaukee', 'Fiserv Forum', 43.0451, -87.9174, 617, 'America/Chicago', 'Eastern', 'Central'),
('Minnesota Timberwolves', 'Minneapolis', 'Target Center', 44.9795, -93.2761, 830, 'America/Chicago', 'Western', 'Northwest'),
('New Orleans Pelicans', 'New Orleans', 'Smoothie King Center', 29.9490, -90.0821, 3, 'America/Chicago', 'Western', 'Southwest'),
('New York Knicks', 'New York', 'Madison Square Garden', 40.7505, -73.9934, 33, 'America/New_York', 'Eastern', 'Atlantic'),
('Oklahoma City Thunder', 'Oklahoma City', 'Paycom Center', 35.4634, -97.5151, 1201, 'America/Chicago', 'Western', 'Northwest'),
('Orlando Magic', 'Orlando', 'Kia Center', 28.5392, -81.3839, 82, 'America/New_York', 'Eastern', 'Southeast'),
('Philadelphia 76ers', 'Philadelphia', 'Wells Fargo Center', 39.9012, -75.1720, 39, 'America/New_York', 'Eastern', 'Atlantic'),
('Phoenix Suns', 'Phoenix', 'Footprint Center', 33.4457, -112.0712, 1086, 'America/Phoenix', 'Western', 'Pacific'),
('Portland Trail Blazers', 'Portland', 'Moda Center', 45.5316, -122.6668, 50, 'America/Los_Angeles', 'Western', 'Northwest'),
('Sacramento Kings', 'Sacramento', 'Golden 1 Center', 38.5802, -121.4997, 30, 'America/Los_Angeles', 'Western', 'Pacific'),
('San Antonio Spurs', 'San Antonio', 'Frost Bank Center', 29.4270, -98.4375, 650, 'America/Chicago', 'Western', 'Southwest'),
('Toronto Raptors', 'Toronto', 'Scotiabank Arena', 43.6435, -79.3791, 250, 'America/Toronto', 'Eastern', 'Atlantic'),
('Utah Jazz', 'Salt Lake City', 'Delta Center', 40.7683, -111.9011, 4226, 'America/Denver', 'Western', 'Northwest'),
('Washington Wizards', 'Washington', 'Capital One Arena', 38.8981, -77.0209, 25, 'America/New_York', 'Eastern', 'Southeast');

-- NBA Schedule Cache for tracking recent games
CREATE TABLE public.nba_schedule_cache (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  team_name text NOT NULL REFERENCES public.nba_team_locations(team_name),
  game_date date NOT NULL,
  opponent text NOT NULL,
  is_home boolean NOT NULL,
  game_time timestamp with time zone NOT NULL,
  venue_city text NOT NULL,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  UNIQUE(team_name, game_date)
);

-- NBA Fatigue Scores for each team/game
CREATE TABLE public.nba_fatigue_scores (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id text NOT NULL,
  team_name text NOT NULL REFERENCES public.nba_team_locations(team_name),
  opponent text NOT NULL,
  game_date date NOT NULL,
  game_time timestamp with time zone NOT NULL,
  is_home boolean NOT NULL,
  
  -- Fatigue factors
  fatigue_score integer NOT NULL DEFAULT 0,
  is_back_to_back boolean NOT NULL DEFAULT false,
  is_road_back_to_back boolean NOT NULL DEFAULT false,
  travel_miles numeric NOT NULL DEFAULT 0,
  timezone_changes integer NOT NULL DEFAULT 0,
  is_altitude_game boolean NOT NULL DEFAULT false,
  is_three_in_four boolean NOT NULL DEFAULT false,
  is_four_in_six boolean NOT NULL DEFAULT false,
  is_early_start boolean NOT NULL DEFAULT false,
  
  -- Fatigue category
  fatigue_category text NOT NULL DEFAULT 'Fresh',
  
  -- Betting adjustments
  ml_adjustment_pct numeric NOT NULL DEFAULT 0,
  spread_adjustment numeric NOT NULL DEFAULT 0,
  points_adjustment_pct numeric NOT NULL DEFAULT 0,
  rebounds_adjustment_pct numeric NOT NULL DEFAULT 0,
  assists_adjustment_pct numeric NOT NULL DEFAULT 0,
  three_pt_adjustment_pct numeric NOT NULL DEFAULT 0,
  blocks_adjustment_pct numeric NOT NULL DEFAULT 0,
  
  -- Recommendations
  recommended_angle text,
  betting_edge_summary text,
  
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  UNIQUE(event_id, team_name)
);

-- Enable RLS
ALTER TABLE public.nba_team_locations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.nba_schedule_cache ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.nba_fatigue_scores ENABLE ROW LEVEL SECURITY;

-- Anyone can view these tables (read-only public data)
CREATE POLICY "Anyone can view team locations" ON public.nba_team_locations FOR SELECT USING (true);
CREATE POLICY "Anyone can view schedule cache" ON public.nba_schedule_cache FOR SELECT USING (true);
CREATE POLICY "Anyone can view fatigue scores" ON public.nba_fatigue_scores FOR SELECT USING (true);

-- Create indexes
CREATE INDEX idx_schedule_cache_team ON public.nba_schedule_cache(team_name, game_date DESC);
CREATE INDEX idx_fatigue_scores_date ON public.nba_fatigue_scores(game_date DESC);
CREATE INDEX idx_fatigue_scores_team ON public.nba_fatigue_scores(team_name);