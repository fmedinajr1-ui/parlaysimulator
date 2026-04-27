// Fuzzy matching helpers for parlay legs against engine prop tables.
// Used by analyze-parlay and find-swap-alternatives.

export interface ParsedLeg {
  raw: string;
  player?: string;
  propType?: string;
  line?: number;
  side?: 'over' | 'under';
  team?: string;
  odds: number;
}

const PROP_TYPE_MAP: Record<string, string> = {
  pts: 'points', point: 'points', points: 'points',
  reb: 'rebounds', rebs: 'rebounds', rebounds: 'rebounds',
  ast: 'assists', asts: 'assists', assists: 'assists',
  '3pm': 'threes', threes: 'threes', '3ptm': 'threes', '3p': 'threes',
  stl: 'steals', steals: 'steals',
  blk: 'blocks', blocks: 'blocks',
  pra: 'pra', 'pts+reb+ast': 'pra',
  pr: 'pr', 'pts+reb': 'pr',
  pa: 'pa', 'pts+ast': 'pa',
  ra: 'ra', 'reb+ast': 'ra',
  to: 'turnovers', turnovers: 'turnovers',
  hits: 'hits', tb: 'total_bases', 'total bases': 'total_bases',
  hr: 'home_runs', 'home runs': 'home_runs', homeruns: 'home_runs',
  rbi: 'rbis', rbis: 'rbis',
  sb: 'stolen_bases', 'stolen bases': 'stolen_bases',
  ks: 'strikeouts', so: 'strikeouts', strikeouts: 'strikeouts',
  yds: 'passing_yards', 'passing yds': 'passing_yards',
  'rush yds': 'rushing_yards', 'rec yds': 'receiving_yards',
  rec: 'receptions', receptions: 'receptions',
  td: 'touchdowns', tds: 'touchdowns', touchdowns: 'touchdowns',
  sog: 'shots_on_goal', 'shots on goal': 'shots_on_goal',
  saves: 'saves', goals: 'goals', points_nhl: 'points',
};

export function normalizePropType(s: string | undefined | null): string | null {
  if (!s) return null;
  const k = s.toLowerCase().trim().replace(/[._-]/g, ' ');
  if (PROP_TYPE_MAP[k]) return PROP_TYPE_MAP[k];
  // Try direct contains
  for (const key of Object.keys(PROP_TYPE_MAP)) {
    if (k.includes(key)) return PROP_TYPE_MAP[key];
  }
  return k;
}

export function parseLeg(input: {
  description?: string;
  player?: string;
  propType?: string;
  line?: number;
  side?: string;
  odds?: number | string;
}): ParsedLeg {
  const raw = input.description || '';
  const oddsNum =
    typeof input.odds === 'number'
      ? input.odds
      : parseInt(String(input.odds ?? '-110').replace(/[^\d\-+]/g, ''), 10) || -110;

  let player = input.player?.trim();
  let propType = normalizePropType(input.propType ?? undefined) ?? undefined;
  let line = typeof input.line === 'number' ? input.line : undefined;
  let side = (input.side?.toLowerCase() as 'over' | 'under' | undefined) ?? undefined;

  // Try extract from description if missing
  if (raw) {
    if (!side) {
      if (/\bover\b|\bo\s+\d/i.test(raw)) side = 'over';
      else if (/\bunder\b|\bu\s+\d/i.test(raw)) side = 'under';
    }
    if (line === undefined) {
      const m = raw.match(/\b(\d{1,3}(?:\.\d)?)\b/);
      if (m) line = parseFloat(m[1]);
    }
    if (!propType) {
      const lower = raw.toLowerCase();
      for (const key of Object.keys(PROP_TYPE_MAP)) {
        if (lower.includes(key)) {
          propType = PROP_TYPE_MAP[key];
          break;
        }
      }
    }
    if (!player) {
      // First two capitalized words before "Over/Under"
      const m = raw.match(/^([A-Z][a-zA-Z'.\-]+(?:\s+[A-Z][a-zA-Z'.\-]+){0,2})/);
      if (m) player = m[1];
    }
  }

  return { raw, player, propType, line, side, odds: oddsNum };
}

/** Lightweight fuzzy match: last-name token match + prop type contains. */
export function isFuzzyMatch(
  leg: ParsedLeg,
  row: { player_name?: string | null; prop_type?: string | null; line?: number | null; current_line?: number | null }
): { matches: boolean; score: number } {
  if (!leg.player || !row.player_name) return { matches: false, score: 0 };
  const legTokens = leg.player.toLowerCase().split(/\s+/).filter(Boolean);
  const rowTokens = row.player_name.toLowerCase().split(/\s+/).filter(Boolean);
  const lastNameMatch =
    legTokens.length > 0 &&
    rowTokens.length > 0 &&
    legTokens[legTokens.length - 1] === rowTokens[rowTokens.length - 1];

  if (!lastNameMatch) return { matches: false, score: 0 };

  let score = 50;
  // Prop type
  const rowProp = normalizePropType(row.prop_type);
  if (leg.propType && rowProp && (leg.propType === rowProp || rowProp.includes(leg.propType) || leg.propType.includes(rowProp))) {
    score += 30;
  } else if (leg.propType && rowProp) {
    return { matches: false, score: 0 };
  }
  // Line
  const rowLine = row.line ?? row.current_line;
  if (leg.line !== undefined && rowLine != null) {
    if (Math.abs(rowLine - leg.line) < 0.5) score += 20;
    else if (Math.abs(rowLine - leg.line) < 1.5) score += 5;
  }
  return { matches: true, score };
}

/** American odds → implied probability */
export function americanToProb(odds: number): number {
  if (!odds || isNaN(odds)) return 0.5;
  return odds > 0 ? 100 / (odds + 100) : Math.abs(odds) / (Math.abs(odds) + 100);
}

/** American odds → decimal odds */
export function americanToDecimal(odds: number): number {
  return odds > 0 ? odds / 100 + 1 : 100 / Math.abs(odds) + 1;
}