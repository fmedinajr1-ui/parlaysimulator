/**
 * bot-settle-and-learn (v3 - Pipeline Fix)
 * 
 * Settles yesterday's parlays, updates category weights based on outcomes,
 * syncs weights from category_sweet_spots verified outcomes, and tracks activation progress.
 * 
 * v3 changes:
 * - Removed inline verify-sweet-spot-outcomes call (handled by separate cron)
 * - Added date guard: only settle parlays where parlay_date < today ET
 * - Batch leg lookups instead of individual queries
 * - Team leg settlement via aggregated game scores
 * 
 * Runs 3x daily via cron (6 AM, 12 PM, 6 PM ET).
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

// EST-aware date helper
function getEasternDate(): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/New_York',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
}

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// Player name aliases for settlement matching (handles known mismatches between prop sources and game logs)
const NAME_ALIASES: Record<string, string[]> = {
  'carlton carrington': ['bub carrington'],
  'bub carrington': ['carlton carrington'],
  'nic claxton': ['nicolas claxton'],
  'nicolas claxton': ['nic claxton'],
  'cam thomas': ['cameron thomas'],
  'cameron thomas': ['cam thomas'],
  'herb jones': ['herbert jones'],
  'herbert jones': ['herb jones'],
  'kenyon martin': ['kenyon martin jr', 'kj martin'],
  'kenyon martin jr': ['kenyon martin', 'kj martin'],
  'kj martin': ['kenyon martin', 'kenyon martin jr'],
  'pj washington': ['p.j. washington'],
  'p.j. washington': ['pj washington'],
  'og anunoby': ['o.g. anunoby', 'ogugua anunoby'],
  'o.g. anunoby': ['og anunoby'],
  'shai gilgeous-alexander': ['shai gilgeous alexander'],
  'shai gilgeous alexander': ['shai gilgeous-alexander'],
  'ayo dosunmu': ['ayodeji dosunmu'],
  'ayodeji dosunmu': ['ayo dosunmu'],
  'moe wagner': ['moritz wagner'],
  'moritz wagner': ['moe wagner'],
};

// Learning constants
const WEIGHT_BOOST_BASE = 0.02;
const WEIGHT_BOOST_STREAK = 0.005;
const WEIGHT_PENALTY_BASE = 0.03;
const WEIGHT_PENALTY_STREAK = 0.01;
const MIN_WEIGHT = 0.5;
const MAX_WEIGHT = 1.5;

const BLOCK_STREAK_THRESHOLD = -5;
const BLOCK_HIT_RATE_THRESHOLD = 35;
const BLOCK_MIN_SAMPLES = 20;

// Team-related categories
const TEAM_CATEGORIES = ['SHARP_SPREAD', 'UNDER_TOTAL', 'OVER_TOTAL', 'ML_UNDERDOG', 'ML_FAVORITE'];

interface BotLeg {
  id: string;
  player_name: string;
  team_name: string;
  prop_type: string;
  line: number;
  side: string;
  category: string;
  weight: number;
  hit_rate: number;
  outcome?: string;
  actual_value?: number;
  type?: string;
  home_team?: string;
  away_team?: string;
  bet_type?: string;
}

interface RecentOutcome {
  category: string;
  recommended_side: string;
  outcome: string;
  settled_at: string;
}

/**
 * Parse old-format whale signal legs where teams are encoded in player_name
 * e.g. "Louisiana Ragin' Cajuns @ Old Dominion Monarchs"
 */
function parseTeamsFromPlayerName(leg: BotLeg): { home_team: string; away_team: string } | null {
  const name = leg.player_name || '';
  // Pattern: "Away Team @ Home Team" or "Away Team vs Home Team"
  const atMatch = name.match(/^(.+?)\s+@\s+(.+)$/);
  if (atMatch) return { away_team: atMatch[1].trim(), home_team: atMatch[2].trim() };
  const vsMatch = name.match(/^(.+?)\s+vs\.?\s+(.+)$/i);
  if (vsMatch) return { away_team: vsMatch[1].trim(), home_team: vsMatch[2].trim() };
  return null;
}

function isTeamLeg(leg: BotLeg): boolean {
  if (leg.type === 'team') return true;
  if (TEAM_CATEGORIES.includes(leg.category ?? '')) return true;
  if (!!leg.home_team && !!leg.away_team) return true;
  // Old-format: whale signal legs with teams in player_name
  if ((leg as any).line_source === 'whale_signal' && parseTeamsFromPlayerName(leg)) return true;
  return false;
}

/**
 * Hydrate old-format legs: extract home_team/away_team from player_name if missing,
 * and infer bet_type from category/prop_type
 */
function hydrateLegTeams(leg: BotLeg): BotLeg {
  if (leg.home_team && leg.away_team) return leg;
  const parsed = parseTeamsFromPlayerName(leg);
  if (!parsed) return leg;
  
  const hydrated = { ...leg, home_team: parsed.home_team, away_team: parsed.away_team };
  
  // Infer bet_type from category or prop_type if missing
  if (!hydrated.bet_type) {
    const cat = (leg.category || '').toUpperCase();
    const pt = (leg.prop_type || '').toLowerCase();
    if (cat.includes('SPREAD') || pt === 'spread') hydrated.bet_type = 'spread';
    else if (cat.includes('TOTAL') || pt === 'total') hydrated.bet_type = 'total';
    else if (cat.includes('ML') || pt === 'moneyline' || pt === 'h2h') hydrated.bet_type = 'h2h';
  }
  
  // Infer sport from team names or default to NCAAB for whale signals
  if (!(hydrated as any).sport) {
    (hydrated as any).sport = 'basketball_ncaab';
  }
  
  console.log(`[Bot Settle] Hydrated old-format leg: "${leg.player_name}" → home=${parsed.home_team}, away=${parsed.away_team}, bet=${hydrated.bet_type}`);
  return hydrated;
}

function adjustWeight(
  currentWeight: number,
  hit: boolean,
  currentStreak: number
): { newWeight: number; blocked: boolean; newStreak: number; blockReason?: string } {
  let newStreak = currentStreak;
  
  if (hit) {
    newStreak = Math.max(1, currentStreak + 1);
    const boost = WEIGHT_BOOST_BASE + (Math.max(0, newStreak - 1) * WEIGHT_BOOST_STREAK);
    return {
      newWeight: Math.min(currentWeight + boost, MAX_WEIGHT),
      blocked: false,
      newStreak,
    };
  } else {
    newStreak = Math.min(-1, currentStreak - 1);
    const absStreak = Math.abs(newStreak);
    const penalty = WEIGHT_PENALTY_BASE + ((absStreak - 1) * WEIGHT_PENALTY_STREAK);
    const newWeight = currentWeight - penalty;
    
    if (newStreak <= BLOCK_STREAK_THRESHOLD) {
      return { 
        newWeight: 0, blocked: true, newStreak,
        blockReason: `${absStreak} consecutive misses`,
      };
    }
    
    if (newWeight < MIN_WEIGHT) {
      return { 
        newWeight: 0, blocked: true, newStreak,
        blockReason: 'Weight dropped below minimum threshold',
      };
    }
    return { newWeight: Math.max(newWeight, MIN_WEIGHT), blocked: false, newStreak };
  }
}

// Settle a team leg by looking up final scores
// For NCAAB: use ESPN scoreboard API directly (more reliable than summing player logs)
// For NBA: sum player game logs
const ESPN_NCAAB_SCOREBOARD = 'https://site.api.espn.com/apis/site/v2/sports/basketball/mens-college-basketball/scoreboard';
const ESPN_NCAA_BASEBALL_SCOREBOARD = 'https://site.api.espn.com/apis/site/v2/sports/baseball/college-baseball/scoreboard';
const ESPN_NHL_SCOREBOARD = 'https://site.api.espn.com/apis/site/v2/sports/hockey/nhl/scoreboard';

function fuzzyMatchTeam(name: string, target: string): boolean {
  const n = name.toLowerCase().replace(/[^a-z\s]/g, '').trim();
  const t = target.toLowerCase().replace(/[^a-z\s]/g, '').trim();
  if (n === t) return true;
  if (n.includes(t) || t.includes(n)) return true;
  // Match last word (mascot) or first words (city/school)
  const nWords = n.split(/\s+/);
  const tWords = t.split(/\s+/);
  if (nWords[nWords.length - 1] === tWords[tWords.length - 1]) return true;
  if (nWords[0] === tWords[0] && nWords.length > 1 && tWords.length > 1) return true;
  return false;
}

// Settle tennis/table tennis via The Odds API scores endpoint
async function settleTennisViaOddsAPI(
  leg: BotLeg,
  parlayDate: string,
  sport: string
): Promise<{ outcome: string; actual_value: number | null }> {
  const homeTeam = leg.home_team;
  const awayTeam = leg.away_team;
  if (!homeTeam || !awayTeam) return { outcome: 'no_data', actual_value: null };

  const apiKey = Deno.env.get('THE_ODDS_API_KEY');
  if (!apiKey) {
    console.error('[Bot Settle] THE_ODDS_API_KEY not set, cannot settle tennis/table tennis');
    return { outcome: 'no_data', actual_value: null };
  }

  try {
    const scoresUrl = `https://api.the-odds-api.com/v4/sports/${sport}/scores/?apiKey=${apiKey}&daysFrom=3`;
    const resp = await fetch(scoresUrl);
    if (!resp.ok) {
      console.error(`[Bot Settle] Odds API scores error for ${sport}: ${resp.status}`);
      return { outcome: 'no_data', actual_value: null };
    }

    const events = await resp.json();
    for (const event of events) {
      if (!event.completed) continue;

      const matchesHome = fuzzyMatchTeam(event.home_team || '', homeTeam);
      const matchesAway = fuzzyMatchTeam(event.away_team || '', awayTeam);
      if (!matchesHome || !matchesAway) continue;

      const scores = event.scores || [];
      const homeScoreObj = scores.find((s: any) => s.name === event.home_team);
      const awayScoreObj = scores.find((s: any) => s.name === event.away_team);
      if (!homeScoreObj || !awayScoreObj) continue;

      const homeScore = parseInt(homeScoreObj.score) || 0;
      const awayScore = parseInt(awayScoreObj.score) || 0;

      console.log(`[Bot Settle] Odds API ${sport}: ${event.home_team} (${homeScore}) vs ${event.away_team} (${awayScore})`);
      return resolveTeamOutcome(leg, homeScore, awayScore);
    }
  } catch (e) {
    console.error(`[Bot Settle] Odds API scores fetch error for ${sport}:`, e);
  }

  return { outcome: 'no_data', actual_value: null };
}

async function settleNcaabTeamLegViaESPN(
  leg: BotLeg,
  parlayDate: string
): Promise<{ outcome: string; actual_value: number | null }> {
  const homeTeam = leg.home_team;
  const awayTeam = leg.away_team;
  if (!homeTeam || !awayTeam) return { outcome: 'no_data', actual_value: null };

  // Search 3-day window
  for (let d = 0; d < 3; d++) {
    const searchDate = new Date(parlayDate + 'T12:00:00Z');
    searchDate.setDate(searchDate.getDate() + d);
    const dateStr = searchDate.toISOString().split('T')[0].replace(/-/g, '');
    
    try {
      const resp = await fetch(`${ESPN_NCAAB_SCOREBOARD}?dates=${dateStr}&limit=200&groups=50`);
      if (!resp.ok) {
        console.warn(`[Bot Settle] ESPN NCAAB scoreboard ${dateStr} returned ${resp.status}`);
        continue;
      }
      const data = await resp.json();
      const events = data.events || [];
      console.log(`[Bot Settle] ESPN NCAAB ${dateStr}: ${events.length} events, looking for ${homeTeam} vs ${awayTeam}`);
      
      for (const event of events) {
        if (event.status?.type?.completed !== true && event.status?.type?.name !== 'STATUS_FINAL') continue;
        
        const competitors = event.competitions?.[0]?.competitors || [];
        if (competitors.length !== 2) continue;
        
        const home = competitors.find((c: any) => c.homeAway === 'home');
        const away = competitors.find((c: any) => c.homeAway === 'away');
        if (!home || !away) continue;
        
        const homeName = home.team?.displayName || home.team?.shortDisplayName || '';
        const awayName = away.team?.displayName || away.team?.shortDisplayName || '';
        
        // Log near-matches for debugging
        const homeMatch = fuzzyMatchTeam(homeName, homeTeam);
        const awayMatch = fuzzyMatchTeam(awayName, awayTeam);
        if (homeMatch || awayMatch) {
          console.log(`[Bot Settle] Partial match: ESPN="${homeName} vs ${awayName}" target="${homeTeam} vs ${awayTeam}" homeMatch=${homeMatch} awayMatch=${awayMatch}`);
        }
        
        if (homeMatch && awayMatch) {
          const homeScore = parseInt(home.score) || 0;
          const awayScore = parseInt(away.score) || 0;
          console.log(`[Bot Settle] ESPN NCAAB MATCH: ${homeName} (${homeScore}) vs ${awayName} (${awayScore})`);
          return resolveTeamOutcome(leg, homeScore, awayScore);
        }
      }
    } catch (e) {
      console.error(`[Bot Settle] ESPN NCAAB fetch error for ${dateStr}:`, e);
    }
    
    await new Promise(r => setTimeout(r, 200));
  }
  
  return { outcome: 'no_data', actual_value: null };
}

// Settle NCAA Baseball team leg via ESPN college baseball scoreboard
async function settleNcaaBaseballViaESPN(
  leg: BotLeg,
  parlayDate: string
): Promise<{ outcome: string; actual_value: number | null }> {
  const homeTeam = leg.home_team;
  const awayTeam = leg.away_team;
  if (!homeTeam || !awayTeam) return { outcome: 'no_data', actual_value: null };

  for (let d = 0; d < 3; d++) {
    const searchDate = new Date(parlayDate + 'T12:00:00Z');
    searchDate.setDate(searchDate.getDate() + d);
    const dateStr = searchDate.toISOString().split('T')[0].replace(/-/g, '');

    try {
      const resp = await fetch(`${ESPN_NCAA_BASEBALL_SCOREBOARD}?dates=${dateStr}&limit=200`);
      if (!resp.ok) continue;
      const data = await resp.json();
      const events = data.events || [];

      for (const event of events) {
        if (event.status?.type?.completed !== true && event.status?.type?.name !== 'STATUS_FINAL') continue;

        const competitors = event.competitions?.[0]?.competitors || [];
        if (competitors.length !== 2) continue;

        const home = competitors.find((c: any) => c.homeAway === 'home');
        const away = competitors.find((c: any) => c.homeAway === 'away');
        if (!home || !away) continue;

        const homeName = home.team?.displayName || home.team?.shortDisplayName || '';
        const awayName = away.team?.displayName || away.team?.shortDisplayName || '';

        if (fuzzyMatchTeam(homeName, homeTeam) && fuzzyMatchTeam(awayName, awayTeam)) {
          const homeScore = parseInt(home.score) || 0;
          const awayScore = parseInt(away.score) || 0;
          console.log(`[Bot Settle] ESPN Baseball: ${homeName} (${homeScore}) vs ${awayName} (${awayScore})`);
          return resolveTeamOutcome(leg, homeScore, awayScore);
        }
      }
    } catch (e) {
      console.error(`[Bot Settle] ESPN Baseball fetch error for ${dateStr}:`, e);
    }

    await new Promise(r => setTimeout(r, 200));
  }

  return { outcome: 'no_data', actual_value: null };
}

// Settle NHL team leg via ESPN NHL scoreboard
async function settleNhlViaESPN(
  leg: BotLeg,
  parlayDate: string
): Promise<{ outcome: string; actual_value: number | null }> {
  const homeTeam = leg.home_team;
  const awayTeam = leg.away_team;
  if (!homeTeam || !awayTeam) return { outcome: 'no_data', actual_value: null };

  for (let d = 0; d < 3; d++) {
    const searchDate = new Date(parlayDate + 'T12:00:00Z');
    searchDate.setDate(searchDate.getDate() + d);
    const dateStr = searchDate.toISOString().split('T')[0].replace(/-/g, '');

    try {
      const resp = await fetch(`${ESPN_NHL_SCOREBOARD}?dates=${dateStr}&limit=50`);
      if (!resp.ok) continue;
      const data = await resp.json();
      const events = data.events || [];

      for (const event of events) {
        if (event.status?.type?.completed !== true && event.status?.type?.name !== 'STATUS_FINAL') continue;

        const competitors = event.competitions?.[0]?.competitors || [];
        if (competitors.length !== 2) continue;

        const home = competitors.find((c: any) => c.homeAway === 'home');
        const away = competitors.find((c: any) => c.homeAway === 'away');
        if (!home || !away) continue;

        const homeName = home.team?.displayName || home.team?.shortDisplayName || '';
        const awayName = away.team?.displayName || away.team?.shortDisplayName || '';

        if (fuzzyMatchTeam(homeName, homeTeam) && fuzzyMatchTeam(awayName, awayTeam)) {
          const homeScore = parseInt(home.score) || 0;
          const awayScore = parseInt(away.score) || 0;
          console.log(`[Bot Settle] ESPN NHL: ${homeName} (${homeScore}) vs ${awayName} (${awayScore})`);
          return resolveTeamOutcome(leg, homeScore, awayScore);
        }
      }
    } catch (e) {
      console.error(`[Bot Settle] ESPN NHL fetch error for ${dateStr}:`, e);
    }

    await new Promise(r => setTimeout(r, 200));
  }

  return { outcome: 'no_data', actual_value: null };
}

async function settleTeamLeg(
  supabase: any,
  leg: BotLeg,
  parlayDate: string
): Promise<{ outcome: string; actual_value: number | null }> {
  // Old variables kept for reference but we use hydrated versions below
  
  // Hydrate old-format legs before checking teams
  const hydratedLeg = hydrateLegTeams(leg);
  const homeTeamH = hydratedLeg.home_team;
  const awayTeamH = hydratedLeg.away_team;
  
  if (!homeTeamH || !awayTeamH) {
    return { outcome: 'no_data', actual_value: null };
  }

  // Use hydrated values for settlement
  const settledLeg = { ...hydratedLeg, home_team: homeTeamH, away_team: awayTeamH };
  const legSport = (settledLeg as any).sport || '';

  // Route NCAA Baseball to ESPN college baseball scoreboard
  if (legSport.includes('baseball_ncaa') || legSport.includes('baseball')) {
    return settleNcaaBaseballViaESPN(settledLeg, parlayDate);
  }

  // Route NCAAB to ESPN scoreboard (more reliable than summing player logs)
  const isNCAAB = legSport.includes('ncaab') || legSport.includes('college');
  if (isNCAAB) {
    return settleNcaabTeamLegViaESPN(settledLeg, parlayDate);
  }

  // Route NHL to ESPN scoreboard
  if (legSport.includes('icehockey_nhl') || legSport.includes('nhl')) {
    return settleNhlViaESPN(settledLeg, parlayDate);
  }

  // Route Tennis / Table Tennis to Odds API scores (ESPN doesn't cover these)
  const isTennis = legSport.includes('tennis_atp') || legSport.includes('tennis_wta') || legSport.includes('tennis_pingpong');
  if (isTennis) {
    return settleTennisViaOddsAPI(settledLeg, parlayDate, legSport);
  }

  // NBA: use player game logs aggregation
  const windowEnd = new Date(parlayDate + 'T12:00:00Z');
  windowEnd.setDate(windowEnd.getDate() + 2);
  const windowEndStr = windowEnd.toISOString().split('T')[0];

  const normalizeTeam = (name: string) => name.toLowerCase()
    .replace(/\b(los angeles|la)\b/g, 'la')
    .replace(/\s+/g, ' ')
    .trim();

  const { data: homePlayerLogs } = await supabase
    .from('nba_player_game_logs')
    .select('points, game_date, opponent, is_home')
    .eq('is_home', true)
    .gte('game_date', parlayDate)
    .lte('game_date', windowEndStr);

  const { data: awayPlayerLogs } = await supabase
    .from('nba_player_game_logs')
    .select('points, game_date, opponent, is_home')
    .eq('is_home', false)
    .gte('game_date', parlayDate)
    .lte('game_date', windowEndStr);

  const normAway = normalizeTeam(awayTeamH);
  const normHome = normalizeTeam(homeTeamH);

  const homeScoreLogs = (homePlayerLogs || []).filter((log: any) => {
    const normOpp = normalizeTeam(log.opponent || '');
    return normOpp.includes(normAway) || normAway.includes(normOpp);
  });

  const awayScoreLogs = (awayPlayerLogs || []).filter((log: any) => {
    const normOpp = normalizeTeam(log.opponent || '');
    return normOpp.includes(normHome) || normHome.includes(normOpp);
  });

  if (homeScoreLogs.length === 0 && awayScoreLogs.length === 0) {
    return { outcome: 'no_data', actual_value: null };
  }

  const homeScore = homeScoreLogs.reduce((sum: number, log: any) => sum + (Number(log.points) || 0), 0);
  const awayScore = awayScoreLogs.reduce((sum: number, log: any) => sum + (Number(log.points) || 0), 0);

  if (homeScore === 0 && awayScore === 0) {
    return { outcome: 'no_data', actual_value: null };
  }

  console.log(`[Bot Settle] Team leg: ${homeTeamH} (${homeScore}) vs ${awayTeamH} (${awayScore}) | bet=${settledLeg.bet_type} side=${settledLeg.side} line=${settledLeg.line}`);
  return resolveTeamOutcome(settledLeg, homeScore, awayScore);
}

function resolveTeamOutcome(
  leg: BotLeg,
  homeScore: number,
  awayScore: number
): { outcome: string; actual_value: number | null } {
  if (homeScore === 0 && awayScore === 0) {
    return { outcome: 'no_data', actual_value: null };
  }

  const betType = leg.bet_type || leg.prop_type || '';
  const side = (leg.side || '').toLowerCase();
  const line = leg.line || 0;

  // Total
  if (betType === 'total' || leg.category === 'OVER_TOTAL' || leg.category === 'UNDER_TOTAL') {
    const combinedScore = homeScore + awayScore;
    if (combinedScore === line) return { outcome: 'push', actual_value: combinedScore };
    if (side === 'over' || side === 'o' || leg.category === 'OVER_TOTAL') {
      return { outcome: combinedScore > line ? 'hit' : 'miss', actual_value: combinedScore };
    }
    return { outcome: combinedScore < line ? 'hit' : 'miss', actual_value: combinedScore };
  }

  // Spread
  if (betType === 'spread' || leg.category === 'SHARP_SPREAD') {
    const margin = homeScore - awayScore;
    const actualMargin = side === 'away' ? -margin : margin;
    if (actualMargin + line === 0) return { outcome: 'push', actual_value: margin };
    return { outcome: actualMargin + line > 0 ? 'hit' : 'miss', actual_value: margin };
  }

  // Moneyline
  if (betType === 'moneyline' || leg.category === 'ML_UNDERDOG' || leg.category === 'ML_FAVORITE') {
    if (homeScore === awayScore) return { outcome: 'push', actual_value: 0 };
    const homeWon = homeScore > awayScore;
    if (side === 'home') return { outcome: homeWon ? 'hit' : 'miss', actual_value: homeScore - awayScore };
    return { outcome: !homeWon ? 'hit' : 'miss', actual_value: awayScore - homeScore };
  }

  return { outcome: 'no_data', actual_value: null };
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    const todayET = getEasternDate();

    // Accept targetDate and force flag from request body
    let targetDates: string[] = [];
    let forceSettle = false;
    try {
      const body = await req.json();
      if (body.date) {
        targetDates = [body.date];
      }
      if (body.force === true) {
        forceSettle = true;
      }
    } catch {
      // No body - use defaults
    }

    if (targetDates.length === 0) {
      // Only settle PAST dates — not today (games may still be in progress)
      const yesterday = new Date();
      yesterday.setDate(yesterday.getDate() - 1);
      const yesterdayStr = new Intl.DateTimeFormat('en-CA', {
        timeZone: 'America/New_York',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
      }).format(yesterday);
      
      const twoDaysAgo = new Date();
      twoDaysAgo.setDate(twoDaysAgo.getDate() - 2);
      const twoDaysAgoStr = new Intl.DateTimeFormat('en-CA', {
        timeZone: 'America/New_York',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
      }).format(twoDaysAgo);
      
      targetDates = [twoDaysAgoStr, yesterdayStr];
    }

    // Date guard: filter out today's date to prevent premature settlement
    // Skip guard when force=true (for manual triggers after games are done)
    if (!forceSettle) {
      targetDates = targetDates.filter(d => d < todayET);
    }

    if (targetDates.length === 0) {
      console.log('[Bot Settle] All target dates are today or future — skipping settlement');
      return new Response(
        JSON.stringify({ success: true, parlaysSettled: 0, message: 'No past dates to settle' }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log(`[Bot Settle] Processing parlays for dates: ${targetDates.join(', ')} (today ET: ${todayET})`);

    // NOTE: verify-sweet-spot-outcomes is handled by separate cron — no inline call needed

    // 1. Get pending parlays from target dates
    const { data: pendingParlays, error: parlaysError } = await supabase
      .from('bot_daily_parlays')
      .select('*')
      .in('parlay_date', targetDates)
      .eq('outcome', 'pending');

    if (parlaysError) throw parlaysError;

    // 1b. Also re-process previously voided parlays that may have had premature voids
    // These are parlays marked 'void' but with legs still 'pending' that can now be resolved
    const { data: voidedParlays } = await supabase
      .from('bot_daily_parlays')
      .select('*')
      .in('parlay_date', targetDates)
      .eq('outcome', 'void');

    const recoveredVoided = (voidedParlays || []).filter((p: any) => {
      const legs = Array.isArray(p.legs) ? p.legs : [];
      return legs.some((l: any) => l.outcome === 'pending' || !l.outcome);
    });

    if (recoveredVoided.length > 0) {
      console.log(`[Bot Settle] Found ${recoveredVoided.length} previously voided parlays with pending legs — re-processing`);
    }

    const allParlaysToProcess = [...(pendingParlays || []), ...recoveredVoided];

    if (allParlaysToProcess.length === 0) {
      console.log('[Bot Settle] No pending or recoverable parlays to settle');
      return new Response(
        JSON.stringify({ success: true, parlaysSettled: 0, message: 'No pending parlays' }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log(`[Bot Settle] Found ${(pendingParlays || []).length} pending + ${recoveredVoided.length} recoverable voided = ${allParlaysToProcess.length} total parlays`);

    // 2. Batch fetch all leg IDs from category_sweet_spots at once
    const allPlayerLegIds: string[] = [];
    for (const parlay of allParlaysToProcess) {
      const legs = (Array.isArray(parlay.legs) ? parlay.legs : JSON.parse(parlay.legs)) as BotLeg[];
      for (const leg of legs) {
        if (!isTeamLeg(leg) && leg.id) {
          allPlayerLegIds.push(leg.id);
        }
      }
    }

    // Batch query for all player leg outcomes at once
    const sweetSpotMap = new Map<string, { outcome: string; actual_value: number | null }>();
    if (allPlayerLegIds.length > 0) {
      // Supabase IN filter supports up to ~1000 items, chunk if needed
      const chunks = [];
      for (let i = 0; i < allPlayerLegIds.length; i += 500) {
        chunks.push(allPlayerLegIds.slice(i, i + 500));
      }
      for (const chunk of chunks) {
        const { data: sweetSpots } = await supabase
          .from('category_sweet_spots')
          .select('id, outcome, actual_value')
          .in('id', chunk);
        
        if (sweetSpots) {
          for (const ss of sweetSpots) {
            sweetSpotMap.set(ss.id, { outcome: ss.outcome, actual_value: ss.actual_value });
          }
        }
      }
    }

    console.log(`[Bot Settle] Batch loaded ${sweetSpotMap.size} sweet spot outcomes for ${allPlayerLegIds.length} player legs`);

    // 3. Load category weights for learning
    const { data: categoryWeights, error: weightsError } = await supabase
      .from('bot_category_weights')
      .select('*');

    if (weightsError) throw weightsError;

    const weightMap = new Map<string, any>();
    (categoryWeights || []).forEach((w: any) => {
      weightMap.set(w.category, w);
    });

    // 4. Process each parlay — track P&L per parlay_date (not run date)
    let parlaysSettled = 0;
    let parlaysWon = 0;
    let parlaysLost = 0;
    let totalProfitLoss = 0;
    const categoryUpdates = new Map<string, { hits: number; misses: number }>();
    // Track P&L per parlay_date for correct date attribution
    const pnlByDate = new Map<string, { won: number; lost: number; profitLoss: number }>();
    // Collect per-parlay leg details for Telegram breakdown (cap at 15)
    const settledParlayDetails: Array<{
      strategy: string;
      tier: string;
      outcome: string;
      odds: number;
      legs: Array<{ player_name: string; prop_type: string; line: number; side: string; outcome: string; actual_value: number | null }>;
    }> = [];

    for (const parlay of allParlaysToProcess) {
      const legs = (Array.isArray(parlay.legs) ? parlay.legs : JSON.parse(parlay.legs)) as BotLeg[];
      let legsHit = 0;
      let legsMissed = 0;
      let legsVoided = 0;
      const updatedLegs: BotLeg[] = [];

      for (const leg of legs) {
        let legOutcome = 'pending';
        let actualValue: number | null = null;

        if (isTeamLeg(leg)) {
          const teamResult = await settleTeamLeg(supabase, leg, parlay.parlay_date);
          legOutcome = teamResult.outcome;
          actualValue = teamResult.actual_value;
        } else {
          const sweetSpot = sweetSpotMap.get(leg.id);
          if (sweetSpot && sweetSpot.outcome && sweetSpot.outcome !== 'pending') {
            if (sweetSpot.outcome === 'hit') {
              legOutcome = 'hit';
            } else if (sweetSpot.outcome === 'miss') {
              legOutcome = 'miss';
            } else if (sweetSpot.outcome === 'no_data') {
              legOutcome = 'void';
            }
            actualValue = sweetSpot.actual_value;
          } else {
            // Normalize prop type: player_points_rebounds_assists -> pra, player_assists -> assists, etc.
            const rawProp = (leg.prop_type || '').toLowerCase().replace(/^player_/, '');
            let normalizedProp = rawProp;
            if (rawProp === 'points_rebounds_assists') normalizedProp = 'pra';
            else if (rawProp === 'points_rebounds') normalizedProp = 'pr';
            else if (rawProp === 'points_assists') normalizedProp = 'pa';
            else if (rawProp === 'rebounds_assists') normalizedProp = 'ra';
            else if (rawProp === 'three_pointers' || rawProp === 'threes_made') normalizedProp = 'threes';

            // FALLBACK 1: Query category_sweet_spots by player name + prop type + line + date
            const normalizedName = (leg.player_name || '').toLowerCase().replace(/\./g, '').replace(/\b(jr|sr|ii|iii|iv|v)\b/g, '').replace(/[^a-z\s-]/g, '').replace(/\s+/g, ' ').trim();
            
            // Try both raw and normalized prop types
            const propVariants = [leg.prop_type, normalizedProp, rawProp].filter((v, i, a) => a.indexOf(v) === i);
            let fallbackFound = false;
            
            for (const propVariant of propVariants) {
              if (fallbackFound) break;
              const { data: fallbackSS } = await supabase
                .from('category_sweet_spots')
                .select('outcome, actual_value')
                .ilike('player_name', `%${normalizedName}%`)
                .eq('prop_type', propVariant)
                .eq('recommended_line', leg.line)
                .eq('analysis_date', parlay.parlay_date)
                .neq('outcome', 'pending')
                .limit(1);

              if (fallbackSS && fallbackSS.length > 0) {
                const fb = fallbackSS[0];
                console.log(`[Bot Settle] FALLBACK 1 match: ${leg.player_name} ${leg.prop_type}->${propVariant} ${leg.line} -> ${fb.outcome}`);
                if (fb.outcome === 'hit') legOutcome = 'hit';
                else if (fb.outcome === 'miss') legOutcome = 'miss';
                else if (fb.outcome === 'no_data') legOutcome = 'void';
                actualValue = fb.actual_value;
                fallbackFound = true;
              }
            }

            if (!fallbackFound) {
              // FALLBACK 2: Direct game log lookup (try primary name + aliases)
              const namesToTry = [normalizedName];
              const aliases = NAME_ALIASES[normalizedName];
              if (aliases) namesToTry.push(...aliases);

              let gameLogFound = false;
              for (const tryName of namesToTry) {
                if (gameLogFound) break;
                const { data: gameLogs } = await supabase
                  .from('nba_player_game_logs')
                  .select('player_name, points, rebounds, assists, threes_made, steals, blocks')
                  .eq('game_date', parlay.parlay_date)
                  .ilike('player_name', `%${tryName}%`)
                  .limit(1);

                if (gameLogs && gameLogs.length > 0) {
                  gameLogFound = true;
                  const gl = gameLogs[0];
                  let statVal: number | null = null;
                  if (normalizedProp === 'points') statVal = Number(gl.points) || 0;
                  else if (normalizedProp === 'rebounds') statVal = Number(gl.rebounds) || 0;
                  else if (normalizedProp === 'assists') statVal = Number(gl.assists) || 0;
                  else if (normalizedProp === 'threes') statVal = Number(gl.threes_made) || 0;
                  else if (normalizedProp === 'steals') statVal = Number(gl.steals) || 0;
                  else if (normalizedProp === 'blocks') statVal = Number(gl.blocks) || 0;
                  else if (normalizedProp === 'pra') statVal = (Number(gl.points) || 0) + (Number(gl.rebounds) || 0) + (Number(gl.assists) || 0);
                  else if (normalizedProp === 'pr') statVal = (Number(gl.points) || 0) + (Number(gl.rebounds) || 0);
                  else if (normalizedProp === 'pa') statVal = (Number(gl.points) || 0) + (Number(gl.assists) || 0);
                  else if (normalizedProp === 'ra') statVal = (Number(gl.rebounds) || 0) + (Number(gl.assists) || 0);

                  if (statVal !== null) {
                    actualValue = statVal;
                    const side = (leg.side || 'OVER').toUpperCase();
                    if (statVal === leg.line) {
                      legOutcome = 'push';
                    } else if (side === 'OVER') {
                      legOutcome = statVal > leg.line ? 'hit' : 'miss';
                    } else {
                      legOutcome = statVal < leg.line ? 'hit' : 'miss';
                    }
                    console.log(`[Bot Settle] FALLBACK 2 game log (name="${tryName}"): ${leg.player_name} ${normalizedProp} ${leg.line} ${side} -> actual=${statVal} -> ${legOutcome}`);
                  }
                }
              }

              if (!gameLogFound) {
                // No game log found — check if parlay is old enough to void
                const parlayAge = Date.now() - new Date(parlay.parlay_date + 'T23:59:00-05:00').getTime();
                const hoursOld = parlayAge / (1000 * 60 * 60);
                if (hoursOld > 48) {
                  legOutcome = 'void'; // Game was 2+ days ago, truly DNP
                  console.log(`[Bot Settle] FALLBACK 2 no game log (48h+ old): ${leg.player_name} on ${parlay.parlay_date} -> void`);
                } else {
                  legOutcome = 'pending'; // Keep pending for retry — game logs may not be ingested yet
                  console.log(`[Bot Settle] FALLBACK 2 no game log (${hoursOld.toFixed(0)}h old, <48h): ${leg.player_name} on ${parlay.parlay_date} -> keeping pending for retry`);
                }
              }
            }
          }
        }

        if (legOutcome === 'hit') legsHit++;
        else if (legOutcome === 'miss') legsMissed++;
        else if (legOutcome === 'void' || legOutcome === 'no_data') legsVoided++;

        // Write hit boolean for leg-level learning
        const legHit = legOutcome === 'hit' ? true : legOutcome === 'miss' ? false : undefined;
        updatedLegs.push({ ...leg, outcome: legOutcome, actual_value: actualValue ?? undefined, hit: legHit });

        if ((legOutcome === 'hit' || legOutcome === 'miss') && leg.category) {
          const existing = categoryUpdates.get(leg.category) || { hits: 0, misses: 0 };
          if (legOutcome === 'hit') existing.hits++;
          else existing.misses++;
          categoryUpdates.set(leg.category, existing);
        }
      }

      const activeLegCount = legs.length - legsVoided;
      let outcome = 'pending';
      let profitLoss = 0;
      
      if (activeLegCount === 0 || legsVoided > legs.length / 2) {
        outcome = 'void';
        parlaysSettled++;
      } else if (legsHit + legsMissed === activeLegCount) {
        if (legsMissed === 0) {
          outcome = 'won';
          const odds = parlay.expected_odds || 500;
          const decimalOdds = odds > 0 ? (odds / 100) + 1 : (100 / Math.abs(odds)) + 1;
          const payout = (parlay.simulated_stake || 100) * decimalOdds;
          profitLoss = payout - (parlay.simulated_stake || 100);
          parlaysWon++;
        } else {
          outcome = 'lost';
          profitLoss = -(parlay.simulated_stake || 100);
          parlaysLost++;
        }
        parlaysSettled++;
        totalProfitLoss += profitLoss;
      }

      // Accumulate P&L under the parlay's own date, not the run date
      if (outcome === 'won' || outcome === 'lost') {
        const dateKey = parlay.parlay_date;
        const existing = pnlByDate.get(dateKey) || { won: 0, lost: 0, profitLoss: 0 };
        if (outcome === 'won') existing.won++;
        else existing.lost++;
        existing.profitLoss += profitLoss;
        pnlByDate.set(dateKey, existing);
      }

      // Collect leg details for Telegram breakdown
      if (outcome === 'won' || outcome === 'lost') {
        if (settledParlayDetails.length < 15) {
          settledParlayDetails.push({
            strategy: parlay.strategy_name || 'Unknown',
            tier: parlay.tier || 'exploration',
            outcome,
            odds: parlay.expected_odds || 0,
            legs: updatedLegs.map(l => ({
              player_name: l.player_name,
              prop_type: l.prop_type,
              line: l.line,
              side: l.side,
              outcome: l.outcome || 'pending',
              actual_value: l.actual_value ?? null,
            })),
          });
        }
      }

      await supabase
        .from('bot_daily_parlays')
        .update({
          legs: updatedLegs,
          outcome,
          legs_hit: legsHit,
          legs_missed: legsMissed,
          profit_loss: profitLoss,
          simulated_payout: outcome === 'won' ? profitLoss + (parlay.simulated_stake || 100) : (outcome === 'lost' ? 0 : null),
          settled_at: outcome !== 'pending' ? new Date().toISOString() : null,
        })
        .eq('id', parlay.id);
    }

    console.log(`[Bot Settle] Settled ${parlaysSettled} parlays (${parlaysWon}W ${parlaysLost}L)`);
    console.log(`[Bot Settle] P&L by date: ${JSON.stringify(Object.fromEntries(pnlByDate))}`);

    // 4b. Update player performance and prop type performance tables
    try {
      // Collect all settled leg outcomes across all parlays
      const playerPerfUpdates = new Map<string, { hits: number; misses: number; edges: number[] }>();
      const propTypePerfUpdates = new Map<string, { hits: number; misses: number }>();

      for (const parlay of allParlaysToProcess) {
        const legs = (Array.isArray(parlay.legs) ? parlay.legs : JSON.parse(parlay.legs)) as BotLeg[];
        for (const leg of legs) {
          const legOutcome = (leg as any).outcome || leg.outcome;
          if (legOutcome !== 'hit' && legOutcome !== 'miss') continue;
          if (isTeamLeg(leg)) continue; // Only track player props

          const playerName = (leg.player_name || '').trim();
          const propType = (leg.prop_type || '').toLowerCase();
          const side = (leg.side || 'over').toLowerCase();
          if (!playerName || !propType) continue;

          const isHit = legOutcome === 'hit';

          // Player performance
          const playerKey = `${playerName.toLowerCase()}|${propType}|${side}`;
          const playerStats = playerPerfUpdates.get(playerKey) || { hits: 0, misses: 0, edges: [] };
          if (isHit) playerStats.hits++; else playerStats.misses++;
          if ((leg as any).edge_pct) playerStats.edges.push((leg as any).edge_pct);
          playerPerfUpdates.set(playerKey, playerStats);

          // Prop type performance
          const propStats = propTypePerfUpdates.get(propType) || { hits: 0, misses: 0 };
          if (isHit) propStats.hits++; else propStats.misses++;
          propTypePerfUpdates.set(propType, propStats);
        }
      }

      // Upsert player performance
      let playerPerfCount = 0;
      for (const [key, stats] of playerPerfUpdates) {
        const [playerNameLower, propType, side] = key.split('|');
        // Find original casing from legs
        let originalName = playerNameLower;
        for (const parlay of allParlaysToProcess) {
          const legs = (Array.isArray(parlay.legs) ? parlay.legs : JSON.parse(parlay.legs)) as BotLeg[];
          for (const leg of legs) {
            if ((leg.player_name || '').toLowerCase() === playerNameLower) {
              originalName = leg.player_name;
              break;
            }
          }
          if (originalName !== playerNameLower) break;
        }

        const { data: existing } = await supabase
          .from('bot_player_performance')
          .select('*')
          .eq('player_name', originalName)
          .eq('prop_type', propType)
          .eq('side', side)
          .maybeSingle();

        const newLegsPlayed = (existing?.legs_played || 0) + stats.hits + stats.misses;
        const newLegsWon = (existing?.legs_won || 0) + stats.hits;
        const newHitRate = newLegsPlayed > 0 ? newLegsWon / newLegsPlayed : 0;
        const avgEdge = stats.edges.length > 0 ? stats.edges.reduce((a, b) => a + b, 0) / stats.edges.length : (existing?.avg_edge || 0);
        
        // Update streak
        let newStreak = existing?.streak || 0;
        // Process hits then misses (simplified — last outcome determines direction)
        if (stats.hits > 0 && stats.misses === 0) {
          newStreak = Math.max(1, newStreak + stats.hits);
        } else if (stats.misses > 0 && stats.hits === 0) {
          newStreak = Math.min(-1, newStreak - stats.misses);
        } else {
          // Mixed — reset to net
          newStreak = stats.hits - stats.misses;
        }

        if (existing) {
          await supabase
            .from('bot_player_performance')
            .update({
              legs_played: newLegsPlayed,
              legs_won: newLegsWon,
              hit_rate: newHitRate,
              avg_edge: avgEdge,
              streak: newStreak,
              last_updated: new Date().toISOString().split('T')[0],
            })
            .eq('id', existing.id);
        } else {
          await supabase
            .from('bot_player_performance')
            .insert({
              player_name: originalName,
              prop_type: propType,
              side,
              legs_played: stats.hits + stats.misses,
              legs_won: stats.hits,
              hit_rate: (stats.hits + stats.misses) > 0 ? stats.hits / (stats.hits + stats.misses) : 0,
              avg_edge: avgEdge,
              streak: newStreak,
              last_updated: new Date().toISOString().split('T')[0],
            });
        }
        playerPerfCount++;
      }

      // Upsert prop type performance
      let propPerfCount = 0;
      for (const [propType, stats] of propTypePerfUpdates) {
        const { data: existing } = await supabase
          .from('bot_prop_type_performance')
          .select('*')
          .eq('prop_type', propType)
          .maybeSingle();

        const newTotal = (existing?.total_legs || 0) + stats.hits + stats.misses;
        const newWon = (existing?.legs_won || 0) + stats.hits;
        const newHitRate = newTotal > 0 ? newWon / newTotal : 0;
        
        // Auto-block: 5+ legs and <25% hit rate
        const autoBlock = newTotal >= 5 && newHitRate < 0.25;
        // Auto-boost: 10+ legs and >60% hit rate
        const autoBoost = newTotal >= 10 && newHitRate > 0.60;

        if (existing) {
          await supabase
            .from('bot_prop_type_performance')
            .update({
              total_legs: newTotal,
              legs_won: newWon,
              hit_rate: newHitRate,
              is_blocked: autoBlock,
              is_boosted: autoBoost,
              boost_multiplier: autoBoost ? 1.2 : 1.0,
              last_updated: new Date().toISOString().split('T')[0],
            })
            .eq('id', existing.id);
        } else {
          await supabase
            .from('bot_prop_type_performance')
            .insert({
              prop_type: propType,
              total_legs: stats.hits + stats.misses,
              legs_won: stats.hits,
              hit_rate: (stats.hits + stats.misses) > 0 ? stats.hits / (stats.hits + stats.misses) : 0,
              is_blocked: autoBlock,
              is_boosted: autoBoost,
              boost_multiplier: autoBoost ? 1.2 : 1.0,
              last_updated: new Date().toISOString().split('T')[0],
            });
        }
        propPerfCount++;
      }

      console.log(`[Bot Settle] Player performance: ${playerPerfCount} players updated. Prop type performance: ${propPerfCount} prop types updated.`);
    } catch (perfErr) {
      console.error('[Bot Settle] Player/prop performance update error:', perfErr);
    }

    // 5. Update category weights based on outcomes
    const weightChanges: Array<{ category: string; oldWeight: number; newWeight: number; delta: number }> = [];
    
    for (const [category, stats] of categoryUpdates) {
      const existing = weightMap.get(category);
      if (!existing) continue;

      const oldWeight = existing.weight;
      let currentWeight = existing.weight;
      let currentStreak = existing.current_streak;

      for (let i = 0; i < stats.hits; i++) {
        const result = adjustWeight(currentWeight, true, currentStreak);
        currentWeight = result.newWeight;
        currentStreak = result.newStreak;
      }

      for (let i = 0; i < stats.misses; i++) {
        const result = adjustWeight(currentWeight, false, currentStreak);
        currentWeight = result.newWeight;
        currentStreak = result.newStreak;
      }

      if (currentWeight !== oldWeight) {
        weightChanges.push({ category, oldWeight, newWeight: currentWeight, delta: currentWeight - oldWeight });
      }

      await supabase
        .from('bot_category_weights')
        .update({
          weight: currentWeight,
          is_blocked: currentWeight === 0,
          block_reason: currentWeight === 0 ? 'Weight dropped below threshold' : null,
          current_streak: currentStreak,
          best_streak: Math.max(existing.best_streak || 0, currentStreak > 0 ? currentStreak : 0),
          worst_streak: Math.min(existing.worst_streak || 0, currentStreak < 0 ? currentStreak : 0),
          total_picks: (existing.total_picks || 0) + stats.hits + stats.misses,
          total_hits: (existing.total_hits || 0) + stats.hits,
          current_hit_rate: ((existing.total_hits || 0) + stats.hits) / 
                           ((existing.total_picks || 0) + stats.hits + stats.misses) * 100,
          updated_at: new Date().toISOString(),
        })
        .eq('id', existing.id);
    }

    // 6. Update activation status — write P&L to each parlay_date, not today
    // This ensures Feb 9 parlays settled on Feb 10 show up on Feb 9 in the calendar
    let isProfitableDay = false;
    let newConsecutive = 0;
    let isRealModeReady = false;
    let newBankroll = 0;

    // Process each date that had settlements
    const datesToProcess = pnlByDate.size > 0 ? [...pnlByDate.keys()] : [];

    for (const dateKey of datesToProcess) {
      const datePnL = pnlByDate.get(dateKey)!;
      
      // Get the previous day's status for bankroll chaining
      const { data: prevStatus } = await supabase
        .from('bot_activation_status')
        .select('*')
        .lt('check_date', dateKey)
        .order('check_date', { ascending: false })
        .limit(1)
        .maybeSingle();

      const prevConsecutive = prevStatus?.consecutive_profitable_days || 0;
      const prevBankroll = prevStatus?.simulated_bankroll || 1000;

      // Check if there's already an entry for this date
      const { data: existingEntry } = await supabase
        .from('bot_activation_status')
        .select('*')
        .eq('check_date', dateKey)
        .maybeSingle();

      // Accumulate P&L across multiple runs
      const accumulatedPnL = (existingEntry?.daily_profit_loss || 0) + datePnL.profitLoss;
      const accumulatedWon = (existingEntry?.parlays_won || 0) + datePnL.won;
      const accumulatedLost = (existingEntry?.parlays_lost || 0) + datePnL.lost;
      const BANKROLL_FLOOR = 1000;
      const accumulatedBankroll = Math.max(
        BANKROLL_FLOOR,
        existingEntry 
          ? (existingEntry.simulated_bankroll || prevBankroll) + datePnL.profitLoss
          : prevBankroll + datePnL.profitLoss
      );
      const dateIsProfitable = accumulatedPnL > 0;
      const dateConsecutive = dateIsProfitable ? prevConsecutive + 1 : 0;
      const dateIsRealModeReady = dateConsecutive >= 3 && 
                              (accumulatedWon / Math.max(1, accumulatedWon + accumulatedLost)) >= 0.60;

      if (existingEntry) {
        await supabase
          .from('bot_activation_status')
          .update({
            parlays_won: accumulatedWon,
            parlays_lost: accumulatedLost,
            daily_profit_loss: accumulatedPnL,
            is_profitable_day: dateIsProfitable,
            consecutive_profitable_days: dateConsecutive,
            is_real_mode_ready: dateIsRealModeReady,
            simulated_bankroll: accumulatedBankroll,
            activated_at: dateIsRealModeReady && !existingEntry.is_real_mode_ready 
              ? new Date().toISOString() 
              : existingEntry.activated_at,
          })
          .eq('id', existingEntry.id);
      } else {
        await supabase
          .from('bot_activation_status')
          .insert({
            check_date: dateKey,
            parlays_won: datePnL.won,
            parlays_lost: datePnL.lost,
            daily_profit_loss: datePnL.profitLoss,
            is_profitable_day: datePnL.profitLoss > 0,
            consecutive_profitable_days: datePnL.profitLoss > 0 ? prevConsecutive + 1 : 0,
            is_real_mode_ready: dateIsRealModeReady,
            simulated_bankroll: prevBankroll + datePnL.profitLoss,
            activated_at: dateIsRealModeReady ? new Date().toISOString() : null,
          });
      }

      // Track latest values for Telegram notification
      isProfitableDay = dateIsProfitable;
      newConsecutive = dateConsecutive;
      isRealModeReady = dateIsRealModeReady;
      newBankroll = accumulatedBankroll;
    }

    // If no dates had settlements, still set defaults for downstream
    if (datesToProcess.length === 0) {
      const { data: latestStatus } = await supabase
        .from('bot_activation_status')
        .select('*')
        .order('check_date', { ascending: false })
        .limit(1)
        .maybeSingle();
      
      newBankroll = latestStatus?.simulated_bankroll || 1000;
      newConsecutive = latestStatus?.consecutive_profitable_days || 0;
      isRealModeReady = latestStatus?.is_real_mode_ready || false;
    }

    // 7. Update strategy performance
    if (parlaysSettled > 0) {
      const { data: strategy } = await supabase
        .from('bot_strategies')
        .select('*')
        .eq('is_active', true)
        .limit(1)
        .maybeSingle();

      if (strategy) {
        const newTimesWon = (strategy.times_won || 0) + parlaysWon;
        const newTimesUsed = strategy.times_used || 0;
        const newWinRate = newTimesUsed > 0 ? newTimesWon / newTimesUsed : 0;

        await supabase
          .from('bot_strategies')
          .update({
            times_won: newTimesWon,
            win_rate: newWinRate,
            updated_at: new Date().toISOString(),
          })
          .eq('id', strategy.id);
      }
    }

    console.log(`[Bot Settle] Complete. P/L: $${totalProfitLoss}, Consecutive: ${newConsecutive}`);

    // 8. Sync weights from recently settled category_sweet_spots (last 24h)
    let sweetSpotSynced = 0;
    try {
      const yesterday24h = new Date();
      yesterday24h.setHours(yesterday24h.getHours() - 24);
      
      const { data: recentOutcomes, error: recentError } = await supabase
        .from('category_sweet_spots')
        .select('category, recommended_side, outcome, settled_at')
        .gte('settled_at', yesterday24h.toISOString())
        .not('outcome', 'is', null);

      if (!recentError && recentOutcomes && recentOutcomes.length > 0) {
        const outcomeMap = new Map<string, { hits: number; misses: number }>();
        
        for (const outcome of recentOutcomes as RecentOutcome[]) {
          const key = `${outcome.category}__${outcome.recommended_side || 'over'}`;
          let stats = outcomeMap.get(key);
          if (!stats) {
            stats = { hits: 0, misses: 0 };
            outcomeMap.set(key, stats);
          }
          if (outcome.outcome === 'hit') stats.hits++;
          else if (outcome.outcome === 'miss') stats.misses++;
        }

        for (const [key, stats] of outcomeMap) {
          const [category, side] = key.split('__');
          
          const { data: existingWeight } = await supabase
            .from('bot_category_weights')
            .select('*')
            .eq('category', category)
            .eq('side', side)
            .maybeSingle();

          if (existingWeight && !existingWeight.is_blocked) {
            let currentWeight = existingWeight.weight || 1.0;
            let currentStreak = existingWeight.current_streak || 0;
            let blocked = false;
            let blockReason: string | null = null;

            for (let i = 0; i < stats.hits; i++) {
              const result = adjustWeight(currentWeight, true, currentStreak);
              currentWeight = result.newWeight;
              currentStreak = result.newStreak;
            }

            for (let i = 0; i < stats.misses; i++) {
              const result = adjustWeight(currentWeight, false, currentStreak);
              currentWeight = result.newWeight;
              currentStreak = result.newStreak;
              if (result.blocked) {
                blocked = true;
                blockReason = result.blockReason || 'Weight dropped below threshold';
              }
            }

            const newTotalPicks = (existingWeight.total_picks || 0) + stats.hits + stats.misses;
            const newTotalHits = (existingWeight.total_hits || 0) + stats.hits;
            const newHitRate = newTotalPicks > 0 ? (newTotalHits / newTotalPicks) * 100 : 0;

            if (newTotalPicks >= BLOCK_MIN_SAMPLES && newHitRate < BLOCK_HIT_RATE_THRESHOLD) {
              blocked = true;
              blockReason = `Hit rate ${newHitRate.toFixed(1)}% below ${BLOCK_HIT_RATE_THRESHOLD}% with ${newTotalPicks} samples`;
              currentWeight = 0;
            }

            await supabase
              .from('bot_category_weights')
              .update({
                weight: currentWeight,
                is_blocked: blocked,
                block_reason: blockReason,
                current_streak: currentStreak,
                best_streak: Math.max(existingWeight.best_streak || 0, currentStreak > 0 ? currentStreak : 0),
                worst_streak: Math.min(existingWeight.worst_streak || 0, currentStreak < 0 ? currentStreak : 0),
                total_picks: newTotalPicks,
                total_hits: newTotalHits,
                current_hit_rate: newHitRate,
                updated_at: new Date().toISOString(),
              })
              .eq('id', existingWeight.id);

            sweetSpotSynced++;
          }
        }
        
        console.log(`[Bot Settle] Synced ${sweetSpotSynced} categories from ${recentOutcomes.length} sweet spot outcomes`);
      }
    } catch (syncError) {
      console.error('[Bot Settle] Sweet spot sync error:', syncError);
    }

    // 9. Trigger calibration
    try {
      await fetch(`${supabaseUrl}/functions/v1/calibrate-bot-weights`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${supabaseKey}`,
        },
        body: JSON.stringify({ fullRebuild: false }),
      });
      console.log('[Bot Settle] Calibration triggered');
    } catch (calibrateError) {
      console.error('[Bot Settle] Calibration trigger failed:', calibrateError);
    }

    // 10. Upsert bot_learning_metrics snapshot
    try {
      for (const tier of ['exploration', 'validation', 'execution']) {
        const { data: tierParlays } = await supabase
          .from('bot_daily_parlays')
          .select('outcome, tier')
          .eq('tier', tier);

        const all = tierParlays || [];
        const settled = all.filter((p: any) => p.outcome && p.outcome !== 'pending');
        const wins = settled.filter((p: any) => p.outcome === 'won').length;
        const losses = settled.filter((p: any) => p.outcome === 'lost').length;
        const totalSettled = settled.length;
        const winRate = totalSettled > 0 ? wins / totalSettled : 0;
        const targetSamples = tier === 'exploration' ? 500 : 300;
        const sampleSufficiency = Math.min(100, (totalSettled / targetSamples) * 100);

        // Wilson score interval
        const z = 1.96;
        const n = totalSettled || 1;
        const p = wins / n;
        const denom = 1 + z * z / n;
        const center = p + z * z / (2 * n);
        const spread = z * Math.sqrt((p * (1 - p) + z * z / (4 * n)) / n);
        const ciLower = Math.max(0, (center - spread) / denom) * 100;
        const ciUpper = Math.min(1, (center + spread) / denom) * 100;

        const dailyRate = all.length / 7;
        const remaining = Math.max(0, targetSamples - totalSettled);
        const daysToConvergence = dailyRate > 0 ? Math.ceil(remaining / dailyRate) : 999;

        const today = new Date().toISOString().split('T')[0];
        await supabase
          .from('bot_learning_metrics')
          .upsert({
            snapshot_date: today,
            tier,
            total_generated: all.length,
            total_settled: totalSettled,
            wins,
            losses,
            win_rate: winRate,
            sample_sufficiency: sampleSufficiency,
            ci_lower: ciLower,
            ci_upper: ciUpper,
            days_to_convergence: daysToConvergence,
          }, { onConflict: 'snapshot_date,tier' });
      }
      console.log('[Bot Settle] Learning metrics snapshot upserted');
    } catch (metricsError) {
      console.error('[Bot Settle] Learning metrics error:', metricsError);
    }

    // 11. Log activity
    await supabase.from('bot_activity_log').insert({
      event_type: 'settlement_complete',
      message: `Settled ${parlaysSettled} parlays: ${parlaysWon}W ${parlaysLost}L | Synced ${sweetSpotSynced} categories`,
      metadata: { 
        parlaysWon,
        parlaysLost,
        totalProfitLoss,
        consecutiveDays: newConsecutive,
        isRealModeReady,
        newBankroll,
        sweetSpotSynced,
        categoryUpdates: Array.from(categoryUpdates.entries()).map(([cat, stats]) => ({
          category: cat, hits: stats.hits, misses: stats.misses,
        })),
      },
      severity: isProfitableDay ? 'success' : 'warning',
    });

    // 11. Gather strategy info and send Telegram
    let activeStrategyName: string | undefined;
    let activeStrategyWinRate: number | undefined;
    let blockedCategories: string[] = [];

    try {
      const { data: activeStrategy } = await supabase
        .from('bot_strategies')
        .select('strategy_name, win_rate')
        .eq('is_active', true)
        .limit(1)
        .maybeSingle();

      if (activeStrategy) {
        activeStrategyName = activeStrategy.strategy_name;
        activeStrategyWinRate = activeStrategy.win_rate ?? undefined;
      }

      const { data: blockedRows } = await supabase
        .from('bot_category_weights')
        .select('category, side')
        .eq('is_blocked', true)
        .limit(10);

      if (blockedRows) {
        blockedCategories = blockedRows.map(r => `${r.category}_${r.side}`);
      }
    } catch (stratError) {
      console.error('[Bot Settle] Strategy/blocked query error:', stratError);
    }

    // === AUTO-DOUBLE STAKES AFTER PROFITABLE DAY ===
    try {
      const { data: stakeConfig } = await supabase
        .from('bot_stake_config')
        .select('*')
        .limit(1)
        .single();

      if (stakeConfig) {
        const alreadyProcessed = stakeConfig.last_streak_date === todayET;
        if (!alreadyProcessed) {
          if (isProfitableDay && totalProfitLoss > 0) {
            // Double all stakes from baseline (capped at 2x, no compounding)
            const { error: doubleErr } = await supabase
              .from('bot_stake_config')
              .update({
                streak_multiplier: 2.0,
                execution_stake: (stakeConfig.baseline_execution_stake ?? stakeConfig.execution_stake) * 2,
                validation_stake: (stakeConfig.baseline_validation_stake ?? stakeConfig.validation_stake) * 2,
                exploration_stake: (stakeConfig.baseline_exploration_stake ?? stakeConfig.exploration_stake) * 2,
                bankroll_doubler_stake: (stakeConfig.baseline_bankroll_doubler_stake ?? stakeConfig.bankroll_doubler_stake) * 2,
                last_streak_date: todayET,
                updated_at: new Date().toISOString(),
              })
              .eq('id', stakeConfig.id);
            if (doubleErr) console.error('[Bot Settle] Stake doubling error:', doubleErr);
            else console.log('[Bot Settle] Profitable day detected — stakes DOUBLED for tomorrow');
          } else {
            // Reset to baseline
            const { error: resetErr } = await supabase
              .from('bot_stake_config')
              .update({
                streak_multiplier: 1.0,
                execution_stake: stakeConfig.baseline_execution_stake ?? stakeConfig.execution_stake,
                validation_stake: stakeConfig.baseline_validation_stake ?? stakeConfig.validation_stake,
                exploration_stake: stakeConfig.baseline_exploration_stake ?? stakeConfig.exploration_stake,
                bankroll_doubler_stake: stakeConfig.baseline_bankroll_doubler_stake ?? stakeConfig.bankroll_doubler_stake,
                last_streak_date: todayET,
                updated_at: new Date().toISOString(),
              })
              .eq('id', stakeConfig.id);
            if (resetErr) console.error('[Bot Settle] Stake reset error:', resetErr);
            else console.log('[Bot Settle] Loss day — stakes reset to baseline');
          }
        } else {
          console.log('[Bot Settle] Stake adjustment already processed for today');
        }
      }
    } catch (stakeErr) {
      console.error('[Bot Settle] Auto-double stakes error:', stakeErr);
    }

    try {
      await fetch(`${supabaseUrl}/functions/v1/bot-send-telegram`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${supabaseKey}`,
        },
        body: JSON.stringify({
          type: isRealModeReady ? 'activation_ready' : 'settlement_complete',
          data: {
            parlaysWon,
            parlaysLost,
            profitLoss: totalProfitLoss,
            consecutiveDays: newConsecutive,
            bankroll: newBankroll,
            isRealModeReady,
            sweetSpotSynced,
            winRate: parlaysWon + parlaysLost > 0 
              ? Math.round((parlaysWon / (parlaysWon + parlaysLost)) * 100) 
              : 0,
            weightChanges,
            strategyName: activeStrategyName,
            strategyWinRate: activeStrategyWinRate,
            blockedCategories,
            parlayDetails: settledParlayDetails,
          },
        }),
      });
      console.log('[Bot Settle] Telegram notification sent');

      // Send daily winners report
      try {
        const winnersResp = await fetch(`${supabaseUrl}/functions/v1/bot-daily-winners`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${supabaseKey}`,
          },
          body: JSON.stringify({}),
        });
        const winnersData = await winnersResp.json();
        if (winnersData?.winners?.length > 0) {
          await fetch(`${supabaseUrl}/functions/v1/bot-send-telegram`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${supabaseKey}`,
            },
            body: JSON.stringify({
              type: 'daily_winners',
              data: winnersData,
            }),
          });
          console.log('[Bot Settle] Daily winners Telegram report sent');
        }
      } catch (winnersErr) {
        console.error('[Bot Settle] Daily winners report failed:', winnersErr);
      }
    } catch (telegramError) {
      console.error('[Bot Settle] Telegram notification failed:', telegramError);
    }

    return new Response(
      JSON.stringify({
        success: true,
        parlaysSettled,
        parlaysWon,
        parlaysLost,
        totalProfitLoss,
        isProfitableDay,
        consecutiveProfitDays: newConsecutive,
        isRealModeReady,
        newBankroll,
        sweetSpotSynced,
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('[Bot Settle] Error:', error);
    return new Response(
      JSON.stringify({ success: false, error: error.message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
