import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
    const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    let body: { sport?: string; playerName?: string } = {};
    try {
      const text = await req.text();
      if (text?.trim()) body = JSON.parse(text);
    } catch { /* no body */ }

    const sport = body.sport || 'NBA';
    console.log(`[line-projection-engine] Running full pipeline for ${sport}...`);

    // ═══════════════════════════════════════════════
    // PHASE 1: Fetch all data sources in parallel
    // ═══════════════════════════════════════════════

    const playerFilter = body.playerName 
      ? (q: any) => q.ilike('player_name', `%${body.playerName}%`)
      : (q: any) => q;

    const [
      { data: gameLogs },
      { data: matchups },
      { data: currentProps },
      { data: lineMovements },
    ] = await Promise.all([
      // L20 game logs per player
      supabase.from('nba_player_game_logs')
        .select('player_name, game_date, opponent, points, rebounds, assists, threes_made, blocks, steals, minutes_played, is_home, field_goals_made, field_goals_attempted, free_throws_made, free_throws_attempted')
        .order('game_date', { ascending: false })
        .limit(5000),
      // Matchup history
      supabase.from('matchup_history')
        .select('player_name, opponent, prop_type, games_played, avg_stat, max_stat, min_stat, hit_rate_over, hit_rate_under, last_game_stat')
        .gte('games_played', 2),
      // Current FanDuel lines
      supabase.from('unified_props')
        .select('player_name, prop_type, current_line, over_price, under_price, event_id, game_description'),
      // Recent line movements for drift prediction
      supabase.from('line_movements')
        .select('player_name, market_type, old_point, new_point, point_change, detected_at, outcome_name')
        .not('player_name', 'is', null)
        .order('detected_at', { ascending: false })
        .limit(3000),
    ]);

    console.log(`[line-projection-engine] Data: ${gameLogs?.length || 0} logs, ${matchups?.length || 0} matchups, ${currentProps?.length || 0} props, ${lineMovements?.length || 0} movements`);

    // ═══════════════════════════════════════════════
    // PHASE 2: PLAYER PROJECTION MODEL
    // Build our own projected stat lines
    // ═══════════════════════════════════════════════

    // Group game logs by player
    const playerLogs: Record<string, any[]> = {};
    gameLogs?.forEach(log => {
      if (!playerLogs[log.player_name]) playerLogs[log.player_name] = [];
      playerLogs[log.player_name].push(log);
    });

    // Sort each player's logs by date desc
    Object.values(playerLogs).forEach(logs => {
      logs.sort((a, b) => new Date(b.game_date).getTime() - new Date(a.game_date).getTime());
    });

    // Build matchup lookup
    const matchupLookup: Record<string, any> = {};
    matchups?.forEach(m => {
      const key = `${m.player_name}|${m.opponent}|${m.prop_type}`;
      matchupLookup[key] = m;
    });

    // Prop type to stat field mapping
    const propToStat: Record<string, (log: any) => number> = {
      'points': (l) => Number(l.points) || 0,
      'player_points': (l) => Number(l.points) || 0,
      'rebounds': (l) => (Number(l.rebounds) || 0),
      'player_rebounds': (l) => (Number(l.rebounds) || 0),
      'assists': (l) => Number(l.assists) || 0,
      'player_assists': (l) => Number(l.assists) || 0,
      'threes': (l) => Number(l.threes_made) || 0,
      'player_threes': (l) => Number(l.threes_made) || 0,
      'blocks': (l) => Number(l.blocks) || 0,
      'player_blocks': (l) => Number(l.blocks) || 0,
      'steals': (l) => Number(l.steals) || 0,
      'player_steals': (l) => Number(l.steals) || 0,
      'pts+reb+ast': (l) => (Number(l.points) || 0) + (Number(l.rebounds) || 0) + (Number(l.assists) || 0),
      'player_points_rebounds_assists': (l) => (Number(l.points) || 0) + (Number(l.rebounds) || 0) + (Number(l.assists) || 0),
      'pts+reb': (l) => (Number(l.points) || 0) + (Number(l.rebounds) || 0),
      'pts+ast': (l) => (Number(l.points) || 0) + (Number(l.assists) || 0),
      'reb+ast': (l) => (Number(l.rebounds) || 0) + (Number(l.assists) || 0),
    };

    function getStatExtractor(propType: string): ((log: any) => number) | null {
      const normalized = propType.toLowerCase().replace(/\s+/g, '_');
      return propToStat[normalized] || null;
    }

    // Weighted average: recent games matter more
    function weightedAvg(values: number[]): number {
      if (!values.length) return 0;
      // Recency weights: [1.0, 0.95, 0.90, 0.85, ...]
      let weightSum = 0;
      let valSum = 0;
      values.forEach((v, i) => {
        const w = Math.pow(0.95, i); // 5% decay per game
        valSum += v * w;
        weightSum += w;
      });
      return weightSum > 0 ? valSum / weightSum : 0;
    }

    function median(values: number[]): number {
      if (!values.length) return 0;
      const sorted = [...values].sort((a, b) => a - b);
      const mid = Math.floor(sorted.length / 2);
      return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
    }

    // Floor = minimum value in last N games
    function floor(values: number[]): number {
      return values.length ? Math.min(...values) : 0;
    }

    // ═══════════════════════════════════════════════
    // PHASE 3: LINE MOVEMENT PREDICTOR
    // Use historical drift patterns to predict settle
    // ═══════════════════════════════════════════════

    // Group movements by player+market
    const playerMovements: Record<string, { points: number[]; directions: string[] }> = {};
    lineMovements?.forEach(lm => {
      if (!lm.player_name || !lm.point_change) return;
      const key = `${lm.player_name}|${lm.market_type || 'unknown'}`;
      if (!playerMovements[key]) playerMovements[key] = { points: [], directions: [] };
      playerMovements[key].points.push(Number(lm.new_point) || 0);
      playerMovements[key].directions.push(Number(lm.point_change) > 0 ? 'up' : 'down');
    });

    function predictLineDrift(playerName: string, propType: string, currentLine: number): { direction: string; predictedSettle: number; confidence: number } {
      const key = `${playerName}|${propType}`;
      const data = playerMovements[key];
      
      if (!data || data.points.length < 3) {
        return { direction: 'stable', predictedSettle: currentLine, confidence: 0.3 };
      }

      const upCount = data.directions.filter(d => d === 'up').length;
      const downCount = data.directions.filter(d => d === 'down').length;
      const total = data.directions.length;
      
      const avgDrift = data.points.length > 1 
        ? (data.points[0] - data.points[data.points.length - 1]) / data.points.length
        : 0;

      let direction = 'stable';
      let predictedSettle = currentLine;
      
      if (upCount / total > 0.6) {
        direction = 'up';
        predictedSettle = currentLine + Math.abs(avgDrift) * 0.5;
      } else if (downCount / total > 0.6) {
        direction = 'down';
        predictedSettle = currentLine - Math.abs(avgDrift) * 0.5;
      }

      const consistency = Math.max(upCount, downCount) / total;
      
      return { 
        direction, 
        predictedSettle: Math.round(predictedSettle * 10) / 10,
        confidence: Math.min(consistency, 0.9)
      };
    }

    // ═══════════════════════════════════════════════
    // PHASE 4: SNAPBACK DETECTOR
    // Find lines where FD overreacted to recent game
    // ═══════════════════════════════════════════════

    function detectSnapback(l3Avg: number, l10Avg: number, l20Avg: number, fdLine: number): { isSnapback: boolean; reason: string; regressionTarget: number } {
      // If L3 deviates significantly from L10/L20, the line may be set reactively
      const l3VsL10Deviation = ((l3Avg - l10Avg) / Math.max(l10Avg, 1)) * 100;
      const l3VsL20Deviation = ((l3Avg - l20Avg) / Math.max(l20Avg, 1)) * 100;
      
      // Regression target: weighted blend of L10 (60%) and L20 (40%)
      const regressionTarget = l10Avg * 0.6 + l20Avg * 0.4;
      
      // FD line vs regression target
      const lineVsRegression = ((fdLine - regressionTarget) / Math.max(regressionTarget, 1)) * 100;

      // SNAPBACK: L3 tanked (>15% below L10) AND FD followed it down
      if (l3VsL10Deviation < -15 && lineVsRegression < -8) {
        return {
          isSnapback: true,
          reason: `L3 dropped ${Math.abs(l3VsL10Deviation).toFixed(0)}% below L10 avg — FD line set ${Math.abs(lineVsRegression).toFixed(0)}% below regression target. OVER likely.`,
          regressionTarget: Math.round(regressionTarget * 10) / 10,
        };
      }

      // SNAPBACK: L3 spiked (>15% above L10) AND FD chased it up  
      if (l3VsL10Deviation > 15 && lineVsRegression > 8) {
        return {
          isSnapback: true,
          reason: `L3 spiked ${l3VsL10Deviation.toFixed(0)}% above L10 avg — FD line set ${lineVsRegression.toFixed(0)}% above regression target. UNDER likely.`,
          regressionTarget: Math.round(regressionTarget * 10) / 10,
        };
      }

      return { isSnapback: false, reason: '', regressionTarget: Math.round(regressionTarget * 10) / 10 };
    }

    // ═══════════════════════════════════════════════
    // PHASE 5: RUN FULL PIPELINE ON CURRENT PROPS
    // ═══════════════════════════════════════════════

    const projections: any[] = [];

    for (const prop of (currentProps || [])) {
      const { player_name, prop_type, current_line, event_id } = prop;
      if (!player_name || !prop_type || !current_line) continue;

      const logs = playerLogs[player_name];
      if (!logs || logs.length < 5) continue;

      const extractor = getStatExtractor(prop_type);
      if (!extractor) continue;

      // Extract stat values
      const allValues = logs.map(extractor);
      const l3Values = allValues.slice(0, 3);
      const l5Values = allValues.slice(0, 5);
      const l10Values = allValues.slice(0, 10);
      const l20Values = allValues.slice(0, 20);

      const l3Avg = l3Values.reduce((a, b) => a + b, 0) / l3Values.length;
      const l5Avg = l5Values.reduce((a, b) => a + b, 0) / l5Values.length;
      const l10Avg = l10Values.reduce((a, b) => a + b, 0) / l10Values.length;
      const l20Avg = l20Values.length > 0 ? l20Values.reduce((a, b) => a + b, 0) / l20Values.length : l10Avg;

      // Weighted projection (recency-weighted L10)
      const weightedProjection = weightedAvg(l10Values);
      const medianProjection = median(l10Values);
      const floorValue = floor(l10Values);

      // Check matchup data for today's opponent
      const gameDesc = prop.game_description || '';
      let matchupAdjustment = 0;
      let matchupGames = 0;
      let matchupAvg = 0;
      
      // Try to extract opponent from game description
      const opponentMatch = gameDesc.match(/vs\.?\s*(\w+)|@\s*(\w+)/i);
      if (opponentMatch) {
        const opponent = opponentMatch[1] || opponentMatch[2];
        // Search matchup history
        for (const [key, m] of Object.entries(matchupLookup)) {
          if (key.startsWith(`${player_name}|`) && key.toLowerCase().includes(opponent.toLowerCase())) {
            matchupAvg = Number(m.avg_stat) || 0;
            matchupGames = Number(m.games_played) || 0;
            if (matchupGames >= 3 && matchupAvg > 0) {
              // Blend matchup data: 30% matchup, 70% overall
              matchupAdjustment = (matchupAvg - weightedProjection) * 0.3;
            }
            break;
          }
        }
      }

      // FINAL PROJECTION: Blend of weighted avg + median + matchup
      let projectedValue = (weightedProjection * 0.5) + (medianProjection * 0.3) + (l5Avg * 0.2);
      projectedValue += matchupAdjustment;
      projectedValue = Math.round(projectedValue * 10) / 10;

      const fdLine = Number(current_line);
      const edgePct = ((projectedValue - fdLine) / Math.max(fdLine, 1)) * 100;
      const absEdge = Math.abs(edgePct);

      // Determine recommended side
      let recommendedSide = projectedValue > fdLine ? 'over' : 'under';
      
      // Edge grading
      let edgeGrade = 'SKIP';
      if (absEdge >= 15 && floorValue > fdLine && recommendedSide === 'over') {
        edgeGrade = 'PERFECT'; // Floor clears the line
      } else if (absEdge >= 15) {
        edgeGrade = 'PERFECT';
      } else if (absEdge >= 10) {
        edgeGrade = 'STRONG';
      } else if (absEdge >= 5) {
        edgeGrade = 'LEAN';
      }

      // Line movement prediction
      const drift = predictLineDrift(player_name, prop_type, fdLine);

      // Snapback detection
      const snapback = detectSnapback(l3Avg, l10Avg, l20Avg, fdLine);

      // If snapback detected, override recommendation
      if (snapback.isSnapback) {
        // Snapback overrides: if L3 tanked → over, if L3 spiked → under
        const snapSide = l3Avg < l10Avg ? 'over' : 'under';
        if (snapSide !== recommendedSide && absEdge < 10) {
          recommendedSide = snapSide;
          projectedValue = snapback.regressionTarget;
        }
        if (edgeGrade === 'SKIP' || edgeGrade === 'LEAN') {
          edgeGrade = 'STRONG'; // Snapback = automatic upgrade
        }
      }

      // Confidence: combine edge size + data volume + matchup data
      let confidence = 30;
      if (absEdge >= 15) confidence += 25;
      else if (absEdge >= 10) confidence += 15;
      else if (absEdge >= 5) confidence += 8;
      if (l10Values.length >= 10) confidence += 10;
      if (matchupGames >= 3) confidence += 10;
      if (snapback.isSnapback) confidence += 10;
      if (drift.confidence > 0.6) confidence += 5;
      if (floorValue > fdLine && recommendedSide === 'over') confidence += 15; // Floor safety
      confidence = Math.min(confidence, 95);

      // Optimal entry: if line is predicted to move in our favor, wait
      let optimalEntry = fdLine;
      if (drift.direction === 'down' && recommendedSide === 'over') {
        optimalEntry = drift.predictedSettle; // Wait for lower line
      } else if (drift.direction === 'up' && recommendedSide === 'under') {
        optimalEntry = drift.predictedSettle; // Wait for higher line
      }

      projections.push({
        player_name,
        prop_type,
        sport,
        projected_value: projectedValue,
        projection_confidence: confidence,
        projection_method: snapback.isSnapback ? 'snapback' : matchupGames >= 3 ? 'matchup_adjusted' : 'weighted_avg',
        fanduel_line: fdLine,
        edge_pct: Math.round(edgePct * 10) / 10,
        recommended_side: recommendedSide,
        edge_grade: edgeGrade,
        predicted_line_direction: drift.direction,
        predicted_settle_line: drift.predictedSettle,
        optimal_entry_line: optimalEntry,
        is_snapback: snapback.isSnapback,
        snapback_reason: snapback.reason || null,
        regression_target: snapback.regressionTarget,
        l3_avg: Math.round(l3Avg * 10) / 10,
        l5_avg: Math.round(l5Avg * 10) / 10,
        l10_avg: Math.round(l10Avg * 10) / 10,
        l20_avg: Math.round(l20Avg * 10) / 10,
        matchup_avg: matchupAvg || null,
        matchup_games: matchupGames || null,
        game_date: new Date().toISOString().split('T')[0],
        event_id: event_id || null,
      });
    }

    // Sort: PERFECT first, then STRONG, then by edge size
    const gradeOrder: Record<string, number> = { 'PERFECT': 0, 'STRONG': 1, 'LEAN': 2, 'SKIP': 3 };
    projections.sort((a, b) => {
      const gradeDiff = (gradeOrder[a.edge_grade] || 3) - (gradeOrder[b.edge_grade] || 3);
      if (gradeDiff !== 0) return gradeDiff;
      return Math.abs(b.edge_pct) - Math.abs(a.edge_pct);
    });

    // ═══════════════════════════════════════════════
    // PHASE 6: PERSIST PROJECTIONS
    // ═══════════════════════════════════════════════

    const actionable = projections.filter(p => p.edge_grade !== 'SKIP');

    if (actionable.length > 0) {
      const { error: upsertError } = await supabase
        .from('line_projection_results')
        .upsert(actionable, { onConflict: 'player_name,prop_type,game_date' });

      if (upsertError) {
        console.error('[line-projection-engine] Upsert error:', upsertError);
      } else {
        console.log(`[line-projection-engine] Persisted ${actionable.length} projections`);
      }
    }

    // ═══════════════════════════════════════════════
    // PHASE 7: SUMMARY STATS
    // ═══════════════════════════════════════════════

    const summary = {
      total_players_analyzed: Object.keys(playerLogs).length,
      total_projections: projections.length,
      perfect_edges: projections.filter(p => p.edge_grade === 'PERFECT').length,
      strong_edges: projections.filter(p => p.edge_grade === 'STRONG').length,
      lean_edges: projections.filter(p => p.edge_grade === 'LEAN').length,
      snapbacks_detected: projections.filter(p => p.is_snapback).length,
      lines_predicted_to_move: projections.filter(p => p.predicted_line_direction !== 'stable').length,
    };

    console.log(`[line-projection-engine] Summary:`, JSON.stringify(summary));

    return new Response(
      JSON.stringify({
        success: true,
        summary,
        projections: projections.filter(p => p.edge_grade !== 'SKIP').slice(0, 25),
        all_projections_count: projections.length,
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('[line-projection-engine] Error:', error);
    return new Response(
      JSON.stringify({ success: false, error: String(error) }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
