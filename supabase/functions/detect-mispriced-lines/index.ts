import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// Map unified_props market keys to game log columns
const PROP_TO_STAT: Record<string, string> = {
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

// Combo stat calculators
function getStatValue(log: any, statKey: string): number | null {
  switch (statKey) {
    case 'pra': return (log.points || 0) + (log.rebounds || 0) + (log.assists || 0);
    case 'pr': return (log.points || 0) + (log.rebounds || 0);
    case 'pa': return (log.points || 0) + (log.assists || 0);
    case 'ra': return (log.rebounds || 0) + (log.assists || 0);
    default: return log[statKey] ?? null;
  }
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

function getConfidenceTier(edgePct: number, gamesPlayed: number): string {
  const absEdge = Math.abs(edgePct);
  if (gamesPlayed < 5) return 'LOW';
  if (absEdge >= 30 && gamesPlayed >= 15) return 'ELITE';
  if (absEdge >= 20 && gamesPlayed >= 10) return 'HIGH';
  if (absEdge >= 15) return 'MEDIUM';
  return 'LOW';
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
    // Get today's date in Eastern
    const now = new Date();
    const formatter = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit'
    });
    const today = formatter.format(now);

    console.log(`[Mispriced] Starting analysis for ${today}`);

    // Step 1: Pull all active NBA props for today
    const { data: props, error: propsError } = await supabase
      .from('unified_props')
      .select('player_name, prop_type, current_line, bookmaker, commence_time')
      .eq('sport', 'basketball_nba')
      .gt('commence_time', now.toISOString())
      .not('player_name', 'is', null)
      .not('current_line', 'is', null);

    if (propsError) throw new Error(`Props fetch error: ${propsError.message}`);
    if (!props || props.length === 0) {
      return new Response(JSON.stringify({ success: true, message: 'No active NBA props found', mispriced: 0 }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    console.log(`[Mispriced] Found ${props.length} active NBA props`);

    // Step 2: Get unique player names
    const uniquePlayers = [...new Set(props.map(p => p.player_name).filter(Boolean))];
    console.log(`[Mispriced] ${uniquePlayers.length} unique players`);

    // Step 3: Fetch game logs for all players (last 20 games)
    const playerLogs: Record<string, any[]> = {};
    
    // Batch fetch in chunks of 20 players
    for (let i = 0; i < uniquePlayers.length; i += 20) {
      const batch = uniquePlayers.slice(i, i + 20);
      const { data: logs } = await supabase
        .from('nba_player_game_logs')
        .select('*')
        .in('player_name', batch)
        .order('game_date', { ascending: false })
        .limit(400); // ~20 games per player

      for (const log of logs || []) {
        if (!playerLogs[log.player_name]) playerLogs[log.player_name] = [];
        if (playerLogs[log.player_name].length < 20) {
          playerLogs[log.player_name].push(log);
        }
      }
    }

    // Step 4: Analyze each prop
    const mispricedResults: any[] = [];
    const processedKeys = new Set<string>();

    for (const prop of props) {
      if (!prop.player_name || !prop.current_line || !prop.prop_type) continue;

      const statKey = PROP_TO_STAT[prop.prop_type];
      if (!statKey) continue;

      // Dedup by player+prop_type per day
      const dedupKey = `${prop.player_name}_${prop.prop_type}`;
      if (processedKeys.has(dedupKey)) continue;
      processedKeys.add(dedupKey);

      const logs = playerLogs[prop.player_name];
      if (!logs || logs.length < 3) continue;

      // Calculate L10 and L20 averages
      const l10Logs = logs.slice(0, Math.min(10, logs.length));
      const l20Logs = logs.slice(0, Math.min(20, logs.length));
      const l5Logs = logs.slice(0, Math.min(5, logs.length));

      const l10Values = l10Logs.map(l => getStatValue(l, statKey)).filter((v): v is number => v !== null);
      const l20Values = l20Logs.map(l => getStatValue(l, statKey)).filter((v): v is number => v !== null);
      const l5Values = l5Logs.map(l => getStatValue(l, statKey)).filter((v): v is number => v !== null);

      if (l10Values.length < 3) continue;

      const avgL10 = calcAvg(l10Values);
      const avgL20 = calcAvg(l20Values);
      const avgL5 = calcAvg(l5Values);
      const line = Number(prop.current_line);

      if (line === 0) continue;

      // Edge calculation
      const edgePct = ((avgL10 - line) / line) * 100;
      const trendEdge = ((avgL5 - avgL20) / (avgL20 || 1)) * 100;

      // Only flag significant edges (±15%)
      if (Math.abs(edgePct) < 15) continue;

      const signal = edgePct > 0 ? 'OVER' : 'UNDER';
      const shootingContext = calcShootingContext(l20Logs);
      const confidenceTier = getConfidenceTier(edgePct, l10Values.length);

      // Add trend data to shooting context
      const fullContext = {
        ...shootingContext,
        l5_avg: Math.round(avgL5 * 10) / 10,
        l10_avg: Math.round(avgL10 * 10) / 10,
        l20_avg: Math.round(avgL20 * 10) / 10,
        trend_pct: Math.round(trendEdge * 10) / 10,
        games_analyzed: l20Values.length,
      };

      mispricedResults.push({
        player_name: prop.player_name,
        prop_type: prop.prop_type,
        book_line: line,
        player_avg_l10: Math.round(avgL10 * 100) / 100,
        player_avg_l20: Math.round(avgL20 * 100) / 100,
        edge_pct: Math.round(edgePct * 100) / 100,
        signal,
        shooting_context: fullContext,
        confidence_tier: confidenceTier,
        analysis_date: today,
      });
    }

    console.log(`[Mispriced] Found ${mispricedResults.length} mispriced lines`);

    // Step 5: Clear today's old results and insert new ones
    if (mispricedResults.length > 0) {
      await supabase
        .from('mispriced_lines')
        .delete()
        .eq('analysis_date', today);

      // Batch insert
      const chunkSize = 50;
      let inserted = 0;
      for (let i = 0; i < mispricedResults.length; i += chunkSize) {
        const chunk = mispricedResults.slice(i, i + chunkSize);
        const { error } = await supabase
          .from('mispriced_lines')
          .upsert(chunk, { onConflict: 'player_name,prop_type,analysis_date' });

        if (error) {
          console.error(`[Mispriced] Insert error:`, error.message);
        } else {
          inserted += chunk.length;
        }
      }
      console.log(`[Mispriced] Inserted ${inserted} mispriced lines`);
    }

    const duration = Date.now() - startTime;

    // Log to cron history
    await supabase.from('cron_job_history').insert({
      job_name: 'detect-mispriced-lines',
      status: 'completed',
      started_at: new Date(startTime).toISOString(),
      completed_at: new Date().toISOString(),
      duration_ms: duration,
      result: {
        props_analyzed: processedKeys.size,
        mispriced_found: mispricedResults.length,
        by_tier: {
          ELITE: mispricedResults.filter(r => r.confidence_tier === 'ELITE').length,
          HIGH: mispricedResults.filter(r => r.confidence_tier === 'HIGH').length,
          MEDIUM: mispricedResults.filter(r => r.confidence_tier === 'MEDIUM').length,
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
