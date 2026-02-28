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

function hasCorrelatedProp(
  existingLegs: Array<{ player_name: string; prop_type: string }>,
  candidatePlayer: string,
  candidateProp: string
): boolean {
  const player = candidatePlayer.toLowerCase().trim();
  const prop = normalizePropType(candidateProp);

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

// Map prop types to defense stat categories
function propToDefenseCategory(propType: string): string | null {
  const pt = normalizePropType(propType);
  if (pt === 'points' || pt === 'player_points') return 'points';
  if (pt === 'rebounds' || pt === 'player_rebounds') return 'rebounds';
  if (pt === 'assists' || pt === 'player_assists') return 'assists';
  if (pt === 'threes' || pt === 'player_threes') return 'threes';
  if (pt === 'pra') return 'points'; // use points as primary for combo
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
    try {
      const body = await req.json();
      replayMode = body?.replay === true;
    } catch { /* no body or invalid JSON, that's fine */ }

    if (!apiKey) throw new Error('THE_ODDS_API_KEY not configured');

    const today = getEasternDate();
    console.log(`[MegaParlay] Scanning NBA props for ${today}, +100 odds only${replayMode ? ' [REPLAY MODE]' : ''}`);

    // Step 1: Get NBA events first, then fetch player props per event
    const markets = 'player_points,player_rebounds,player_assists,player_threes,player_points_rebounds_assists';
    
    const eventsListUrl = `https://api.the-odds-api.com/v4/sports/basketball_nba/events?apiKey=${apiKey}`;
    const eventsListRes = await fetchWithTimeout(eventsListUrl);
    if (!eventsListRes.ok) throw new Error(`Events API returned ${eventsListRes.status}: ${await eventsListRes.text()}`);
    const eventsList: any[] = await eventsListRes.json();
    console.log(`[MegaParlay] Found ${eventsList.length} NBA events today`);

    const eventPropsPromises = eventsList.map(async (evt) => {
      const eventUrl = `https://api.the-odds-api.com/v4/sports/basketball_nba/events/${evt.id}/odds?apiKey=${apiKey}&regions=us&markets=${markets}&oddsFormat=american&bookmakers=fanduel,hardrockbet`;
      try {
        const res = await fetchWithTimeout(eventUrl);
        if (!res.ok) {
          console.warn(`[MegaParlay] Event ${evt.id} returned ${res.status}`);
          await res.text();
          return null;
        }
        const data = await res.json();
        return data;
      } catch (e) {
        console.warn(`[MegaParlay] Failed to fetch event ${evt.id}:`, e);
        return null;
      }
    });

    const eventResults = await Promise.all(eventPropsPromises);
    const events: any[] = eventResults.filter(Boolean);
    console.log(`[MegaParlay] Got props from ${events.length}/${eventsList.length} events`);

    // Step 2: Extract all props and filter for +100 odds
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
    }

    const rawProps: RawProp[] = [];

    for (const event of events) {
      const game = `${event.away_team} @ ${event.home_team}`;
      for (const bm of (event.bookmakers || [])) {
        for (const market of (bm.markets || [])) {
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
              });
            }
          }
        }
      }
    }

    console.log(`[MegaParlay] Found ${rawProps.length} prop sides with +100 odds`);

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

    // Step 3: Cross-reference with our database
    // FIX #1: Fetch RECENT game logs (not today's empty logs)
    const [sweetSpotsRes, mispricedRes, gameLogsRes, defenseRes, archetypesRes, teamDefenseRes] = await Promise.all([
      supabase
        .from('category_sweet_spots')
        .select('player_name, prop_type, recommended_side, l10_hit_rate, l10_avg, l10_median, actual_line, category, confidence_score')
        .eq('analysis_date', today),
      supabase
        .from('mispriced_lines')
        .select('player_name, prop_type, signal, edge_pct, book_line, player_avg')
        .eq('analysis_date', today)
        .gte('edge_pct', 3), // FIX: Only fetch positive edges >= 3%
      supabase
        .from('category_sweet_spots')
        .select('player_name, prop_type, l10_avg, l10_median, category')
        .not('l10_avg', 'is', null)
        .order('analysis_date', { ascending: false })
        .limit(1000), // Use sweet spots as game log proxy (has L10 stats)
      supabase
        .from('nba_opponent_defense_stats')
        .select('team_name, stat_category, defensive_rank, pts_allowed_rank'),
      supabase
        .from('bdl_player_cache')
        .select('player_name, position'),
      supabase
        .from('team_defense_rankings')
        .select('team_name, opp_points_rank, opp_threes_rank, opp_rebounds_rank, opp_assists_rank'),
    ]);

    const sweetSpots = sweetSpotsRes.data || [];
    const mispricedLines = mispricedRes.data || [];
    const gameLogs = gameLogsRes.data || [];
    const defenseStats = defenseRes.data || [];
    const playerPositions = archetypesRes.data || [];
    const teamDefenseRankings = teamDefenseRes.data || [];

    console.log(`[MegaParlay] DB: ${sweetSpots.length} sweet spots, ${mispricedLines.length} mispriced (3%+ edge only), ${gameLogs.length} game log proxies, ${defenseStats.length} defense stats, ${teamDefenseRankings.length} team defense rankings`);

    // Build lookup maps
    const sweetSpotMap = new Map<string, any>();
    for (const ss of sweetSpots) {
      const key = `${normalizeName(ss.player_name)}|${normalizePropType(ss.prop_type)}`;
      sweetSpotMap.set(key, ss);
    }

    const mispricedMap = new Map<string, any>();
    for (const ml of mispricedLines) {
      const key = `${normalizeName(ml.player_name)}|${normalizePropType(ml.prop_type)}`;
      mispricedMap.set(key, ml);
    }

    // Build game log proxy map from second sweet spots query (L10 stats)
    const gameLogMap = new Map<string, any>();
    for (const gl of gameLogs) {
      const key = `${normalizeName(gl.player_name)}|${normalizePropType(gl.prop_type)}`;
      if (!gameLogMap.has(key)) {
        gameLogMap.set(key, gl);
      }
    }

    const positionMap = new Map<string, string>();
    for (const p of playerPositions) {
      positionMap.set(normalizeName(p.player_name), p.position || '');
    }

    // FIX #4: Build defense lookup maps
    const defenseStatMap = new Map<string, any>();
    for (const ds of defenseStats) {
      const key = `${(ds.team_name || '').toLowerCase()}|${(ds.stat_category || '').toLowerCase()}`;
      defenseStatMap.set(key, ds);
    }

    const teamDefenseMap = new Map<string, any>();
    for (const td of teamDefenseRankings) {
      teamDefenseMap.set((td.team_name || '').toLowerCase(), td);
    }

    // Helper: get defense rank for a team + prop type
    function getDefenseRank(teamName: string, propType: string): number | null {
      const team = teamName.toLowerCase();
      const category = propToDefenseCategory(propType);
      if (!category) return null;

      // Try team_defense_rankings first (has prop-specific ranks)
      const td = teamDefenseMap.get(team);
      if (td) {
        if (category === 'points' && td.opp_points_rank) return td.opp_points_rank;
        if (category === 'threes' && td.opp_threes_rank) return td.opp_threes_rank;
        if (category === 'rebounds' && td.opp_rebounds_rank) return td.opp_rebounds_rank;
        if (category === 'assists' && td.opp_assists_rank) return td.opp_assists_rank;
      }

      // Fallback to nba_opponent_defense_stats
      const dsKey = `${team}|${category}`;
      const ds = defenseStatMap.get(dsKey);
      if (ds?.defensive_rank) return ds.defensive_rank;

      return null;
    }

    // Helper: determine opponent team for a player's prop
    function getOpponentTeam(prop: RawProp, playerTeam: string | null): string | null {
      if (!playerTeam) return null;
      const homeNorm = prop.home_team.toLowerCase();
      const awayNorm = prop.away_team.toLowerCase();
      const ptNorm = playerTeam.toLowerCase();
      if (homeNorm.includes(ptNorm) || ptNorm.includes(homeNorm)) return prop.away_team;
      if (awayNorm.includes(ptNorm) || ptNorm.includes(awayNorm)) return prop.home_team;
      return null;
    }

    // Step 4: Score each prop with ALL fixes applied
    interface ScoredProp extends RawProp {
      hitRate: number;
      edgePct: number;
      medianGap: number;
      compositeScore: number;
      l10Avg: number | null;
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

      // Role-stat alignment check
      if (!roleStatAligned(position, prop.prop_type)) continue;

      // Hit rate from sweet spots, with game-log fallback
      let hitRate = ss?.l10_hit_rate || 0;
      // Normalize: if stored as decimal (0.7 = 70%), convert to percentage
      if (hitRate > 0 && hitRate <= 1) hitRate = hitRate * 100;

      // FALLBACK: If no sweet spot hit rate, estimate from L10 avg vs line
      if (hitRate === 0 && gl && gl.l10_avg != null) {
        const avg = gl.l10_avg;
        if (prop.side === 'OVER') {
          const ratio = avg / prop.line;
          hitRate = Math.min(90, Math.max(0, ratio * 55));
        } else {
          const ratio = prop.line / avg;
          hitRate = Math.min(90, Math.max(0, ratio * 55));
        }
      }

      // FIX #2 & #3: Edge from mispriced — NO Math.abs, with direction validation
      let edgePct = 0;
      const mispricedSide = ml?.signal?.toUpperCase() || null;
      
      if (ml && ml.edge_pct >= 3) {
        // FIX #3: Only count edge if mispriced direction matches prop side
        if (mispricedSide === prop.side) {
          edgePct = ml.edge_pct; // Raw value, no Math.abs
        } else {
          edgePct = 0; // Direction mismatch — do not count edge
          console.log(`[MegaParlay] Edge direction mismatch: ${prop.player_name} ${prop.prop_type} prop=${prop.side} mispriced=${mispricedSide}, edge zeroed`);
        }
      }

      // Check direction agreement
      const sweetSpotSide = ss?.recommended_side?.toUpperCase() || null;

      // FIX #3: Direction bonus only when signal matches prop side
      let directionBonus = 0;
      if (sweetSpotSide === prop.side) directionBonus += 10;
      if (mispricedSide === prop.side && edgePct >= 3) directionBonus += 10;

      // Median validation (now populated since game logs are fixed)
      const median = gl?.l10_median ?? ss?.l10_median ?? null;
      let medianGap = 0;
      if (median != null) {
        if (prop.side === 'OVER') {
          medianGap = Math.max(0, (median - prop.line) / prop.line) * 100;
        } else {
          medianGap = Math.max(0, (prop.line - median) / prop.line) * 100;
        }
      }

      // FIX #4: Defense matchup scoring
      // Try to find which team the player is on using sweet spots or game context
      let opponentTeam: string | null = null;
      let defenseRank: number | null = null;
      let defenseBonus = 0;

      // Try both teams as opponent and see which defense rank we find
      const homeDefRank = getDefenseRank(prop.home_team, prop.prop_type);
      const awayDefRank = getDefenseRank(prop.away_team, prop.prop_type);
      
      // Use whichever is weaker as the potential opponent (lottery favors weak defense matchups)
      if (homeDefRank && awayDefRank) {
        // Player is on one team, opponent is the other — we check both
        defenseRank = Math.max(homeDefRank, awayDefRank); // Take the weaker defense
      } else {
        defenseRank = homeDefRank || awayDefRank || null;
      }

      if (defenseRank !== null) {
        if (prop.side === 'OVER') {
          if (defenseRank >= 25) defenseBonus = 15;       // Bottom 6 defense = huge boost
          else if (defenseRank >= 21) defenseBonus = 10;   // Bottom 10 defense = strong boost
          else if (defenseRank >= 18) defenseBonus = 6;    // Below average = moderate boost
          else if (defenseRank <= 5) defenseBonus = -15;   // Elite defense = hard penalty
          else if (defenseRank <= 10) defenseBonus = -10;  // Strong defense = penalty
        } else {
          // UNDER props: reward elite defense matchups
          if (defenseRank <= 5) defenseBonus = 8;
          else if (defenseRank <= 10) defenseBonus = 5;
          else if (defenseRank >= 25) defenseBonus = -10;  // Weak defense = bad for unders
        }
      }

      // Odds value score
      const oddsValue = Math.min(100, (prop.odds - 100) / 3 + 50);

      // L10 data
      const l10Avg = gl?.l10_avg ?? ss?.l10_avg ?? null;
      const l10Median = median;

      // Volume candidate: L10 avg significantly above main line + facing weak defense
      const volumeCandidate = !!(
        l10Avg &&
        prop.side === 'OVER' &&
        l10Avg >= prop.line * 1.3 &&
        defenseRank !== null &&
        defenseRank >= 18 &&
        edgePct >= 5
      );

      // Composite score with defense integration
      const compositeScore =
        (hitRate * 0.35) +
        (edgePct * 0.20) +
        (medianGap * 0.10) +
        directionBonus +
        defenseBonus +
        (oddsValue * 0.10) +
        (volumeCandidate ? 15 : 0); // Big bonus for volume + weak defense matchups

      scoredProps.push({
        ...prop,
        hitRate,
        edgePct,
        medianGap,
        compositeScore,
        l10Avg,
        l10Median,
        position,
        sweetSpotSide,
        mispricedSide,
        defenseRank,
        defenseBonus,
        volumeCandidate,
      });
    }

    // Sort by composite score
    scoredProps.sort((a, b) => b.compositeScore - a.compositeScore);
    console.log(`[MegaParlay] ${scoredProps.length} scored props after role alignment filter`);

    // FIX #5: Alt line hunting for volume candidates
    const volumeCandidates = scoredProps
      .filter(p => p.volumeCandidate)
      .slice(0, 10);

    console.log(`[MegaParlay] Found ${volumeCandidates.length} volume+matchup candidates for alt line hunting`);

    // Fetch alt lines for volume candidates
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
        } catch (e) {
          console.warn(`[MegaParlay] Alt line fetch failed for ${vc.player_name}:`, e);
        }
        return null;
      });

      const altResults = await Promise.all(altLinePromises);
      for (const r of altResults) {
        if (r?.data?.lines?.length > 0) {
          altLineResults.set(r.key, r.data.lines);
        }
      }
      console.log(`[MegaParlay] Got alt lines for ${altLineResults.size} players`);
    }

    // Try to swap in alt lines for volume candidates
    for (const prop of scoredProps) {
      if (!prop.volumeCandidate || !prop.l10Avg) continue;
      const altKey = `${normalizeName(prop.player_name)}|${normalizePropType(prop.prop_type)}`;
      const altLines = altLineResults.get(altKey);
      if (!altLines) continue;

      // Find the highest alt line where the player's L10 avg still clears it
      const viableAlts = altLines
        .filter((al: any) => al.line > prop.line && prop.l10Avg! >= al.line * 1.1 && al.overOdds >= 100)
        .sort((a: any, b: any) => b.line - a.line);

      if (viableAlts.length > 0) {
        const bestAlt = viableAlts[0];
        console.log(`[MegaParlay] ALT LINE SWAP: ${prop.player_name} ${prop.prop_type} ${prop.line} → ${bestAlt.line} (odds +${bestAlt.overOdds}, L10 avg ${prop.l10Avg})`);
        prop.line = bestAlt.line;
        prop.odds = bestAlt.overOdds;
        prop.compositeScore += 5; // Bonus for getting a better alt line
      }
    }

    // Re-sort after alt line swaps
    scoredProps.sort((a, b) => b.compositeScore - a.compositeScore);

    // Step 5: Build 3-leg role-based parlay (SAFE / BALANCED / GREAT ODDS)
    const MIN_LEGS = 3;
    const MAX_PER_GAME = 2;
    const MAX_SAME_PROP = 2;

    const LOTTERY_MIN_LINES: Record<string, number> = {
      player_blocks: 1.5,
      player_steals: 1.5,
    };

    // Helper: basic eligibility checks shared across all roles
    function passesBasicChecks(prop: ScoredProp, existingLegs: ScoredProp[], gameCount: Map<string, number>): boolean {
      const lotteryMin = LOTTERY_MIN_LINES[prop.prop_type];
      if (lotteryMin && prop.line < lotteryMin) return false;
      const gc = gameCount.get(prop.game) || 0;
      if (gc >= MAX_PER_GAME) return false;
      const existingForCheck = existingLegs.map(p => ({ player_name: p.player_name, prop_type: p.prop_type }));
      if (hasCorrelatedProp(existingForCheck, prop.player_name, prop.prop_type)) return false;
      const propNorm = normalizePropType(prop.prop_type);
      const sameTypeCount = existingLegs.filter(l => normalizePropType(l.prop_type) === propNorm).length;
      if (sameTypeCount >= MAX_SAME_PROP) return false;
      return true;
    }

    const parlayLegs: (ScoredProp & { leg_role: string })[] = [];
    const gameCount = new Map<string, number>();
    const usedPlayers = new Set<string>();

    // === REPLAY MODE: Fetch yesterday's pattern and apply to today's data ===
    let replayPattern: { propTypes: string[]; sides: string[]; minDefenseRank: number; minHitRate: number } | null = null;
    if (replayMode) {
      try {
        const yesterday = getYesterdayEasternDate();
        const { data: yesterdayParlays } = await supabase
          .from('bot_daily_parlays')
          .select('legs')
          .eq('strategy_name', 'mega_lottery_scanner')
          .eq('parlay_date', yesterday)
          .order('created_at', { ascending: false })
          .limit(1);

        if (yesterdayParlays && yesterdayParlays.length > 0) {
          const yLegs = Array.isArray(yesterdayParlays[0].legs) ? yesterdayParlays[0].legs : [];
          const propTypes = yLegs.map((l: any) => normalizePropType(l.prop_type || ''));
          const sides = yLegs.map((l: any) => (l.side || 'OVER').toUpperCase());
          const defRanks = yLegs.map((l: any) => l.defense_rank || 0).filter((r: number) => r > 0);
          const hitRates = yLegs.map((l: any) => l.hit_rate || 0).filter((r: number) => r > 0);
          replayPattern = {
            propTypes,
            sides,
            minDefenseRank: defRanks.length > 0 ? Math.min(...defRanks) : 15,
            minHitRate: hitRates.length > 0 ? Math.min(...hitRates) : 55,
          };
          console.log(`[MegaParlay] REPLAY: Yesterday's pattern — props: [${propTypes.join(', ')}], sides: [${sides.join(', ')}], minDef: ${replayPattern.minDefenseRank}, minHR: ${replayPattern.minHitRate}`);
        } else {
          console.log(`[MegaParlay] REPLAY: No yesterday parlay found, falling back to role-based`);
        }
      } catch (e) {
        console.error(`[MegaParlay] REPLAY fetch error:`, e);
      }
    }

    if (replayPattern && replayPattern.propTypes.length >= MIN_LEGS) {
      // === REPLAY BUILD: Match yesterday's pattern with today's players ===
      console.log(`[MegaParlay] Building REPLAY parlay from yesterday's pattern`);
      for (let i = 0; i < replayPattern.propTypes.length && parlayLegs.length < replayPattern.propTypes.length; i++) {
        const targetProp = replayPattern.propTypes[i];
        const targetSide = replayPattern.sides[i] || 'OVER';

        const candidate = scoredProps.find(p => {
          if (normalizePropType(p.prop_type) !== targetProp) return false;
          if (p.side !== targetSide) return false;
          if (p.hitRate < replayPattern!.minHitRate) return false;
          if (replayPattern!.minDefenseRank > 0 && p.defenseRank !== null && p.defenseRank < replayPattern!.minDefenseRank) return false;
          return passesBasicChecks(p, parlayLegs, gameCount);
        });

        if (candidate) {
          parlayLegs.push({ ...candidate, leg_role: `replay_leg_${i + 1}` });
          gameCount.set(candidate.game, (gameCount.get(candidate.game) || 0) + 1);
          usedPlayers.add(normalizeName(candidate.player_name));
          console.log(`[MegaParlay] REPLAY leg ${i + 1}: ${candidate.player_name} ${candidate.prop_type} ${candidate.side} ${candidate.line} +${candidate.odds}`);
        } else {
          console.log(`[MegaParlay] REPLAY leg ${i + 1}: No match for ${targetProp} ${targetSide}, will fill with role-based`);
        }
      }
    }

    // === ROLE-BASED 3-PASS BUILDER (primary path, or fills remaining replay gaps) ===
    if (parlayLegs.length < MIN_LEGS) {
      // PASS 1: SAFE LEG — highest hit rate, mispriced edge confirmed, neutral/weak defense
      if (!parlayLegs.some(l => l.leg_role === 'safe')) {
        const safeCandidates = scoredProps
          .filter(p => {
            if (p.hitRate < 70) return false;
            if (p.edgePct < 3) return false;
            if (p.defenseRank !== null && p.defenseRank < 15) return false;
            if (p.sweetSpotSide !== p.side && p.mispricedSide !== p.side) return false;
            if (p.l10Avg !== null && p.side === 'OVER' && p.l10Avg < p.line * 1.1) return false;
            if (p.l10Avg !== null && p.side === 'UNDER' && p.line < (p.l10Avg || 0) * 1.1) return false;
            return passesBasicChecks(p, parlayLegs, gameCount);
          })
          .sort((a, b) => b.hitRate - a.hitRate);

        if (safeCandidates.length > 0) {
          const pick = safeCandidates[0];
          parlayLegs.push({ ...pick, leg_role: 'safe' });
          gameCount.set(pick.game, (gameCount.get(pick.game) || 0) + 1);
          usedPlayers.add(normalizeName(pick.player_name));
          console.log(`[MegaParlay] SAFE leg: ${pick.player_name} ${pick.prop_type} ${pick.side} ${pick.line} +${pick.odds} (HR: ${pick.hitRate.toFixed(1)}%, edge: ${pick.edgePct.toFixed(1)}%, def: ${pick.defenseRank})`);
        } else {
          console.log(`[MegaParlay] SAFE: No candidate met all criteria, relaxing...`);
          // Relaxed safe: 65%+ hit rate, any edge
          const relaxedSafe = scoredProps.find(p => p.hitRate >= 65 && passesBasicChecks(p, parlayLegs, gameCount));
          if (relaxedSafe) {
            parlayLegs.push({ ...relaxedSafe, leg_role: 'safe' });
            gameCount.set(relaxedSafe.game, (gameCount.get(relaxedSafe.game) || 0) + 1);
            usedPlayers.add(normalizeName(relaxedSafe.player_name));
            console.log(`[MegaParlay] SAFE (relaxed): ${relaxedSafe.player_name} ${relaxedSafe.prop_type} ${relaxedSafe.side} +${relaxedSafe.odds}`);
          }
        }
      }

      // PASS 2: BALANCED LEG — 60%+ hit rate, 5%+ edge, defense rank 18+, sweet spot or mispriced agree
      if (parlayLegs.length < MIN_LEGS && !parlayLegs.some(l => l.leg_role === 'balanced')) {
        const balancedCandidates = scoredProps
          .filter(p => {
            if (p.hitRate < 60) return false;
            if (p.edgePct < 5) return false;
            if (p.defenseRank !== null && p.defenseRank < 18) return false;
            if (p.sweetSpotSide !== p.side && p.mispricedSide !== p.side) return false;
            if (p.l10Avg !== null && p.side === 'OVER' && p.l10Avg < p.line * 1.15) return false;
            return passesBasicChecks(p, parlayLegs, gameCount);
          })
          .sort((a, b) => b.compositeScore - a.compositeScore);

        if (balancedCandidates.length > 0) {
          const pick = balancedCandidates[0];
          parlayLegs.push({ ...pick, leg_role: 'balanced' });
          gameCount.set(pick.game, (gameCount.get(pick.game) || 0) + 1);
          usedPlayers.add(normalizeName(pick.player_name));
          console.log(`[MegaParlay] BALANCED leg: ${pick.player_name} ${pick.prop_type} ${pick.side} ${pick.line} +${pick.odds} (HR: ${pick.hitRate.toFixed(1)}%, edge: ${pick.edgePct.toFixed(1)}%, def: ${pick.defenseRank})`);
        } else {
          console.log(`[MegaParlay] BALANCED: No candidate met all criteria, relaxing...`);
          const relaxedBalanced = scoredProps.find(p => p.hitRate >= 55 && p.edgePct >= 3 && passesBasicChecks(p, parlayLegs, gameCount));
          if (relaxedBalanced) {
            parlayLegs.push({ ...relaxedBalanced, leg_role: 'balanced' });
            gameCount.set(relaxedBalanced.game, (gameCount.get(relaxedBalanced.game) || 0) + 1);
            usedPlayers.add(normalizeName(relaxedBalanced.player_name));
            console.log(`[MegaParlay] BALANCED (relaxed): ${relaxedBalanced.player_name} ${relaxedBalanced.prop_type} ${relaxedBalanced.side} +${relaxedBalanced.odds}`);
          }
        }
      }

      // PASS 3: GREAT ODDS LEG — +120 or higher, L10 avg clears line by 1.3x, volume candidate preferred
      if (parlayLegs.length < MIN_LEGS && !parlayLegs.some(l => l.leg_role === 'great_odds')) {
        const greatOddsCandidates = scoredProps
          .filter(p => {
            if (p.odds < 120) return false;
            if (p.hitRate < 55) return false;
            if (p.l10Avg !== null && p.side === 'OVER' && p.l10Avg < p.line * 1.3) return false;
            return passesBasicChecks(p, parlayLegs, gameCount);
          })
          .sort((a, b) => {
            // Prefer volume candidates, then sort by odds DESC then composite
            if (a.volumeCandidate !== b.volumeCandidate) return a.volumeCandidate ? -1 : 1;
            if (b.odds !== a.odds) return b.odds - a.odds;
            return b.compositeScore - a.compositeScore;
          });

        if (greatOddsCandidates.length > 0) {
          const pick = greatOddsCandidates[0];
          parlayLegs.push({ ...pick, leg_role: 'great_odds' });
          gameCount.set(pick.game, (gameCount.get(pick.game) || 0) + 1);
          usedPlayers.add(normalizeName(pick.player_name));
          console.log(`[MegaParlay] GREAT ODDS leg: ${pick.player_name} ${pick.prop_type} ${pick.side} ${pick.line} +${pick.odds} (HR: ${pick.hitRate.toFixed(1)}%, L10 avg: ${pick.l10Avg}, volume: ${pick.volumeCandidate})`);
        } else {
          console.log(`[MegaParlay] GREAT ODDS: No candidate met all criteria, relaxing...`);
          const relaxedGreat = scoredProps.find(p => p.odds >= 110 && p.hitRate >= 50 && passesBasicChecks(p, parlayLegs, gameCount));
          if (relaxedGreat) {
            parlayLegs.push({ ...relaxedGreat, leg_role: 'great_odds' });
            gameCount.set(relaxedGreat.game, (gameCount.get(relaxedGreat.game) || 0) + 1);
            usedPlayers.add(normalizeName(relaxedGreat.player_name));
            console.log(`[MegaParlay] GREAT ODDS (relaxed): ${relaxedGreat.player_name} ${relaxedGreat.prop_type} ${relaxedGreat.side} +${relaxedGreat.odds}`);
          }
        }
      }

      // FALLBACK: If still under MIN_LEGS, fill with greedy composite (existing logic)
      if (parlayLegs.length < MIN_LEGS) {
        console.log(`[MegaParlay] Role-based produced ${parlayLegs.length} legs, filling remaining with greedy composite`);
        for (const prop of scoredProps) {
          if (parlayLegs.length >= MIN_LEGS) break;
          if (prop.hitRate < 50) continue;
          if (prop.compositeScore < 20) continue;
          if (!passesBasicChecks(prop, parlayLegs, gameCount)) continue;
          parlayLegs.push({ ...prop, leg_role: 'fallback' });
          gameCount.set(prop.game, (gameCount.get(prop.game) || 0) + 1);
          usedPlayers.add(normalizeName(prop.player_name));
        }
      }
    }

    console.log(`[MegaParlay] Built ${parlayLegs.length}-leg parlay with roles: [${parlayLegs.map(l => l.leg_role).join(', ')}]`);

    // Calculate parlay odds
    let combinedDecimalOdds = 1;
    for (const leg of parlayLegs) {
      combinedDecimalOdds *= americanToDecimal(leg.odds);
    }
    const parlayPayoutOn25 = 25 * combinedDecimalOdds;
    const combinedAmericanOdds = combinedDecimalOdds >= 2
      ? Math.round((combinedDecimalOdds - 1) * 100)
      : Math.round(-100 / (combinedDecimalOdds - 1));

    const topProps = scoredProps.slice(0, 20).map(p => ({
      player: p.player_name,
      prop: p.prop_type.replace('player_', ''),
      side: p.side,
      line: p.line,
      odds: `+${p.odds}`,
      book: p.bookmaker,
      game: p.game,
      hit_rate: p.hitRate ? `${p.hitRate.toFixed(1)}%` : 'N/A',
      edge: p.edgePct ? `${p.edgePct.toFixed(1)}%` : 'N/A',
      l10_median: p.l10Median,
      l10_avg: p.l10Avg,
      composite: p.compositeScore.toFixed(1),
      sweet_spot_agrees: p.sweetSpotSide === p.side,
      mispriced_agrees: p.mispricedSide === p.side,
      defense_rank: p.defenseRank,
      defense_bonus: p.defenseBonus,
      volume_candidate: p.volumeCandidate,
    }));

    const parlayBreakdown = parlayLegs.map((leg, i) => ({
      leg: i + 1,
      leg_role: leg.leg_role,
      player: leg.player_name,
      prop: leg.prop_type.replace('player_', ''),
      side: leg.side,
      line: leg.line,
      odds: `+${leg.odds}`,
      book: leg.bookmaker,
      game: leg.game,
      hit_rate: leg.hitRate ? `${leg.hitRate.toFixed(1)}%` : 'N/A',
      edge: leg.edgePct ? `${leg.edgePct.toFixed(1)}%` : 'N/A',
      l10_median: leg.l10Median,
      l10_avg: leg.l10Avg,
      composite: leg.compositeScore.toFixed(1),
      sweet_spot_agrees: leg.sweetSpotSide === leg.side,
      mispriced_agrees: leg.mispricedSide === leg.side,
      defense_rank: leg.defenseRank,
      defense_bonus: leg.defenseBonus,
      volume_candidate: leg.volumeCandidate,
    }));

    const result = {
      success: true,
      date: today,
      events_found: events.length,
      total_props_with_plus100: rawProps.length,
      unique_props_after_dedup: uniqueProps.length,
      scored_props_count: scoredProps.length,
      volume_candidates_found: volumeCandidates.length,
      alt_lines_fetched: altLineResults.size,
      db_stats: {
        sweet_spots: sweetSpots.length,
        mispriced_lines: mispricedLines.length,
        game_logs: gameLogs.length,
        defense_stats: defenseStats.length,
        team_defense_rankings: teamDefenseRankings.length,
      },
      recommended_parlay: {
        legs: parlayBreakdown,
        leg_count: parlayLegs.length,
        combined_american_odds: `+${combinedAmericanOdds}`,
        combined_decimal_odds: combinedDecimalOdds.toFixed(2),
        payout_on_25: `$${parlayPayoutOn25.toFixed(2)}`,
        profit_on_25: `$${(parlayPayoutOn25 - 25).toFixed(2)}`,
      },
      top_20_props: topProps,
    };

    console.log(`[MegaParlay] Built ${parlayLegs.length}-leg parlay at +${combinedAmericanOdds}, payout $${parlayPayoutOn25.toFixed(2)} on $25`);

    // FIX #6: Save lottery parlay to bot_daily_parlays for tracking + settlement
    if (parlayLegs.length >= MIN_LEGS) {
      try {
        const parlayLegsJson = parlayLegs.map(leg => ({
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
          l10_median: leg.l10Median,
          defense_rank: leg.defenseRank,
          defense_bonus: leg.defenseBonus,
          volume_candidate: leg.volumeCandidate,
          leg_role: leg.leg_role,
        }));

        const combinedProb = parlayLegs.reduce((acc, leg) => acc * americanToImpliedProb(leg.odds), 1);
        const strategyName = replayMode ? 'mega_lottery_replay' : 'mega_lottery_scanner';
        const rationale = replayMode
          ? `Replay of yesterday's pattern: [${replayPattern?.propTypes.join(', ')}] sides [${replayPattern?.sides.join(', ')}]. Role-based fill for gaps.`
          : `Role-based scanner: SAFE/BALANCED/GREAT_ODDS. ${volumeCandidates.length} volume candidates, ${altLineResults.size} alt lines checked.`;

        const { error: insertError } = await supabase
          .from('bot_daily_parlays')
          .insert({
            parlay_date: today,
            strategy_name: strategyName,
            tier: 'lottery',
            legs: parlayLegsJson,
            leg_count: parlayLegs.length,
            combined_probability: combinedProb,
            expected_odds: combinedAmericanOdds,
            is_simulated: true,
            selection_rationale: rationale,
          });

        if (insertError) {
          console.error('[MegaParlay] Failed to save parlay to DB:', insertError);
        } else {
          console.log('[MegaParlay] ✅ Lottery parlay saved to bot_daily_parlays');
        }
      } catch (e) {
        console.error('[MegaParlay] DB save error:', e);
      }
    }

    // Send Telegram report
    try {
      await fetch(`${supabaseUrl}/functions/v1/bot-send-telegram`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${supabaseKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: replayMode ? 'mega_parlay_replay' : 'mega_parlay_scanner',
          data: {
            date: today,
            isReplay: replayMode,
            replayPattern: replayPattern || null,
            scanned: rawProps.length,
            events: events.length,
            qualified: scoredProps.length,
            volumeCandidates: volumeCandidates.length,
            altLinesFound: altLineResults.size,
            legs: parlayBreakdown,
            combinedOdds: combinedAmericanOdds,
            payout25: parlayPayoutOn25.toFixed(2),
          }
        }),
      });
    } catch (e) {
      console.error('[MegaParlay] Telegram failed:', e);
    }

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
