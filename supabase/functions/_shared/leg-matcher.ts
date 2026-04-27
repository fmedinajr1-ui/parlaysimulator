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
  sport?: SportKey;
  sportConfidence?: 'high' | 'medium' | 'low';
}

// ─── Sport routing ────────────────────────────────────────────────────────

export type SportKey =
  | 'NBA' | 'WNBA' | 'NCAAMB'
  | 'MLB'
  | 'NHL'
  | 'NFL' | 'NCAAF'
  | 'TENNIS' | 'MMA' | 'GOLF' | 'SOCCER';

/** All sport-column aliases that appear in our engine tables for a canonical sport. */
export const SPORT_ALIASES: Record<SportKey, string[]> = {
  NBA: ['NBA', 'basketball_nba', 'nba'],
  WNBA: ['WNBA', 'basketball_wnba', 'wnba'],
  NCAAMB: ['NCAAMB', 'basketball_ncaamb', 'ncaamb'],
  MLB: ['MLB', 'baseball_mlb', 'mlb'],
  NHL: ['NHL', 'icehockey_nhl', 'nhl'],
  NFL: ['NFL', 'NFL Prop', 'americanfootball_nfl', 'nfl'],
  NCAAF: ['NCAAF', 'americanfootball_ncaaf', 'ncaaf'],
  TENNIS: ['TENNIS', 'tennis', 'tennis_atp', 'tennis_wta'],
  MMA: ['MMA', 'mma', 'mma_mixed_martial_arts'],
  GOLF: ['GOLF', 'golf', 'golf_pga'],
  SOCCER: ['SOCCER', 'soccer', 'soccer_mls', 'soccer_epl'],
};

/** Prop-type → sports it can belong to. Lowercased keys (raw, not normalized). */
const PROP_TO_SPORTS: Array<{ patterns: RegExp[]; sports: SportKey[]; confidence: 'high' | 'medium' }> = [
  // MLB-specific (high confidence — these props don't exist anywhere else)
  { patterns: [/\bhits?\b/, /\btotal[_\s]?bases\b/, /\bhome[_\s]?runs?\b/, /\bhr\b/, /\brbis?\b/, /\bstolen[_\s]?bases?\b/, /\bsb\b/, /\bsingles?\b/, /\bdoubles?\b/, /\btriples?\b/, /\bwalks?\b/, /\bbb\b/, /\bpitcher\b/, /\bbatter\b/, /\bouts[_\s]?recorded\b/, /\bearned[_\s]?runs?\b/], sports: ['MLB'], confidence: 'high' },
  { patterns: [/\bstrikeouts?\b/, /\bks\b/], sports: ['MLB'], confidence: 'medium' },
  // NHL-specific
  { patterns: [/\bshots[_\s]?on[_\s]?goal\b/, /\bsog\b/, /\bsaves?\b/, /\bblocked[_\s]?shots?\b/, /\bpower[_\s]?play[_\s]?points?\b/, /\bppp\b/, /\bgoalie\b/, /\bskater\b/], sports: ['NHL'], confidence: 'high' },
  { patterns: [/\bgoals?\b/], sports: ['NHL', 'SOCCER'], confidence: 'medium' },
  // NFL/NCAAF
  { patterns: [/\bpassing[_\s]?yards?\b/, /\brushing[_\s]?yards?\b/, /\breceiving[_\s]?yards?\b/, /\bpass[_\s]?yds?\b/, /\brush[_\s]?yds?\b/, /\brec[_\s]?yds?\b/, /\breceptions?\b/, /\btouchdowns?\b/, /\btds?\b/, /\binterceptions?\b/, /\bcompletions?\b/, /\bsacks?\b/], sports: ['NFL', 'NCAAF'], confidence: 'high' },
  // Tennis
  { patterns: [/\baces?\b/, /\bdouble[_\s]?faults?\b/, /\bgames[_\s]?won\b/, /\bsets[_\s]?won\b/, /\bbreaks?\b/, /\btiebreaks?\b/], sports: ['TENNIS'], confidence: 'high' },
  // MMA
  { patterns: [/\bsignificant[_\s]?strikes?\b/, /\btakedowns?\b/, /\bfight[_\s]?to[_\s]?go[_\s]?distance\b/, /\bsubmission\b/, /\bko\/tko\b/], sports: ['MMA'], confidence: 'high' },
  // Golf
  { patterns: [/\bbirdies?\b/, /\bbogeys?\b/, /\bmade[_\s]?cut\b/, /\btop[_\s]?5\b/, /\btop[_\s]?10\b/, /\btop[_\s]?20\b/, /\beagles?\b/], sports: ['GOLF'], confidence: 'high' },
  // Basketball default (lower confidence — many of these names overlap)
  { patterns: [/\bpoints?\b/, /\bpts\b/, /\brebounds?\b/, /\breb\b/, /\bassists?\b/, /\bast\b/, /\bthrees?\b/, /\b3pm\b/, /\b3ptm\b/, /\bsteals?\b/, /\bstl\b/, /\bblocks?\b/, /\bblk\b/, /\bturnovers?\b/, /\bto\b/, /\bpra\b/, /\bdouble[_\s-]?double\b/, /\btriple[_\s-]?double\b/], sports: ['NBA', 'WNBA', 'NCAAMB'], confidence: 'medium' },
];

const LEAGUE_KEYWORDS: Array<{ pattern: RegExp; sport: SportKey }> = [
  { pattern: /\bnba\b/i, sport: 'NBA' },
  { pattern: /\bwnba\b/i, sport: 'WNBA' },
  { pattern: /\bncaa[mb]\b/i, sport: 'NCAAMB' },
  { pattern: /\bmlb\b|\bbaseball\b/i, sport: 'MLB' },
  { pattern: /\bnhl\b|\bhockey\b/i, sport: 'NHL' },
  { pattern: /\bnfl\b/i, sport: 'NFL' },
  { pattern: /\bncaaf\b|\bcfb\b/i, sport: 'NCAAF' },
  { pattern: /\batp\b|\bwta\b|\btennis\b/i, sport: 'TENNIS' },
  { pattern: /\bufc\b|\bmma\b/i, sport: 'MMA' },
  { pattern: /\bpga\b|\bgolf\b/i, sport: 'GOLF' },
  { pattern: /\bmls\b|\bepl\b|\bsoccer\b|\bfootball\s*\(soccer\)/i, sport: 'SOCCER' },
];

/** Normalize anything the caller might pass as a sport hint into our canonical key. */
export function canonicalizeSportHint(hint: unknown): SportKey | null {
  if (!hint) return null;
  const s = String(hint).toLowerCase().trim();
  for (const [key, aliases] of Object.entries(SPORT_ALIASES) as [SportKey, string[]][]) {
    if (aliases.some((a) => a.toLowerCase() === s)) return key;
  }
  // fuzzy contains
  if (s.includes('nba')) return 'NBA';
  if (s.includes('wnba')) return 'WNBA';
  if (s.includes('mlb') || s.includes('baseball')) return 'MLB';
  if (s.includes('nhl') || s.includes('hockey')) return 'NHL';
  if (s.includes('nfl')) return 'NFL';
  if (s.includes('ncaaf')) return 'NCAAF';
  if (s.includes('ncaa')) return 'NCAAMB';
  if (s.includes('tennis') || s.includes('atp') || s.includes('wta')) return 'TENNIS';
  if (s.includes('mma') || s.includes('ufc')) return 'MMA';
  if (s.includes('golf') || s.includes('pga')) return 'GOLF';
  if (s.includes('soccer') || s.includes('mls') || s.includes('epl')) return 'SOCCER';
  return null;
}

/**
 * Detect the sport a parsed leg belongs to. Layered:
 *   1. Caller hint (highest priority, marked 'high').
 *   2. Prop-type signature (high or medium depending on uniqueness).
 *   3. Description league/team keyword scan.
 *   4. Fall back to NBA with 'low' confidence.
 */
export function detectSport(
  parsed: { raw?: string; propType?: string; player?: string },
  hint?: unknown
): { sport: SportKey; confidence: 'high' | 'medium' | 'low' } {
  const hinted = canonicalizeSportHint(hint);
  if (hinted) return { sport: hinted, confidence: 'high' };

  const propBlob = `${parsed.propType ?? ''} ${parsed.raw ?? ''}`.toLowerCase();

  for (const rule of PROP_TO_SPORTS) {
    if (rule.patterns.some((p) => p.test(propBlob))) {
      // Disambiguate multi-sport rules using description keywords
      if (rule.sports.length > 1 && parsed.raw) {
        for (const kw of LEAGUE_KEYWORDS) {
          if (kw.pattern.test(parsed.raw) && rule.sports.includes(kw.sport)) {
            return { sport: kw.sport, confidence: 'high' };
          }
        }
      }
      return { sport: rule.sports[0], confidence: rule.confidence };
    }
  }

  // Description-only fallback
  if (parsed.raw) {
    for (const kw of LEAGUE_KEYWORDS) {
      if (kw.pattern.test(parsed.raw)) return { sport: kw.sport, confidence: 'medium' };
    }
  }

  return { sport: 'NBA', confidence: 'low' };
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