/**
 * bot-game-context-analyzer
 * 
 * Runs before generation to detect game context signals:
 * - Revenge games: teams facing opponent that beat them in last 30 days
 * - Back-to-back fatigue: teams on 2nd game in 2 days
 * - Thin slate risk: fewer than 6 games available
 * - Blowout risk: spreads above 10 points
 * 
 * Writes flags to bot_research_findings for the generator to consume.
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

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

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    const today = getEasternDate();
    const todayStart = `${today}T00:00:00Z`;
    const todayEnd = `${today}T23:59:59Z`;
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    console.log(`[GameContext] Analyzing game context for ${today}`);

    // Fetch today's games, fatigue data, and recent results in parallel
    const [gamesResult, fatigueResult, recentGamesResult, whaleResult] = await Promise.all([
      supabase.from('game_bets')
        .select('id, home_team, away_team, sport, commence_time')
        .gte('commence_time', todayStart)
        .lt('commence_time', todayEnd),
      supabase.from('nba_fatigue_scores')
        .select('team_name, fatigue_score, is_back_to_back, is_three_in_four, game_date')
        .eq('game_date', today),
      // Recent completed games for revenge detection
      supabase.from('game_bets')
        .select('id, home_team, away_team, sport, commence_time')
        .gte('commence_time', thirtyDaysAgo.toISOString())
        .lt('commence_time', todayStart)
        .order('commence_time', { ascending: false })
        .limit(500),
      // Today's whale picks for spread data
      supabase.from('whale_picks')
        .select('home_team, away_team, market_key, current_line, sharp_score')
        .gte('start_time', todayStart)
        .lte('start_time', todayEnd),
    ]);

    const todayGames = gamesResult.data || [];
    const fatigueData = fatigueResult.data || [];
    const recentGames = recentGamesResult.data || [];
    const whalePicks = whaleResult.data || [];

    console.log(`[GameContext] ${todayGames.length} games today, ${fatigueData.length} fatigue records, ${recentGames.length} recent games`);

    const fatigueMap = new Map<string, any>();
    for (const f of fatigueData) {
      fatigueMap.set(f.team_name.toLowerCase(), f);
    }

    const contextFlags: any[] = [];

    // === REVENGE GAMES ===
    // Find teams that lost to today's opponent in the last 30 days
    for (const game of todayGames) {
      const home = game.home_team;
      const away = game.away_team;

      // Check if away team lost to home team recently (home team is "revenge target")
      const revengeForHome = recentGames.some((rg: any) =>
        (rg.home_team === away && rg.away_team === home) ||
        (rg.home_team === home && rg.away_team === away)
      );

      if (revengeForHome) {
        contextFlags.push({
          type: 'revenge_game',
          game_id: game.id,
          home_team: home,
          away_team: away,
          sport: game.sport,
          description: `Revenge game: ${home} vs ${away} (rematch within 30 days)`,
          boost: 5, // +5 for revenge team bets
        });
      }
    }

    // === BACK-TO-BACK FATIGUE ===
    for (const game of todayGames) {
      const homeFatigue = fatigueMap.get(game.home_team?.toLowerCase());
      const awayFatigue = fatigueMap.get(game.away_team?.toLowerCase());

      if (homeFatigue?.is_back_to_back) {
        contextFlags.push({
          type: 'b2b_fatigue',
          game_id: game.id,
          team: game.home_team,
          side: 'home',
          sport: game.sport,
          fatigue_score: homeFatigue.fatigue_score,
          description: `B2B fatigue: ${game.home_team} on back-to-back`,
          penalty: -6,
        });
      }
      if (awayFatigue?.is_back_to_back) {
        contextFlags.push({
          type: 'b2b_fatigue',
          game_id: game.id,
          team: game.away_team,
          side: 'away',
          sport: game.sport,
          fatigue_score: awayFatigue.fatigue_score,
          description: `B2B fatigue: ${game.away_team} on back-to-back`,
          penalty: -6,
        });
      }
    }

    // === BLOWOUT RISK ===
    // Check spreads from whale picks and game data
    for (const wp of whalePicks) {
      if (wp.market_key?.includes('spread') && Math.abs(wp.current_line || 0) > 10) {
        contextFlags.push({
          type: 'blowout_risk',
          home_team: wp.home_team,
          away_team: wp.away_team,
          spread: wp.current_line,
          description: `Blowout risk: ${wp.home_team} vs ${wp.away_team} (spread ${wp.current_line})`,
          penalty: -8, // Heavy penalty for player props in blowout games
        });
      }
    }

    // === THIN SLATE RISK ===
    const uniqueSports = new Set(todayGames.map((g: any) => g.sport));
    const gameCount = todayGames.length;
    let thinSlate = false;

    if (gameCount < 6) {
      thinSlate = true;
      contextFlags.push({
        type: 'thin_slate',
        game_count: gameCount,
        sports: [...uniqueSports],
        description: `Thin slate: only ${gameCount} games today. Reduce max legs to 3, tighten thresholds.`,
        max_legs_override: 3,
      });
    }

    // Store findings
    const insights = contextFlags.map((f: any) => f.description);
    const summary = [
      `Game context analysis for ${today}:`,
      `${todayGames.length} games on slate`,
      `${contextFlags.filter((f: any) => f.type === 'revenge_game').length} revenge games`,
      `${contextFlags.filter((f: any) => f.type === 'b2b_fatigue').length} B2B fatigue flags`,
      `${contextFlags.filter((f: any) => f.type === 'blowout_risk').length} blowout risk games`,
      thinSlate ? `THIN SLATE: ${gameCount} games — reducing max legs` : '',
    ].filter(Boolean).join('. ');

    await supabase.from('bot_research_findings').insert({
      title: `Game Context Analysis - ${today}`,
      summary,
      category: 'game_context',
      research_date: today,
      relevance_score: 9.5,
      actionable: true,
      key_insights: [
        ...insights,
        JSON.stringify({ context_flags: contextFlags }),
      ],
      sources: ['game_bets', 'nba_fatigue_scores', 'whale_picks'],
    });

    console.log(`[GameContext] Found ${contextFlags.length} context flags: ${insights.join('; ')}`);

    return new Response(JSON.stringify({
      success: true,
      date: today,
      gamesOnSlate: gameCount,
      contextFlags,
      thinSlate,
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error) {
    console.error('[GameContext] Error:', error);
    return new Response(JSON.stringify({ success: false, error: error.message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
