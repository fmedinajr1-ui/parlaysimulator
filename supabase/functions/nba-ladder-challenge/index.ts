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

    // === STEP 1: Fetch NBA events ===
    const eventsUrl = `https://api.the-odds-api.com/v4/sports/basketball_nba/events?apiKey=${apiKey}`;
    const eventsRes = await fetchWithTimeout(eventsUrl);
    if (!eventsRes.ok) throw new Error(`Events API returned ${eventsRes.status}`);
    const events: any[] = await eventsRes.json();
    console.log(`[LadderLock] Found ${events.length} NBA events`);

    if (events.length === 0) {
      return new Response(JSON.stringify({ success: false, error: 'No NBA events today' }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // === STEP 2: Fetch ALL prop markets for each event ===
    const allLines: PlayerLine[] = [];
    for (const evt of events) {
      try {
        const marketsParam = PROP_MARKETS.join(',');
        const url = `https://api.the-odds-api.com/v4/sports/basketball_nba/events/${evt.id}/odds?apiKey=${apiKey}&regions=us&markets=${marketsParam}&oddsFormat=american&bookmakers=fanduel,draftkings,hardrockbet`;
        const res = await fetchWithTimeout(url);
        if (!res.ok) { await res.text(); continue; }
        const data = await res.json();

        for (const bk of data.bookmakers || []) {
          for (const mkt of bk.markets || []) {
            if (!PROP_MARKETS.includes(mkt.key)) continue;
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
        console.warn(`[LadderLock] Error fetching event ${evt.id}:`, e.message);
      }
    }

    console.log(`[LadderLock] Collected ${allLines.length} total over lines across ${PROP_MARKETS.length} markets`);

    // === STEP 3: For each unique player+prop combo, keep the best odds line ===
    const bestLineMap = new Map<string, PlayerLine>();
    for (const line of allLines) {
      const key = `${normalizeName(line.player_name)}|${line.prop_type}|${line.line}`;
      const existing = bestLineMap.get(key);
      if (!existing || line.over_odds > existing.over_odds) {
        bestLineMap.set(key, line);
      }
    }

    // Group by player+prop to find distinct lines
    const playerPropLines = new Map<string, PlayerLine[]>();
    for (const line of bestLineMap.values()) {
      const key = `${normalizeName(line.player_name)}|${line.prop_type}`;
      if (!playerPropLines.has(key)) playerPropLines.set(key, []);
      playerPropLines.get(key)!.push(line);
    }

    // === STEP 4: Fetch intelligence data ===
    const [sweetSpotRes, defenseRes, playerCacheRes] = await Promise.all([
      supabase
        .from('category_sweet_spots')
        .select('player_name, l10_avg, l10_median, l10_min, l10_max, l10_hit_rate, confidence_score, prop_type')
        .eq('is_active', true),
      supabase
        .from('team_defense_rankings')
        .select('team_abbreviation, team_name, opp_threes_rank, off_pace_rank')
        .eq('is_current', true),
      supabase
        .from('bdl_player_cache')
        .select('player_name, team_name')
        .not('team_name', 'is', null),
    ]);

    // Build sweet spot lookup: key = normalizedName|propType
    const sweetSpotMap = new Map<string, any>();
    for (const ss of sweetSpotRes.data || []) {
      const key = `${normalizeName(ss.player_name)}|${ss.prop_type}`;
      sweetSpotMap.set(key, ss);
    }

    // Defense lookup
    const defenseMap = new Map<string, any>();
    for (const d of defenseRes.data || []) {
      if (d.team_name) defenseMap.set(d.team_name.toLowerCase(), d);
      if (d.team_abbreviation) defenseMap.set(d.team_abbreviation.toLowerCase(), d);
    }

    // Player team lookup
    const playerTeamMap = new Map<string, string>();
    for (const p of playerCacheRes.data || []) {
      if (p.team_name) playerTeamMap.set(normalizeName(p.player_name), p.team_name);
    }

    // === STEP 5: Fetch L10 game logs for all candidate players (up to 50) ===
    const uniquePlayers = new Set<string>();
    for (const line of bestLineMap.values()) {
      uniquePlayers.add(line.player_name);
    }
    const playerList = Array.from(uniquePlayers).slice(0, 50);

    const gameLogPromises = playerList.map(async (name) => {
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

    // === STEP 6: Score every player+prop+line combination ===
    const candidates: LockCandidate[] = [];

    for (const [ppKey, lines] of playerPropLines) {
      const [normalizedPlayer, propType] = ppKey.split('|');
      const firstLine = lines[0];
      const logs = gameLogMap.get(normalizedPlayer) || [];

      // SAFETY GATE: Need at least 8 games (was 5)
      if (logs.length < 8) continue;

      const gameLogField = PROP_GAME_LOG_FIELD[propType];
      if (!gameLogField) continue;

      const values = logs.map((g: any) => g[gameLogField] ?? 0);

      // Try each distinct line for this player+prop — pick the SAFEST
      for (const lineObj of lines) {
        const hitCount = values.filter((v: number) => v > lineObj.line).length;
        const hitRate = hitCount / values.length;

        // SAFETY GATE 1: Must have at least 90% L10 hit rate (was 80%)
        if (hitRate < 0.9) continue;

        const avg = values.reduce((a: number, b: number) => a + b, 0) / values.length;
        const sorted = [...values].sort((a: number, b: number) => a - b);
        const median = sorted[Math.floor(sorted.length / 2)];
        const min = Math.min(...values);
        const max = Math.max(...values);

        // SAFETY GATE 2: Hard floor — L10 worst game MUST exceed the line
        if (min <= lineObj.line) continue;

        // SAFETY GATE 3: Median clearance — L10 median must beat line by at least 1.0
        if (median < lineObj.line + 1) continue;

        const floorMargin = min - lineObj.line;

        // Try sweet spot data for extra context
        let ssMatch: any = null;
        const ssTypes = PROP_SWEET_SPOT_TYPES[propType] || [];
        for (const st of ssTypes) {
          const ssKey = `${normalizedPlayer}|${st}`;
          if (sweetSpotMap.has(ssKey)) { ssMatch = sweetSpotMap.get(ssKey); break; }
        }

        // Resolve opponent
        const playerTeam = playerTeamMap.get(normalizedPlayer);
        let opponent = '';
        let playerTeamName = '';
        const homeLower = firstLine.home_team.toLowerCase();
        const awayLower = firstLine.away_team.toLowerCase();

        if (playerTeam) {
          const ptLower = playerTeam.toLowerCase();
          if (homeLower.includes(ptLower) || ptLower.includes(homeLower)) {
            opponent = firstLine.away_team; playerTeamName = firstLine.home_team;
          } else if (awayLower.includes(ptLower) || ptLower.includes(awayLower)) {
            opponent = firstLine.home_team; playerTeamName = firstLine.away_team;
          } else {
            const ptWords = ptLower.split(' ');
            if (ptWords.some((w: string) => homeLower.includes(w) && w.length > 3)) {
              opponent = firstLine.away_team; playerTeamName = firstLine.home_team;
            } else {
              opponent = firstLine.home_team; playerTeamName = firstLine.away_team;
            }
          }
        } else {
          opponent = firstLine.away_team; playerTeamName = firstLine.home_team;
        }

        const oppDef = defenseMap.get(opponent.toLowerCase());
        const oppDefRank = oppDef?.opp_threes_rank || 15;

        // === SAFETY SCORE: Prioritize safety above all ===
        const hitRateScore = hitRate * 50;                                          // 50% weight — hit rate is king
        const floorScore = Math.min((floorMargin / lineObj.line) * 50, 25);         // 25% weight — floor margin
        const edgeScore = Math.min(((avg - lineObj.line) / lineObj.line) * 30, 15); // 15% weight — edge over line
        const consistencyScore = (1 - (max - min) / (avg || 1)) * 10;              // 10% weight — low variance

        const safetyScore = hitRateScore + floorScore + edgeScore + consistencyScore;

        candidates.push({
          player_name: firstLine.player_name,
          prop_type: propType,
          prop_label: PROP_LABELS[propType] || propType,
          line: lineObj.line,
          over_odds: lineObj.over_odds,
          bookmaker: lineObj.bookmaker,
          game: firstLine.game,
          home_team: firstLine.home_team,
          away_team: firstLine.away_team,
          opponent,
          player_team: playerTeamName,
          l10_avg: Math.round(avg * 10) / 10,
          l10_min: min,
          l10_max: max,
          l10_median: median,
          l10_hit_rate: hitRate,
          l10_games: values.length,
          l10_hits: hitCount,
          opp_defense_rank: oppDefRank,
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

    console.log(`[LadderLock] ${candidates.length} eligible candidates after filtering (90%+ hit rate, floor > line, median +1)`);
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
