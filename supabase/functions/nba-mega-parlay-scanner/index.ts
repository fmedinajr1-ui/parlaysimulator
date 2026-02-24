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

// Convert American odds to implied probability
function americanToImpliedProb(odds: number): number {
  if (odds >= 100) return 100 / (odds + 100);
  return Math.abs(odds) / (Math.abs(odds) + 100);
}

// Convert American odds to decimal
function americanToDecimal(odds: number): number {
  if (odds >= 100) return (odds / 100) + 1;
  return (100 / Math.abs(odds)) + 1;
}

// Position-based archetype checks
const GUARD_POSITIONS = ['PG', 'SG', 'G'];
const FORWARD_POSITIONS = ['SF', 'PF', 'F'];
const CENTER_POSITIONS = ['C'];

function isGuard(position: string | null): boolean {
  if (!position) return false;
  return GUARD_POSITIONS.some(p => position.toUpperCase().includes(p));
}

function roleStatAligned(position: string | null, propType: string): boolean {
  if (!position) return true; // can't filter without position
  const pt = propType.toLowerCase();
  // Don't give guards rebounds props
  if (isGuard(position) && (pt.includes('rebound') || pt === 'player_rebounds')) return false;
  // Don't give centers 3-pointers
  if (CENTER_POSITIONS.some(p => (position || '').toUpperCase().includes(p)) && pt.includes('three')) return false;
  return true;
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
    if (!apiKey) throw new Error('THE_ODDS_API_KEY not configured');

    const today = getEasternDate();
    console.log(`[MegaParlay] Scanning NBA props for ${today}, +100 odds only`);

    // Step 1: Get NBA events first, then fetch player props per event
    const markets = 'player_points,player_rebounds,player_assists,player_threes,player_blocks,player_steals,player_points_rebounds_assists';
    
    // First get the list of events
    const eventsListUrl = `https://api.the-odds-api.com/v4/sports/basketball_nba/events?apiKey=${apiKey}`;
    const eventsListRes = await fetch(eventsListUrl);
    if (!eventsListRes.ok) throw new Error(`Events API returned ${eventsListRes.status}: ${await eventsListRes.text()}`);
    const eventsList: any[] = await eventsListRes.json();
    console.log(`[MegaParlay] Found ${eventsList.length} NBA events today`);

    // Fetch player props for each event in parallel
    const eventPropsPromises = eventsList.map(async (evt) => {
      const eventUrl = `https://api.the-odds-api.com/v4/sports/basketball_nba/events/${evt.id}/odds?apiKey=${apiKey}&regions=us&markets=${markets}&oddsFormat=american&bookmakers=fanduel,hardrockbet`;
      try {
        const res = await fetch(eventUrl);
        if (!res.ok) {
          console.warn(`[MegaParlay] Event ${evt.id} returned ${res.status}`);
          await res.text(); // consume body
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
          // Group outcomes by player (description)
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
            // Check Over side
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
            // Check Under side
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

    // Deduplicate: keep best odds per player+prop+side
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
    const playerNames = [...new Set(uniqueProps.map(p => p.player_name))];

    const [sweetSpotsRes, mispricedRes, gameLogsRes, defenseRes, archetypesRes] = await Promise.all([
      supabase
        .from('category_sweet_spots')
        .select('player_name, prop_type, recommended_side, l10_hit_rate, l10_avg, l10_median, actual_line, category, confidence_score')
        .eq('analysis_date', today),
      supabase
        .from('mispriced_lines')
        .select('player_name, prop_type, signal, edge_pct, book_line, player_avg')
        .eq('analysis_date', today),
      supabase
        .from('nba_player_game_logs')
        .select('player_name, stat_category, l5_avg, l10_avg, l20_avg, l5_median, l10_median, position, minutes_avg')
        .eq('game_date', today),
      supabase
        .from('nba_opponent_defense_stats')
        .select('team_name, stat_category, defensive_rank, pts_allowed_rank'),
      supabase
        .from('bdl_player_cache')
        .select('player_name, position'),
    ]);

    const sweetSpots = sweetSpotsRes.data || [];
    const mispricedLines = mispricedRes.data || [];
    const gameLogs = gameLogsRes.data || [];
    const defenseStats = defenseRes.data || [];
    const playerPositions = archetypesRes.data || [];

    console.log(`[MegaParlay] DB: ${sweetSpots.length} sweet spots, ${mispricedLines.length} mispriced, ${gameLogs.length} game logs, ${defenseStats.length} defense stats`);

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

    const gameLogMap = new Map<string, any>();
    for (const gl of gameLogs) {
      const key = `${normalizeName(gl.player_name)}|${normalizePropType(gl.stat_category)}`;
      gameLogMap.set(key, gl);
    }

    const positionMap = new Map<string, string>();
    for (const p of playerPositions) {
      positionMap.set(normalizeName(p.player_name), p.position || '');
    }

    // Step 4: Score each prop
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

      // Hit rate from sweet spots
      let hitRate = ss?.l10_hit_rate || 0;

      // Edge from mispriced
      let edgePct = ml ? Math.abs(ml.edge_pct || 0) : 0;

      // Check direction agreement
      const sweetSpotSide = ss?.recommended_side?.toUpperCase() || null;
      const mispricedSide = ml?.signal?.toUpperCase() || null;

      // Bonus if both engines agree on the same side as our prop
      let directionBonus = 0;
      if (sweetSpotSide === prop.side) directionBonus += 10;
      if (mispricedSide === prop.side) directionBonus += 10;

      // Median validation
      const median = gl?.l10_median ?? ss?.l10_median ?? null;
      let medianGap = 0;
      if (median != null) {
        if (prop.side === 'OVER') {
          medianGap = Math.max(0, (median - prop.line) / prop.line) * 100;
        } else {
          medianGap = Math.max(0, (prop.line - median) / prop.line) * 100;
        }
      }

      // Odds value score (higher American odds = more value)
      const oddsValue = Math.min(100, (prop.odds - 100) / 3 + 50);

      // Composite score
      const compositeScore =
        (hitRate * 0.40) +
        (edgePct * 0.25) +
        (medianGap * 0.15) +
        directionBonus +
        (oddsValue * 0.10);

      scoredProps.push({
        ...prop,
        hitRate,
        edgePct,
        medianGap,
        compositeScore,
        l10Avg: gl?.l10_avg ?? ss?.l10_avg ?? null,
        l10Median: median,
        position,
        sweetSpotSide,
        mispricedSide,
      });
    }

    // Sort by composite score
    scoredProps.sort((a, b) => b.compositeScore - a.compositeScore);
    console.log(`[MegaParlay] ${scoredProps.length} scored props after role alignment filter`);

    // Step 5: Build optimal parlay (greedy, 3-5 legs)
    const MIN_HIT_RATE = 55;
    const MAX_LEGS = 5;
    const MIN_LEGS = 3;
    const MAX_PER_GAME = 2;

    const parlayLegs: ScoredProp[] = [];
    const gameCount = new Map<string, number>();
    const usedPlayers = new Set<string>();

    for (const prop of scoredProps) {
      if (parlayLegs.length >= MAX_LEGS) break;

      // Must have some hit rate data (skip completely unknown)
      if (prop.hitRate < MIN_HIT_RATE && prop.hitRate > 0) continue;
      // If no hit rate data, require strong edge or direction agreement
      if (prop.hitRate === 0 && prop.edgePct < 15 && prop.compositeScore < 30) continue;

      // Game diversity
      const gc = gameCount.get(prop.game) || 0;
      if (gc >= MAX_PER_GAME) continue;

      // No duplicate players
      const nameKey = normalizeName(prop.player_name);
      if (usedPlayers.has(nameKey)) continue;

      parlayLegs.push(prop);
      gameCount.set(prop.game, gc + 1);
      usedPlayers.add(nameKey);
    }

    // If we couldn't get MIN_LEGS with strict filters, relax
    if (parlayLegs.length < MIN_LEGS) {
      for (const prop of scoredProps) {
        if (parlayLegs.length >= MIN_LEGS) break;
        const nameKey = normalizeName(prop.player_name);
        if (usedPlayers.has(nameKey)) continue;
        const gc = gameCount.get(prop.game) || 0;
        if (gc >= MAX_PER_GAME) continue;

        parlayLegs.push(prop);
        gameCount.set(prop.game, gc + 1);
        usedPlayers.add(nameKey);
      }
    }

    // Calculate parlay odds
    let combinedDecimalOdds = 1;
    for (const leg of parlayLegs) {
      combinedDecimalOdds *= americanToDecimal(leg.odds);
    }
    const parlayPayoutOn25 = 25 * combinedDecimalOdds;
    const combinedAmericanOdds = combinedDecimalOdds >= 2
      ? Math.round((combinedDecimalOdds - 1) * 100)
      : Math.round(-100 / (combinedDecimalOdds - 1));

    // All scored props for reference (top 20)
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
    }));

    const parlayBreakdown = parlayLegs.map((leg, i) => ({
      leg: i + 1,
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
    }));

    const result = {
      success: true,
      date: today,
      events_found: events.length,
      total_props_with_plus100: rawProps.length,
      unique_props_after_dedup: uniqueProps.length,
      scored_props_count: scoredProps.length,
      db_stats: {
        sweet_spots: sweetSpots.length,
        mispriced_lines: mispricedLines.length,
        game_logs: gameLogs.length,
        defense_stats: defenseStats.length,
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

    // Send Telegram report
    try {

      await fetch(`${supabaseUrl}/functions/v1/bot-send-telegram`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${supabaseKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: 'mega_parlay_scanner',
          data: {
            date: today,
            scanned: rawProps.length,
            events: events.length,
            qualified: scoredProps.length,
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
