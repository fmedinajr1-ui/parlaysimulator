/**
 * bot-review-and-optimize
 * 
 * Analyzes historical parlay win/loss patterns, identifies hot/cold templates,
 * stores optimization findings, then triggers generation with pattern-replay data.
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface ParlayLeg {
  player_name?: string;
  prop_type?: string;
  category?: string;
  side?: string;
  type?: string;
  bet_type?: string;
  sport?: string;
  home_team?: string;
  away_team?: string;
  outcome?: string;
}

interface ParlayRow {
  id: string;
  parlay_date: string;
  outcome: string;
  legs: ParlayLeg[] | string;
  leg_count: number;
  strategy_name: string;
  tier?: string;
  profit_loss?: number;
  combined_probability?: number;
}

interface PatternKey {
  legCount: number;
  betTypes: string;    // sorted, comma-joined
  sports: string;      // sorted, comma-joined
  tier: string;
}

interface PatternStats {
  key: PatternKey;
  wins: number;
  losses: number;
  total: number;
  winRate: number;
  avgProfit: number;
  totalProfit: number;
}

function getEasternDate(): string {
  const now = new Date();
  const eastern = new Date(now.toLocaleString('en-US', { timeZone: 'America/New_York' }));
  return eastern.toISOString().split('T')[0];
}

function extractPatternKey(parlay: ParlayRow): PatternKey {
  const legs: ParlayLeg[] = typeof parlay.legs === 'string' ? JSON.parse(parlay.legs) : parlay.legs;
  
  const betTypes = new Set<string>();
  const sports = new Set<string>();
  
  for (const leg of legs) {
    if (leg.bet_type) betTypes.add(leg.bet_type);
    else if (leg.prop_type) betTypes.add(leg.prop_type);
    if (leg.sport) sports.add(leg.sport);
  }
  
  return {
    legCount: parlay.leg_count || legs.length,
    betTypes: [...betTypes].sort().join(','),
    sports: [...sports].sort().join(','),
    tier: parlay.tier || 'unknown',
  };
}

function patternToString(key: PatternKey): string {
  return `${key.legCount}L|${key.betTypes}|${key.sports}|${key.tier}`;
}

function analyzeSideBias(parlays: ParlayRow[]): Record<string, { over: number; under: number; overWins: number; underWins: number }> {
  const sideStats: Record<string, { over: number; under: number; overWins: number; underWins: number }> = {};
  
  for (const parlay of parlays) {
    const legs: ParlayLeg[] = typeof parlay.legs === 'string' ? JSON.parse(parlay.legs) : parlay.legs;
    for (const leg of legs) {
      if (!leg.category || !leg.side) continue;
      if (!sideStats[leg.category]) {
        sideStats[leg.category] = { over: 0, under: 0, overWins: 0, underWins: 0 };
      }
      if (leg.side === 'over') {
        sideStats[leg.category].over++;
        if (leg.outcome === 'hit') sideStats[leg.category].overWins++;
      } else if (leg.side === 'under') {
        sideStats[leg.category].under++;
        if (leg.outcome === 'hit') sideStats[leg.category].underWins++;
      }
    }
  }
  return sideStats;
}

function detectColdPatterns(parlays: ParlayRow[]): string[] {
  const coldPatterns: string[] = [];
  
  // Detect: parlays where all legs are same bet_type OVER and all lost
  const overStackedLosses = parlays.filter(p => {
    if (p.outcome !== 'lost') return false;
    const legs: ParlayLeg[] = typeof p.legs === 'string' ? JSON.parse(p.legs) : p.legs;
    const allOverTotals = legs.every(l => l.side === 'over' && (l.bet_type === 'total' || l.prop_type?.includes('total')));
    return allOverTotals && legs.length >= 3;
  });
  
  if (overStackedLosses.length >= 2) {
    coldPatterns.push('3+ OVER totals stacked in same parlay (systematic loss pattern)');
  }
  
  // Detect: any bet_type with 0% win rate across 3+ parlays
  const betTypeResults = new Map<string, { wins: number; total: number }>();
  for (const p of parlays) {
    const legs: ParlayLeg[] = typeof p.legs === 'string' ? JSON.parse(p.legs) : p.legs;
    const types = [...new Set(legs.map(l => l.bet_type || l.prop_type).filter(Boolean))];
    for (const t of types) {
      if (!betTypeResults.has(t!)) betTypeResults.set(t!, { wins: 0, total: 0 });
      const stat = betTypeResults.get(t!)!;
      stat.total++;
      if (p.outcome === 'won') stat.wins++;
    }
  }
  
  for (const [type, stat] of betTypeResults) {
    if (stat.total >= 3 && stat.wins === 0) {
      coldPatterns.push(`${type}: 0% win rate across ${stat.total} parlays`);
    }
  }
  
  return coldPatterns;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseKey);
    
    const body = await req.json().catch(() => ({}));
    const targetDate = body.date || getEasternDate();

    console.log(`[Review] Analyzing historical patterns for optimized generation on ${targetDate}`);

    // 1. Query all settled parlays
    const { data: settledParlays, error: parlayError } = await supabase
      .from('bot_daily_parlays')
      .select('*')
      .in('outcome', ['won', 'lost'])
      .order('parlay_date', { ascending: false })
      .limit(500);

    if (parlayError) throw parlayError;
    
    const parlays = (settledParlays || []).map(p => ({
      ...p,
      legs: typeof p.legs === 'string' ? JSON.parse(p.legs) : p.legs,
    })) as ParlayRow[];

    console.log(`[Review] Analyzing ${parlays.length} settled parlays`);

    // 2. Group by pattern and calculate stats
    const patternMap = new Map<string, PatternStats>();
    
    for (const parlay of parlays) {
      const key = extractPatternKey(parlay);
      const keyStr = patternToString(key);
      
      if (!patternMap.has(keyStr)) {
        patternMap.set(keyStr, {
          key,
          wins: 0,
          losses: 0,
          total: 0,
          winRate: 0,
          avgProfit: 0,
          totalProfit: 0,
        });
      }
      
      const stats = patternMap.get(keyStr)!;
      stats.total++;
      if (parlay.outcome === 'won') {
        stats.wins++;
        stats.totalProfit += (parlay.profit_loss || 0);
      } else {
        stats.losses++;
        stats.totalProfit += (parlay.profit_loss || 0);
      }
      stats.winRate = stats.wins / stats.total;
      stats.avgProfit = stats.totalProfit / stats.total;
    }

    // 3. Identify hot and cold patterns
    const allPatterns = [...patternMap.values()];
    
    const hotPatterns = allPatterns
      .filter(p => p.total >= 3 && p.winRate >= 0.5)
      .sort((a, b) => b.winRate - a.winRate || b.totalProfit - a.totalProfit)
      .slice(0, 10);

    const coldPatterns = allPatterns
      .filter(p => p.total >= 3 && p.winRate < 0.3)
      .sort((a, b) => a.winRate - b.winRate)
      .slice(0, 10);

    // 4. Detect specific failure modes
    const failurePatterns = detectColdPatterns(parlays);
    
    // 5. Analyze side bias
    const sideBias = analyzeSideBias(parlays);

    // 6. Build winning_patterns payload for generation
    const winningPatterns = {
      boost_leg_counts: hotPatterns.map(p => p.key.legCount),
      boost_bet_types: [...new Set(hotPatterns.flatMap(p => p.key.betTypes.split(',')))],
      boost_sports: [...new Set(hotPatterns.flatMap(p => p.key.sports.split(',')))],
      boost_tiers: [...new Set(hotPatterns.map(p => p.key.tier))],
      penalize_bet_types: [...new Set(coldPatterns.flatMap(p => p.key.betTypes.split(',')))],
      max_same_side_per_parlay: 2, // Anti-stacking rule
      failure_modes: failurePatterns,
      side_bias: Object.entries(sideBias).map(([cat, stats]) => ({
        category: cat,
        preferred_side: stats.overWins / (stats.over || 1) > stats.underWins / (stats.under || 1) ? 'over' : 'under',
        over_rate: stats.over > 0 ? (stats.overWins / stats.over * 100).toFixed(0) + '%' : 'N/A',
        under_rate: stats.under > 0 ? (stats.underWins / stats.under * 100).toFixed(0) + '%' : 'N/A',
      })),
      hot_patterns: hotPatterns.map(p => ({
        description: `${p.key.legCount}-leg ${p.key.betTypes} (${p.key.sports}) [${p.key.tier}]`,
        winRate: (p.winRate * 100).toFixed(0) + '%',
        sample: p.total,
        avgProfit: '$' + p.avgProfit.toFixed(0),
      })),
      cold_patterns: coldPatterns.map(p => ({
        description: `${p.key.legCount}-leg ${p.key.betTypes} (${p.key.sports}) [${p.key.tier}]`,
        winRate: (p.winRate * 100).toFixed(0) + '%',
        sample: p.total,
      })),
    };

    // 7. Store optimization findings
    const summary = [
      `Analyzed ${parlays.length} historical parlays.`,
      `Found ${hotPatterns.length} hot patterns (≥50% WR) and ${coldPatterns.length} cold patterns (<30% WR).`,
      hotPatterns.length > 0 ? `Top pattern: ${hotPatterns[0].key.legCount}-leg ${hotPatterns[0].key.betTypes} at ${(hotPatterns[0].winRate * 100).toFixed(0)}% WR.` : '',
      failurePatterns.length > 0 ? `Failure modes detected: ${failurePatterns.join('; ')}` : 'No systemic failure modes detected.',
    ].filter(Boolean).join(' ');

    await supabase.from('bot_research_findings').insert({
      title: `Pattern Replay Optimization - ${targetDate}`,
      summary,
      category: 'optimization',
      research_date: targetDate,
      relevance_score: 9.0,
      actionable: true,
      action_taken: 'Applied to smart generation',
      key_insights: [
        ...hotPatterns.map(p => `HOT: ${p.key.legCount}-leg ${p.key.betTypes} (${p.key.tier}) = ${(p.winRate * 100).toFixed(0)}% WR over ${p.total} parlays`),
        ...coldPatterns.map(p => `COLD: ${p.key.legCount}-leg ${p.key.betTypes} (${p.key.tier}) = ${(p.winRate * 100).toFixed(0)}% WR over ${p.total} parlays`),
        ...failurePatterns.map(f => `AVOID: ${f}`),
      ],
      sources: ['bot_daily_parlays historical analysis'],
    });

    console.log(`[Review] Stored optimization findings. Gathering team intel & whale signals...`);

    // ============= TEAM RESEARCH INTELLIGENCE =============
    
    // 8a. Fetch today's game slate for team-level research
    const todayStart = `${targetDate}T00:00:00Z`;
    const todayEnd = `${targetDate}T23:59:59Z`;
    
    const [gameBetsResult, whalePicksResult, lineMovementResult, ncaabStatsResult, defenseResult, injuryResult] = await Promise.all([
      // Today's games
      supabase.from('game_bets').select('id, home_team, away_team, sport, commence_time')
        .gte('commence_time', todayStart).lt('commence_time', todayEnd),
      // Active whale picks (lowered threshold to 45)
      supabase.from('whale_picks').select('*')
        .eq('is_expired', false).gte('sharp_score', 45)
        .gte('start_time', todayStart).lte('start_time', todayEnd)
        .order('sharp_score', { ascending: false }).limit(30),
      // Recent line movements for reverse steam detection
      supabase.from('line_movement_history').select('event_id, market_key, opening_line, current_line, line_change, updated_at')
        .gte('updated_at', new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString())
        .order('updated_at', { ascending: false }).limit(100),
      // NCAAB team stats (ATS, scoring, tempo)
      supabase.from('ncaab_team_stats').select('team_name, conference, kenpom_rank, adj_offense, adj_defense, adj_tempo, home_record, away_record, ats_record, over_under_record'),
      // Defense rankings
      supabase.from('team_defense_rankings').select('team_abbreviation, team_name, overall_rank, points_allowed_rank, opp_rebounds_allowed_pg, opp_assists_allowed_pg, opp_rebounds_rank, opp_assists_rank, opp_points_rank, opp_threes_rank, off_points_rank, off_rebounds_rank, off_assists_rank, off_threes_rank, off_pace_rank').eq('is_current', true),
      // Active injury alerts
      supabase.from('lineup_alerts').select('player_name, team_name, status, sport, impact_level')
        .in('status', ['Out', 'Doubtful', 'Questionable'])
        .gte('created_at', new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString()),
    ]);

    const todayGames = gameBetsResult.data || [];
    const whalePicks = whalePicksResult.data || [];
    const lineMovements = lineMovementResult.data || [];
    const ncaabStats = ncaabStatsResult.data || [];
    const defenseRankings = defenseResult.data || [];
    const injuries = injuryResult.data || [];

    console.log(`[Review] Slate: ${todayGames.length} games, ${whalePicks.length} whale picks, ${lineMovements.length} line moves, ${injuries.length} injury alerts`);

    // 8b. Build team research intel
    const teamIntel: Record<string, any> = {};
    const ncaabMap = new Map(ncaabStats.map((t: any) => [t.team_name, t]));
    const defenseMap = new Map(defenseRankings.map((d: any) => [d.team_name, d]));

    for (const game of todayGames) {
      const homeStats = ncaabMap.get(game.home_team);
      const awayStats = ncaabMap.get(game.away_team);
      const homeDef = defenseMap.get(game.home_team);
      const awayDef = defenseMap.get(game.away_team);
      const gameInjuries = injuries.filter((i: any) => 
        i.team_name === game.home_team || i.team_name === game.away_team
      );

      teamIntel[game.id] = {
        home_team: game.home_team,
        away_team: game.away_team,
        sport: game.sport,
        home_stats: homeStats ? {
          kenpom_rank: homeStats.kenpom_rank,
          adj_offense: homeStats.adj_offense,
          adj_defense: homeStats.adj_defense,
          adj_tempo: homeStats.adj_tempo,
          ats_record: homeStats.ats_record,
          over_under_record: homeStats.over_under_record,
        } : null,
        away_stats: awayStats ? {
          kenpom_rank: awayStats.kenpom_rank,
          adj_offense: awayStats.adj_offense,
          adj_defense: awayStats.adj_defense,
          adj_tempo: awayStats.adj_tempo,
          ats_record: awayStats.ats_record,
          over_under_record: awayStats.over_under_record,
        } : null,
        home_defense_rank: homeDef?.overall_rank || null,
        away_defense_rank: awayDef?.overall_rank || null,
        home_defense_detail: homeDef ? {
          opp_points_rank: homeDef.opp_points_rank,
          opp_threes_rank: homeDef.opp_threes_rank,
          opp_rebounds_rank: homeDef.opp_rebounds_rank,
          opp_assists_rank: homeDef.opp_assists_rank,
        } : null,
        away_defense_detail: awayDef ? {
          opp_points_rank: awayDef.opp_points_rank,
          opp_threes_rank: awayDef.opp_threes_rank,
          opp_rebounds_rank: awayDef.opp_rebounds_rank,
          opp_assists_rank: awayDef.opp_assists_rank,
        } : null,
        home_offense_rank: homeDef ? {
          off_points_rank: homeDef.off_points_rank,
          off_rebounds_rank: homeDef.off_rebounds_rank,
          off_assists_rank: homeDef.off_assists_rank,
          off_threes_rank: homeDef.off_threes_rank,
          off_pace_rank: homeDef.off_pace_rank,
        } : null,
        away_offense_rank: awayDef ? {
          off_points_rank: awayDef.off_points_rank,
          off_rebounds_rank: awayDef.off_rebounds_rank,
          off_assists_rank: awayDef.off_assists_rank,
          off_threes_rank: awayDef.off_threes_rank,
          off_pace_rank: awayDef.off_pace_rank,
        } : null,
        key_injuries: gameInjuries.map((i: any) => ({
          player: i.player_name,
          team: i.team_name,
          status: i.status,
          impact: i.impact_level,
        })),
      };
    }

    // 8c. Reverse steam detection — find lines moving against public action
    const reverseSteamSignals: any[] = [];
    const significantMoves = lineMovements.filter((m: any) => Math.abs(m.line_change || 0) >= 1.5);
    
    for (const move of significantMoves) {
      // A significant move in the opposite direction of where public would bet
      // suggests sharp/whale money. Flag these as high-conviction signals.
      const direction = (move.line_change || 0) > 0 ? 'up' : 'down';
      reverseSteamSignals.push({
        event_id: move.event_id,
        market: move.market_key,
        opening: move.opening_line,
        current: move.current_line,
        shift: move.line_change,
        direction,
        signal: `Line moved ${direction} ${Math.abs(move.line_change).toFixed(1)} pts — possible reverse steam`,
      });
    }

    console.log(`[Review] Reverse steam signals: ${reverseSteamSignals.length}, Team intel for ${Object.keys(teamIntel).length} games`);

    // 8d. Build whale cross-reference with team research
    const whaleTeamCrossRef = whalePicks.map((wp: any) => {
      const matchingGame = todayGames.find((g: any) => 
        g.home_team === wp.home_team || g.away_team === wp.away_team ||
        g.home_team === wp.team_name || g.away_team === wp.team_name
      );
      const intel = matchingGame ? teamIntel[matchingGame.id] : null;
      return {
        pick: wp.player_name || wp.team_name || wp.description,
        sharp_score: wp.sharp_score,
        market: wp.market_key,
        team_intel: intel,
        has_team_backing: !!intel,
        conviction: wp.sharp_score >= 65 ? 'high' : wp.sharp_score >= 55 ? 'medium' : 'low',
      };
    });

    // Add team intel and whale data to winning patterns
    winningPatterns.team_intel = teamIntel;
    winningPatterns.whale_signals = whaleTeamCrossRef;
    winningPatterns.reverse_steam = reverseSteamSignals;
    winningPatterns.injury_blocklist = injuries
      .filter((i: any) => i.status === 'Out' || i.status === 'Doubtful')
      .map((i: any) => i.player_name);

    // Store team research finding
    const teamInsights = [
      `${todayGames.length} games on today's slate`,
      `${whalePicks.length} whale picks (sharp_score >= 45)`,
      `${reverseSteamSignals.length} reverse steam signals detected`,
      `${injuries.filter((i: any) => i.status === 'Out').length} players OUT, ${injuries.filter((i: any) => i.status === 'Doubtful').length} Doubtful`,
      ...whaleTeamCrossRef.filter((w: any) => w.conviction === 'high').map((w: any) => 
        `HIGH CONVICTION: ${w.pick} (SharpScore: ${w.sharp_score})`
      ),
      ...reverseSteamSignals.slice(0, 5).map((r: any) => r.signal),
    ];

    await supabase.from('bot_research_findings').insert({
      title: `Team Intel & Whale Cross-Ref - ${targetDate}`,
      summary: `Pre-generation research: ${todayGames.length} games, ${whalePicks.length} whale picks (threshold lowered to 45), ${reverseSteamSignals.length} reverse steam signals. ${injuries.filter((i: any) => i.status === 'Out').length} key injuries flagged.`,
      category: 'team_research',
      research_date: targetDate,
      relevance_score: 9.5,
      actionable: true,
      action_taken: 'Injected into smart generation',
      key_insights: teamInsights,
      sources: ['game_bets', 'whale_picks', 'line_movement_history', 'ncaab_team_stats', 'lineup_alerts'],
    });

    // Log activity
    await supabase.from('bot_activity_log').insert({
      event_type: 'review_and_optimize',
      message: `Smart review complete: ${parlays.length} historical parlays analyzed, ${hotPatterns.length} hot/${coldPatterns.length} cold patterns, ${whalePicks.length} whale picks, ${reverseSteamSignals.length} reverse steam signals. Triggering optimized generation.`,
      severity: 'info',
      metadata: {
        patterns: { hot: hotPatterns.length, cold: coldPatterns.length },
        whale_picks: whalePicks.length,
        reverse_steam: reverseSteamSignals.length,
        games_on_slate: todayGames.length,
        injuries_flagged: injuries.length,
      },
    });

    // 9. Call bot-generate-daily-parlays with enriched winning patterns
    const genResponse = await fetch(`${supabaseUrl}/functions/v1/bot-generate-daily-parlays`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${supabaseKey}`,
      },
      body: JSON.stringify({
        date: targetDate,
        winning_patterns: winningPatterns,
        source: 'smart_review',
      }),
    });

    const genResult = await genResponse.json();

    console.log(`[Review] Generation complete:`, genResult);

    return new Response(
      JSON.stringify({
        success: true,
        analysis: {
          totalAnalyzed: parlays.length,
          hotPatterns: hotPatterns.length,
          coldPatterns: coldPatterns.length,
          failureModes: failurePatterns,
          topPattern: hotPatterns[0] ? `${hotPatterns[0].key.legCount}-leg ${hotPatterns[0].key.betTypes} at ${(hotPatterns[0].winRate * 100).toFixed(0)}% WR` : 'none',
        },
        teamResearch: {
          gamesOnSlate: todayGames.length,
          whalePicks: whalePicks.length,
          highConvictionWhales: whaleTeamCrossRef.filter((w: any) => w.conviction === 'high').length,
          reverseSteamSignals: reverseSteamSignals.length,
          injuriesBlocklisted: winningPatterns.injury_blocklist.length,
        },
        generation: genResult,
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('[Review] Error:', error);
    return new Response(
      JSON.stringify({ success: false, error: error.message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
