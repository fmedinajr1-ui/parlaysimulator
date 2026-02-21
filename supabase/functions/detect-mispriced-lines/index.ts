import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// NBA prop-to-stat mapping
const NBA_PROP_TO_STAT: Record<string, string> = {
  'player_points': 'points',
  'player_rebounds': 'rebounds',
  'player_assists': 'assists',
  'player_threes': 'threes_made',
  'player_blocks': 'blocks',
  'player_steals': 'steals',
  'player_turnovers': 'turnovers',
  'player_points_rebounds_assists': 'pra',
  'player_points_rebounds': 'pr',
  'player_points_assists': 'pa',
  'player_rebounds_assists': 'ra',
};

// MLB prop-to-stat mapping
const MLB_PROP_TO_STAT: Record<string, string> = {
  'batter_hits': 'hits',
  'batter_rbis': 'rbis',
  'batter_runs_scored': 'runs',
  'batter_total_bases': 'total_bases',
  'batter_home_runs': 'home_runs',
  'batter_stolen_bases': 'stolen_bases',
  'pitcher_strikeouts': 'pitcher_strikeouts',
  'pitcher_outs': 'pitcher_outs',
};

// NBA combo stat calculators
function getNbaStatValue(log: any, statKey: string): number | null {
  switch (statKey) {
    case 'pra': return (log.points || 0) + (log.rebounds || 0) + (log.assists || 0);
    case 'pr': return (log.points || 0) + (log.rebounds || 0);
    case 'pa': return (log.points || 0) + (log.assists || 0);
    case 'ra': return (log.rebounds || 0) + (log.assists || 0);
    default: return log[statKey] ?? null;
  }
}

function getMlbStatValue(log: any, statKey: string): number | null {
  return log[statKey] ?? null;
}

function calcAvg(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

function calcShootingContext(logs: any[]): Record<string, number | null> {
  let fgm = 0, fga = 0, ftm = 0, fta = 0, tpm = 0, tpa = 0;
  for (const log of logs) {
    fgm += log.field_goals_made || 0;
    fga += log.field_goals_attempted || 0;
    ftm += log.free_throws_made || 0;
    fta += log.free_throws_attempted || 0;
    tpm += log.threes_made || 0;
    tpa += log.threes_attempted || 0;
  }
  return {
    fg_pct: fga > 0 ? Math.round((fgm / fga) * 1000) / 10 : null,
    ft_pct: fta > 0 ? Math.round((ftm / fta) * 1000) / 10 : null,
    three_pct: tpa > 0 ? Math.round((tpm / tpa) * 1000) / 10 : null,
    avg_fgm: logs.length > 0 ? Math.round((fgm / logs.length) * 10) / 10 : null,
    avg_fga: logs.length > 0 ? Math.round((fga / logs.length) * 10) / 10 : null,
    avg_ftm: logs.length > 0 ? Math.round((ftm / logs.length) * 10) / 10 : null,
    avg_fta: logs.length > 0 ? Math.round((fta / logs.length) * 10) / 10 : null,
    avg_3pm: logs.length > 0 ? Math.round((tpm / logs.length) * 10) / 10 : null,
    avg_3pa: logs.length > 0 ? Math.round((tpa / logs.length) * 10) / 10 : null,
    avg_oreb: logs.length > 0 ? Math.round(calcAvg(logs.map(l => l.offensive_rebounds || 0)) * 10) / 10 : null,
    avg_dreb: logs.length > 0 ? Math.round(calcAvg(logs.map(l => l.defensive_rebounds || 0)) * 10) / 10 : null,
  };
}

function calcBaseballContext(logs: any[]): Record<string, number | null> {
  let totalHits = 0, totalAB = 0, totalWalks = 0, totalTB = 0;
  let totalRBIs = 0, totalRuns = 0, totalHR = 0, totalSB = 0;
  for (const log of logs) {
    totalHits += log.hits || 0;
    totalAB += log.at_bats || 0;
    totalWalks += log.walks || 0;
    totalTB += log.total_bases || 0;
    totalRBIs += log.rbis || 0;
    totalRuns += log.runs || 0;
    totalHR += log.home_runs || 0;
    totalSB += log.stolen_bases || 0;
  }
  const avg = totalAB > 0 ? totalHits / totalAB : null;
  const obp = (totalAB + totalWalks) > 0 ? (totalHits + totalWalks) / (totalAB + totalWalks) : null;
  const slg = totalAB > 0 ? totalTB / totalAB : null;
  const ops = (obp !== null && slg !== null) ? obp + slg : null;
  const n = logs.length || 1;
  return {
    avg: avg !== null ? Math.round(avg * 1000) / 1000 : null,
    obp: obp !== null ? Math.round(obp * 1000) / 1000 : null,
    slg: slg !== null ? Math.round(slg * 1000) / 1000 : null,
    ops: ops !== null ? Math.round(ops * 1000) / 1000 : null,
    avg_hits: Math.round((totalHits / n) * 10) / 10,
    avg_rbis: Math.round((totalRBIs / n) * 10) / 10,
    avg_total_bases: Math.round((totalTB / n) * 10) / 10,
    avg_runs: Math.round((totalRuns / n) * 10) / 10,
    avg_hr: Math.round((totalHR / n) * 10) / 10,
    avg_sb: Math.round((totalSB / n) * 10) / 10,
  };
}

function getConfidenceTier(edgePct: number, gamesPlayed: number): string {
  const absEdge = Math.abs(edgePct);
  if (gamesPlayed < 5) return 'LOW';
  if (absEdge >= 30 && gamesPlayed >= 15) return 'ELITE';
  if (absEdge >= 20 && gamesPlayed >= 10) return 'HIGH';
  if (absEdge >= 15) return 'MEDIUM';
  return 'LOW';
}

// Prop type → defense stat category mapping
const PROP_TO_DEFENSE_CATEGORY: Record<string, string> = {
  'player_points': 'points',
  'player_rebounds': 'rebounds',
  'player_assists': 'assists',
  'player_threes': 'threes',
  'player_blocks': 'overall',
  'player_steals': 'overall',
  'player_turnovers': 'overall',
  'player_points_rebounds_assists': 'overall',
  'player_points_rebounds': 'overall',
  'player_points_assists': 'overall',
  'player_rebounds_assists': 'overall',
};

// Defense-adjusted multiplier based on opponent rank and signal direction
function getDefenseMultiplier(rank: number | null, signal: string): number {
  if (rank === null) return 1.0;
  const isOver = signal === 'OVER';
  if (rank <= 5)  return isOver ? 0.94 : 1.04;  // elite defense
  if (rank <= 10) return isOver ? 0.97 : 1.02;  // strong defense
  if (rank <= 20) return 1.0;                     // average
  if (rank <= 25) return isOver ? 1.02 : 0.98;  // soft defense
  return isOver ? 1.04 : 0.96;                    // weak defense (26-30)
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  const startTime = Date.now();
  const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
  const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const supabase = createClient(supabaseUrl, supabaseKey);

  try {
    const now = new Date();
    const formatter = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit'
    });
    const today = formatter.format(now);

    console.log(`[Mispriced] Starting analysis for ${today}`);

    const mispricedResults: any[] = [];
    const processedKeys = new Set<string>();

    // ==================== NBA ANALYSIS ====================
    const { data: nbaProps, error: nbaPropsError } = await supabase
      .from('unified_props')
      .select('player_name, prop_type, current_line, bookmaker, commence_time')
      .eq('sport', 'basketball_nba')
      .gt('commence_time', now.toISOString())
      .not('player_name', 'is', null)
      .not('current_line', 'is', null);

    if (nbaPropsError) throw new Error(`NBA props fetch error: ${nbaPropsError.message}`);

    console.log(`[Mispriced] Found ${nbaProps?.length || 0} active NBA props`);

    // ==================== LOAD DEFENSE DATA ====================
    // 1. Today's NBA schedule → team-to-opponent map
    const { data: todayGames } = await supabase
      .from('game_bets')
      .select('home_team, away_team')
      .eq('sport', 'basketball_nba')
      .gt('commence_time', now.toISOString());

    const teamToOpponent: Record<string, string> = {};
    for (const g of todayGames || []) {
      if (g.home_team && g.away_team) {
        teamToOpponent[g.home_team.toLowerCase()] = g.away_team;
        teamToOpponent[g.away_team.toLowerCase()] = g.home_team;
      }
    }

    // 2. Defense ranks by team + stat category
    const { data: defenseStats } = await supabase
      .from('nba_opponent_defense_stats')
      .select('team_name, stat_category, defense_rank');

    const defenseRankMap: Record<string, number> = {};
    for (const d of defenseStats || []) {
      defenseRankMap[`${d.team_name.toLowerCase()}_${d.stat_category}`] = d.defense_rank;
    }

    // 3. Player → team mapping from bdl_player_cache
    const { data: playerTeams } = await supabase
      .from('bdl_player_cache')
      .select('player_name, team_name')
      .not('team_name', 'is', null);

    const playerTeamMap: Record<string, string> = {};
    for (const p of playerTeams || []) {
      if (p.team_name) playerTeamMap[p.player_name] = p.team_name;
    }

    console.log(`[Mispriced] Defense data loaded: ${Object.keys(teamToOpponent).length / 2} games, ${defenseStats?.length || 0} defense entries, ${playerTeams?.length || 0} player-team mappings`);

    if (nbaProps && nbaProps.length > 0) {
      const uniqueNbaPlayers = [...new Set(nbaProps.map(p => p.player_name).filter(Boolean))];
      const nbaPlayerLogs: Record<string, any[]> = {};

      for (let i = 0; i < uniqueNbaPlayers.length; i += 20) {
        const batch = uniqueNbaPlayers.slice(i, i + 20);
        const { data: logs } = await supabase
          .from('nba_player_game_logs')
          .select('*')
          .in('player_name', batch)
          .order('game_date', { ascending: false })
          .limit(400);

        for (const log of logs || []) {
          if (!nbaPlayerLogs[log.player_name]) nbaPlayerLogs[log.player_name] = [];
          if (nbaPlayerLogs[log.player_name].length < 20) {
            nbaPlayerLogs[log.player_name].push(log);
          }
        }
      }

      for (const prop of nbaProps) {
        if (!prop.player_name || !prop.current_line || !prop.prop_type) continue;
        const statKey = NBA_PROP_TO_STAT[prop.prop_type];
        if (!statKey) continue;

        const dedupKey = `nba_${prop.player_name}_${prop.prop_type}`;
        if (processedKeys.has(dedupKey)) continue;
        processedKeys.add(dedupKey);

        const logs = nbaPlayerLogs[prop.player_name];
        if (!logs || logs.length < 3) continue;

        const l10Logs = logs.slice(0, Math.min(10, logs.length));
        const l20Logs = logs.slice(0, Math.min(20, logs.length));
        const l5Logs = logs.slice(0, Math.min(5, logs.length));

        const l10Values = l10Logs.map(l => getNbaStatValue(l, statKey)).filter((v): v is number => v !== null);
        const l20Values = l20Logs.map(l => getNbaStatValue(l, statKey)).filter((v): v is number => v !== null);
        const l5Values = l5Logs.map(l => getNbaStatValue(l, statKey)).filter((v): v is number => v !== null);

        if (l10Values.length < 3) continue;

        const avgL10 = calcAvg(l10Values);
        const avgL20 = calcAvg(l20Values);
        const avgL5 = calcAvg(l5Values);
        const line = Number(prop.current_line);
        if (line === 0) continue;

        // Determine raw signal direction first (needed for defense multiplier)
        const rawEdgePct = ((avgL10 - line) / line) * 100;
        const rawSignal = rawEdgePct > 0 ? 'OVER' : 'UNDER';

        // Look up opponent defense rank for this player + prop type
        const playerTeam = playerTeamMap[prop.player_name];
        const opponentTeam = playerTeam ? teamToOpponent[playerTeam.toLowerCase()] : null;
        const defCategory = PROP_TO_DEFENSE_CATEGORY[prop.prop_type] || 'overall';
        const opponentDefRank = opponentTeam
          ? (defenseRankMap[`${opponentTeam.toLowerCase()}_${defCategory}`] ?? null)
          : null;

        // Apply defense multiplier to projection
        const defMultiplier = getDefenseMultiplier(opponentDefRank, rawSignal);
        const adjustedAvg = avgL10 * defMultiplier;

        // Use defense-adjusted avg for edge calculation
        const edgePct = ((adjustedAvg - line) / line) * 100;
        const trendEdge = ((avgL5 - avgL20) / (avgL20 || 1)) * 100;
        if (Math.abs(edgePct) < 15) continue;

        const signal = edgePct > 0 ? 'OVER' : 'UNDER';
        const shootingContext = calcShootingContext(l20Logs);
        const confidenceTier = getConfidenceTier(edgePct, l10Values.length);

        if (opponentDefRank !== null) {
          console.log(`[Mispriced] ${prop.player_name} ${prop.prop_type}: raw=${Math.round(rawEdgePct)}% → adj=${Math.round(edgePct)}% (vs #${opponentDefRank} DEF, x${defMultiplier})`);
        }

        mispricedResults.push({
          player_name: prop.player_name,
          prop_type: prop.prop_type,
          book_line: line,
          player_avg_l10: Math.round(avgL10 * 100) / 100,
          player_avg_l20: Math.round(avgL20 * 100) / 100,
          edge_pct: Math.round(edgePct * 100) / 100,
          signal,
          shooting_context: {
            ...shootingContext,
            l5_avg: Math.round(avgL5 * 10) / 10,
            l10_avg: Math.round(avgL10 * 10) / 10,
            l20_avg: Math.round(avgL20 * 10) / 10,
            trend_pct: Math.round(trendEdge * 10) / 10,
            games_analyzed: l20Values.length,
            defense_multiplier: defMultiplier !== 1.0 ? defMultiplier : undefined,
          },
          confidence_tier: confidenceTier,
          analysis_date: today,
          sport: 'basketball_nba',
          defense_adjusted_avg: defMultiplier !== 1.0 ? Math.round(adjustedAvg * 100) / 100 : null,
          opponent_defense_rank: opponentDefRank,
        });
      }
    }

    console.log(`[Mispriced] NBA: ${mispricedResults.filter(r => r.sport === 'basketball_nba').length} mispriced`);

    // ==================== MLB ANALYSIS ====================
    const { data: mlbProps, error: mlbPropsError } = await supabase
      .from('unified_props')
      .select('player_name, prop_type, current_line, bookmaker, commence_time')
      .eq('sport', 'baseball_mlb')
      .gt('commence_time', now.toISOString())
      .not('player_name', 'is', null)
      .not('current_line', 'is', null);

    if (mlbPropsError) throw new Error(`MLB props fetch error: ${mlbPropsError.message}`);

    console.log(`[Mispriced] Found ${mlbProps?.length || 0} active MLB props`);

    if (mlbProps && mlbProps.length > 0) {
      const uniqueMlbPlayers = [...new Set(mlbProps.map(p => p.player_name).filter(Boolean))];
      const mlbPlayerLogs: Record<string, any[]> = {};

      // Fetch ALL available logs (full 2024 season) — no L20 cap for MLB
      for (let i = 0; i < uniqueMlbPlayers.length; i += 20) {
        const batch = uniqueMlbPlayers.slice(i, i + 20);
        const { data: logs } = await supabase
          .from('mlb_player_game_logs')
          .select('*')
          .in('player_name', batch)
          .order('game_date', { ascending: false })
          .limit(1000); // full season ~150 games max per player

        for (const log of logs || []) {
          if (!mlbPlayerLogs[log.player_name]) mlbPlayerLogs[log.player_name] = [];
          mlbPlayerLogs[log.player_name].push(log);
        }
      }

      for (const prop of mlbProps) {
        if (!prop.player_name || !prop.current_line || !prop.prop_type) continue;
        const statKey = MLB_PROP_TO_STAT[prop.prop_type];
        if (!statKey) continue;

        const dedupKey = `mlb_${prop.player_name}_${prop.prop_type}`;
        if (processedKeys.has(dedupKey)) continue;
        processedKeys.add(dedupKey);

        const allLogs = mlbPlayerLogs[prop.player_name];
        if (!allLogs || allLogs.length < 10) continue; // need decent sample for baseball

        const l20Logs = allLogs.slice(0, Math.min(20, allLogs.length));
        const seasonLogs = allLogs; // full 2024 season

        const seasonValues = seasonLogs.map(l => getMlbStatValue(l, statKey)).filter((v): v is number => v !== null);
        const l20Values = l20Logs.map(l => getMlbStatValue(l, statKey)).filter((v): v is number => v !== null);

        if (seasonValues.length < 10) continue;

        const avgSeason = calcAvg(seasonValues);
        const avgL20 = calcAvg(l20Values);
        const line = Number(prop.current_line);
        if (line === 0) continue;

        // Use season avg as primary edge for MLB (larger sample = more stable)
        const edgePct = ((avgSeason - line) / line) * 100;
        const trendEdge = ((avgL20 - avgSeason) / (avgSeason || 1)) * 100;
        if (Math.abs(edgePct) < 15) continue;

        const signal = edgePct > 0 ? 'OVER' : 'UNDER';
        const baseballContext = calcBaseballContext(seasonLogs);
        const confidenceTier = getConfidenceTier(edgePct, seasonValues.length);

        mispricedResults.push({
          player_name: prop.player_name,
          prop_type: prop.prop_type,
          book_line: line,
          player_avg_l10: Math.round(avgL20 * 100) / 100, // L20 for MLB (most recent from last year)
          player_avg_l20: Math.round(avgSeason * 100) / 100, // season avg stored in l20 field
          edge_pct: Math.round(edgePct * 100) / 100,
          signal,
          shooting_context: {
            ...baseballContext,
            l20_avg: Math.round(avgL20 * 10) / 10,
            season_avg: Math.round(avgSeason * 10) / 10,
            trend_pct: Math.round(trendEdge * 10) / 10,
            games_analyzed: seasonValues.length,
          },
          confidence_tier: confidenceTier,
          analysis_date: today,
          sport: 'baseball_mlb',
        });
      }
    }

    const nbaCount = mispricedResults.filter(r => r.sport === 'basketball_nba').length;
    const mlbCount = mispricedResults.filter(r => r.sport === 'baseball_mlb').length;
    console.log(`[Mispriced] MLB: ${mlbCount} mispriced | Total: ${mispricedResults.length}`);

    // ==================== PERSIST RESULTS ====================
    if (mispricedResults.length > 0) {
      // Delete today's results for both sports
      await supabase.from('mispriced_lines').delete().eq('analysis_date', today);

      const chunkSize = 50;
      let inserted = 0;
      for (let i = 0; i < mispricedResults.length; i += chunkSize) {
        const chunk = mispricedResults.slice(i, i + chunkSize);
        const { error } = await supabase
          .from('mispriced_lines')
          .upsert(chunk, { onConflict: 'player_name,prop_type,analysis_date,sport' });

        if (error) {
          console.error(`[Mispriced] Insert error:`, error.message);
        } else {
          inserted += chunk.length;
        }
      }
      console.log(`[Mispriced] Inserted ${inserted} mispriced lines`);

      // Trigger Telegram report
      try {
        const topByTier: Record<string, any[]> = { ELITE: [], HIGH: [], MEDIUM: [] };
        for (const r of mispricedResults) {
          if (topByTier[r.confidence_tier]) {
            topByTier[r.confidence_tier].push({
              player_name: r.player_name,
              prop_type: r.prop_type,
              book_line: r.book_line,
              player_avg: r.player_avg_l10,
              edge_pct: r.edge_pct,
              signal: r.signal,
              sport: r.sport,
            });
          }
        }
        // Sort each tier by abs edge desc
        for (const tier of Object.keys(topByTier)) {
          topByTier[tier].sort((a: any, b: any) => Math.abs(b.edge_pct) - Math.abs(a.edge_pct));
        }

        const overCount = mispricedResults.filter(r => r.signal === 'OVER').length;
        const underCount = mispricedResults.filter(r => r.signal === 'UNDER').length;

        await fetch(`${supabaseUrl}/functions/v1/bot-send-telegram`, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${supabaseKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            type: 'mispriced_lines_report',
            data: {
              nbaCount,
              mlbCount,
              overCount,
              underCount,
              totalCount: mispricedResults.length,
              topByTier,
            },
          }),
        });
        console.log(`[Mispriced] Telegram report triggered`);
      } catch (teleErr) {
        console.error(`[Mispriced] Telegram trigger failed:`, teleErr);
      }

      // Trigger high conviction analyzer for cross-engine overlaps
      try {
        await fetch(`${supabaseUrl}/functions/v1/high-conviction-analyzer`, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${supabaseKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({}),
        });
        console.log(`[Mispriced] High conviction analyzer triggered`);
      } catch (hcErr) {
        console.error(`[Mispriced] High conviction analyzer failed:`, hcErr);
      }
    }

    const duration = Date.now() - startTime;

    await supabase.from('cron_job_history').insert({
      job_name: 'detect-mispriced-lines',
      status: 'completed',
      started_at: new Date(startTime).toISOString(),
      completed_at: new Date().toISOString(),
      duration_ms: duration,
      result: {
        props_analyzed: processedKeys.size,
        mispriced_found: mispricedResults.length,
        nba: {
          count: nbaCount,
          by_tier: {
            ELITE: mispricedResults.filter(r => r.sport === 'basketball_nba' && r.confidence_tier === 'ELITE').length,
            HIGH: mispricedResults.filter(r => r.sport === 'basketball_nba' && r.confidence_tier === 'HIGH').length,
            MEDIUM: mispricedResults.filter(r => r.sport === 'basketball_nba' && r.confidence_tier === 'MEDIUM').length,
          },
        },
        mlb: {
          count: mlbCount,
          by_tier: {
            ELITE: mispricedResults.filter(r => r.sport === 'baseball_mlb' && r.confidence_tier === 'ELITE').length,
            HIGH: mispricedResults.filter(r => r.sport === 'baseball_mlb' && r.confidence_tier === 'HIGH').length,
            MEDIUM: mispricedResults.filter(r => r.sport === 'baseball_mlb' && r.confidence_tier === 'MEDIUM').length,
          },
        },
        by_signal: {
          OVER: mispricedResults.filter(r => r.signal === 'OVER').length,
          UNDER: mispricedResults.filter(r => r.signal === 'UNDER').length,
        },
      },
    });

    return new Response(JSON.stringify({
      success: true,
      duration_ms: duration,
      props_analyzed: processedKeys.size,
      mispriced_found: mispricedResults.length,
      nba_count: nbaCount,
      mlb_count: mlbCount,
      results: mispricedResults,
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error('[Mispriced] Error:', msg);
    return new Response(JSON.stringify({ success: false, error: msg }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
