// Multi-sport Ladder Lock of the Day (MLB / NBA / NHL)
// Picks a single highest-confidence player prop per day and broadcasts to Telegram.
// Tier system: Lock (90%+ floor>line) -> Strong (80%+ floor>=line) -> Lean (70%+ avg>=line).
// Always sends a Telegram message so the channel never goes silent.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.38.4";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

function getEasternDate(): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/New_York',
    year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date());
}

const normalizeName = (name: string) =>
  name.toLowerCase().replace(/\./g, '').replace(/'/g, '')
    .replace(/jr$/i, '').replace(/sr$/i, '').replace(/iii$/i, '').replace(/ii$/i, '').trim();

function americanToDecimal(odds: number): number {
  if (odds >= 100) return (odds / 100) + 1;
  return (100 / Math.abs(odds)) + 1;
}

function impliedProb(odds: number): number {
  return odds >= 100 ? 100 / (odds + 100) : Math.abs(odds) / (Math.abs(odds) + 100);
}

async function fetchWithTimeout(url: string, options: RequestInit = {}, timeoutMs = 10000): Promise<Response> {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), timeoutMs);
  try { return await fetch(url, { ...options, signal: controller.signal }); }
  finally { clearTimeout(t); }
}

type Tier = 'lock' | 'strong' | 'lean';
type Sport = 'NBA' | 'MLB' | 'NHL';

interface LockCandidate {
  sport: Sport;
  player_name: string;
  prop_type: string;        // internal market key
  prop_label: string;       // human readable e.g. "RBIs"
  side: 'OVER' | 'UNDER';
  line: number;
  odds: number;
  bookmaker: string;
  game: string;
  player_team: string;
  opponent: string;
  l10_values: number[];
  l10_avg: number;
  l10_min: number;
  l10_max: number;
  l10_median: number;
  l10_hit_rate: number;
  l10_games: number;
  l10_hits: number;
  floor_margin: number;
  median_clearance: number;
  safety_score: number;
  tier: Tier;
  safety_breakdown: {
    hit_rate_score: number;
    floor_score: number;
    edge_score: number;
    consistency_score: number;
    floor_margin: number;
  };
}

const SPORT_EMOJI: Record<Sport, string> = { NBA: '🏀', MLB: '⚾', NHL: '🏒' };
const TIER_RANK: Record<Tier, number> = { lock: 3, strong: 2, lean: 1 };
const TIER_HEADER: Record<Tier, string> = {
  lock: '🔒 LADDER LOCK OF THE DAY',
  strong: '💪 STRONG PLAY OF THE DAY',
  lean: '📈 LEAN OF THE DAY',
};

function scoreSafety(values: number[], line: number, side: 'OVER' | 'UNDER') {
  const hitCount = values.filter(v => side === 'OVER' ? v > line : v < line).length;
  const hitRate = hitCount / values.length;
  const avg = values.reduce((a, b) => a + b, 0) / values.length;
  const sorted = [...values].sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)];
  const min = Math.min(...values);
  const max = Math.max(...values);
  const floorMargin = side === 'OVER' ? (min - line) : (line - max);
  const medianClearance = side === 'OVER' ? (median - line) : (line - median);
  const denom = line || 1;
  const hitRateScore = hitRate * 50;
  const floorScore = Math.min((floorMargin / denom) * 50, 25);
  const edgeRatio = side === 'OVER' ? (avg - line) / denom : (line - avg) / denom;
  const edgeScore = Math.min(edgeRatio * 30, 15);
  const consistencyScore = (1 - (max - min) / (avg || 1)) * 10;
  const safety = hitRateScore + floorScore + edgeScore + consistencyScore;
  return {
    hitRate, hitCount, avg, median, min, max,
    floorMargin, medianClearance, safety,
    breakdown: {
      hit_rate_score: Math.round(hitRateScore * 10) / 10,
      floor_score: Math.round(floorScore * 10) / 10,
      edge_score: Math.round(edgeScore * 10) / 10,
      consistency_score: Math.round(consistencyScore * 10) / 10,
      floor_margin: floorMargin,
    },
  };
}

function assignTier(side: 'OVER' | 'UNDER', s: ReturnType<typeof scoreSafety>, line: number): Tier | null {
  // Lock: 90% hit, floor strictly beats line, median clears by 1
  if (s.hitRate >= 0.9 && s.floorMargin > 0 && s.medianClearance >= 1) return 'lock';
  // Strong: 80% hit, floor meets/beats line, median at/above
  if (s.hitRate >= 0.8 && s.floorMargin >= 0 && s.medianClearance >= 0) return 'strong';
  // Lean: 70% hit and avg favors side
  if (s.hitRate >= 0.7 && (side === 'OVER' ? s.avg >= line : s.avg <= line)) return 'lean';
  return null;
}

// Quality gate applied across all sports/sides
// - reject odds worse than -400 (terrible payout, often hidden risk)
// - for OVER plays require ≥2 nonzero games (signal of activity)
// - for UNDER plays zeros are wins, so we only reject when ALL values are 0 (likely DNP / dead data)
function passesQualityGates(values: number[], odds: number, side: 'OVER' | 'UNDER'): boolean {
  if (!isFinite(odds) || odds <= -250) return false;
  const nonzero = values.filter(v => v !== 0).length;
  if (side === 'OVER' && nonzero < 2) return false;
  // For UNDERs: at least 1 game of activity in the recent window. All-zero history
  // usually means the data layer is missing this player's appearances.
  if (side === 'UNDER' && nonzero === 0) return false;
  return true;
}

// ===== NBA adapter =====
async function collectNbaCandidates(supabase: any, today: string, apiKey: string | undefined): Promise<LockCandidate[]> {
  if (!apiKey) { console.log('[NBA] THE_ODDS_API_KEY missing, skipping NBA'); return []; }

  const PROP_LABELS: Record<string, string> = {
    player_points: 'Points', player_rebounds: 'Rebounds',
    player_assists: 'Assists', player_threes: '3-Pointers Made',
  };
  const PROP_GAME_LOG_FIELD: Record<string, string> = {
    player_points: 'points', player_rebounds: 'rebounds',
    player_assists: 'assists', player_threes: 'threes_made',
  };
  const CATEGORY_TO_MARKET: Record<string, string> = {
    points: 'player_points', player_points: 'player_points', PTS_OVER: 'player_points',
    rebounds: 'player_rebounds', player_rebounds: 'player_rebounds', REB_OVER: 'player_rebounds',
    assists: 'player_assists', player_assists: 'player_assists', AST_OVER: 'player_assists',
    threes: 'player_threes', player_threes: 'player_threes', '3PT_OVER': 'player_threes',
  };

  const { data: sweetSpots } = await supabase
    .from('category_sweet_spots').select('*')
    .eq('analysis_date', today).eq('is_active', true).gte('l10_hit_rate', 0.7)
    .not('l10_avg', 'is', null)
    .not('category', 'like', 'NHL_%').not('category', 'like', 'MLB_%').not('category', 'like', 'NCAAB_%')
    .order('l10_hit_rate', { ascending: false }).limit(100);
  const { data: fallbackSpots } = await supabase
    .from('category_sweet_spots').select('*')
    .eq('is_active', true).gte('l10_hit_rate', 0.7)
    .not('l10_avg', 'is', null)
    .not('category', 'like', 'NHL_%').not('category', 'like', 'MLB_%').not('category', 'like', 'NCAAB_%')
    .order('l10_hit_rate', { ascending: false }).limit(100);
  const allSpots = (sweetSpots && sweetSpots.length > 0) ? sweetSpots : (fallbackSpots || []);
  console.log(`[NBA] ${allSpots.length} sweet spots`);
  if (allSpots.length === 0) return [];

  const names = [...new Set(allSpots.map((s: any) => s.player_name))];
  const gameLogMap = new Map<string, any[]>();
  for (const name of names) {
    const nName = normalizeName(name as string);
    let { data } = await supabase
      .from('nba_player_game_logs')
      .select('player_name, points, rebounds, assists, threes_made, game_date')
      .ilike('player_name', name as string)
      .order('game_date', { ascending: false }).limit(10);
    if (!data || data.length === 0) {
      const lastName = (name as string).split(' ').pop() || name;
      const res = await supabase
        .from('nba_player_game_logs')
        .select('player_name, points, rebounds, assists, threes_made, game_date')
        .ilike('player_name', `%${lastName}%`)
        .order('game_date', { ascending: false }).limit(20);
      data = (res.data || []).filter((g: any) => {
        const gNorm = normalizeName(g.player_name);
        return gNorm === nName || gNorm.includes(nName) || nName.includes(gNorm);
      }).slice(0, 10);
    }
    if (data && data.length > 0) gameLogMap.set(nName, data);
  }

  const playerPropData = new Map<string, { values: number[]; propMarket: string }>();
  for (const ss of allSpots) {
    const nName = normalizeName(ss.player_name);
    const logs = gameLogMap.get(nName);
    if (!logs || logs.length < 8) continue;
    const pt = ss.prop_type || ss.category || '';
    const field = PROP_GAME_LOG_FIELD[CATEGORY_TO_MARKET[pt.toLowerCase()] || CATEGORY_TO_MARKET[pt]];
    const propMarket = CATEGORY_TO_MARKET[pt.toLowerCase()] || CATEGORY_TO_MARKET[pt];
    if (!field || !propMarket) continue;
    const values = logs.map((g: any) => g[field] ?? 0);
    playerPropData.set(`${nName}|${propMarket}`, { values, propMarket });
  }
  if (playerPropData.size === 0) return [];

  const neededMarkets = [...new Set([...playerPropData.values()].map(v => v.propMarket))];
  let events: any[] = [];
  try {
    const er = await fetchWithTimeout(`https://api.the-odds-api.com/v4/sports/basketball_nba/events?apiKey=${apiKey}`);
    if (er.ok) events = await er.json();
  } catch (e) { console.warn('[NBA] events fetch failed', (e as Error).message); }
  if (events.length === 0) { console.log('[NBA] no events today'); return []; }

  interface LL { player_name: string; prop_type: string; line: number; over_odds: number; bookmaker: string; game: string; home_team: string; away_team: string; }
  const allLines: LL[] = [];
  for (const evt of events) {
    try {
      const url = `https://api.the-odds-api.com/v4/sports/basketball_nba/events/${evt.id}/odds?apiKey=${apiKey}&regions=us&markets=${neededMarkets.join(',')}&oddsFormat=american&bookmakers=fanduel,draftkings,hardrockbet`;
      const r = await fetchWithTimeout(url);
      if (!r.ok) continue;
      const d = await r.json();
      for (const bk of d.bookmakers || []) for (const mkt of bk.markets || []) for (const o of mkt.outcomes || []) {
        if (o.name === 'Over') allLines.push({
          player_name: o.description, prop_type: mkt.key, line: o.point, over_odds: o.price,
          bookmaker: bk.key, game: `${evt.away_team} @ ${evt.home_team}`,
          home_team: evt.home_team, away_team: evt.away_team,
        });
      }
    } catch {}
  }

  const linesByKey = new Map<string, LL[]>();
  for (const ln of allLines) {
    const k = `${normalizeName(ln.player_name)}|${ln.prop_type}`;
    if (!linesByKey.has(k)) linesByKey.set(k, []);
    linesByKey.get(k)!.push(ln);
  }

  const { data: cache } = await supabase.from('bdl_player_cache').select('player_name, team_name').not('team_name', 'is', null);
  const teamMap = new Map<string, string>();
  for (const p of cache || []) if (p.team_name) teamMap.set(normalizeName(p.player_name), p.team_name);

  const out: LockCandidate[] = [];
  for (const [k, data] of playerPropData) {
    const [nName] = k.split('|');
    const lines = linesByKey.get(k) || [];
    if (!lines.length) continue;
    for (const ln of lines) {
      const s = scoreSafety(data.values, ln.line, 'OVER');
      const tier = assignTier('OVER', s, ln.line);
      if (!tier) continue;
      if (!passesQualityGates(data.values, ln.over_odds, 'OVER')) continue;
      const pteam = teamMap.get(nName) || '';
      let opp = '', myTeam = '';
      const ht = ln.home_team.toLowerCase(), at = ln.away_team.toLowerCase(), pt = pteam.toLowerCase();
      if (pt && (ht.includes(pt) || pt.includes(ht))) { opp = ln.away_team; myTeam = ln.home_team; }
      else if (pt && (at.includes(pt) || pt.includes(at))) { opp = ln.home_team; myTeam = ln.away_team; }
      else { opp = ln.away_team; myTeam = ln.home_team; }
      out.push({
        sport: 'NBA', player_name: ln.player_name, prop_type: data.propMarket,
        prop_label: PROP_LABELS[data.propMarket] || data.propMarket,
        side: 'OVER', line: ln.line, odds: ln.over_odds, bookmaker: ln.bookmaker,
        game: ln.game, player_team: myTeam, opponent: opp,
        l10_values: data.values, l10_avg: Math.round(s.avg * 10) / 10,
        l10_min: s.min, l10_max: s.max, l10_median: s.median,
        l10_hit_rate: s.hitRate, l10_games: data.values.length, l10_hits: s.hitCount,
        floor_margin: s.floorMargin, median_clearance: s.medianClearance,
        safety_score: s.safety, tier, safety_breakdown: s.breakdown,
      });
    }
  }
  console.log(`[NBA] ${out.length} candidates`);
  return out;
}

// ===== MLB adapter =====
async function collectMlbCandidates(supabase: any, today: string): Promise<LockCandidate[]> {
  const MLB_GAME_LOG_FIELD: Record<string, string> = {
    batter_rbis: 'rbis', batter_hits: 'hits', batter_runs_scored: 'runs',
    batter_home_runs: 'home_runs', batter_total_bases: 'total_bases',
    batter_stolen_bases: 'stolen_bases', batter_walks: 'walks',
    batter_singles: 'hits', batter_doubles: 'hits',
    batter_hits_runs_rbis: 'hits',
    pitcher_strikeouts: 'pitcher_strikeouts', pitcher_hits_allowed: 'pitcher_hits_allowed',
    pitcher_earned_runs: 'earned_runs', pitcher_walks: 'walks',
  };
  const PROP_LABELS: Record<string, string> = {
    batter_rbis: 'RBIs', batter_hits: 'Hits', batter_runs_scored: 'Runs Scored',
    batter_home_runs: 'Home Runs', batter_total_bases: 'Total Bases',
    batter_stolen_bases: 'Stolen Bases', batter_walks: 'Walks',
    pitcher_strikeouts: 'Strikeouts', pitcher_hits_allowed: 'Hits Allowed',
    pitcher_earned_runs: 'Earned Runs', pitcher_walks: 'Walks',
  };

  const { data: sweetSpotsToday } = await supabase
    .from('category_sweet_spots').select('*')
    .eq('analysis_date', today).eq('is_active', true).gte('l10_hit_rate', 0.7)
    .like('category', 'MLB_%').order('l10_hit_rate', { ascending: false }).limit(200);
  const { data: sweetSpotsAll } = await supabase
    .from('category_sweet_spots').select('*')
    .eq('is_active', true).gte('l10_hit_rate', 0.7)
    .like('category', 'MLB_%').order('l10_hit_rate', { ascending: false }).limit(200);
  const spots = (sweetSpotsToday && sweetSpotsToday.length > 0) ? sweetSpotsToday : (sweetSpotsAll || []);
  console.log(`[MLB] ${spots.length} sweet spots`);
  if (spots.length === 0) return [];

  // Pull active MLB lines
  const { data: rawLines } = await supabase
    .from('unified_props')
    .select('player_name, prop_type, current_line, over_price, under_price, bookmaker, game_description')
    .eq('sport', 'baseball_mlb').eq('is_active', true)
    .not('player_name', 'is', null).not('current_line', 'is', null)
    .limit(5000);
  const lines = rawLines || [];
  console.log(`[MLB] ${lines.length} active lines`);
  if (!lines.length) return [];

  // Group lines by player|prop_type for quick lookup
  const linesByKey = new Map<string, any[]>();
  for (const ln of lines) {
    const k = `${normalizeName(ln.player_name)}|${ln.prop_type}`;
    if (!linesByKey.has(k)) linesByKey.set(k, []);
    linesByKey.get(k)!.push(ln);
  }

  // Game logs for all sweet-spot players
  const names = [...new Set(spots.map((s: any) => s.player_name))];
  const gameLogMap = new Map<string, any[]>();
  for (const name of names) {
    const nName = normalizeName(name as string);
    let { data } = await supabase
      .from('mlb_player_game_logs')
      .select('player_name, rbis, hits, runs, home_runs, total_bases, stolen_bases, walks, pitcher_strikeouts, pitcher_hits_allowed, earned_runs, game_date, opponent, team')
      .ilike('player_name', name as string)
      .order('game_date', { ascending: false }).limit(10);
    if (!data || data.length === 0) {
      const last = (name as string).split(' ').pop() || name;
      const res = await supabase
        .from('mlb_player_game_logs')
        .select('player_name, rbis, hits, runs, home_runs, total_bases, stolen_bases, walks, pitcher_strikeouts, pitcher_hits_allowed, earned_runs, game_date, opponent, team')
        .ilike('player_name', `%${last}%`)
        .order('game_date', { ascending: false }).limit(20);
      data = (res.data || []).filter((g: any) => {
        const gNorm = normalizeName(g.player_name);
        return gNorm === nName || gNorm.includes(nName) || nName.includes(gNorm);
      }).slice(0, 10);
    }
    if (data && data.length > 0) gameLogMap.set(nName, data);
  }
  console.log(`[MLB] ${gameLogMap.size}/${names.length} players matched logs`);

  const out: LockCandidate[] = [];
  for (const ss of spots) {
    const nName = normalizeName(ss.player_name);
    const logs = gameLogMap.get(nName);
    if (!logs || logs.length < 5) continue;
    const propType = (ss.prop_type || '').toLowerCase();
    const field = MLB_GAME_LOG_FIELD[propType];
    if (!field) continue;
    const values = logs.map((g: any) => g[field] ?? 0).filter((v: any) => typeof v === 'number');
    if (values.length < 5) continue;

    const side: 'OVER' | 'UNDER' = (ss.recommended_side || '').toString().toUpperCase() === 'UNDER' ? 'UNDER' : 'OVER';

    // Match active live line
    const matched = (linesByKey.get(`${nName}|${propType}`) || []);
    if (!matched.length) continue;

    // Pick the line closest to the sweet spot's recommended_line (if present) to keep safety
    const recLine = Number(ss.recommended_line);
    let best: any = null;
    let bestDist = Infinity;
    for (const ln of matched) {
      const dist = isFinite(recLine) ? Math.abs(Number(ln.current_line) - recLine) : 0;
      if (dist < bestDist) { bestDist = dist; best = ln; }
    }
    if (!best) continue;

    const line = Number(best.current_line);
    const odds = side === 'OVER' ? Number(best.over_price) : Number(best.under_price);
    if (!isFinite(line) || !isFinite(odds) || odds === 0) continue;

    const s = scoreSafety(values, line, side);
    const tier = assignTier(side, s, line);
    if (!tier) continue;
    if (!passesQualityGates(values, odds, side)) continue;

    const game = best.game_description || '';
    const opp = logs[0]?.opponent || '';
    const myTeam = logs[0]?.team || '';

    out.push({
      sport: 'MLB', player_name: ss.player_name, prop_type: propType,
      prop_label: PROP_LABELS[propType] || propType,
      side, line, odds, bookmaker: best.bookmaker || 'fanduel',
      game, player_team: myTeam, opponent: opp,
      l10_values: values, l10_avg: Math.round(s.avg * 100) / 100,
      l10_min: s.min, l10_max: s.max, l10_median: s.median,
      l10_hit_rate: s.hitRate, l10_games: values.length, l10_hits: s.hitCount,
      floor_margin: s.floorMargin, median_clearance: s.medianClearance,
      safety_score: s.safety, tier, safety_breakdown: s.breakdown,
    });
  }
  console.log(`[MLB] ${out.length} candidates`);
  return out;
}

async function sendTelegram(supabaseUrl: string, supabaseKey: string, message: string, picks: any[], adminOnly = false) {
  try {
    await fetch(`${supabaseUrl}/functions/v1/bot-send-telegram`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${supabaseKey}` },
      body: JSON.stringify({
        type: 'ladder_challenge',
        admin_only: adminOnly,
        data: { message, picks },
      }),
    });
  } catch (e) { console.warn('[Ladder] telegram send failed', (e as Error).message); }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });

  const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
  const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const apiKey = Deno.env.get('THE_ODDS_API_KEY');
  const supabase = createClient(supabaseUrl, supabaseKey);

  try {
    const today = getEasternDate();
    console.log(`[Ladder] Starting multi-sport scan for ${today}`);

    const url = new URL(req.url);
    const force = url.searchParams.get('force') === '1';

    // Dedup
    const { data: existing } = await supabase
      .from('bot_daily_parlays').select('id')
      .eq('parlay_date', today).eq('strategy_name', 'ladder_challenge').neq('outcome', 'void');
    if (!force && existing && existing.length >= 1) {
      console.log('[Ladder] already have today\'s pick, skipping');
      return new Response(JSON.stringify({ success: true, skipped: true, reason: 'already_exists' }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    // Optional NBA freshness refresh (non-fatal)
    try {
      await fetch(`${supabaseUrl}/functions/v1/nba-stats-fetcher`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${supabaseKey}` },
        body: JSON.stringify({ mode: 'sync', daysBack: 3, useESPN: true, includeParlayPlayers: true }),
      });
    } catch (e) { console.warn('[Ladder] nba refresh skipped', (e as Error).message); }

    // Run sport adapters in parallel
    const [nba, mlb] = await Promise.all([
      collectNbaCandidates(supabase, today, apiKey).catch(e => { console.warn('[NBA] err', e.message); return []; }),
      collectMlbCandidates(supabase, today).catch(e => { console.warn('[MLB] err', e.message); return []; }),
    ]);
    const all: LockCandidate[] = [...nba, ...mlb];
    console.log(`[Ladder] total candidates: ${all.length} (NBA ${nba.length}, MLB ${mlb.length})`);

    // Select highest-tier candidate with best safety score
    all.sort((a, b) => {
      const t = TIER_RANK[b.tier] - TIER_RANK[a.tier];
      if (t !== 0) return t;
      const ss = b.safety_score - a.safety_score;
      if (Math.abs(ss) > 0.5) return ss;
      // Tiebreaker: prefer less-juiced odds (closer to even money)
      return Math.abs(a.odds) - Math.abs(b.odds);
    });

    if (all.length === 0) {
      const msg = `🤔 *Ladder Challenge — ${today}*\nNo qualified pick today. Markets thin or sweet-spot intelligence cold across NBA / MLB / NHL. Tomorrow we ride again.`;
      await sendTelegram(supabaseUrl, supabaseKey, msg, [], true);
      return new Response(JSON.stringify({ success: false, error: 'No candidates across any sport', sent_admin_note: true }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    const lock = all[0];
    console.log(`[Ladder] Top 5:`, all.slice(0, 5).map(c =>
      `[${c.tier}] ${c.sport} ${c.player_name} ${c.prop_label} ${c.side} ${c.line} safety=${c.safety_score.toFixed(1)} hit=${(c.l10_hit_rate*100).toFixed(0)}%`));

    const oddsStr = lock.odds > 0 ? `+${lock.odds}` : `${lock.odds}`;
    const decimal = americanToDecimal(lock.odds);
    const ip = impliedProb(lock.odds);
    const hitPct = `${(lock.l10_hit_rate * 100).toFixed(0)}%`;
    const last5 = lock.l10_values.slice(0, 5).join(', ');
    const sb = lock.safety_breakdown;

    const rationale = `${TIER_HEADER[lock.tier]}: ${lock.sport} ${lock.player_name} ${lock.prop_label} ${lock.side} ${lock.line} (${oddsStr}) vs ${lock.opponent}. L10: ${hitPct} hit rate (${lock.l10_hits}/${lock.l10_games}), Avg ${lock.l10_avg}, Floor ${lock.l10_min}, Ceiling ${lock.l10_max}. Safety ${lock.safety_score.toFixed(2)}.`;

    const leg = {
      sport: lock.sport,
      player_name: lock.player_name,
      prop_type: lock.prop_type,
      prop_label: lock.prop_label,
      line: lock.line,
      side: lock.side,
      odds: lock.odds,
      bookmaker: lock.bookmaker,
      rung_label: lock.tier === 'lock' ? 'Lock' : lock.tier === 'strong' ? 'Strong' : 'Lean',
      l10_hit_rate: hitPct,
      game: lock.game,
      player_team: lock.player_team,
      opponent: lock.opponent,
    };

    const { error: insertError } = await supabase.from('bot_daily_parlays').insert({
      parlay_date: today,
      strategy_name: 'ladder_challenge',
      tier: lock.tier === 'lock' ? 'execution' : lock.tier,
      legs: [leg],
      leg_count: 1,
      combined_probability: Math.round(ip * 10000) / 10000,
      expected_odds: Math.round(decimal),
      selection_rationale: rationale,
      is_simulated: false,
      simulated_stake: 100,
    });
    if (insertError) console.error('[Ladder] insert error', insertError);

    const sideEmoji = lock.side === 'OVER' ? '⬆️' : '⬇️';
    const tierFooter = lock.tier === 'lock'
      ? '🛡️ Maximum-safety tier — floor strictly beats the line.'
      : lock.tier === 'strong'
        ? '⚠️ Strong tier — best available today (Lock criteria not met).'
        : '⚠️ Lean tier — relaxed gates today, ride with caution.';

    const telegramMessage =
      `${TIER_HEADER[lock.tier]} ${SPORT_EMOJI[lock.sport]}\n` +
      `━━━━━━━━━━━━━━━━━━━━━\n` +
      `${lock.player_name}\n` +
      `${sideEmoji} ${lock.side} ${lock.line} ${lock.prop_label} (${oddsStr})\n` +
      `${lock.game || `${lock.player_team} vs ${lock.opponent}`}\n\n` +
      `📊 L10 Hit Rate: ${hitPct} (${lock.l10_hits}/${lock.l10_games})\n` +
      `📈 L10 Avg: ${lock.l10_avg} | Median: ${lock.l10_median}\n` +
      `🟢 Floor: ${lock.l10_min} (margin: ${lock.floor_margin >= 0 ? '+' : ''}${lock.floor_margin}) | Ceiling: ${lock.l10_max}\n` +
      `📋 Last 5: ${last5}\n\n` +
      `🛡️ Safety Score: ${lock.safety_score.toFixed(1)}/100\n` +
      `  Hit Rate: ${sb.hit_rate_score}/50\n` +
      `  Floor: ${sb.floor_score}/25\n` +
      `  Edge: ${sb.edge_score}/15\n` +
      `  Consistency: ${sb.consistency_score}/10\n` +
      `━━━━━━━━━━━━━━━━━━━━━\n` +
      `💰 $100 Stake | vs ${lock.opponent}\n` +
      `${tierFooter}`;

    await sendTelegram(supabaseUrl, supabaseKey, telegramMessage, [{
      player: lock.player_name, line: lock.line, odds: oddsStr,
      prop: lock.prop_label, side: lock.side, sport: lock.sport, tier: lock.tier,
    }]);

    return new Response(JSON.stringify({
      success: true,
      tier: lock.tier,
      sport: lock.sport,
      lock: {
        player: lock.player_name, prop: lock.prop_label, side: lock.side, line: lock.line,
        odds: oddsStr, hit_rate: hitPct, l10_avg: lock.l10_avg,
        l10_min: lock.l10_min, l10_max: lock.l10_max,
        safety_score: lock.safety_score, safety_breakdown: lock.safety_breakdown,
        opponent: lock.opponent, game: lock.game,
      },
      candidates_evaluated: all.length,
      by_sport: { NBA: nba.length, MLB: mlb.length },
    }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

  } catch (error) {
    console.error('[Ladder] fatal', error);
    return new Response(JSON.stringify({ success: false, error: (error as Error).message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  }
});
