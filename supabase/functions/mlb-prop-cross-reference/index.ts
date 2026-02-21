import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.38.4";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

function getEasternDate(): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/New_York',
    year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date());
}

/** Map PrizePicks / unified_props stat names to mlb_player_game_logs columns */
const PROP_TO_STAT: Record<string, string> = {
  'batter_hits': 'hits',
  'player_hits': 'hits',
  'hits': 'hits',
  'batter_total_bases': 'total_bases',
  'player_total_bases': 'total_bases',
  'total_bases': 'total_bases',
  'batter_home_runs': 'home_runs',
  'player_home_runs': 'home_runs',
  'home_runs': 'home_runs',
  'batter_rbis': 'rbis',
  'player_rbis': 'rbis',
  'rbis': 'rbis',
  'batter_runs': 'runs',
  'player_runs': 'runs',
  'runs': 'runs',
  'batter_stolen_bases': 'stolen_bases',
  'player_stolen_bases': 'stolen_bases',
  'stolen_bases': 'stolen_bases',
  'pitcher_strikeouts': 'strikeouts',
  'player_strikeouts': 'strikeouts',
  'strikeouts': 'strikeouts',
  'pitcher_outs': 'pitcher_strikeouts',
  'player_pitcher_outs': 'pitcher_strikeouts',
  'player_fantasy_score': '__fantasy__',
  'player_hitter_fantasy_score': '__fantasy__',
};

interface GameLog {
  [key: string]: number | string | null;
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
  const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const supabase = createClient(supabaseUrl, supabaseKey);
  const today = getEasternDate();

  try {
    console.log(`[MLB-CrossRef] Starting analysis for ${today}`);

    // Fetch mispriced lines for MLB + recent game logs in parallel
    const [mispricedResult, ppResult] = await Promise.all([
      supabase.from('mispriced_lines')
        .select('player_name, prop_type, signal, edge_pct, confidence_tier, book_line, player_avg_l10, sport')
        .eq('analysis_date', today)
        .in('sport', ['baseball_mlb', 'MLB']),
      supabase.from('pp_snapshot')
        .select('player_name, stat_type, line_score')
        .in('stat_type', ['batter_home_runs', 'pitcher_strikeouts', 'batter_hits', 'batter_total_bases', 'batter_rbis', 'batter_runs', 'batter_stolen_bases', 'player_hitter_fantasy_score', 'player_fantasy_score']),
    ]);

    const mispricedLines = mispricedResult.data || [];
    console.log(`[MLB-CrossRef] Found ${mispricedLines.length} MLB mispriced lines for ${today}`);

    if (mispricedLines.length === 0) {
      return new Response(JSON.stringify({ success: true, message: 'No MLB mispriced lines today', picks_generated: 0 }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Build PP line lookup
    const ppLines = new Map<string, number>();
    for (const pp of ppResult.data || []) {
      const key = `${pp.player_name.toLowerCase()}|${pp.stat_type}`;
      ppLines.set(key, pp.line_score);
    }

    // Get unique player names from mispriced lines
    const playerNames = [...new Set(mispricedLines.map(ml => ml.player_name))];

    // Fetch game logs for these players (last 20 games each)
    console.log(`[MLB-CrossRef] Fetching game logs for ${playerNames.length} players:`, playerNames.slice(0, 5));
    const logResults = await supabase
      .from('mlb_player_game_logs')
      .select('player_name, game_date, hits, walks, total_bases, home_runs, rbis, runs, stolen_bases, strikeouts, pitcher_strikeouts')
      .in('player_name', playerNames)
      .order('game_date', { ascending: false })
      .limit(1000);

    if (logResults.error) {
      console.error(`[MLB-CrossRef] Game logs query error:`, logResults.error);
    }
    console.log(`[MLB-CrossRef] Game logs returned: ${logResults.data?.length ?? 'null'} rows`);

    // Group logs by player
    const playerLogs = new Map<string, GameLog[]>();
    for (const log of logResults.data || []) {
      const key = log.player_name.toLowerCase();
      if (!playerLogs.has(key)) playerLogs.set(key, []);
      playerLogs.get(key)!.push(log);
    }

    // Also check if pitcher-k-analyzer or batter-analyzer found the same signal today
    const existingMispricedKeys = new Set<string>();
    for (const ml of mispricedLines) {
      existingMispricedKeys.add(`${ml.player_name.toLowerCase()}|${ml.prop_type.toLowerCase()}|${ml.signal.toLowerCase()}`);
    }

    const picks: any[] = [];

    for (const ml of mispricedLines) {
      const statCol = PROP_TO_STAT[ml.prop_type.toLowerCase()];
      if (!statCol) {
        console.log(`[MLB-CrossRef] Skipping unknown prop type: ${ml.prop_type}`);
        continue;
      }

      const logs = playerLogs.get(ml.player_name.toLowerCase()) || [];
      if (logs.length < 5) {
        console.log(`[MLB-CrossRef] Skipping ${ml.player_name} - only ${logs.length} game logs`);
        continue;
      }

      const line = ml.book_line || 0;
      const signal = ml.signal.toUpperCase(); // OVER or UNDER
      const signalLower = signal.toLowerCase();

      // Calculate stats from game logs
      const l10 = logs.slice(0, Math.min(10, logs.length));
      const l20 = logs.slice(0, Math.min(20, logs.length));
      const allLogs = logs;

      const isFantasy = statCol === '__fantasy__';
      const calcFantasy = (g: GameLog) =>
        (Number(g.hits) || 0) + (Number(g.walks) || 0) + (Number(g.runs) || 0) +
        (Number(g.rbis) || 0) + (Number(g.total_bases) || 0) + (Number(g.stolen_bases) || 0);

      const avg = (arr: GameLog[], col: string) => {
        const vals = isFantasy ? arr.map(calcFantasy) : arr.map(g => Number(g[col]) || 0);
        return vals.length > 0 ? vals.reduce((a, b) => a + b, 0) / vals.length : 0;
      };

      const stdDev = (arr: GameLog[], col: string) => {
        const vals = isFantasy ? arr.map(calcFantasy) : arr.map(g => Number(g[col]) || 0);
        if (vals.length < 2) return 0;
        const mean = vals.reduce((a, b) => a + b, 0) / vals.length;
        const variance = vals.reduce((sum, v) => sum + (v - mean) ** 2, 0) / (vals.length - 1);
        return Math.sqrt(variance);
      };

      const l10Avg = avg(l10, statCol);
      const l20Avg = avg(l20, statCol);
      const seasonAvg = avg(allLogs, statCol);
      const l10StdDev = stdDev(l10, statCol);

      // Hit rate: how often player went over/under this line in L10
      const hitRate = (() => {
        const relevant = isFantasy ? l10.map(calcFantasy) : l10.map(g => Number(g[statCol]) || 0);
        if (relevant.length === 0) return 50;
        const hits = signal === 'OVER'
          ? relevant.filter(v => v > line).length
          : relevant.filter(v => v < line).length;
        return (hits / relevant.length) * 100;
      })();

      // L20 hit rate for additional context
      const l20HitRate = (() => {
        const relevant = isFantasy ? l20.map(calcFantasy) : l20.map(g => Number(g[statCol]) || 0);
        if (relevant.length === 0) return 50;
        const hits = signal === 'OVER'
          ? relevant.filter(v => v > line).length
          : relevant.filter(v => v < line).length;
        return (hits / relevant.length) * 100;
      })();

      // ===== CONFIDENCE SCORE CALCULATION =====
      const signals: Record<string, any> = {};

      // 1. Edge weight (0-40 points)
      const edgeScore = Math.min(Math.abs(ml.edge_pct) * 1.5, 40);
      signals.edge = { score: edgeScore, edge_pct: ml.edge_pct };

      // 2. Hit rate bonus (0-25 points)
      const hitRateBonus = Math.max(0, (hitRate - 50) * 0.5);
      signals.hit_rate = { score: hitRateBonus, l10_rate: hitRate, l20_rate: l20HitRate };

      // 3. Trend alignment (0-15 points)
      let trendScore = 0;
      if (signal === 'OVER' && l10Avg > seasonAvg * 1.05) trendScore = 15;
      else if (signal === 'UNDER' && l10Avg < seasonAvg * 0.95) trendScore = 15;
      else if (signal === 'OVER' && l10Avg > seasonAvg) trendScore = 7;
      else if (signal === 'UNDER' && l10Avg < seasonAvg) trendScore = 7;
      signals.trend = { score: trendScore, l10_avg: l10Avg, season_avg: seasonAvg };

      // 4. Consistency bonus (0-10 points)
      let consistencyScore = 0;
      if (l10Avg > 0 && l10StdDev / l10Avg < 0.3) consistencyScore = 10;
      else if (l10Avg > 0 && l10StdDev / l10Avg < 0.5) consistencyScore = 5;
      signals.consistency = { score: consistencyScore, std_dev: l10StdDev, cv: l10Avg > 0 ? l10StdDev / l10Avg : 0 };

      // 5. PrizePicks line discrepancy (0-10 points)
      let ppScore = 0;
      const ppKey = `${ml.player_name.toLowerCase()}|${ml.prop_type.toLowerCase()}`;
      const ppLine = ppLines.get(ppKey);
      if (ppLine !== undefined && line > 0) {
        const discrepancy = Math.abs(ppLine - line) / line;
        if (discrepancy > 0.1) ppScore = 10;
        else if (discrepancy > 0.05) ppScore = 5;
        signals.pp_discrepancy = { score: ppScore, pp_line: ppLine, book_line: line, diff_pct: discrepancy * 100 };
      }

      const confidenceScore = edgeScore + hitRateBonus + trendScore + consistencyScore + ppScore;

      // Only include picks with meaningful confidence
      if (confidenceScore < 20) continue;

      picks.push({
        player_name: ml.player_name,
        prop_type: ml.prop_type,
        line: line,
        side: signal,
        confidence_score: Math.round(confidenceScore * 100) / 100,
        signal_sources: signals,
        game_date: today,
      });
    }

    // Sort by confidence and take top picks
    picks.sort((a, b) => b.confidence_score - a.confidence_score);

    console.log(`[MLB-CrossRef] Generated ${picks.length} MLB engine picks`);

    // Upsert to mlb_engine_picks
    if (picks.length > 0) {
      // Delete today's old picks first
      await supabase.from('mlb_engine_picks').delete().eq('game_date', today);

      const { error } = await supabase.from('mlb_engine_picks').insert(picks);
      if (error) {
        console.error(`[MLB-CrossRef] Insert error:`, error);
      } else {
        console.log(`[MLB-CrossRef] Upserted ${picks.length} picks`);
      }
    }

    return new Response(JSON.stringify({
      success: true,
      picks_generated: picks.length,
      top_picks: picks.slice(0, 10).map(p => ({
        player: p.player_name,
        prop: p.prop_type,
        side: p.side,
        confidence: p.confidence_score,
      })),
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[MLB-CrossRef] Error:`, msg);
    return new Response(JSON.stringify({ success: false, error: msg }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
