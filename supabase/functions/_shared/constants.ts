// _shared/constants.ts
// Single source of truth. Do not duplicate these maps in other files.

// ─── Sports ────────────────────────────────────────────────────────────────

export const SPORT_EMOJI: Record<string, string> = {
  nba: '🏀',
  wnba: '🏀',
  ncaamb: '🏀',
  nhl: '🏒',
  mlb: '⚾',
  nfl: '🏈',
  ncaaf: '🏈',
  tennis: '🎾',
  mma: '🥊',
  golf: '⛳',
  soccer: '⚽',
};

export const SPORT_LABEL: Record<string, string> = {
  basketball_nba: 'NBA',
  basketball_wnba: 'WNBA',
  basketball_ncaamb: 'NCAAMB',
  icehockey_nhl: 'NHL',
  baseball_mlb: 'MLB',
  americanfootball_nfl: 'NFL',
  americanfootball_ncaaf: 'NCAAF',
  tennis: 'Tennis',
  mma: 'MMA',
  golf: 'Golf',
};

/** Given anything sport-ish (sport, sport_key, prop_type), return the correct emoji. */
export function getSportEmoji(input: any): string {
  const s = String(
    input?.sport || input?.sport_key || input?.category || input?.prop_type || input || ''
  ).toLowerCase();
  if (s.includes('nhl') || s.includes('hockey')) return '🏒';
  if (s.includes('mlb') || s.includes('baseball') || s.includes('pitcher') ||
      s.includes('batter') || s.includes('hitter')) return '⚾';
  if (s.includes('nfl') || s.includes('ncaaf') || s.includes('football')) return '🏈';
  if (s.includes('tennis')) return '🎾';
  if (s.includes('mma') || s.includes('ufc')) return '🥊';
  if (s.includes('golf')) return '⛳';
  if (s.includes('soccer') || s.includes('futbol')) return '⚽';
  return '🏀'; // NBA/WNBA/NCAAMB default
}

// ─── Prop labels ──────────────────────────────────────────────────────────
// Short form (for inline usage, crowded messages)

export const PROP_LABEL_SHORT: Record<string, string> = {
  // Basketball
  points: 'PTS', player_points: 'PTS',
  rebounds: 'REB', player_rebounds: 'REB',
  assists: 'AST', player_assists: 'AST',
  threes: '3PT', player_threes: '3PT', three_pointers_made: '3PT',
  blocks: 'BLK', player_blocks: 'BLK',
  steals: 'STL', player_steals: 'STL',
  turnovers: 'TO', player_turnovers: 'TO',
  pra: 'PRA', player_pra: 'PRA', player_points_rebounds_assists: 'PRA',
  pts_rebs: 'P+R', player_pts_rebs: 'P+R', player_points_rebounds: 'P+R',
  pts_asts: 'P+A', player_pts_asts: 'P+A', player_points_assists: 'P+A',
  rebs_asts: 'R+A', player_rebs_asts: 'R+A', player_rebounds_assists: 'R+A',
  player_double_double: 'DD', player_triple_double: 'TD',
  fantasy_score: 'FPTS', player_fantasy_score: 'FPTS',

  // Hockey
  goals: 'G', player_goals: 'G',
  shots: 'SOG', player_shots_on_goal: 'SOG',
  saves: 'SVS', player_saves: 'SVS',
  player_blocked_shots: 'BLK',
  player_power_play_points: 'PPP',
  player_points_nhl: 'PTS', player_assists_nhl: 'A', assists_nhl: 'A',

  // Baseball
  pitcher_strikeouts: 'Ks', pitcher_outs: 'Outs',
  batter_hits: 'H', hits: 'H',
  batter_total_bases: 'TB', total_bases: 'TB',
  batter_rbis: 'RBI', rbis: 'RBI',
  batter_runs_scored: 'R', runs: 'R',
  batter_home_runs: 'HR', batter_home_runs_mlb: 'HR',
  batter_stolen_bases: 'SB', stolen_bases: 'SB',
  walks: 'BB',
  hitter_fantasy_score: 'FPTS',

  // Tennis / general
  aces: 'ACES', games: 'Games',

  // Markets
  spread: 'SPR', total: 'TOT', moneyline: 'ML', h2h: 'ML',
};

// Long form (for standalone callouts and headers)

export const PROP_LABEL_LONG: Record<string, string> = {
  player_points: 'points',
  player_rebounds: 'rebounds',
  player_assists: 'assists',
  player_threes: '3-pointers made',
  player_blocks: 'blocks',
  player_steals: 'steals',
  player_turnovers: 'turnovers',
  player_points_rebounds_assists: 'PRA',
  player_points_rebounds: 'points + rebounds',
  player_points_assists: 'points + assists',
  player_rebounds_assists: 'rebounds + assists',
  player_double_double: 'double-double',
  player_triple_double: 'triple-double',
  player_fantasy_score: 'fantasy score',
  player_goals: 'goals',
  player_shots_on_goal: 'shots on goal',
  player_saves: 'saves',
  player_blocked_shots: 'blocked shots',
  player_power_play_points: 'power play points',
  pitcher_strikeouts: 'strikeouts',
  pitcher_outs: 'outs recorded',
  batter_hits: 'hits',
  batter_total_bases: 'total bases',
  batter_rbis: 'RBIs',
  batter_runs_scored: 'runs',
  batter_home_runs: 'home runs',
  batter_stolen_bases: 'stolen bases',
};

/** Null-safe prop label lookup. Never throws. */
export function formatPropLabel(propType: string | null | undefined, form: 'short' | 'long' = 'short'): string {
  if (!propType) return '?';
  const key = String(propType).toLowerCase();
  const map = form === 'long' ? PROP_LABEL_LONG : PROP_LABEL_SHORT;
  if (map[key]) return map[key];
  // Fallback: strip common prefixes, replace underscores, uppercase for short form
  const cleaned = key.replace(/^(player_|batter_|pitcher_|hitter_)/, '').replace(/_/g, ' ');
  return form === 'short' ? cleaned.toUpperCase() : cleaned;
}

// ─── Pick type ────────────────────────────────────────────────────────────
// The canonical shape every generator produces and every formatter consumes.

export type PickSide = 'over' | 'under';

export interface PickReasoning {
  /** One-sentence plain-English summary of why this pick exists. */
  headline: string;
  /** The one or two stats that drive the pick. */
  drivers: string[];
  /** What would kill this pick? Always required — no pick without a risk note. */
  risk_note: string;
  /** Optional matchup context (opponent, situation). */
  matchup?: string;
  /** Sources / engines that contributed. */
  sources?: string[];
}

export interface PickRecency {
  l3_avg?: number;
  l5_avg?: number;
  l10_avg?: number;
  l10_hit_rate?: number;     // 0-100 (percentage). Never 0-1.
  h2h_avg?: number;
  h2h_games?: number;
}

export interface Pick {
  // Identity
  id: string;
  sport: string;              // e.g. 'basketball_nba'
  player_name: string;
  team?: string;
  opponent?: string;

  // The pick itself
  prop_type: string;          // e.g. 'player_points'
  line: number;
  side: PickSide;
  american_odds?: number;

  // Decision support
  confidence: number;         // 0-100. Never 0-1.
  edge_pct?: number;          // 0-100. Positive = our side is +EV.
  suggested_stake_pct?: number; // 0-1. e.g. 0.02 for 2% of bankroll.
  tier?: 'elite' | 'high' | 'medium' | 'exploration';

  // Narrative
  reasoning: PickReasoning;
  recency?: PickRecency;

  // Provenance
  generated_at: string;       // ISO timestamp
  generator: string;          // e.g. 'nba_bench_under', 'sweet_spots'
  game_start_utc?: string;    // ISO timestamp of game start
  parlay_id?: string;         // If part of a parlay
}

// ─── Day phases ───────────────────────────────────────────────────────────
// The orchestrator steps through these.

export type DayPhase =
  | 'dawn_brief'         // 8:00 AM ET   — morning read
  | 'slate_lock'         // 11:00 AM ET  — plays locked, full breakdown
  | 'pick_drops'         // staggered after lock — individual picks with reasoning
  | 'pre_game_pulse'     // 30min before each game — line movement, scratches
  | 'live_tracker'       // during games — meaningful updates only
  | 'settlement_story'   // after last game — honest recap
  | 'tomorrow_tease';    // 11:30 PM ET  — what's coming

export const PHASE_LABEL: Record<DayPhase, string> = {
  dawn_brief: 'Dawn Brief',
  slate_lock: 'Slate Lock',
  pick_drops: 'Pick Drops',
  pre_game_pulse: 'Pre-Game Pulse',
  live_tracker: 'Live Tracker',
  settlement_story: 'Settlement',
  tomorrow_tease: 'Tomorrow Tease',
};

// ─── Standard Telegram payload ─────────────────────────────────────────────

export interface TelegramSendRequest {
  /** The fully-rendered message text. */
  message: string;
  /** 'Markdown' (default) or 'HTML'. Mixed will fail — Voice module enforces this. */
  parse_mode?: 'Markdown' | 'HTML';
  /** Optional inline keyboard. Attached to first chunk on split. */
  reply_markup?: object;
  /** If true, bypasses customer fanout. */
  admin_only?: boolean;
  /** Tags this message in bot_message_log for later reference by orchestrator. */
  narrative_phase?: DayPhase | null;
  /** Category key used to reference this message later ('dawn_brief', 'pick_{id}', etc.). */
  reference_key?: string;
}
