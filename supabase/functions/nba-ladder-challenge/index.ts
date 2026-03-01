import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
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

interface PlayerLine {
  player_name: string;
  line: number;
  over_odds: number;
  bookmaker: string;
  game: string;
  home_team: string;
  away_team: string;
}

interface PlayerLadderCandidate {
  player_name: string;
  lines: PlayerLine[];
  game: string;
  home_team: string;
  away_team: string;
  opponent: string;
  // Sweet spot data
  l10_avg: number;
  l10_median: number;
  l10_min: number;
  l10_max: number;
  l10_hit_rate: number;
  // Defense data
  opp_threes_rank: number;
  // Pace data
  off_pace_rank: number;
  // Ceiling analysis
  ceiling_games: number; // games with 4+ threes in L10
  // Scoring
  composite_score: number;
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
    console.log(`[LadderChallenge] Starting scan for ${today}`);

    // === DEDUP CHECK: Skip if we already have a ladder for today ===
    const { data: existingLadders } = await supabase
      .from('bot_daily_parlays')
      .select('id')
      .eq('parlay_date', today)
      .eq('strategy_name', 'ladder_challenge')
      .neq('outcome', 'void');

    if (existingLadders && existingLadders.length > 0) {
      console.log(`[LadderChallenge] Already have ${existingLadders.length} ladder(s) for today, skipping`);
      return new Response(JSON.stringify({ success: true, skipped: true, reason: 'already_exists' }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // === STEP 1: Fetch NBA 3PT props from The Odds API ===
    const eventsUrl = `https://api.the-odds-api.com/v4/sports/basketball_nba/events?apiKey=${apiKey}`;
    const eventsRes = await fetchWithTimeout(eventsUrl);
    if (!eventsRes.ok) throw new Error(`Events API returned ${eventsRes.status}`);
    const events: any[] = await eventsRes.json();
    console.log(`[LadderChallenge] Found ${events.length} NBA events`);

    if (events.length === 0) {
      return new Response(JSON.stringify({ success: false, error: 'No NBA events today' }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Fetch player_threes props for each event
    const allLines: PlayerLine[] = [];
    for (const evt of events) {
      try {
        const url = `https://api.the-odds-api.com/v4/sports/basketball_nba/events/${evt.id}/odds?apiKey=${apiKey}&regions=us&markets=player_threes&oddsFormat=american&bookmakers=fanduel,draftkings,hardrockbet`;
        const res = await fetchWithTimeout(url);
        if (!res.ok) { await res.text(); continue; }
        const data = await res.json();

        for (const bk of data.bookmakers || []) {
          for (const mkt of bk.markets || []) {
            if (mkt.key !== 'player_threes') continue;
            for (const outcome of mkt.outcomes || []) {
              if (outcome.name === 'Over') {
                allLines.push({
                  player_name: outcome.description,
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
        console.warn(`[LadderChallenge] Error fetching event ${evt.id}:`, e.message);
      }
    }

    console.log(`[LadderChallenge] Collected ${allLines.length} 3PT over lines`);

    // === STEP 2: Group lines by player ===
    const playerLinesMap = new Map<string, PlayerLine[]>();
    for (const line of allLines) {
      const key = normalizeName(line.player_name);
      if (!playerLinesMap.has(key)) playerLinesMap.set(key, []);
      playerLinesMap.get(key)!.push(line);
    }

    // Deduplicate lines per player: keep best odds per line value
    const playerBestLines = new Map<string, PlayerLine[]>();
    for (const [key, lines] of playerLinesMap) {
      const byLine = new Map<number, PlayerLine>();
      for (const l of lines) {
        const existing = byLine.get(l.line);
        if (!existing || l.over_odds > existing.over_odds) {
          byLine.set(l.line, l);
        }
      }
      const sorted = Array.from(byLine.values()).sort((a, b) => a.line - b.line);
      // Only keep players with 2+ distinct lines (we need at least a 2-rung ladder, ideally 3)
      if (sorted.length >= 2) {
        playerBestLines.set(key, sorted);
      }
    }

    console.log(`[LadderChallenge] ${playerBestLines.size} players with 2+ distinct 3PT lines`);

    if (playerBestLines.size === 0) {
      return new Response(JSON.stringify({ success: false, error: 'No players with sufficient line depth' }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // === STEP 3: Fetch intelligence data ===
    const playerNames = Array.from(playerBestLines.values()).map(lines => lines[0].player_name);

    const [sweetSpotRes, defenseRes, paceRes] = await Promise.all([
      supabase
        .from('category_sweet_spots')
        .select('player_name, l10_avg, l10_median, l10_min, l10_max, l10_hit_rate, confidence_score, prop_type')
        .eq('prop_type', 'player_threes')
        .eq('is_active', true),
      supabase
        .from('team_defense_rankings')
        .select('team_abbreviation, team_name, opp_threes_rank, off_pace_rank')
        .eq('is_current', true),
      supabase
        .from('nba_team_pace_projections')
        .select('team_name, pace_rating, pace_rank'),
    ]);

    // Build sweet spot lookup
    const sweetSpotMap = new Map<string, any>();
    for (const ss of sweetSpotRes.data || []) {
      sweetSpotMap.set(normalizeName(ss.player_name), ss);
    }

    // Build defense lookup by team name (full names from events)
    const defenseMap = new Map<string, any>();
    for (const d of defenseRes.data || []) {
      if (d.team_name) defenseMap.set(d.team_name.toLowerCase(), d);
      if (d.team_abbreviation) defenseMap.set(d.team_abbreviation.toLowerCase(), d);
    }

    // Build pace lookup
    const paceMap = new Map<string, any>();
    for (const p of paceRes.data || []) {
      if (p.team_name) paceMap.set(p.team_name.toLowerCase(), p);
    }

    // === STEP 4: Fetch L10 game logs for ceiling analysis ===
    // Get threes_made from last 10 games for each candidate player
    const gameLogPromises = playerNames.slice(0, 30).map(async (name) => {
      const { data } = await supabase
        .from('nba_player_game_logs')
        .select('player_name, threes_made, game_date')
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

    // === STEP 5: Score each player ===
    const candidates: PlayerLadderCandidate[] = [];

    for (const [key, lines] of playerBestLines) {
      const ss = sweetSpotMap.get(key);
      if (!ss || !ss.l10_avg) continue;

      const firstLine = lines[0];
      
      // Determine opponent team
      // The game string is "Away @ Home" — find which team the player is NOT on
      const opponent = firstLine.game; // We'll match defense by both teams
      const homeTeamLower = firstLine.home_team.toLowerCase();
      const awayTeamLower = firstLine.away_team.toLowerCase();

      // Find opponent defense rank — we need to figure out which team the player is on
      // Try matching player to sweet_spots team or just check both teams
      const homeDef = defenseMap.get(homeTeamLower);
      const awayDef = defenseMap.get(awayTeamLower);

      // Use the worse 3PT defense (higher rank = worse) as the opponent
      // This is a simplification — ideally we'd know the player's team
      let oppThreesRank = 15; // default middle
      let oppTeamName = '';
      let offPaceRank = 15;

      // Try to determine player's team from game logs or sweet spots
      // For now, use the team with WORSE 3PT defense as the presumed opponent
      if (homeDef && awayDef) {
        if ((homeDef.opp_threes_rank || 0) > (awayDef.opp_threes_rank || 0)) {
          oppThreesRank = homeDef.opp_threes_rank || 15;
          oppTeamName = firstLine.home_team;
          offPaceRank = awayDef.off_pace_rank || 15;
        } else {
          oppThreesRank = awayDef.opp_threes_rank || 15;
          oppTeamName = firstLine.away_team;
          offPaceRank = homeDef.off_pace_rank || 15;
        }
      } else if (homeDef) {
        oppThreesRank = homeDef.opp_threes_rank || 15;
        oppTeamName = firstLine.home_team;
      } else if (awayDef) {
        oppThreesRank = awayDef.opp_threes_rank || 15;
        oppTeamName = firstLine.away_team;
      }

      // Filter: no ladders against top-15 3PT defense
      if (oppThreesRank < 15) continue;

      // Determine middle rung line
      const middleIdx = Math.min(1, lines.length - 1);
      const middleLine = lines[middleIdx].line;

      // Safety check: L10 avg must be >= middle rung
      if (ss.l10_avg < middleLine) continue;

      // Ceiling analysis from game logs
      const logs = gameLogMap.get(key) || [];
      const ceilingGames = logs.filter((g: any) => (g.threes_made || 0) >= 4).length;

      // Calculate L10 hit rate at middle rung from game logs
      const middleHits = logs.filter((g: any) => (g.threes_made || 0) > middleLine).length;
      const middleHitRate = logs.length > 0 ? middleHits / logs.length : 0;

      // === WEIGHTED COMPOSITE SCORE ===
      const l10AvgDelta = (ss.l10_avg - lines[0].line); // How far above lowest line
      const l10Floor = ss.l10_min || 0;
      
      // Normalize each component to 0-10 scale
      const avgScore = Math.min(l10AvgDelta * 2, 10); // 5 above line = 10
      const floorScore = Math.min(l10Floor * 2.5, 10); // floor of 4 = 10
      const defScore = Math.min((oppThreesRank - 14) * 0.625, 10); // rank 30 = 10
      const paceScore = Math.min((30 - (offPaceRank || 15)) * 0.5, 10); // rank 1 = ~15 but capped
      const hitRateScore = middleHitRate * 10; // 100% = 10
      const ceilingScore = Math.min(ceilingGames * 2.5, 10); // 4 ceiling games = 10

      const compositeScore =
        avgScore * 0.25 +
        floorScore * 0.15 +
        defScore * 0.20 +
        paceScore * 0.10 +
        hitRateScore * 0.15 +
        ceilingScore * 0.15;

      candidates.push({
        player_name: firstLine.player_name,
        lines,
        game: firstLine.game,
        home_team: firstLine.home_team,
        away_team: firstLine.away_team,
        opponent: oppTeamName,
        l10_avg: ss.l10_avg,
        l10_median: ss.l10_median || 0,
        l10_min: ss.l10_min || 0,
        l10_max: ss.l10_max || 0,
        l10_hit_rate: ss.l10_hit_rate || 0,
        opp_threes_rank: oppThreesRank,
        off_pace_rank: offPaceRank,
        ceiling_games: ceilingGames,
        composite_score: compositeScore,
      });
    }

    // Sort by composite score descending
    candidates.sort((a, b) => b.composite_score - a.composite_score);

    console.log(`[LadderChallenge] ${candidates.length} eligible candidates after filtering`);
    if (candidates.length > 0) {
      console.log(`[LadderChallenge] Top 5:`, candidates.slice(0, 5).map(c => 
        `${c.player_name} (score: ${c.composite_score.toFixed(2)}, L10avg: ${c.l10_avg}, opp3rank: ${c.opp_threes_rank})`
      ));
    }

    if (candidates.length === 0) {
      return new Response(JSON.stringify({ success: false, error: 'No eligible ladder candidates found' }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // === STEP 6: Build the 3-rung ladder for #1 pick ===
    const pick = candidates[0];
    const ladderLines = pick.lines.slice(0, 3); // Take up to 3 rungs

    // Calculate hit rates per rung from game logs
    const logs = gameLogMap.get(normalizeName(pick.player_name)) || [];
    const rungHitRates = ladderLines.map(l => {
      const hits = logs.filter((g: any) => (g.threes_made || 0) > l.line).length;
      return { hits, total: logs.length };
    });

    // Build legs for bot_daily_parlays
    const legs = ladderLines.map((l, i) => ({
      player_name: pick.player_name,
      prop_type: 'player_threes',
      line: l.line,
      side: 'OVER',
      odds: l.over_odds,
      bookmaker: l.bookmaker,
      rung: i + 1,
      rung_label: i === 0 ? 'Safety' : i === 1 ? 'Value' : 'Boom',
      l10_hit_rate: rungHitRates[i] ? `${rungHitRates[i].hits}/${rungHitRates[i].total}` : 'N/A',
    }));

    // Calculate combined probability
    const combinedProb = legs.reduce((acc, l) => {
      const imp = l.odds >= 100 ? 100 / (l.odds + 100) : Math.abs(l.odds) / (Math.abs(l.odds) + 100);
      return acc * imp;
    }, 1);

    const combinedDecimalOdds = legs.reduce((acc, l) => acc * americanToDecimal(l.odds), 1);

    // Matchup grade
    let matchupGrade = 'NEUTRAL';
    if (pick.opp_threes_rank >= 25) matchupGrade = 'ELITE';
    else if (pick.opp_threes_rank >= 20) matchupGrade = 'GOOD';
    else matchupGrade = 'FAIR';

    const rationale = `Ladder Challenge: ${pick.player_name} 3PT OVER vs ${pick.opponent} (Rank ${pick.opp_threes_rank} 3PT D). L10 Avg: ${pick.l10_avg}, Floor: ${pick.l10_min}, Ceiling: ${pick.l10_max}. Composite Score: ${pick.composite_score.toFixed(2)}. Matchup: ${matchupGrade}.`;

    // === STEP 7: Save to bot_daily_parlays ===
    const { error: insertError } = await supabase
      .from('bot_daily_parlays')
      .insert({
        parlay_date: today,
        strategy_name: 'ladder_challenge',
        tier: 'execution',
        legs: legs,
        leg_count: legs.length,
        combined_probability: combinedProb,
        expected_odds: combinedDecimalOdds,
        selection_rationale: rationale,
        is_simulated: false,
      });

    if (insertError) {
      console.error(`[LadderChallenge] Insert error:`, insertError);
      throw new Error(`Failed to save ladder: ${insertError.message}`);
    }

    console.log(`[LadderChallenge] Saved ladder for ${pick.player_name}`);

    // === STEP 8: Send Telegram notification ===
    const rungsText = legs.map((l, i) => {
      const oddsStr = l.odds > 0 ? `+${l.odds}` : `${l.odds}`;
      const hr = rungHitRates[i];
      return `Rung ${i + 1}: Over ${l.line} (${oddsStr}) — L10: ${hr.hits}/${hr.total}`;
    }).join('\n');

    const telegramMessage = `🪜 LADDER CHALLENGE 🪜\n${pick.player_name} | 3PT OVER\nvs ${pick.opponent} (Rank ${pick.opp_threes_rank} 3PT Defense)\n\n${rungsText}\n\nL10 Avg: ${pick.l10_avg} | Floor: ${pick.l10_min} | Ceiling: ${pick.l10_max}\nMatchup: ${matchupGrade} ${matchupGrade === 'ELITE' ? '🔥' : matchupGrade === 'GOOD' ? '✅' : '⚠️'}\nScore: ${pick.composite_score.toFixed(2)}`;

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
            player: pick.player_name,
            opponent: pick.opponent,
            legs,
            composite_score: pick.composite_score,
            matchup_grade: matchupGrade,
          },
        }),
      });
      console.log(`[LadderChallenge] Telegram notification sent`);
    } catch (e) {
      console.warn(`[LadderChallenge] Telegram send failed:`, e.message);
    }

    return new Response(JSON.stringify({
      success: true,
      player: pick.player_name,
      opponent: pick.opponent,
      composite_score: pick.composite_score,
      matchup_grade: matchupGrade,
      ladder: legs,
      l10: { avg: pick.l10_avg, min: pick.l10_min, max: pick.l10_max, median: pick.l10_median },
      runners_up: candidates.slice(1, 4).map(c => ({
        player: c.player_name, score: c.composite_score.toFixed(2), l10_avg: c.l10_avg,
      })),
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error) {
    console.error(`[LadderChallenge] Fatal error:`, error);
    return new Response(JSON.stringify({ success: false, error: error.message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});

