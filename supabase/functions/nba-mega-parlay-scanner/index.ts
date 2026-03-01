import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.38.4";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
};

function getEasternDate(): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/New_York',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
}

const normalizeName = (name: string) =>
  name.toLowerCase().replace(/\./g, '').replace(/'/g, '').replace(/jr$/i, '').replace(/sr$/i, '').replace(/iii$/i, '').replace(/ii$/i, '').trim();

function normalizePropType(raw: string): string {
  const s = (raw || '').replace(/^(player_|batter_|pitcher_)/, '').toLowerCase().trim();
  if (/points.*rebounds.*assists|pts.*rebs.*asts|^pra$/.test(s)) return 'pra';
  if (/points.*rebounds|pts.*rebs|^pr$/.test(s)) return 'pr';
  if (/points.*assists|pts.*asts|^pa$/.test(s)) return 'pa';
  if (/rebounds.*assists|rebs.*asts|^ra$/.test(s)) return 'ra';
  if (/three_pointers|threes_made|^threes$/.test(s)) return 'threes';
  return s;
}

// ============= STRICT PROP OVERLAP PREVENTION =============
const COMBO_BASES: Record<string, string[]> = {
  pra: ['points', 'rebounds', 'assists'],
  pr: ['points', 'rebounds'],
  pa: ['points', 'assists'],
  ra: ['rebounds', 'assists'],
};

// Extended correlation blocking: includes team bet stacking
function hasCorrelatedProp(
  existingLegs: Array<{ player_name: string; prop_type: string; event_id?: string; market_type?: string }>,
  candidatePlayer: string,
  candidateProp: string,
  candidateEventId?: string,
  candidateMarketType?: string
): boolean {
  const player = candidatePlayer.toLowerCase().trim();
  const prop = normalizePropType(candidateProp);

  // Block stacking team bets (h2h + h2h_q1) from same game
  if (candidateMarketType === 'team_bet' && candidateEventId) {
    const sameGameTeamBets = existingLegs.filter(
      l => l.market_type === 'team_bet' && l.event_id === candidateEventId
    );
    if (sameGameTeamBets.length > 0) return true;
  }

  const playerLegs = existingLegs
    .filter(l => l.player_name.toLowerCase().trim() === player)
    .map(l => normalizePropType(l.prop_type));

  if (playerLegs.length === 0) return false;

  const combos = Object.keys(COMBO_BASES);
  if (combos.includes(prop)) {
    const bases = COMBO_BASES[prop];
    if (playerLegs.some(s => bases.includes(s))) return true;
    if (playerLegs.some(s => combos.includes(s))) return true;
  }
  for (const existing of playerLegs) {
    if (combos.includes(existing)) {
      const bases = COMBO_BASES[existing];
      if (bases?.includes(prop)) return true;
    }
  }

  return true; // Same player = always block
}

function americanToImpliedProb(odds: number): number {
  if (odds >= 100) return 100 / (odds + 100);
  return Math.abs(odds) / (Math.abs(odds) + 100);
}

function americanToDecimal(odds: number): number {
  if (odds >= 100) return (odds / 100) + 1;
  return (100 / Math.abs(odds)) + 1;
}

const GUARD_POSITIONS = ['PG', 'SG', 'G'];
const FORWARD_POSITIONS = ['SF', 'PF', 'F'];
const CENTER_POSITIONS = ['C'];

function isGuard(position: string | null): boolean {
  if (!position) return false;
  return GUARD_POSITIONS.some(p => position.toUpperCase().includes(p));
}

function roleStatAligned(position: string | null, propType: string): boolean {
  if (!position) return true;
  const pt = propType.toLowerCase();
  if (isGuard(position) && (pt.includes('rebound') || pt === 'player_rebounds')) return false;
  if (CENTER_POSITIONS.some(p => (position || '').toUpperCase().includes(p)) && pt.includes('three')) return false;
  return true;
}

async function fetchWithTimeout(url: string, options: RequestInit = {}, timeoutMs = 10000): Promise<Response> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timeoutId);
  }
}

function propToDefenseCategory(propType: string): string | null {
  const pt = normalizePropType(propType);
  if (pt === 'points' || pt === 'player_points') return 'points';
  if (pt === 'rebounds' || pt === 'player_rebounds') return 'rebounds';
  if (pt === 'assists' || pt === 'player_assists') return 'assists';
  if (pt === 'threes' || pt === 'player_threes') return 'threes';
  if (pt === 'pra') return 'points';
  return null;
}

function getYesterdayEasternDate(): string {
  const now = new Date();
  const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/New_York',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(yesterday);
}

// Exotic market categories
const EXOTIC_PLAYER_MARKETS = ['player_first_basket', 'player_double_double', 'player_triple_double'];
const TEAM_BET_MARKETS = ['h2h', 'h2h_q1'];
const STANDARD_PLAYER_MARKETS = ['player_points', 'player_rebounds', 'player_assists', 'player_threes', 'player_points_rebounds_assists'];

function getMarketType(marketKey: string): 'player_prop' | 'exotic_player' | 'team_bet' {
  if (EXOTIC_PLAYER_MARKETS.includes(marketKey)) return 'exotic_player';
  if (TEAM_BET_MARKETS.includes(marketKey)) return 'team_bet';
  return 'player_prop';
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
  const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const apiKey = Deno.env.get('THE_ODDS_API_KEY');
  const supabase = createClient(supabaseUrl, supabaseKey);

  try {
    let replayMode = false;
    let excludePlayers: string[] = [];
    try {
      const body = await req.json();
      replayMode = body?.replay === true;
      excludePlayers = Array.isArray(body?.exclude_players) ? body.exclude_players : [];
    } catch { /* no body */ }

    if (!apiKey) throw new Error('THE_ODDS_API_KEY not configured');

    const today = getEasternDate();

    // === AUTO-DEDUP: Query existing lottery parlays for today ===
    const { data: existingLotteryParlays } = await supabase
      .from('bot_daily_parlays')
      .select('legs')
      .eq('parlay_date', today)
      .eq('strategy_name', 'mega_lottery_scanner')
      .neq('outcome', 'void');

    const existingPlayerNames: string[] = [];
    if (existingLotteryParlays && existingLotteryParlays.length > 0) {
      // If we already have 3+ tickets today, skip
      if (existingLotteryParlays.length >= 3) {
        console.log(`[MegaParlay] Already have ${existingLotteryParlays.length} lottery tickets today, skipping`);
        return new Response(JSON.stringify({ success: true, skipped: true, reason: '3 tickets already generated today' }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
      for (const p of existingLotteryParlays) {
        const legs = Array.isArray(p.legs) ? p.legs : [];
        for (const leg of legs) {
          if ((leg as any)?.player_name) {
            existingPlayerNames.push((leg as any).player_name);
          }
        }
      }
    }

    const excludeSet = new Set([
      ...excludePlayers.map(normalizeName),
      ...existingPlayerNames.map(normalizeName),
    ]);

    if (excludeSet.size > 0) {
      console.log(`[MegaParlay] Excluding ${excludeSet.size} players from previous tickets`);
    }

    console.log(`[MegaParlay] V2 3-Ticket Scanner for ${today}${replayMode ? ' [REPLAY]' : ''}`);

    // Step 1: Get NBA events
    const eventsListUrl = `https://api.the-odds-api.com/v4/sports/basketball_nba/events?apiKey=${apiKey}`;
    const eventsListRes = await fetchWithTimeout(eventsListUrl);
    if (!eventsListRes.ok) throw new Error(`Events API returned ${eventsListRes.status}: ${await eventsListRes.text()}`);
    const eventsList: any[] = await eventsListRes.json();
    console.log(`[MegaParlay] Found ${eventsList.length} NBA events`);

    // Standard + exotic markets
    const standardMarkets = STANDARD_PLAYER_MARKETS.join(',');
    const exoticMarkets = [...EXOTIC_PLAYER_MARKETS, ...TEAM_BET_MARKETS].join(',');
    const allMarkets = `${standardMarkets},${exoticMarkets}`;

    // Fetch props per event (standard + exotic in one call)
    const eventPropsPromises = eventsList.map(async (evt) => {
      const eventUrl = `https://api.the-odds-api.com/v4/sports/basketball_nba/events/${evt.id}/odds?apiKey=${apiKey}&regions=us&markets=${allMarkets}&oddsFormat=american&bookmakers=fanduel,hardrockbet`;
      try {
        const res = await fetchWithTimeout(eventUrl);
        if (!res.ok) {
          console.warn(`[MegaParlay] Event ${evt.id} returned ${res.status}`);
          await res.text();
          return null;
        }
        return await res.json();
      } catch (e) {
        console.warn(`[MegaParlay] Failed to fetch event ${evt.id}:`, e);
        return null;
      }
    });

    const eventResults = await Promise.all(eventPropsPromises);
    const events: any[] = eventResults.filter(Boolean);
    console.log(`[MegaParlay] Got props from ${events.length}/${eventsList.length} events`);

    // Step 2: Extract all props
    interface RawProp {
      player_name: string;
      prop_type: string;
      side: string;
      odds: number;
      line: number;
      bookmaker: string;
      event_id: string;
      home_team: string;
      away_team: string;
      game: string;
      market_type: 'player_prop' | 'exotic_player' | 'team_bet';
    }

    const rawProps: RawProp[] = [];

    for (const event of events) {
      const game = `${event.away_team} @ ${event.home_team}`;
      for (const bm of (event.bookmakers || [])) {
        for (const market of (bm.markets || [])) {
          const marketType = getMarketType(market.key);

          // === TEAM BET MARKETS (h2h, h2h_q1) — extract underdog (plus-money) side only ===
          if (marketType === 'team_bet') {
            for (const outcome of (market.outcomes || [])) {
              if (outcome.price >= 130) { // Only underdogs with +130 or higher
                rawProps.push({
                  player_name: outcome.name, // Team name
                  prop_type: market.key,
                  side: 'WIN',
                  odds: outcome.price,
                  line: 0,
                  bookmaker: bm.key,
                  event_id: event.id,
                  home_team: event.home_team,
                  away_team: event.away_team,
                  game,
                  market_type: 'team_bet',
                });
              }
            }
            continue;
          }

          // === EXOTIC PLAYER MARKETS (first basket, double/triple double) — Yes outcomes only ===
          if (marketType === 'exotic_player') {
            for (const outcome of (market.outcomes || [])) {
              // First basket uses player names directly; double/triple double have Yes/No
              const isYesOutcome = outcome.name === 'Yes' || !['Yes', 'No', 'Over', 'Under'].includes(outcome.name);
              if (isYesOutcome && outcome.price >= 150) {
                const playerName = outcome.description || outcome.name;
                rawProps.push({
                  player_name: playerName,
                  prop_type: market.key,
                  side: 'YES',
                  odds: outcome.price,
                  line: 0.5, // Yes/No market
                  bookmaker: bm.key,
                  event_id: event.id,
                  home_team: event.home_team,
                  away_team: event.away_team,
                  game,
                  market_type: 'exotic_player',
                });
              }
            }
            continue;
          }

          // === STANDARD PLAYER PROPS — existing Over/Under logic ===
          const playerOutcomes = new Map<string, { over?: any; under?: any }>();
          for (const outcome of (market.outcomes || [])) {
            const desc = outcome.description || '';
            if (!desc) continue;
            if (!playerOutcomes.has(desc)) playerOutcomes.set(desc, {});
            const entry = playerOutcomes.get(desc)!;
            if (outcome.name === 'Over') entry.over = outcome;
            if (outcome.name === 'Under') entry.under = outcome;
          }

          for (const [playerDesc, outcomes] of playerOutcomes) {
            if (outcomes.over && outcomes.over.price >= 100) {
              rawProps.push({
                player_name: playerDesc,
                prop_type: market.key,
                side: 'OVER',
                odds: outcomes.over.price,
                line: outcomes.over.point,
                bookmaker: bm.key,
                event_id: event.id,
                home_team: event.home_team,
                away_team: event.away_team,
                game,
                market_type: 'player_prop',
              });
            }
            if (outcomes.under && outcomes.under.price >= 100) {
              rawProps.push({
                player_name: playerDesc,
                prop_type: market.key,
                side: 'UNDER',
                odds: outcomes.under.price,
                line: outcomes.under.point ?? outcomes.over?.point,
                bookmaker: bm.key,
                event_id: event.id,
                home_team: event.home_team,
                away_team: event.away_team,
                game,
                market_type: 'player_prop',
              });
            }
          }
        }
      }
    }

    const exoticCount = rawProps.filter(p => p.market_type === 'exotic_player').length;
    const teamBetCount = rawProps.filter(p => p.market_type === 'team_bet').length;
    console.log(`[MegaParlay] Found ${rawProps.length} total props (${exoticCount} exotic, ${teamBetCount} team bets)`);

    const dedupMap = new Map<string, RawProp>();
    for (const p of rawProps) {
      const key = `${normalizeName(p.player_name)}|${p.prop_type}|${p.side}`;
      const existing = dedupMap.get(key);
      if (!existing || p.odds > existing.odds) {
        dedupMap.set(key, p);
      }
    }
    const uniqueProps = Array.from(dedupMap.values());
    console.log(`[MegaParlay] ${uniqueProps.length} unique props after dedup`);

    // Step 3: Cross-reference with database (include L20)
    const [sweetSpotsRes, mispricedRes, gameLogsRes, defenseRes, archetypesRes, teamDefenseRes, l20Res] = await Promise.all([
      supabase
        .from('category_sweet_spots')
        .select('player_name, prop_type, recommended_side, l10_hit_rate, l10_avg, l10_median, actual_line, category, confidence_score')
        .eq('analysis_date', today),
      supabase
        .from('mispriced_lines')
        .select('player_name, prop_type, signal, edge_pct, book_line, player_avg')
        .eq('analysis_date', today)
        .gte('edge_pct', 3),
      supabase
        .from('category_sweet_spots')
        .select('player_name, prop_type, l10_avg, l10_median, category')
        .not('l10_avg', 'is', null)
        .order('analysis_date', { ascending: false })
        .limit(1000),
      supabase
        .from('nba_opponent_defense_stats')
        .select('team_name, stat_category, defensive_rank, pts_allowed_rank'),
      supabase
        .from('bdl_player_cache')
        .select('player_name, position'),
      supabase
        .from('team_defense_rankings')
        .select('team_name, opp_points_rank, opp_threes_rank, opp_rebounds_rank, opp_assists_rank'),
      // L20 data from mispriced_lines (player_avg is season avg, use as L20 proxy)
      supabase
        .from('mispriced_lines')
        .select('player_name, prop_type, player_avg')
        .eq('analysis_date', today)
        .not('player_avg', 'is', null),
    ]);

    const sweetSpots = sweetSpotsRes.data || [];
    const mispricedLines = mispricedRes.data || [];
    const gameLogs = gameLogsRes.data || [];
    const defenseStats = defenseRes.data || [];
    const playerPositions = archetypesRes.data || [];
    const teamDefenseRankings = teamDefenseRes.data || [];
    const l20Data = l20Res.data || [];

    console.log(`[MegaParlay] DB: ${sweetSpots.length} sweet spots, ${mispricedLines.length} mispriced, ${gameLogs.length} game logs, ${defenseStats.length} defense, ${l20Data.length} L20 records`);

    // Build lookup maps
    const sweetSpotMap = new Map<string, any>();
    for (const ss of sweetSpots) {
      sweetSpotMap.set(`${normalizeName(ss.player_name)}|${normalizePropType(ss.prop_type)}`, ss);
    }

    const mispricedMap = new Map<string, any>();
    for (const ml of mispricedLines) {
      mispricedMap.set(`${normalizeName(ml.player_name)}|${normalizePropType(ml.prop_type)}`, ml);
    }

    const gameLogMap = new Map<string, any>();
    for (const gl of gameLogs) {
      const key = `${normalizeName(gl.player_name)}|${normalizePropType(gl.prop_type)}`;
      if (!gameLogMap.has(key)) gameLogMap.set(key, gl);
    }

    // L20 map (using player_avg from mispriced_lines as L20 proxy)
    const l20Map = new Map<string, number>();
    for (const l of l20Data) {
      const key = `${normalizeName(l.player_name)}|${normalizePropType(l.prop_type)}`;
      if (!l20Map.has(key)) l20Map.set(key, l.player_avg);
    }

    const positionMap = new Map<string, string>();
    for (const p of playerPositions) {
      positionMap.set(normalizeName(p.player_name), p.position || '');
    }

    const defenseStatMap = new Map<string, any>();
    for (const ds of defenseStats) {
      defenseStatMap.set(`${(ds.team_name || '').toLowerCase()}|${(ds.stat_category || '').toLowerCase()}`, ds);
    }

    const teamDefenseMap = new Map<string, any>();
    for (const td of teamDefenseRankings) {
      teamDefenseMap.set((td.team_name || '').toLowerCase(), td);
    }

    function getDefenseRank(teamName: string, propType: string): number | null {
      const team = teamName.toLowerCase();
      const category = propToDefenseCategory(propType);
      if (!category) return null;
      const td = teamDefenseMap.get(team);
      if (td) {
        if (category === 'points' && td.opp_points_rank) return td.opp_points_rank;
        if (category === 'threes' && td.opp_threes_rank) return td.opp_threes_rank;
        if (category === 'rebounds' && td.opp_rebounds_rank) return td.opp_rebounds_rank;
        if (category === 'assists' && td.opp_assists_rank) return td.opp_assists_rank;
      }
      const dsKey = `${team}|${category}`;
      const ds = defenseStatMap.get(dsKey);
      if (ds?.defensive_rank) return ds.defensive_rank;
      return null;
    }

    // Step 4: Score each prop
    interface ScoredProp extends RawProp {
      hitRate: number;
      edgePct: number;
      medianGap: number;
      compositeScore: number;
      l10Avg: number | null;
      l20Avg: number | null;
      l10Median: number | null;
      position: string | null;
      sweetSpotSide: string | null;
      mispricedSide: string | null;
      defenseRank: number | null;
      defenseBonus: number;
      volumeCandidate: boolean;
    }

    const scoredProps: ScoredProp[] = [];

    for (const prop of uniqueProps) {
      const nameNorm = normalizeName(prop.player_name);
      const ptNorm = normalizePropType(prop.prop_type);
      const lookupKey = `${nameNorm}|${ptNorm}`;

      const ss = sweetSpotMap.get(lookupKey);
      const ml = mispricedMap.get(lookupKey);
      const gl = gameLogMap.get(lookupKey);
      const position = positionMap.get(nameNorm) || null;
      const l20Avg = l20Map.get(lookupKey) ?? null;

      // Role-stat alignment (skip for exotic/team bets)
      if (prop.market_type === 'player_prop' && !roleStatAligned(position, prop.prop_type)) continue;

      // Hit rate from sweet spots, with game-log fallback
      let hitRate = ss?.l10_hit_rate || 0;
      if (hitRate > 0 && hitRate <= 1) hitRate = hitRate * 100;

      if (hitRate === 0 && gl && gl.l10_avg != null) {
        const avg = gl.l10_avg;
        if (prop.side === 'OVER') {
          hitRate = Math.min(90, Math.max(0, (avg / prop.line) * 55));
        } else if (prop.side === 'UNDER') {
          hitRate = Math.min(90, Math.max(0, (prop.line / avg) * 55));
        }
      }

      // For exotic/team bets without data, assign baseline hit rates
      if (hitRate === 0 && prop.market_type === 'exotic_player') {
        // First basket ~4-8% chance, double double ~30-50%, triple double ~2-10%
        if (prop.prop_type === 'player_first_basket') hitRate = 8;
        else if (prop.prop_type === 'player_double_double') hitRate = 40;
        else if (prop.prop_type === 'player_triple_double') hitRate = 5;
      }
      if (hitRate === 0 && prop.market_type === 'team_bet') {
        // Underdog ML implied from odds
        hitRate = americanToImpliedProb(prop.odds) * 100;
      }

      // Edge
      let edgePct = 0;
      const mispricedSide = ml?.signal?.toUpperCase() || null;
      if (ml && ml.edge_pct >= 3) {
        if (mispricedSide === prop.side) {
          edgePct = ml.edge_pct;
        }
      }

      const sweetSpotSide = ss?.recommended_side?.toUpperCase() || null;

      let directionBonus = 0;
      if (sweetSpotSide === prop.side) directionBonus += 10;
      if (mispricedSide === prop.side && edgePct >= 3) directionBonus += 10;

      const median = gl?.l10_median ?? ss?.l10_median ?? null;
      let medianGap = 0;
      if (median != null) {
        if (prop.side === 'OVER') {
          medianGap = Math.max(0, (median - prop.line) / prop.line) * 100;
        } else if (prop.side === 'UNDER') {
          medianGap = Math.max(0, (prop.line - median) / prop.line) * 100;
        }
      }

      // Defense matchup
      const homeDefRank = getDefenseRank(prop.home_team, prop.prop_type);
      const awayDefRank = getDefenseRank(prop.away_team, prop.prop_type);
      let defenseRank: number | null = null;
      if (homeDefRank && awayDefRank) {
        defenseRank = Math.max(homeDefRank, awayDefRank);
      } else {
        defenseRank = homeDefRank || awayDefRank || null;
      }

      // For team bets, use the opponent's overall defensive rank
      if (prop.market_type === 'team_bet') {
        // The player_name is the team name for team bets, opponent is the other team
        const isHome = prop.player_name.toLowerCase() === prop.home_team.toLowerCase();
        const oppTeam = isHome ? prop.away_team : prop.home_team;
        const oppDefRank = getDefenseRank(oppTeam, 'points'); // Use points as general metric
        if (oppDefRank) defenseRank = oppDefRank;
      }

      let defenseBonus = 0;
      if (defenseRank !== null) {
        if (prop.side === 'OVER' || prop.side === 'WIN' || prop.side === 'YES') {
          if (defenseRank >= 25) defenseBonus = 15;
          else if (defenseRank >= 21) defenseBonus = 10;
          else if (defenseRank >= 18) defenseBonus = 6;
          else if (defenseRank <= 5) defenseBonus = -15;
          else if (defenseRank <= 10) defenseBonus = -10;
        } else {
          if (defenseRank <= 5) defenseBonus = 8;
          else if (defenseRank <= 10) defenseBonus = 5;
          else if (defenseRank >= 25) defenseBonus = -10;
        }
      }

      const oddsValue = Math.min(100, (prop.odds - 100) / 3 + 50);
      const l10Avg = gl?.l10_avg ?? ss?.l10_avg ?? null;
      const l10Median = median;

      const volumeCandidate = !!(
        l10Avg &&
        prop.side === 'OVER' &&
        l10Avg >= prop.line * 1.3 &&
        defenseRank !== null &&
        defenseRank >= 18 &&
        edgePct >= 5
      );

      const compositeScore =
        (hitRate * 0.35) +
        (edgePct * 0.20) +
        (medianGap * 0.10) +
        directionBonus +
        defenseBonus +
        (oddsValue * 0.10) +
        (volumeCandidate ? 15 : 0);

      scoredProps.push({
        ...prop,
        hitRate,
        edgePct,
        medianGap,
        compositeScore,
        l10Avg,
        l20Avg,
        l10Median,
        position,
        sweetSpotSide,
        mispricedSide,
        defenseRank,
        defenseBonus,
        volumeCandidate,
      });
    }

    scoredProps.sort((a, b) => b.compositeScore - a.compositeScore);
    console.log(`[MegaParlay] ${scoredProps.length} scored props (${scoredProps.filter(p => p.market_type === 'exotic_player').length} exotic, ${scoredProps.filter(p => p.market_type === 'team_bet').length} team bets)`);

    // === ALT LINE HUNTING (same as before) ===
    const volumeCandidates = scoredProps.filter(p => p.volumeCandidate).slice(0, 10);
    const altLineResults = new Map<string, any>();
    if (volumeCandidates.length > 0) {
      const altLinePromises = volumeCandidates.map(async (vc) => {
        try {
          const res = await fetch(`${supabaseUrl}/functions/v1/fetch-alternate-lines`, {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${supabaseKey}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({
              eventId: vc.event_id,
              playerName: vc.player_name,
              propType: normalizePropType(vc.prop_type),
            }),
          });
          if (res.ok) {
            const data = await res.json();
            return { key: `${normalizeName(vc.player_name)}|${normalizePropType(vc.prop_type)}`, data };
          }
          await res.text();
        } catch (e) {
          console.warn(`[MegaParlay] Alt line fetch failed for ${vc.player_name}:`, e);
        }
        return null;
      });

      const altResults = await Promise.all(altLinePromises);
      for (const r of altResults) {
        if (r?.data?.lines?.length > 0) altLineResults.set(r.key, r.data.lines);
      }
    }

    for (const prop of scoredProps) {
      if (!prop.volumeCandidate || !prop.l10Avg) continue;
      const altKey = `${normalizeName(prop.player_name)}|${normalizePropType(prop.prop_type)}`;
      const altLines = altLineResults.get(altKey);
      if (!altLines) continue;
      const viableAlts = altLines
        .filter((al: any) => al.line > prop.line && prop.l10Avg! >= al.line * 1.1 && al.overOdds >= 100)
        .sort((a: any, b: any) => b.line - a.line);
      if (viableAlts.length > 0) {
        const bestAlt = viableAlts[0];
        console.log(`[MegaParlay] ALT SWAP: ${prop.player_name} ${prop.line} → ${bestAlt.line} (+${bestAlt.overOdds})`);
        prop.line = bestAlt.line;
        prop.odds = bestAlt.overOdds;
        prop.compositeScore += 5;
      }
    }
    scoredProps.sort((a, b) => b.compositeScore - a.compositeScore);

    // ============= 3-TICKET BUILDER =============
    const LOTTERY_MIN_LINES: Record<string, number> = {
      player_blocks: 1.5,
      player_steals: 1.5,
    };
    const MAX_PER_GAME = 2;
    const MAX_SAME_PROP = 2;

    function passesBasicChecks(
      prop: ScoredProp,
      existingLegs: ScoredProp[],
      gameCount: Map<string, number>,
      skipDedup = false
    ): boolean {
      if (!skipDedup && excludeSet.has(normalizeName(prop.player_name))) return false;
      const lotteryMin = LOTTERY_MIN_LINES[prop.prop_type];
      if (lotteryMin && prop.line < lotteryMin) return false;
      const gc = gameCount.get(prop.game) || 0;
      if (gc >= MAX_PER_GAME) return false;
      const existingForCheck = existingLegs.map(p => ({
        player_name: p.player_name,
        prop_type: p.prop_type,
        event_id: p.event_id,
        market_type: p.market_type,
      }));
      if (hasCorrelatedProp(existingForCheck, prop.player_name, prop.prop_type, prop.event_id, prop.market_type)) return false;
      const propNorm = normalizePropType(prop.prop_type);
      const sameTypeCount = existingLegs.filter(l => normalizePropType(l.prop_type) === propNorm).length;
      if (sameTypeCount >= MAX_SAME_PROP) return false;
      return true;
    }

    function addLeg(
      prop: ScoredProp,
      legs: (ScoredProp & { leg_role: string; ticket_tier: string })[],
      gameCount: Map<string, number>,
      usedPlayers: Set<string>,
      role: string,
      tier: string
    ) {
      legs.push({ ...prop, leg_role: role, ticket_tier: tier });
      gameCount.set(prop.game, (gameCount.get(prop.game) || 0) + 1);
      usedPlayers.add(normalizeName(prop.player_name));
    }

    function calcCombinedOdds(legs: ScoredProp[]): number {
      let dec = 1;
      for (const l of legs) dec *= americanToDecimal(l.odds);
      return dec >= 2 ? Math.round((dec - 1) * 100) : Math.round(-100 / (dec - 1));
    }

    // Track used players across all 3 tickets
    const allUsedPlayers = new Set<string>();
    const allTickets: {
      tier: string;
      legs: (ScoredProp & { leg_role: string; ticket_tier: string })[];
      stake: number;
      combinedOdds: number;
    }[] = [];

    // ============= TICKET 1: STANDARD LOTTERY (2-4 legs, +500 to +2000, $5) =============
    console.log(`\n[MegaParlay] === TICKET 1: STANDARD LOTTERY ===`);
    {
      const legs: (ScoredProp & { leg_role: string; ticket_tier: string })[] = [];
      const gc = new Map<string, number>();
      const used = new Set<string>();

      // SAFE leg
      const safeCandidates = scoredProps.filter(p => {
        if (p.market_type !== 'player_prop') return false;
        if (p.hitRate < 70) return false;
        if (p.edgePct < 3) return false;
        if (p.defenseRank !== null && p.defenseRank < 15) return false;
        if (p.sweetSpotSide !== p.side && p.mispricedSide !== p.side) return false;
        if (p.l10Avg !== null && p.side === 'OVER' && p.l10Avg < p.line * 1.1) return false;
        if (allUsedPlayers.has(normalizeName(p.player_name))) return false;
        return passesBasicChecks(p, legs, gc);
      }).sort((a, b) => b.hitRate - a.hitRate);

      if (safeCandidates.length > 0) {
        addLeg(safeCandidates[0], legs, gc, used, 'safe', 'standard');
        console.log(`[MegaParlay] STANDARD SAFE: ${safeCandidates[0].player_name} +${safeCandidates[0].odds}`);
      }

      // BALANCED leg
      const balCandidates = scoredProps.filter(p => {
        if (p.market_type !== 'player_prop') return false;
        if (p.hitRate < 60) return false;
        if (p.edgePct < 5) return false;
        if (p.defenseRank !== null && p.defenseRank < 18) return false;
        if (allUsedPlayers.has(normalizeName(p.player_name))) return false;
        return passesBasicChecks(p, legs, gc);
      }).sort((a, b) => b.compositeScore - a.compositeScore);

      if (balCandidates.length > 0) {
        addLeg(balCandidates[0], legs, gc, used, 'balanced', 'standard');
        console.log(`[MegaParlay] STANDARD BALANCED: ${balCandidates[0].player_name} +${balCandidates[0].odds}`);
      }

      // GREAT ODDS leg
      const greatCandidates = scoredProps.filter(p => {
        if (p.market_type !== 'player_prop') return false;
        if (p.odds < 120) return false;
        if (p.hitRate < 55) return false;
        if (p.l10Avg !== null && p.side === 'OVER' && p.l10Avg < p.line * 1.3) return false;
        if (allUsedPlayers.has(normalizeName(p.player_name))) return false;
        return passesBasicChecks(p, legs, gc);
      }).sort((a, b) => b.odds - a.odds);

      if (greatCandidates.length > 0) {
        addLeg(greatCandidates[0], legs, gc, used, 'great_odds', 'standard');
        console.log(`[MegaParlay] STANDARD GREAT: ${greatCandidates[0].player_name} +${greatCandidates[0].odds}`);
      }

      // Fill to 4 legs if combined odds < 500
      while (legs.length < 4 && calcCombinedOdds(legs) < 500) {
        const filler = scoredProps.find(p => {
          if (p.market_type !== 'player_prop') return false;
          if (p.hitRate < 50) return false;
          if (allUsedPlayers.has(normalizeName(p.player_name))) return false;
          return passesBasicChecks(p, legs, gc);
        });
        if (!filler) break;
        addLeg(filler, legs, gc, used, 'filler', 'standard');
      }

      // Relaxed fallback if < 2 legs
      if (legs.length < 2) {
        for (const p of scoredProps) {
          if (legs.length >= 2) break;
          if (p.hitRate < 45) continue;
          if (allUsedPlayers.has(normalizeName(p.player_name))) continue;
          if (!passesBasicChecks(p, legs, gc)) continue;
          addLeg(p, legs, gc, used, 'fallback', 'standard');
        }
      }

      if (legs.length >= 2) {
        const odds = calcCombinedOdds(legs);
        allTickets.push({ tier: 'standard', legs, stake: 5, combinedOdds: odds });
        for (const n of used) allUsedPlayers.add(n);
        console.log(`[MegaParlay] STANDARD: ${legs.length} legs at +${odds}`);
      } else {
        console.log(`[MegaParlay] STANDARD: Failed to build (only ${legs.length} legs)`);
      }
    }

    // ============= TICKET 2: HIGH ROLLER (3-6 legs, +2000 to +8000, $3) =============
    console.log(`\n[MegaParlay] === TICKET 2: HIGH ROLLER ===`);
    {
      const legs: (ScoredProp & { leg_role: string; ticket_tier: string })[] = [];
      const gc = new Map<string, number>();
      const used = new Set<string>();

      // High roller: 40%+ hit rate, +200 min odds, defense 15+, L10 or L20 clears line by 1.1x
      const hrCandidates = scoredProps.filter(p => {
        if (p.odds < 200) return false;
        if (p.hitRate < 40) return false;
        if (p.defenseRank !== null && p.defenseRank < 15) return false;
        if (allUsedPlayers.has(normalizeName(p.player_name))) return false;
        // L10 or L20 must clear line by 1.1x for player props
        if (p.market_type === 'player_prop' && p.side === 'OVER') {
          const bestAvg = p.l10Avg || p.l20Avg;
          if (bestAvg !== null && bestAvg < p.line * 1.1) return false;
        }
        return passesBasicChecks(p, legs, gc);
      }).sort((a, b) => b.odds - a.odds); // Sort by odds for high value

      for (const c of hrCandidates) {
        if (legs.length >= 6) break;
        if (!passesBasicChecks(c, legs, gc)) continue;
        addLeg(c, legs, gc, used, 'high_roller', 'high_roller');
        const currentOdds = calcCombinedOdds(legs);
        console.log(`[MegaParlay] HR leg ${legs.length}: ${c.player_name} ${c.prop_type} +${c.odds} (running: +${currentOdds})`);
        if (legs.length >= 3 && currentOdds >= 2000) break; // Hit target
      }

      if (legs.length >= 3) {
        const odds = calcCombinedOdds(legs);
        allTickets.push({ tier: 'high_roller', legs, stake: 3, combinedOdds: odds });
        for (const n of used) allUsedPlayers.add(n);
        console.log(`[MegaParlay] HIGH ROLLER: ${legs.length} legs at +${odds}`);
      } else {
        console.log(`[MegaParlay] HIGH ROLLER: Failed (only ${legs.length} legs)`);
      }
    }

    // ============= TICKET 3: MEGA JACKPOT (4-8 legs, +10000 min, $1) =============
    console.log(`\n[MegaParlay] === TICKET 3: MEGA JACKPOT ===`);
    {
      const legs: (ScoredProp & { leg_role: string; ticket_tier: string })[] = [];
      const gc = new Map<string, number>();
      const used = new Set<string>();

      // Mega jackpot filters:
      // - +300 min per leg
      // - 30%+ hit rate (just viable)
      // - Defense rank 18+ for player props
      // - L10 or L20 within 0.8x of line (not impossible)
      // - Exotic props skip L10/L20 checks
      // - Team bets use defense rank as primary filter
      const megaCandidates = scoredProps.filter(p => {
        if (p.odds < 300) return false;
        if (p.hitRate < 30 && p.market_type !== 'exotic_player') return false;
        if (allUsedPlayers.has(normalizeName(p.player_name))) return false;

        // Defense filter: 18+ for player props, any for exotic
        if (p.market_type === 'player_prop') {
          if (p.defenseRank !== null && p.defenseRank < 18) return false;
          // L10 or L20 must be within 0.8x of line
          if (p.side === 'OVER') {
            const bestAvg = p.l10Avg || p.l20Avg;
            if (bestAvg !== null && bestAvg < p.line * 0.8) return false;
          }
        }

        // Team bets: only pick underdogs vs weak defenses (rank 18+)
        if (p.market_type === 'team_bet') {
          if (p.defenseRank !== null && p.defenseRank < 18) return false;
        }

        return passesBasicChecks(p, legs, gc);
      }).sort((a, b) => {
        // Prioritize exotic props (highest odds), then team bets, then player props
        const typeOrder = { exotic_player: 0, team_bet: 1, player_prop: 2 };
        const aOrder = typeOrder[a.market_type] ?? 2;
        const bOrder = typeOrder[b.market_type] ?? 2;
        if (aOrder !== bOrder) return aOrder - bOrder;
        return b.odds - a.odds;
      });

      console.log(`[MegaParlay] Mega jackpot candidates: ${megaCandidates.length} (exotic: ${megaCandidates.filter(p => p.market_type === 'exotic_player').length}, team: ${megaCandidates.filter(p => p.market_type === 'team_bet').length})`);

      for (const c of megaCandidates) {
        if (legs.length >= 8) break;
        if (!passesBasicChecks(c, legs, gc)) continue;
        addLeg(c, legs, gc, used, `mega_${c.market_type}`, 'mega_jackpot');
        const currentOdds = calcCombinedOdds(legs);
        console.log(`[MegaParlay] MEGA leg ${legs.length}: ${c.player_name} ${c.prop_type} ${c.side} +${c.odds} [${c.market_type}] def:${c.defenseRank} (running: +${currentOdds})`);
        if (legs.length >= 4 && currentOdds >= 10000) break; // Hit target!
      }

      // If we haven't hit 10k yet and have < 8 legs, add more with relaxed filters
      if (legs.length < 8 && calcCombinedOdds(legs) < 10000) {
        const relaxedCandidates = scoredProps.filter(p => {
          if (p.odds < 200) return false;
          if (allUsedPlayers.has(normalizeName(p.player_name))) return false;
          return passesBasicChecks(p, legs, gc);
        }).sort((a, b) => b.odds - a.odds);

        for (const c of relaxedCandidates) {
          if (legs.length >= 8) break;
          if (!passesBasicChecks(c, legs, gc)) continue;
          addLeg(c, legs, gc, used, 'mega_filler', 'mega_jackpot');
          const currentOdds = calcCombinedOdds(legs);
          console.log(`[MegaParlay] MEGA filler ${legs.length}: ${c.player_name} +${c.odds} (running: +${currentOdds})`);
          if (currentOdds >= 10000) break;
        }
      }

      if (legs.length >= 4) {
        const odds = calcCombinedOdds(legs);
        allTickets.push({ tier: 'mega_jackpot', legs, stake: 1, combinedOdds: odds });
        for (const n of used) allUsedPlayers.add(n);
        console.log(`[MegaParlay] MEGA JACKPOT: ${legs.length} legs at +${odds} ${odds >= 10000 ? '🎰 TARGET HIT!' : '⚠️ Below 10k target'}`);
      } else {
        console.log(`[MegaParlay] MEGA JACKPOT: Failed (only ${legs.length} legs)`);
      }
    }

    console.log(`\n[MegaParlay] Built ${allTickets.length}/3 tickets`);

    // ============= SAVE ALL TICKETS =============
    for (const ticket of allTickets) {
      try {
        const parlayLegsJson = ticket.legs.map(leg => ({
          player_name: leg.player_name,
          prop_type: leg.prop_type,
          side: leg.side,
          line: leg.line,
          odds: leg.odds,
          bookmaker: leg.bookmaker,
          game: leg.game,
          hit_rate: leg.hitRate,
          edge_pct: leg.edgePct,
          l10_avg: leg.l10Avg,
          l20_avg: leg.l20Avg,
          l10_median: leg.l10Median,
          defense_rank: leg.defenseRank,
          defense_bonus: leg.defenseBonus,
          volume_candidate: leg.volumeCandidate,
          leg_role: leg.leg_role,
          ticket_tier: ticket.tier,
          market_type: leg.market_type,
        }));

        const combinedProb = ticket.legs.reduce((acc, leg) => acc * americanToImpliedProb(leg.odds), 1);
        const decimalOdds = ticket.legs.reduce((acc, leg) => acc * americanToDecimal(leg.odds), 1);

        const { error: insertError } = await supabase
          .from('bot_daily_parlays')
          .insert({
            parlay_date: today,
            strategy_name: 'mega_lottery_scanner',
            tier: ticket.tier,
            legs: parlayLegsJson,
            leg_count: ticket.legs.length,
            combined_probability: combinedProb,
            expected_odds: ticket.combinedOdds,
            simulated_stake: ticket.stake,
            simulated_payout: ticket.stake * decimalOdds,
            is_simulated: true,
            selection_rationale: `V2 3-ticket system: ${ticket.tier} (${ticket.legs.length} legs, +${ticket.combinedOdds}, $${ticket.stake} stake)`,
          });

        if (insertError) {
          console.error(`[MegaParlay] Failed to save ${ticket.tier}:`, insertError);
        } else {
          console.log(`[MegaParlay] ✅ ${ticket.tier} saved`);
        }
      } catch (e) {
        console.error(`[MegaParlay] DB save error for ${ticket.tier}:`, e);
      }
    }

    // ============= TELEGRAM MESSAGE =============
    try {
      const telegramData = allTickets.map(t => ({
        tier: t.tier,
        stake: t.stake,
        combinedOdds: t.combinedOdds,
        payout: (t.stake * t.legs.reduce((acc, l) => acc * americanToDecimal(l.odds), 1)).toFixed(2),
        legs: t.legs.map((leg, i) => ({
          leg: i + 1,
          player: leg.player_name,
          prop: leg.prop_type.replace('player_', ''),
          side: leg.side,
          line: leg.line,
          odds: `+${leg.odds}`,
          market_type: leg.market_type,
          defense_rank: leg.defenseRank,
          hit_rate: leg.hitRate?.toFixed(1),
          game: leg.game,
        })),
      }));

      await fetch(`${supabaseUrl}/functions/v1/bot-send-telegram`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${supabaseKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: 'mega_lottery_v2',
          data: {
            date: today,
            tickets: telegramData,
            ticketCount: allTickets.length,
            scanned: rawProps.length,
            events: events.length,
            exoticProps: exoticCount,
            teamBets: teamBetCount,
          }
        }),
      });
    } catch (e) {
      console.error('[MegaParlay] Telegram failed:', e);
    }

    // ============= RESPONSE =============
    const result = {
      success: true,
      date: today,
      version: 'v2_3ticket',
      events_found: events.length,
      total_props: rawProps.length,
      exotic_props: exoticCount,
      team_bets: teamBetCount,
      scored_props: scoredProps.length,
      tickets: allTickets.map(t => ({
        tier: t.tier,
        leg_count: t.legs.length,
        combined_odds: `+${t.combinedOdds}`,
        stake: `$${t.stake}`,
        potential_payout: `$${(t.stake * t.legs.reduce((acc, l) => acc * americanToDecimal(l.odds), 1)).toFixed(2)}`,
        legs: t.legs.map((leg, i) => ({
          leg: i + 1,
          role: leg.leg_role,
          player: leg.player_name,
          prop: leg.prop_type.replace('player_', ''),
          side: leg.side,
          line: leg.line,
          odds: `+${leg.odds}`,
          market_type: leg.market_type,
          hit_rate: leg.hitRate?.toFixed(1) + '%',
          defense_rank: leg.defenseRank,
          l10_avg: leg.l10Avg,
          l20_avg: leg.l20Avg,
          game: leg.game,
        })),
      })),
    };

    return new Response(JSON.stringify(result, null, 2), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (err) {
    console.error('[MegaParlay] Error:', err);
    return new Response(JSON.stringify({
      success: false,
      error: err instanceof Error ? err.message : 'Unknown error',
    }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
