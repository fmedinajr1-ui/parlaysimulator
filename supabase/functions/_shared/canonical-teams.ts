// ============================================================================
// canonical-teams.ts
// Whitelist of canonical team names per sport + strict matcher.
// Used by leg-validator to reject truncated/garbled team strings like
// "Colorado A…alanche" before they enter a parlay.
// ============================================================================

export type CanonicalSport = "mlb" | "nhl" | "nba" | "wnba" | "nfl";

export const MLB_TEAMS = [
  "Arizona Diamondbacks","Atlanta Braves","Baltimore Orioles","Boston Red Sox",
  "Chicago Cubs","Chicago White Sox","Cincinnati Reds","Cleveland Guardians",
  "Colorado Rockies","Detroit Tigers","Houston Astros","Kansas City Royals",
  "Los Angeles Angels","Los Angeles Dodgers","Miami Marlins","Milwaukee Brewers",
  "Minnesota Twins","New York Mets","New York Yankees","Oakland Athletics",
  "Athletics","Philadelphia Phillies","Pittsburgh Pirates","San Diego Padres",
  "San Francisco Giants","Seattle Mariners","St. Louis Cardinals","Tampa Bay Rays",
  "Texas Rangers","Toronto Blue Jays","Washington Nationals",
];

export const NHL_TEAMS = [
  "Anaheim Ducks","Boston Bruins","Buffalo Sabres","Calgary Flames",
  "Carolina Hurricanes","Chicago Blackhawks","Colorado Avalanche","Columbus Blue Jackets",
  "Dallas Stars","Detroit Red Wings","Edmonton Oilers","Florida Panthers",
  "Los Angeles Kings","Minnesota Wild","Montreal Canadiens","Montréal Canadiens",
  "Nashville Predators","New Jersey Devils","New York Islanders","New York Rangers",
  "Ottawa Senators","Philadelphia Flyers","Pittsburgh Penguins","San Jose Sharks",
  "Seattle Kraken","St. Louis Blues","Tampa Bay Lightning","Toronto Maple Leafs",
  "Utah Hockey Club","Utah Mammoth","Vancouver Canucks","Vegas Golden Knights",
  "Washington Capitals","Winnipeg Jets",
];

export const NBA_TEAMS = [
  "Atlanta Hawks","Boston Celtics","Brooklyn Nets","Charlotte Hornets",
  "Chicago Bulls","Cleveland Cavaliers","Dallas Mavericks","Denver Nuggets",
  "Detroit Pistons","Golden State Warriors","Houston Rockets","Indiana Pacers",
  "LA Clippers","Los Angeles Clippers","Los Angeles Lakers","Memphis Grizzlies",
  "Miami Heat","Milwaukee Bucks","Minnesota Timberwolves","New Orleans Pelicans",
  "New York Knicks","Oklahoma City Thunder","Orlando Magic","Philadelphia 76ers",
  "Phoenix Suns","Portland Trail Blazers","Sacramento Kings","San Antonio Spurs",
  "Toronto Raptors","Utah Jazz","Washington Wizards",
];

export const WNBA_TEAMS = [
  "Atlanta Dream","Chicago Sky","Connecticut Sun","Dallas Wings",
  "Golden State Valkyries","Indiana Fever","Las Vegas Aces","Los Angeles Sparks",
  "Minnesota Lynx","New York Liberty","Phoenix Mercury","Seattle Storm",
  "Washington Mystics",
];

export const NFL_TEAMS = [
  "Arizona Cardinals","Atlanta Falcons","Baltimore Ravens","Buffalo Bills",
  "Carolina Panthers","Chicago Bears","Cincinnati Bengals","Cleveland Browns",
  "Dallas Cowboys","Denver Broncos","Detroit Lions","Green Bay Packers",
  "Houston Texans","Indianapolis Colts","Jacksonville Jaguars","Kansas City Chiefs",
  "Las Vegas Raiders","Los Angeles Chargers","Los Angeles Rams","Miami Dolphins",
  "Minnesota Vikings","New England Patriots","New Orleans Saints","New York Giants",
  "New York Jets","Philadelphia Eagles","Pittsburgh Steelers","San Francisco 49ers",
  "Seattle Seahawks","Tampa Bay Buccaneers","Tennessee Titans","Washington Commanders",
];

const CANONICAL: Record<CanonicalSport, string[]> = {
  mlb: MLB_TEAMS,
  nhl: NHL_TEAMS,
  nba: NBA_TEAMS,
  wnba: WNBA_TEAMS,
  nfl: NFL_TEAMS,
};

function normalize(s: string): string {
  return (s ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[.'`’\-]/g, "")
    .replace(/[…]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** Build a normalized lookup index per sport (computed once). */
const INDEX: Record<CanonicalSport, Map<string, string>> = Object.fromEntries(
  (Object.keys(CANONICAL) as CanonicalSport[]).map((sport) => {
    const m = new Map<string, string>();
    for (const t of CANONICAL[sport]) m.set(normalize(t), t);
    return [sport, m];
  }),
) as Record<CanonicalSport, Map<string, string>>;

/** Map common sport-key variants to a canonical sport bucket, or null. */
export function canonicalSportFor(sportRaw: string | null | undefined): CanonicalSport | null {
  if (!sportRaw) return null;
  const s = sportRaw.toLowerCase();
  if (s.includes("mlb") || s.includes("baseball")) return "mlb";
  if (s.includes("nhl") || s.includes("icehockey")) return "nhl";
  if (s === "nba" || s.includes("basketball_nba")) return "nba";
  if (s.includes("wnba")) return "wnba";
  if (s === "nfl" || s.includes("americanfootball_nfl")) return "nfl";
  return null;
}

/**
 * Strict canonical match: returns the canonical name if `raw` is an exact
 * normalized match against the whitelist, otherwise `null`. No substring
 * matching — truncated/garbled inputs are rejected.
 */
export function matchCanonicalTeam(sport: CanonicalSport | null, raw: string | null | undefined): string | null {
  if (!sport || !raw) return null;
  const idx = INDEX[sport];
  if (!idx) return null;
  return idx.get(normalize(raw)) ?? null;
}

export function isCanonicalTeam(sport: CanonicalSport | null, raw: string | null | undefined): boolean {
  return matchCanonicalTeam(sport, raw) !== null;
}