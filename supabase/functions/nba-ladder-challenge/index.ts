// Native Deno.serve used below
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.38.4";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
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

function americanToDecimal(odds: number): number {
  if (odds >= 100) return (odds / 100) + 1;
  return (100 / Math.abs(odds)) + 1;
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

// All prop markets we scan
const PROP_MARKETS = ['player_points', 'player_rebounds', 'player_assists', 'player_threes'];

const PROP_LABELS: Record<string, string> = {
  player_points: 'PTS',
  player_rebounds: 'REB',
  player_assists: 'AST',
  player_threes: '3PT',
};

const PROP_GAME_LOG_FIELD: Record<string, string> = {
  player_points: 'points',
  player_rebounds: 'rebounds',
  player_assists: 'assists',
  player_threes: 'threes_made',
};

const PROP_SWEET_SPOT_TYPES: Record<string, string[]> = {
  player_points: ['points', 'player_points'],
  player_rebounds: ['rebounds', 'player_rebounds'],
  player_assists: ['assists', 'player_assists'],
  player_threes: ['threes', 'player_threes'],
};

interface PlayerLine {
  player_name: string;
  prop_type: string;
  line: number;
  over_odds: number;
  bookmaker: string;
  game: string;
  home_team: string;
  away_team: string;
}

interface LockCandidate {
  player_name: string;
  prop_type: string;
  prop_label: string;
  line: number;
  over_odds: number;
  bookmaker: string;
  game: string;
  home_team: string;
  away_team: string;
  opponent: string;
  player_team: string;
  // L10 stats
  l10_avg: number;
  l10_min: number;
  l10_max: number;
  l10_median: number;
  l10_hit_rate: number;
  l10_games: number;
  l10_hits: number;
  // Defense
  opp_defense_rank: number;
  // Scoring
  safety_score: number;
  // Safety breakdown
  safety_breakdown: {
    hit_rate_score: number;
    floor_score: number;
    edge_score: number;
    consistency_score: number;
    floor_margin: number;
  };
}

Deno.serve(async (req) => {
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
    console.log(`[LadderLock] Starting scan for ${today}`);

    // === DEDUP CHECK: Skip if we already have 1 ladder for today ===
    const { data: existingLadders } = await supabase
      .from('bot_daily_parlays')
      .select('id')
      .eq('parlay_date', today)
      .eq('strategy_name', 'ladder_challenge')
      .neq('outcome', 'void');

    if (existingLadders && existingLadders.length >= 1) {
      console.log(`[LadderLock] Already have lock for today, skipping`);
      return new Response(JSON.stringify({ success: true, skipped: true, reason: 'already_exists' }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // === FRESH DATA: Force refresh game logs before picking ===
    console.log(`[LadderLock] Refreshing game log data via nba-stats-fetcher...`);
    try {
      const refreshRes = await fetch(`${supabaseUrl}/functions/v1/nba-stats-fetcher`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${supabaseKey}`,
        },
        body: JSON.stringify({
          mode: 'sync',
          daysBack: 3,
          useESPN: true,
          includeParlayPlayers: true,
        }),
      });
      const refreshResult = await refreshRes.json();
      console.log(`[LadderLock] Game log refresh result:`, JSON.stringify(refreshResult).slice(0, 200));
    } catch (refreshErr) {
      console.warn(`[LadderLock] Game log refresh failed (continuing with existing data):`, refreshErr.message);
    }

    // === STEP 1: Query NBA sweet spots — filter out NHL/MLB, wide net (70%+) ===
    console.log(`[LadderLock] Querying NBA sweet spots for today's high-accuracy players...`);
    
    // NBA categories to include (exclude NHL_* and MLB_*)
    const NBA_CATEGORIES_FILTER = `category.not.like.NHL_%,category.not.like.MLB_%,category.not.like.NCAAB_%`;
    
    const { data: sweetSpots, error: ssError } = await supabase
      .from('category_sweet_spots')
      .select('*')
      .eq('analysis_date', today)
      .eq('is_active', true)
      .gte('l10_hit_rate', 0.7)
      .not('l10_avg', 'is', null)
      .not('category', 'like', 'NHL_%')
      .not('category', 'like', 'MLB_%')
      .not('category', 'like', 'NCAAB_%')
      .order('l10_hit_rate', { ascending: false })
      .limit(100);

    if (ssError) console.warn(`[LadderLock] Sweet spot query error:`, ssError.message);

    // Fallback to all-time active NBA sweet spots
    const { data: fallbackSpots } = await supabase
      .from('category_sweet_spots')
      .select('*')
      .eq('is_active', true)
      .gte('l10_hit_rate', 0.7)
      .not('l10_avg', 'is', null)
      .not('category', 'like', 'NHL_%')
      .not('category', 'like', 'MLB_%')
      .not('category', 'like', 'NCAAB_%')
      .order('l10_hit_rate', { ascending: false })
      .limit(100);

    const allSpots = (sweetSpots && sweetSpots.length > 0) ? sweetSpots : (fallbackSpots || []);
    console.log(`[LadderLock] Found ${allSpots.length} NBA sweet spots with 70%+ L10 hit rate`);

    if (allSpots.length === 0) {
      console.log(`[LadderLock] No qualified NBA sweet spots found — skipping today`);
      return new Response(JSON.stringify({ success: false, error: 'No NBA sweet spots with 70%+ hit rate available' }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // === STEP 2: Verify L10 data from game logs for top candidates ===
    const topCandidateNames = [...new Set(allSpots.slice(0, 30).map((s: any) => s.player_name))];
    console.log(`[LadderLock] Verifying game logs for ${topCandidateNames.length} players...`);

    const gameLogPromises = topCandidateNames.map(async (name: string) => {
      const { data } = await supabase
        .from('nba_player_game_logs')
        .select('player_name, points, rebounds, assists, threes_made, game_date')
        .ilike('player_name', `%${name.split(' ').pop()}%`)
        .order('game_date', { ascending: false })
        .limit(10);
      return { name: normalizeName(name), logs: data || [] };
    });

    const gameLogResults = await Promise.all(gameLogPromises);
    const gameLogMap = new Map<string, any[]>();
    for (const { name, logs } of gameLogResults) {
      gameLogMap.set(name, logs);
    }

    // === STEP 3: Apply safety gates using sweet spot data + game logs ===
    interface VerifiedCandidate {
      sweet_spot: any;
      l10_values: number[];
      l10_avg: number;
      l10_min: number;
      l10_max: number;
      l10_median: number;
      l10_hit_rate: number;
      l10_games: number;
      l10_hits: number;
      floor_margin: number;
      prop_market: string;
      game_log_field: string;
    }

    const CATEGORY_TO_MARKET: Record<string, string> = {
      'points': 'player_points',
      'player_points': 'player_points',
      'PTS_OVER': 'player_points',
      'rebounds': 'player_rebounds',
      'player_rebounds': 'player_rebounds',
      'REB_OVER': 'player_rebounds',
      'assists': 'player_assists',
      'player_assists': 'player_assists',
      'AST_OVER': 'player_assists',
      'threes': 'player_threes',
      'player_threes': 'player_threes',
      '3PT_OVER': 'player_threes',
    };

    const CATEGORY_TO_FIELD: Record<string, string> = {
      'points': 'points',
      'player_points': 'points',
      'PTS_OVER': 'points',
      'rebounds': 'rebounds',
      'player_rebounds': 'rebounds',
      'REB_OVER': 'rebounds',
      'assists': 'assists',
      'player_assists': 'assists',
      'AST_OVER': 'assists',
      'threes': 'threes_made',
      'player_threes': 'threes_made',
      '3PT_OVER': 'threes_made',
    };

    const verified: VerifiedCandidate[] = [];

    // Skip pre-verification at SS lines — we'll verify directly against live sportsbook lines
    // Just collect player+prop combos and their game log data
    const playerPropData = new Map<string, { values: number[]; sweet_spot: any; propMarket: string; gameLogField: string }>();

    for (const ss of allSpots) {
      const nName = normalizeName(ss.player_name);
      const logs = gameLogMap.get(nName);
      if (!logs || logs.length < 8) continue;

      const propType = ss.prop_type || ss.category || '';
      const gameLogField = CATEGORY_TO_FIELD[propType.toLowerCase()] || CATEGORY_TO_FIELD[propType];
      const propMarket = CATEGORY_TO_MARKET[propType.toLowerCase()] || CATEGORY_TO_MARKET[propType];
      if (!gameLogField || !propMarket) continue;

      const values = logs.map((g: any) => g[gameLogField] ?? 0);
      const key = `${nName}|${propMarket}`;
      if (!playerPropData.has(key)) {
        playerPropData.set(key, { values, sweet_spot: ss, propMarket, gameLogField });
      }
    }

    console.log(`[LadderLock] ${playerPropData.size} player+prop combos with 8+ game logs ready for live line verification`);

    // === STEP 4: Fetch live lines for sweet spot players ===
    console.log(`[LadderLock] Fetching live lines for ${playerPropData.size} player+prop combos...`);
    
    const neededMarkets = [...new Set([...playerPropData.values()].map(v => v.propMarket))];
    const eventsUrl = `https://api.the-odds-api.com/v4/sports/basketball_nba/events?apiKey=${apiKey}`;
    const eventsRes = await fetchWithTimeout(eventsUrl);
    if (!eventsRes.ok) throw new Error(`Events API returned ${eventsRes.status}`);
    const events: any[] = await eventsRes.json();

    if (events.length === 0) {
      return new Response(JSON.stringify({ success: false, error: 'No NBA events today' }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const allLines: PlayerLine[] = [];
    
    for (const evt of events) {
      try {
        const marketsParam = neededMarkets.join(',');
        const url = `https://api.the-odds-api.com/v4/sports/basketball_nba/events/${evt.id}/odds?apiKey=${apiKey}&regions=us&markets=${marketsParam}&oddsFormat=american&bookmakers=fanduel,draftkings,hardrockbet`;
        const res = await fetchWithTimeout(url);
        if (!res.ok) { await res.text(); continue; }
        const data = await res.json();

        for (const bk of data.bookmakers || []) {
          for (const mkt of bk.markets || []) {
            for (const outcome of mkt.outcomes || []) {
              if (outcome.name === 'Over') {
                allLines.push({
                  player_name: outcome.description,
                  prop_type: mkt.key,
                  line: outcome.point,
                  over_odds: outcome.price,
                  bookmaker: bk.key,
                  game: `${evt.away_team} @ ${evt.home_team}`,
                  home_team: evt.home_team,
                  away_team: evt.away_team,
                });
              }
            }
          }
        }
      } catch (e) {
        console.warn(`[LadderLock] Error fetching event ${evt.id}:`, (e as Error).message);
      }
    }

    console.log(`[LadderLock] Fetched ${allLines.length} live lines`);

    // Build line lookup: normalizedName|market -> ALL lines (to find best match for sweet spot line)
    const linesByPlayer = new Map<string, PlayerLine[]>();
    for (const line of allLines) {
      const key = `${normalizeName(line.player_name)}|${line.prop_type}`;
      if (!linesByPlayer.has(key)) linesByPlayer.set(key, []);
      linesByPlayer.get(key)!.push(line);
    }

    // Player team lookup
    const { data: playerCacheData } = await supabase
      .from('bdl_player_cache')
      .select('player_name, team_name')
      .not('team_name', 'is', null);

    const playerTeamMap = new Map<string, string>();
    for (const p of playerCacheData || []) {
      if (p.team_name) playerTeamMap.set(normalizeName(p.player_name), p.team_name);
    }

    // === STEP 5: For each sweet spot player, try ALL available live lines and pick the safest ===
    const candidates: LockCandidate[] = [];

    for (const [ppKey, data] of playerPropData) {
      const [nName] = ppKey.split('|');
      const playerLines = linesByPlayer.get(ppKey) || [];
      
      if (playerLines.length === 0) continue; // Must have a live bettable line

      // Try each live line for this player+prop
      for (const liveLine of playerLines) {
        const line = liveLine.line;
        const values = data.values;

        // SAFETY GATE 1: 90%+ hit rate at this specific line
        const hitCount = values.filter((v: number) => v > line).length;
        const hitRate = hitCount / values.length;
        if (hitRate < 0.9) continue;

        const avg = values.reduce((a: number, b: number) => a + b, 0) / values.length;
        const sorted = [...values].sort((a: number, b: number) => a - b);
        const median = sorted[Math.floor(sorted.length / 2)];
        const min = Math.min(...values);
        const max = Math.max(...values);

        // SAFETY GATE 2: Hard floor — L10 worst game MUST exceed the line
        if (min <= line) continue;

        // SAFETY GATE 3: Median clearance — L10 median must beat line by at least 1.0
        if (median < line + 1) continue;

        // Resolve opponent
        const playerTeam = playerTeamMap.get(nName);
        let opponent = '';
        let playerTeamName = '';
        const homeTeam = liveLine.home_team;
        const awayTeam = liveLine.away_team;
        if (playerTeam && homeTeam && awayTeam) {
          const ptLower = playerTeam.toLowerCase();
          const homeLower = homeTeam.toLowerCase();
          const awayLower = awayTeam.toLowerCase();
          if (homeLower.includes(ptLower) || ptLower.includes(homeLower)) {
            opponent = awayTeam; playerTeamName = homeTeam;
          } else if (awayLower.includes(ptLower) || ptLower.includes(awayLower)) {
            opponent = homeTeam; playerTeamName = awayTeam;
          } else {
            const ptWords = ptLower.split(' ');
            if (ptWords.some((w: string) => homeLower.includes(w) && w.length > 3)) {
              opponent = awayTeam; playerTeamName = homeTeam;
            } else {
              opponent = homeTeam; playerTeamName = awayTeam;
            }
          }
        }

        const floorMargin = min - line;

        // === SAFETY SCORE ===
        const hitRateScore = hitRate * 50;
        const floorScore = Math.min((floorMargin / line) * 50, 25);
        const edgeScore = Math.min(((avg - line) / line) * 30, 15);
        const consistencyScore = (1 - (max - min) / (avg || 1)) * 10;
        const safetyScore = hitRateScore + floorScore + edgeScore + consistencyScore;

        const propLabel = PROP_LABELS[data.propMarket] || data.sweet_spot.prop_type || data.propMarket;

        candidates.push({
          player_name: liveLine.player_name,
          prop_type: data.propMarket,
          prop_label: propLabel,
          line,
          over_odds: liveLine.over_odds,
          bookmaker: liveLine.bookmaker,
          game: liveLine.game,
          home_team: homeTeam,
          away_team: awayTeam,
          opponent,
          player_team: playerTeamName,
          l10_avg: Math.round(avg * 10) / 10,
          l10_min: min,
          l10_max: max,
          l10_median: median,
          l10_hit_rate: hitRate,
          l10_games: values.length,
          l10_hits: hitCount,
          opp_defense_rank: 15,
          safety_score: safetyScore,
          safety_breakdown: {
            hit_rate_score: Math.round(hitRateScore * 10) / 10,
            floor_score: Math.round(floorScore * 10) / 10,
            edge_score: Math.round(edgeScore * 10) / 10,
            consistency_score: Math.round(consistencyScore * 10) / 10,
            floor_margin: floorMargin,
          },
        });
      }
    }

    // Sort by safety score descending — top 1 is our LOCK
    candidates.sort((a, b) => b.safety_score - a.safety_score);

    console.log(`[LadderLock] ${candidates.length} final candidates after live line verification`);
    if (candidates.length > 0) {
      console.log(`[LadderLock] Top 5:`, candidates.slice(0, 5).map(c =>
        `${c.player_name} ${c.prop_label} O${c.line} (safety: ${c.safety_score.toFixed(2)}, hitRate: ${(c.l10_hit_rate * 100).toFixed(0)}%, avg: ${c.l10_avg}, floor: ${c.l10_min}, floorMargin: +${c.safety_breakdown.floor_margin})`
      ));
    }

    if (candidates.length === 0) {
      console.log(`[LadderLock] No picks qualified — skipping today (this is correct behavior)`);
      return new Response(JSON.stringify({ success: false, error: 'No eligible lock candidates — all picks filtered by safety gates (90% hit rate + floor > line + median +1)' }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // === STEP 7: Take the #1 candidate — the single Lock of the Day ===
    const lock = candidates[0];
    const logs = gameLogMap.get(normalizeName(lock.player_name)) || [];
    const gameLogField = PROP_GAME_LOG_FIELD[lock.prop_type];
    const recentValues = logs.slice(0, 5).map((g: any) => g[gameLogField] ?? 0);
    const l5Str = recentValues.join(', ');

    const oddsStr = lock.over_odds > 0 ? `+${lock.over_odds}` : `${lock.over_odds}`;
    const decimalOdds = americanToDecimal(lock.over_odds);
    const impliedProb = lock.over_odds >= 100
      ? 100 / (lock.over_odds + 100)
      : Math.abs(lock.over_odds) / (Math.abs(lock.over_odds) + 100);

    const hitPct = `${(lock.l10_hit_rate * 100).toFixed(0)}%`;
    const rationale = `Lock of the Day: ${lock.player_name} ${lock.prop_label} Over ${lock.line} (${oddsStr}) vs ${lock.opponent}. L10: ${hitPct} hit rate (${lock.l10_hits}/${lock.l10_games}), Avg: ${lock.l10_avg}, Floor: ${lock.l10_min} (margin: +${lock.safety_breakdown.floor_margin}), Ceiling: ${lock.l10_max}. Safety Score: ${lock.safety_score.toFixed(2)}.`;

    const leg = {
      player_name: lock.player_name,
      prop_type: lock.prop_type,
      line: lock.line,
      side: 'OVER',
      odds: lock.over_odds,
      bookmaker: lock.bookmaker,
      rung_label: 'Lock',
      l10_hit_rate: hitPct,
    };

    // Save to bot_daily_parlays as single-leg entry
    const { error: insertError } = await supabase
      .from('bot_daily_parlays')
      .insert({
        parlay_date: today,
        strategy_name: 'ladder_challenge',
        tier: 'execution',
        legs: [leg],
        leg_count: 1,
        combined_probability: Math.round(impliedProb * 10000) / 10000,
        expected_odds: Math.round(decimalOdds),
        selection_rationale: rationale,
        is_simulated: false,
        simulated_stake: 100,
      });

    if (insertError) {
      console.error(`[LadderLock] Insert error:`, insertError);
    } else {
      console.log(`[LadderLock] Saved lock: ${lock.player_name} ${lock.prop_label} O${lock.line} (${oddsStr})`);
    }

    // === STEP 8: Send Telegram notification with safety score breakdown ===
    const sb = lock.safety_breakdown;
    const telegramMessage =
      `🔒 LADDER LOCK OF THE DAY 🔒\n` +
      `━━━━━━━━━━━━━━━━━━━━━\n` +
      `${lock.player_name}\n` +
      `Take OVER ${lock.line} ${lock.prop_label} (${oddsStr})\n` +
      `${lock.game}\n\n` +
      `📊 L10 Hit Rate: ${hitPct} (${lock.l10_hits}/${lock.l10_games})\n` +
      `📈 L10 Avg: ${lock.l10_avg} | Median: ${lock.l10_median}\n` +
      `🟢 Floor: ${lock.l10_min} (margin: +${sb.floor_margin}) | Ceiling: ${lock.l10_max}\n` +
      `📋 Last 5: ${l5Str}\n\n` +
      `🛡️ Safety Score: ${lock.safety_score.toFixed(1)}/100\n` +
      `  Hit Rate: ${sb.hit_rate_score}/50\n` +
      `  Floor: ${sb.floor_score}/25\n` +
      `  Edge: ${sb.edge_score}/15\n` +
      `  Consistency: ${sb.consistency_score}/10\n` +
      `━━━━━━━━━━━━━━━━━━━━━\n` +
      `💰 $100 Stake | vs ${lock.opponent}`;

    try {
      await fetch(`${supabaseUrl}/functions/v1/bot-send-telegram`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${supabaseKey}`,
        },
        body: JSON.stringify({
          type: 'ladder_challenge',
          data: {
            message: telegramMessage,
            picks: [{ player: lock.player_name, line: lock.line, odds: oddsStr, prop: lock.prop_label }],
          },
        }),
      });
      console.log(`[LadderLock] Telegram notification sent`);
    } catch (e) {
      console.warn(`[LadderLock] Telegram send failed:`, e.message);
    }

    return new Response(JSON.stringify({
      success: true,
      lock: {
        player: lock.player_name,
        prop: lock.prop_label,
        line: lock.line,
        odds: oddsStr,
        hit_rate: hitPct,
        l10_avg: lock.l10_avg,
        l10_min: lock.l10_min,
        l10_max: lock.l10_max,
        safety_score: lock.safety_score,
        safety_breakdown: lock.safety_breakdown,
        opponent: lock.opponent,
        game: lock.game,
      },
      candidates_evaluated: candidates.length,
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error) {
    console.error(`[LadderLock] Fatal error:`, error);
    return new Response(JSON.stringify({ success: false, error: error.message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
