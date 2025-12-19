-- Create team_aliases table for centralized team name lookups
CREATE TABLE public.team_aliases (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sport TEXT NOT NULL,
  team_abbreviation TEXT NOT NULL,
  team_name TEXT NOT NULL,
  city TEXT,
  nickname TEXT,
  aliases JSONB DEFAULT '[]'::jsonb,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(sport, team_abbreviation)
);

-- Create optimized indexes
CREATE INDEX idx_team_aliases_sport ON public.team_aliases(sport);
CREATE INDEX idx_team_aliases_abbrev ON public.team_aliases(team_abbreviation);
CREATE INDEX idx_team_aliases_aliases_gin ON public.team_aliases USING GIN(aliases);
CREATE INDEX idx_team_aliases_sport_abbrev ON public.team_aliases(sport, team_abbreviation);

-- Enable RLS
ALTER TABLE public.team_aliases ENABLE ROW LEVEL SECURITY;

-- Public read access
CREATE POLICY "Anyone can view team aliases"
  ON public.team_aliases FOR SELECT
  USING (true);

-- Create find_team_by_alias function for fast lookups
CREATE OR REPLACE FUNCTION public.find_team_by_alias(
  search_term TEXT,
  sport_filter TEXT DEFAULT NULL
)
RETURNS TABLE(
  team_abbreviation TEXT,
  team_name TEXT,
  sport TEXT,
  nickname TEXT,
  match_type TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  normalized_search TEXT;
BEGIN
  normalized_search := LOWER(TRIM(search_term));
  
  -- Priority 1: Exact abbreviation match
  RETURN QUERY
  SELECT 
    ta.team_abbreviation,
    ta.team_name,
    ta.sport,
    ta.nickname,
    'exact_abbrev'::TEXT as match_type
  FROM team_aliases ta
  WHERE LOWER(ta.team_abbreviation) = normalized_search
    AND ta.is_active = true
    AND (sport_filter IS NULL OR ta.sport = sport_filter)
  LIMIT 1;
  
  IF FOUND THEN RETURN; END IF;
  
  -- Priority 2: Exact team name match
  RETURN QUERY
  SELECT 
    ta.team_abbreviation,
    ta.team_name,
    ta.sport,
    ta.nickname,
    'exact_name'::TEXT as match_type
  FROM team_aliases ta
  WHERE LOWER(ta.team_name) = normalized_search
    AND ta.is_active = true
    AND (sport_filter IS NULL OR ta.sport = sport_filter)
  LIMIT 1;
  
  IF FOUND THEN RETURN; END IF;
  
  -- Priority 3: Exact nickname match
  RETURN QUERY
  SELECT 
    ta.team_abbreviation,
    ta.team_name,
    ta.sport,
    ta.nickname,
    'exact_nickname'::TEXT as match_type
  FROM team_aliases ta
  WHERE LOWER(ta.nickname) = normalized_search
    AND ta.is_active = true
    AND (sport_filter IS NULL OR ta.sport = sport_filter)
  LIMIT 1;
  
  IF FOUND THEN RETURN; END IF;
  
  -- Priority 4: JSONB alias array containment (uses GIN index)
  RETURN QUERY
  SELECT 
    ta.team_abbreviation,
    ta.team_name,
    ta.sport,
    ta.nickname,
    'alias_match'::TEXT as match_type
  FROM team_aliases ta
  WHERE ta.aliases @> to_jsonb(normalized_search)
    AND ta.is_active = true
    AND (sport_filter IS NULL OR ta.sport = sport_filter)
  LIMIT 1;
  
  IF FOUND THEN RETURN; END IF;
  
  -- Priority 5: Partial match fallback (ILIKE)
  RETURN QUERY
  SELECT 
    ta.team_abbreviation,
    ta.team_name,
    ta.sport,
    ta.nickname,
    'partial_match'::TEXT as match_type
  FROM team_aliases ta
  WHERE (
    ta.team_name ILIKE '%' || normalized_search || '%'
    OR ta.nickname ILIKE '%' || normalized_search || '%'
    OR ta.city ILIKE '%' || normalized_search || '%'
  )
    AND ta.is_active = true
    AND (sport_filter IS NULL OR ta.sport = sport_filter)
  LIMIT 1;
END;
$$;

-- ============ SEED DATA ============

-- NBA Teams (30)
INSERT INTO public.team_aliases (sport, team_abbreviation, team_name, city, nickname, aliases) VALUES
('NBA', 'ATL', 'Atlanta Hawks', 'Atlanta', 'Hawks', '["hawks", "atlanta", "atlanta hawks", "atl"]'),
('NBA', 'BOS', 'Boston Celtics', 'Boston', 'Celtics', '["celtics", "boston", "boston celtics", "bos"]'),
('NBA', 'BKN', 'Brooklyn Nets', 'Brooklyn', 'Nets', '["nets", "brooklyn", "brooklyn nets", "bkn"]'),
('NBA', 'CHA', 'Charlotte Hornets', 'Charlotte', 'Hornets', '["hornets", "charlotte", "charlotte hornets", "cha"]'),
('NBA', 'CHI', 'Chicago Bulls', 'Chicago', 'Bulls', '["bulls", "chicago", "chicago bulls", "chi"]'),
('NBA', 'CLE', 'Cleveland Cavaliers', 'Cleveland', 'Cavaliers', '["cavaliers", "cavs", "cleveland", "cleveland cavaliers", "cle"]'),
('NBA', 'DAL', 'Dallas Mavericks', 'Dallas', 'Mavericks', '["mavericks", "mavs", "dallas", "dallas mavericks", "dal"]'),
('NBA', 'DEN', 'Denver Nuggets', 'Denver', 'Nuggets', '["nuggets", "denver", "denver nuggets", "den"]'),
('NBA', 'DET', 'Detroit Pistons', 'Detroit', 'Pistons', '["pistons", "detroit", "detroit pistons", "det"]'),
('NBA', 'GSW', 'Golden State Warriors', 'Golden State', 'Warriors', '["warriors", "golden state", "golden state warriors", "gsw", "gs", "dubs"]'),
('NBA', 'HOU', 'Houston Rockets', 'Houston', 'Rockets', '["rockets", "houston", "houston rockets", "hou"]'),
('NBA', 'IND', 'Indiana Pacers', 'Indiana', 'Pacers', '["pacers", "indiana", "indiana pacers", "ind"]'),
('NBA', 'LAC', 'Los Angeles Clippers', 'Los Angeles', 'Clippers', '["clippers", "la clippers", "los angeles clippers", "lac"]'),
('NBA', 'LAL', 'Los Angeles Lakers', 'Los Angeles', 'Lakers', '["lakers", "la lakers", "los angeles lakers", "lal", "lake show"]'),
('NBA', 'MEM', 'Memphis Grizzlies', 'Memphis', 'Grizzlies', '["grizzlies", "grizz", "memphis", "memphis grizzlies", "mem"]'),
('NBA', 'MIA', 'Miami Heat', 'Miami', 'Heat', '["heat", "miami", "miami heat", "mia"]'),
('NBA', 'MIL', 'Milwaukee Bucks', 'Milwaukee', 'Bucks', '["bucks", "milwaukee", "milwaukee bucks", "mil"]'),
('NBA', 'MIN', 'Minnesota Timberwolves', 'Minnesota', 'Timberwolves', '["timberwolves", "wolves", "minnesota", "minnesota timberwolves", "min"]'),
('NBA', 'NOP', 'New Orleans Pelicans', 'New Orleans', 'Pelicans', '["pelicans", "pels", "new orleans", "new orleans pelicans", "nop", "no"]'),
('NBA', 'NYK', 'New York Knicks', 'New York', 'Knicks', '["knicks", "new york", "new york knicks", "nyk", "ny knicks"]'),
('NBA', 'OKC', 'Oklahoma City Thunder', 'Oklahoma City', 'Thunder', '["thunder", "okc", "oklahoma city", "oklahoma city thunder"]'),
('NBA', 'ORL', 'Orlando Magic', 'Orlando', 'Magic', '["magic", "orlando", "orlando magic", "orl"]'),
('NBA', 'PHI', 'Philadelphia 76ers', 'Philadelphia', '76ers', '["76ers", "sixers", "philadelphia", "philadelphia 76ers", "phi", "philly"]'),
('NBA', 'PHX', 'Phoenix Suns', 'Phoenix', 'Suns', '["suns", "phoenix", "phoenix suns", "phx"]'),
('NBA', 'POR', 'Portland Trail Blazers', 'Portland', 'Trail Blazers', '["trail blazers", "blazers", "portland", "portland trail blazers", "por"]'),
('NBA', 'SAC', 'Sacramento Kings', 'Sacramento', 'Kings', '["kings", "sacramento", "sacramento kings", "sac"]'),
('NBA', 'SAS', 'San Antonio Spurs', 'San Antonio', 'Spurs', '["spurs", "san antonio", "san antonio spurs", "sas", "sa"]'),
('NBA', 'TOR', 'Toronto Raptors', 'Toronto', 'Raptors', '["raptors", "toronto", "toronto raptors", "tor"]'),
('NBA', 'UTA', 'Utah Jazz', 'Utah', 'Jazz', '["jazz", "utah", "utah jazz", "uta"]'),
('NBA', 'WAS', 'Washington Wizards', 'Washington', 'Wizards', '["wizards", "washington", "washington wizards", "was", "wiz"]'),

-- NFL Teams (32)
('NFL', 'ARI', 'Arizona Cardinals', 'Arizona', 'Cardinals', '["cardinals", "arizona", "arizona cardinals", "ari", "az"]'),
('NFL', 'ATL', 'Atlanta Falcons', 'Atlanta', 'Falcons', '["falcons", "atlanta", "atlanta falcons", "atl"]'),
('NFL', 'BAL', 'Baltimore Ravens', 'Baltimore', 'Ravens', '["ravens", "baltimore", "baltimore ravens", "bal"]'),
('NFL', 'BUF', 'Buffalo Bills', 'Buffalo', 'Bills', '["bills", "buffalo", "buffalo bills", "buf"]'),
('NFL', 'CAR', 'Carolina Panthers', 'Carolina', 'Panthers', '["panthers", "carolina", "carolina panthers", "car"]'),
('NFL', 'CHI', 'Chicago Bears', 'Chicago', 'Bears', '["bears", "chicago", "chicago bears", "chi"]'),
('NFL', 'CIN', 'Cincinnati Bengals', 'Cincinnati', 'Bengals', '["bengals", "cincinnati", "cincinnati bengals", "cin"]'),
('NFL', 'CLE', 'Cleveland Browns', 'Cleveland', 'Browns', '["browns", "cleveland", "cleveland browns", "cle"]'),
('NFL', 'DAL', 'Dallas Cowboys', 'Dallas', 'Cowboys', '["cowboys", "dallas", "dallas cowboys", "dal"]'),
('NFL', 'DEN', 'Denver Broncos', 'Denver', 'Broncos', '["broncos", "denver", "denver broncos", "den"]'),
('NFL', 'DET', 'Detroit Lions', 'Detroit', 'Lions', '["lions", "detroit", "detroit lions", "det"]'),
('NFL', 'GB', 'Green Bay Packers', 'Green Bay', 'Packers', '["packers", "green bay", "green bay packers", "gb", "gnb"]'),
('NFL', 'HOU', 'Houston Texans', 'Houston', 'Texans', '["texans", "houston", "houston texans", "hou"]'),
('NFL', 'IND', 'Indianapolis Colts', 'Indianapolis', 'Colts', '["colts", "indianapolis", "indianapolis colts", "ind"]'),
('NFL', 'JAX', 'Jacksonville Jaguars', 'Jacksonville', 'Jaguars', '["jaguars", "jags", "jacksonville", "jacksonville jaguars", "jax"]'),
('NFL', 'KC', 'Kansas City Chiefs', 'Kansas City', 'Chiefs', '["chiefs", "kansas city", "kansas city chiefs", "kc"]'),
('NFL', 'LV', 'Las Vegas Raiders', 'Las Vegas', 'Raiders', '["raiders", "las vegas", "las vegas raiders", "lv", "lvr"]'),
('NFL', 'LAC', 'Los Angeles Chargers', 'Los Angeles', 'Chargers', '["chargers", "la chargers", "los angeles chargers", "lac"]'),
('NFL', 'LAR', 'Los Angeles Rams', 'Los Angeles', 'Rams', '["rams", "la rams", "los angeles rams", "lar"]'),
('NFL', 'MIA', 'Miami Dolphins', 'Miami', 'Dolphins', '["dolphins", "miami", "miami dolphins", "mia"]'),
('NFL', 'MIN', 'Minnesota Vikings', 'Minnesota', 'Vikings', '["vikings", "minnesota", "minnesota vikings", "min"]'),
('NFL', 'NE', 'New England Patriots', 'New England', 'Patriots', '["patriots", "pats", "new england", "new england patriots", "ne"]'),
('NFL', 'NO', 'New Orleans Saints', 'New Orleans', 'Saints', '["saints", "new orleans", "new orleans saints", "no"]'),
('NFL', 'NYG', 'New York Giants', 'New York', 'Giants', '["giants", "ny giants", "new york giants", "nyg"]'),
('NFL', 'NYJ', 'New York Jets', 'New York', 'Jets', '["jets", "ny jets", "new york jets", "nyj"]'),
('NFL', 'PHI', 'Philadelphia Eagles', 'Philadelphia', 'Eagles', '["eagles", "philadelphia", "philadelphia eagles", "phi", "philly"]'),
('NFL', 'PIT', 'Pittsburgh Steelers', 'Pittsburgh', 'Steelers', '["steelers", "pittsburgh", "pittsburgh steelers", "pit"]'),
('NFL', 'SF', 'San Francisco 49ers', 'San Francisco', '49ers', '["49ers", "niners", "san francisco", "san francisco 49ers", "sf"]'),
('NFL', 'SEA', 'Seattle Seahawks', 'Seattle', 'Seahawks', '["seahawks", "hawks", "seattle", "seattle seahawks", "sea"]'),
('NFL', 'TB', 'Tampa Bay Buccaneers', 'Tampa Bay', 'Buccaneers', '["buccaneers", "bucs", "tampa bay", "tampa bay buccaneers", "tb"]'),
('NFL', 'TEN', 'Tennessee Titans', 'Tennessee', 'Titans', '["titans", "tennessee", "tennessee titans", "ten"]'),
('NFL', 'WAS', 'Washington Commanders', 'Washington', 'Commanders', '["commanders", "washington", "washington commanders", "was", "wsh"]'),

-- NHL Teams (32)
('NHL', 'ANA', 'Anaheim Ducks', 'Anaheim', 'Ducks', '["ducks", "anaheim", "anaheim ducks", "ana"]'),
('NHL', 'ARI', 'Arizona Coyotes', 'Arizona', 'Coyotes', '["coyotes", "yotes", "arizona", "arizona coyotes", "ari"]'),
('NHL', 'BOS', 'Boston Bruins', 'Boston', 'Bruins', '["bruins", "boston", "boston bruins", "bos"]'),
('NHL', 'BUF', 'Buffalo Sabres', 'Buffalo', 'Sabres', '["sabres", "buffalo", "buffalo sabres", "buf"]'),
('NHL', 'CGY', 'Calgary Flames', 'Calgary', 'Flames', '["flames", "calgary", "calgary flames", "cgy"]'),
('NHL', 'CAR', 'Carolina Hurricanes', 'Carolina', 'Hurricanes', '["hurricanes", "canes", "carolina", "carolina hurricanes", "car"]'),
('NHL', 'CHI', 'Chicago Blackhawks', 'Chicago', 'Blackhawks', '["blackhawks", "hawks", "chicago", "chicago blackhawks", "chi"]'),
('NHL', 'COL', 'Colorado Avalanche', 'Colorado', 'Avalanche', '["avalanche", "avs", "colorado", "colorado avalanche", "col"]'),
('NHL', 'CBJ', 'Columbus Blue Jackets', 'Columbus', 'Blue Jackets', '["blue jackets", "jackets", "columbus", "columbus blue jackets", "cbj"]'),
('NHL', 'DAL', 'Dallas Stars', 'Dallas', 'Stars', '["stars", "dallas", "dallas stars", "dal"]'),
('NHL', 'DET', 'Detroit Red Wings', 'Detroit', 'Red Wings', '["red wings", "wings", "detroit", "detroit red wings", "det"]'),
('NHL', 'EDM', 'Edmonton Oilers', 'Edmonton', 'Oilers', '["oilers", "edmonton", "edmonton oilers", "edm"]'),
('NHL', 'FLA', 'Florida Panthers', 'Florida', 'Panthers', '["panthers", "florida", "florida panthers", "fla"]'),
('NHL', 'LAK', 'Los Angeles Kings', 'Los Angeles', 'Kings', '["kings", "la kings", "los angeles kings", "lak"]'),
('NHL', 'MIN', 'Minnesota Wild', 'Minnesota', 'Wild', '["wild", "minnesota", "minnesota wild", "min"]'),
('NHL', 'MTL', 'Montreal Canadiens', 'Montreal', 'Canadiens', '["canadiens", "habs", "montreal", "montreal canadiens", "mtl"]'),
('NHL', 'NSH', 'Nashville Predators', 'Nashville', 'Predators', '["predators", "preds", "nashville", "nashville predators", "nsh"]'),
('NHL', 'NJD', 'New Jersey Devils', 'New Jersey', 'Devils', '["devils", "new jersey", "new jersey devils", "njd", "nj"]'),
('NHL', 'NYI', 'New York Islanders', 'New York', 'Islanders', '["islanders", "isles", "ny islanders", "new york islanders", "nyi"]'),
('NHL', 'NYR', 'New York Rangers', 'New York', 'Rangers', '["rangers", "ny rangers", "new york rangers", "nyr"]'),
('NHL', 'OTT', 'Ottawa Senators', 'Ottawa', 'Senators', '["senators", "sens", "ottawa", "ottawa senators", "ott"]'),
('NHL', 'PHI', 'Philadelphia Flyers', 'Philadelphia', 'Flyers', '["flyers", "philadelphia", "philadelphia flyers", "phi", "philly"]'),
('NHL', 'PIT', 'Pittsburgh Penguins', 'Pittsburgh', 'Penguins', '["penguins", "pens", "pittsburgh", "pittsburgh penguins", "pit"]'),
('NHL', 'SJS', 'San Jose Sharks', 'San Jose', 'Sharks', '["sharks", "san jose", "san jose sharks", "sjs", "sj"]'),
('NHL', 'SEA', 'Seattle Kraken', 'Seattle', 'Kraken', '["kraken", "seattle", "seattle kraken", "sea"]'),
('NHL', 'STL', 'St. Louis Blues', 'St. Louis', 'Blues', '["blues", "st louis", "st. louis blues", "stl"]'),
('NHL', 'TBL', 'Tampa Bay Lightning', 'Tampa Bay', 'Lightning', '["lightning", "bolts", "tampa bay", "tampa bay lightning", "tbl", "tb"]'),
('NHL', 'TOR', 'Toronto Maple Leafs', 'Toronto', 'Maple Leafs', '["maple leafs", "leafs", "toronto", "toronto maple leafs", "tor"]'),
('NHL', 'UTA', 'Utah Hockey Club', 'Utah', 'Hockey Club', '["utah", "utah hockey club", "uta"]'),
('NHL', 'VAN', 'Vancouver Canucks', 'Vancouver', 'Canucks', '["canucks", "nucks", "vancouver", "vancouver canucks", "van"]'),
('NHL', 'VGK', 'Vegas Golden Knights', 'Vegas', 'Golden Knights', '["golden knights", "knights", "vegas", "vegas golden knights", "vgk"]'),
('NHL', 'WSH', 'Washington Capitals', 'Washington', 'Capitals', '["capitals", "caps", "washington", "washington capitals", "wsh"]'),
('NHL', 'WPG', 'Winnipeg Jets', 'Winnipeg', 'Jets', '["jets", "winnipeg", "winnipeg jets", "wpg"]'),

-- MLB Teams (30)
('MLB', 'ARI', 'Arizona Diamondbacks', 'Arizona', 'Diamondbacks', '["diamondbacks", "dbacks", "arizona", "arizona diamondbacks", "ari", "az"]'),
('MLB', 'ATL', 'Atlanta Braves', 'Atlanta', 'Braves', '["braves", "atlanta", "atlanta braves", "atl"]'),
('MLB', 'BAL', 'Baltimore Orioles', 'Baltimore', 'Orioles', '["orioles", "os", "baltimore", "baltimore orioles", "bal"]'),
('MLB', 'BOS', 'Boston Red Sox', 'Boston', 'Red Sox', '["red sox", "sox", "boston", "boston red sox", "bos"]'),
('MLB', 'CHC', 'Chicago Cubs', 'Chicago', 'Cubs', '["cubs", "chicago cubs", "chc"]'),
('MLB', 'CHW', 'Chicago White Sox', 'Chicago', 'White Sox', '["white sox", "chicago white sox", "chw", "cws"]'),
('MLB', 'CIN', 'Cincinnati Reds', 'Cincinnati', 'Reds', '["reds", "cincinnati", "cincinnati reds", "cin"]'),
('MLB', 'CLE', 'Cleveland Guardians', 'Cleveland', 'Guardians', '["guardians", "cleveland", "cleveland guardians", "cle"]'),
('MLB', 'COL', 'Colorado Rockies', 'Colorado', 'Rockies', '["rockies", "colorado", "colorado rockies", "col"]'),
('MLB', 'DET', 'Detroit Tigers', 'Detroit', 'Tigers', '["tigers", "detroit", "detroit tigers", "det"]'),
('MLB', 'HOU', 'Houston Astros', 'Houston', 'Astros', '["astros", "stros", "houston", "houston astros", "hou"]'),
('MLB', 'KC', 'Kansas City Royals', 'Kansas City', 'Royals', '["royals", "kansas city", "kansas city royals", "kc"]'),
('MLB', 'LAA', 'Los Angeles Angels', 'Los Angeles', 'Angels', '["angels", "la angels", "los angeles angels", "laa"]'),
('MLB', 'LAD', 'Los Angeles Dodgers', 'Los Angeles', 'Dodgers', '["dodgers", "la dodgers", "los angeles dodgers", "lad"]'),
('MLB', 'MIA', 'Miami Marlins', 'Miami', 'Marlins', '["marlins", "miami", "miami marlins", "mia"]'),
('MLB', 'MIL', 'Milwaukee Brewers', 'Milwaukee', 'Brewers', '["brewers", "milwaukee", "milwaukee brewers", "mil"]'),
('MLB', 'MIN', 'Minnesota Twins', 'Minnesota', 'Twins', '["twins", "minnesota", "minnesota twins", "min"]'),
('MLB', 'NYM', 'New York Mets', 'New York', 'Mets', '["mets", "ny mets", "new york mets", "nym"]'),
('MLB', 'NYY', 'New York Yankees', 'New York', 'Yankees', '["yankees", "yanks", "ny yankees", "new york yankees", "nyy", "bronx bombers"]'),
('MLB', 'OAK', 'Oakland Athletics', 'Oakland', 'Athletics', '["athletics", "as", "oakland", "oakland athletics", "oak"]'),
('MLB', 'PHI', 'Philadelphia Phillies', 'Philadelphia', 'Phillies', '["phillies", "phils", "philadelphia", "philadelphia phillies", "phi", "philly"]'),
('MLB', 'PIT', 'Pittsburgh Pirates', 'Pittsburgh', 'Pirates', '["pirates", "bucs", "pittsburgh", "pittsburgh pirates", "pit"]'),
('MLB', 'SD', 'San Diego Padres', 'San Diego', 'Padres', '["padres", "san diego", "san diego padres", "sd"]'),
('MLB', 'SF', 'San Francisco Giants', 'San Francisco', 'Giants', '["giants", "san francisco", "san francisco giants", "sf"]'),
('MLB', 'SEA', 'Seattle Mariners', 'Seattle', 'Mariners', '["mariners", "seattle", "seattle mariners", "sea"]'),
('MLB', 'STL', 'St. Louis Cardinals', 'St. Louis', 'Cardinals', '["cardinals", "cards", "st louis", "st. louis cardinals", "stl"]'),
('MLB', 'TB', 'Tampa Bay Rays', 'Tampa Bay', 'Rays', '["rays", "tampa bay", "tampa bay rays", "tb"]'),
('MLB', 'TEX', 'Texas Rangers', 'Texas', 'Rangers', '["rangers", "texas", "texas rangers", "tex"]'),
('MLB', 'TOR', 'Toronto Blue Jays', 'Toronto', 'Blue Jays', '["blue jays", "jays", "toronto", "toronto blue jays", "tor"]'),
('MLB', 'WAS', 'Washington Nationals', 'Washington', 'Nationals', '["nationals", "nats", "washington", "washington nationals", "was", "wsh"]'),

-- NCAAB Top Teams (50+)
('NCAAB', 'DUKE', 'Duke Blue Devils', 'Durham', 'Blue Devils', '["duke", "blue devils", "duke blue devils"]'),
('NCAAB', 'UNC', 'North Carolina Tar Heels', 'Chapel Hill', 'Tar Heels', '["unc", "tar heels", "north carolina", "carolina"]'),
('NCAAB', 'UK', 'Kentucky Wildcats', 'Lexington', 'Wildcats', '["kentucky", "wildcats", "uk", "cats"]'),
('NCAAB', 'KU', 'Kansas Jayhawks', 'Lawrence', 'Jayhawks', '["kansas", "jayhawks", "ku", "hawks"]'),
('NCAAB', 'UCLA', 'UCLA Bruins', 'Los Angeles', 'Bruins', '["ucla", "bruins"]'),
('NCAAB', 'GONZ', 'Gonzaga Bulldogs', 'Spokane', 'Bulldogs', '["gonzaga", "bulldogs", "zags"]'),
('NCAAB', 'MICH', 'Michigan Wolverines', 'Ann Arbor', 'Wolverines', '["michigan", "wolverines", "um"]'),
('NCAAB', 'MSU', 'Michigan State Spartans', 'East Lansing', 'Spartans', '["michigan state", "spartans", "msu"]'),
('NCAAB', 'OSU', 'Ohio State Buckeyes', 'Columbus', 'Buckeyes', '["ohio state", "buckeyes", "osu"]'),
('NCAAB', 'IU', 'Indiana Hoosiers', 'Bloomington', 'Hoosiers', '["indiana", "hoosiers", "iu"]'),
('NCAAB', 'LOU', 'Louisville Cardinals', 'Louisville', 'Cardinals', '["louisville", "cardinals"]'),
('NCAAB', 'ARIZ', 'Arizona Wildcats', 'Tucson', 'Wildcats', '["arizona", "wildcats", "zona"]'),
('NCAAB', 'VILL', 'Villanova Wildcats', 'Villanova', 'Wildcats', '["villanova", "wildcats", "nova"]'),
('NCAAB', 'UVA', 'Virginia Cavaliers', 'Charlottesville', 'Cavaliers', '["virginia", "cavaliers", "uva", "wahoos"]'),
('NCAAB', 'BAYLOR', 'Baylor Bears', 'Waco', 'Bears', '["baylor", "bears"]'),
('NCAAB', 'TEX', 'Texas Longhorns', 'Austin', 'Longhorns', '["texas", "longhorns", "horns"]'),
('NCAAB', 'TENN', 'Tennessee Volunteers', 'Knoxville', 'Volunteers', '["tennessee", "volunteers", "vols"]'),
('NCAAB', 'AUB', 'Auburn Tigers', 'Auburn', 'Tigers', '["auburn", "tigers"]'),
('NCAAB', 'CONN', 'Connecticut Huskies', 'Storrs', 'Huskies', '["uconn", "huskies", "connecticut"]'),
('NCAAB', 'HOU', 'Houston Cougars', 'Houston', 'Cougars', '["houston", "cougars", "coogs"]'),
('NCAAB', 'PUR', 'Purdue Boilermakers', 'West Lafayette', 'Boilermakers', '["purdue", "boilermakers"]'),
('NCAAB', 'IOWA', 'Iowa Hawkeyes', 'Iowa City', 'Hawkeyes', '["iowa", "hawkeyes"]'),
('NCAAB', 'WIS', 'Wisconsin Badgers', 'Madison', 'Badgers', '["wisconsin", "badgers"]'),
('NCAAB', 'MARQ', 'Marquette Golden Eagles', 'Milwaukee', 'Golden Eagles', '["marquette", "golden eagles"]'),
('NCAAB', 'CREI', 'Creighton Bluejays', 'Omaha', 'Bluejays', '["creighton", "bluejays"]'),
('NCAAB', 'FSU', 'Florida State Seminoles', 'Tallahassee', 'Seminoles', '["florida state", "seminoles", "fsu", "noles"]'),
('NCAAB', 'FLA', 'Florida Gators', 'Gainesville', 'Gators', '["florida", "gators", "uf"]'),
('NCAAB', 'USC', 'USC Trojans', 'Los Angeles', 'Trojans', '["usc", "trojans", "southern cal"]'),
('NCAAB', 'ORE', 'Oregon Ducks', 'Eugene', 'Ducks', '["oregon", "ducks"]'),
('NCAAB', 'ARK', 'Arkansas Razorbacks', 'Fayetteville', 'Razorbacks', '["arkansas", "razorbacks", "hogs"]'),
('NCAAB', 'COLO', 'Colorado Buffaloes', 'Boulder', 'Buffaloes', '["colorado", "buffaloes", "buffs"]'),
('NCAAB', 'SDSU', 'San Diego State Aztecs', 'San Diego', 'Aztecs', '["san diego state", "aztecs", "sdsu"]'),
('NCAAB', 'XAVI', 'Xavier Musketeers', 'Cincinnati', 'Musketeers', '["xavier", "musketeers"]'),
('NCAAB', 'PROV', 'Providence Friars', 'Providence', 'Friars', '["providence", "friars"]'),
('NCAAB', 'STJO', 'St. Johns Red Storm', 'Queens', 'Red Storm', '["st johns", "red storm", "johnnies"]'),
('NCAAB', 'SETON', 'Seton Hall Pirates', 'South Orange', 'Pirates', '["seton hall", "pirates"]'),
('NCAAB', 'TCU', 'TCU Horned Frogs', 'Fort Worth', 'Horned Frogs', '["tcu", "horned frogs"]'),
('NCAAB', 'TTU', 'Texas Tech Red Raiders', 'Lubbock', 'Red Raiders', '["texas tech", "red raiders"]'),
('NCAAB', 'ISU', 'Iowa State Cyclones', 'Ames', 'Cyclones', '["iowa state", "cyclones"]'),
('NCAAB', 'KSU', 'Kansas State Wildcats', 'Manhattan', 'Wildcats', '["kansas state", "wildcats", "k-state"]'),
('NCAAB', 'WVU', 'West Virginia Mountaineers', 'Morgantown', 'Mountaineers', '["west virginia", "mountaineers", "wvu"]'),
('NCAAB', 'OKLA', 'Oklahoma Sooners', 'Norman', 'Sooners', '["oklahoma", "sooners", "ou"]'),
('NCAAB', 'ALA', 'Alabama Crimson Tide', 'Tuscaloosa', 'Crimson Tide', '["alabama", "crimson tide", "bama"]'),
('NCAAB', 'LSU', 'LSU Tigers', 'Baton Rouge', 'Tigers', '["lsu", "tigers"]'),
('NCAAB', 'MISS', 'Mississippi Rebels', 'Oxford', 'Rebels', '["ole miss", "rebels", "mississippi"]'),
('NCAAB', 'MSST', 'Mississippi State Bulldogs', 'Starkville', 'Bulldogs', '["mississippi state", "bulldogs"]'),
('NCAAB', 'UGA', 'Georgia Bulldogs', 'Athens', 'Bulldogs', '["georgia", "bulldogs", "uga"]'),
('NCAAB', 'SC', 'South Carolina Gamecocks', 'Columbia', 'Gamecocks', '["south carolina", "gamecocks"]'),
('NCAAB', 'VT', 'Virginia Tech Hokies', 'Blacksburg', 'Hokies', '["virginia tech", "hokies", "vt"]'),
('NCAAB', 'CLEM', 'Clemson Tigers', 'Clemson', 'Tigers', '["clemson", "tigers"]');

-- Create trigger for updated_at
CREATE OR REPLACE FUNCTION update_team_aliases_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER update_team_aliases_timestamp
  BEFORE UPDATE ON public.team_aliases
  FOR EACH ROW
  EXECUTE FUNCTION update_team_aliases_updated_at();