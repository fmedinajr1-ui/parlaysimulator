import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// NHL prop_type → game log column mapping
const NHL_SKATER_PROP_MAP: Record<string, string> = {
  'player_shots_on_goal': 'shots_on_goal',
  'player_goals': 'goals',
  'player_assists': 'assists',
  'player_points': 'points',
  'player_blocked_shots': 'blocked_shots',
  'player_power_play_points': 'power_play_points',
};

const NHL_GOALIE_PROP_MAP: Record<string, string> = {
  'player_saves': 'saves',
  'player_goalie_saves': 'saves',
  'goalie_saves': 'saves',
};

// Convert "Aaron Ekblad" → "A. Ekblad" for matching against ESPN-style abbreviated names
function abbreviateName(fullName: string): string {
  const parts = fullName.trim().split(/\s+/);
  if (parts.length < 2) return fullName;
  return `${parts[0][0]}. ${parts.slice(1).join(' ')}`;
}

// NHL categories for sweet spot classification
function classifyNhlCategory(propType: string): string {
  const p = propType.toLowerCase();
  if (p.includes('shots') || p.includes('sog')) return 'NHL_SHOTS_ON_GOAL';
  if (p.includes('goal') && !p.includes('save')) return 'NHL_GOALS_SCORER';
  if (p.includes('assist')) return 'NHL_ASSISTS';
  if (p.includes('point') && !p.includes('power')) return 'NHL_POINTS';
  if (p.includes('save')) return 'NHL_GOALIE_SAVES';
  if (p.includes('block')) return 'NHL_BLOCKED_SHOTS';
  if (p.includes('power_play')) return 'NHL_POWER_PLAY_POINTS';
  return 'NHL_OTHER';
}

function calcStats(values: number[]) {
  if (values.length === 0) return { avg: 0, median: 0, min: 0, max: 0, stdDev: 0 };
  const sorted = [...values].sort((a, b) => a - b);
  const avg = values.reduce((a, b) => a + b, 0) / values.length;
  const median = sorted.length % 2 === 0
    ? (sorted[sorted.length / 2 - 1] + sorted[sorted.length / 2]) / 2
    : sorted[Math.floor(sorted.length / 2)];
  const min = sorted[0];
  const max = sorted[sorted.length - 1];
  const variance = values.reduce((sum, v) => sum + (v - avg) ** 2, 0) / values.length;
  const stdDev = Math.sqrt(variance);
  return { avg, median, min, max, stdDev };
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  const startTime = Date.now();
  const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
  const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const supabase = createClient(supabaseUrl, supabaseKey);

  try {
    const { forceRefresh = false } = await req.json().catch(() => ({}));
    const now = new Date();
    const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);

    console.log(`[NHL Scanner] Starting prop sweet spots scan for ${today}`);

    // 1. Fetch active NHL player props
    const { data: nhlProps, error: propsErr } = await supabase
      .from('unified_props')
      .select('player_name, prop_type, current_line, bookmaker, over_price, under_price, game_description')
      .eq('sport', 'icehockey_nhl')
      .eq('is_active', true)
      .gt('commence_time', now.toISOString())
      .not('player_name', 'is', null)
      .not('current_line', 'is', null);

    if (propsErr) throw new Error(`Props fetch error: ${propsErr.message}`);
    console.log(`[NHL Scanner] Found ${nhlProps?.length || 0} active NHL props`);

    if (!nhlProps || nhlProps.length === 0) {
      return new Response(JSON.stringify({ success: true, message: 'No active NHL props found', sweetSpots: 0 }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Deduplicate props by player+type (keep first/best line)
    const uniqueProps = new Map<string, typeof nhlProps[0]>();
    for (const p of nhlProps) {
      const key = `${p.player_name}_${p.prop_type}`;
      if (!uniqueProps.has(key)) uniqueProps.set(key, p);
    }
    console.log(`[NHL Scanner] ${uniqueProps.size} unique player-prop combos`);

    // 2. Name mapping: game logs have MIXED formats ("Bryan Rust" AND "A. Tuch")
    // Query with BOTH full name and abbreviated name, merge results

    // Split into skater vs goalie props, collect both name forms
    const skaterFullNames: string[] = [];
    const skaterAbbrevNames: string[] = [];
    const goalieFullNames: string[] = [];
    const goalieAbbrevNames: string[] = [];

    for (const [, prop] of uniqueProps) {
      const full = prop.player_name;
      const abbrev = abbreviateName(full);
      const isGoalie = !!NHL_GOALIE_PROP_MAP[prop.prop_type];

      if (isGoalie) {
        if (!goalieFullNames.includes(full)) goalieFullNames.push(full);
        if (abbrev !== full && !goalieAbbrevNames.includes(abbrev)) goalieAbbrevNames.push(abbrev);
      } else {
        if (!skaterFullNames.includes(full)) skaterFullNames.push(full);
        if (abbrev !== full && !skaterAbbrevNames.includes(abbrev)) skaterAbbrevNames.push(abbrev);
      }
    }

    // Combine both name forms for querying
    const allSkaterNames = [...new Set([...skaterFullNames, ...skaterAbbrevNames])];
    const allGoalieNames = [...new Set([...goalieFullNames, ...goalieAbbrevNames])];

    console.log(`[NHL Scanner] Querying logs for ${allSkaterNames.length} skater name variants, ${allGoalieNames.length} goalie name variants`);
    console.log(`[NHL Scanner] Sample names: ${allSkaterNames.slice(0, 5).join(', ')}`);

    // Fetch skater logs using BOTH full + abbreviated names
    const skaterLogs: Record<string, any[]> = {};
    for (let i = 0; i < allSkaterNames.length; i += 20) {
      const batch = allSkaterNames.slice(i, i + 20);
      const { data: logs } = await supabase
        .from('nhl_player_game_logs')
        .select('player_name, game_date, goals, assists, points, shots_on_goal, blocked_shots, power_play_points, hits, team')
        .in('player_name', batch)
        .order('game_date', { ascending: false })
        .limit(400);

      for (const log of logs || []) {
        if (!skaterLogs[log.player_name]) skaterLogs[log.player_name] = [];
        if (skaterLogs[log.player_name].length < 10) skaterLogs[log.player_name].push(log);
      }
    }
    console.log(`[NHL Scanner] Loaded skater logs for ${Object.keys(skaterLogs).length} players`);

    // Fetch goalie logs
    const goalieLogs: Record<string, any[]> = {};
    for (let i = 0; i < allGoalieNames.length; i += 20) {
      const batch = allGoalieNames.slice(i, i + 20);
      const { data: logs } = await supabase
        .from('nhl_goalie_game_logs')
        .select('player_name, game_date, saves, shots_against, goals_against, save_pct, opponent')
        .in('player_name', batch)
        .order('game_date', { ascending: false })
        .limit(200);

      for (const log of logs || []) {
        if (!goalieLogs[log.player_name]) goalieLogs[log.player_name] = [];
        if (goalieLogs[log.player_name].length < 10) goalieLogs[log.player_name].push(log);
      }
    }
    console.log(`[NHL Scanner] Loaded goalie logs for ${Object.keys(goalieLogs).length} goalies`);

    // Build propToLogName: for each prop player, find which name form has logs
    const propToLogName = new Map<string, string>();
    for (const [, prop] of uniqueProps) {
      const full = prop.player_name;
      const abbrev = abbreviateName(full);
      const isGoalie = !!NHL_GOALIE_PROP_MAP[prop.prop_type];
      const logs = isGoalie ? goalieLogs : skaterLogs;
      
      if (logs[full] && logs[full].length > 0) {
        // Merge both forms if both exist
        if (abbrev !== full && logs[abbrev]) {
          logs[full] = [...logs[full], ...logs[abbrev]]
            .sort((a, b) => b.game_date.localeCompare(a.game_date))
            .slice(0, 10);
        }
        propToLogName.set(full, full);
      } else if (logs[abbrev] && logs[abbrev].length > 0) {
        propToLogName.set(full, abbrev);
      }
    }
    console.log(`[NHL Scanner] Name resolution: ${propToLogName.size}/${uniqueProps.size} props matched to game logs`);

    // 3. Fetch defense rankings for matchup scoring
    const { data: defenseRankings } = await supabase
      .from('nhl_team_defense_rankings')
      .select('team_abbrev, goals_against_rank, shots_against_rank, shots_for_per_game, goals_for_rank, shots_for_rank, penalty_kill_rank');

    const defRankMap = new Map<string, any>();
    for (const r of defenseRankings || []) {
      defRankMap.set(r.team_abbrev?.toUpperCase(), r);
    }

    // 4. Analyze each prop and compute L10 stats
    const sweetSpots: any[] = [];
    let analyzed = 0;
    let qualifying = 0;

    for (const [key, prop] of uniqueProps) {
      const isGoalieProp = !!NHL_GOALIE_PROP_MAP[prop.prop_type];
      const statCol = isGoalieProp ? NHL_GOALIE_PROP_MAP[prop.prop_type] : NHL_SKATER_PROP_MAP[prop.prop_type];
      if (!statCol) {
        console.log(`[NHL Scanner] No stat mapping for prop_type: ${prop.prop_type}`);
        continue;
      }

      const logName = propToLogName.get(prop.player_name);
      if (!logName) continue;

      const logs = isGoalieProp ? goalieLogs[logName] : skaterLogs[logName];
      if (!logs || logs.length < 3) continue;

      const line = Number(prop.current_line);
      if (line <= 0) continue;

      const values = logs.map(l => Number(l[statCol] ?? 0));
      const stats = calcStats(values);

      // Hit rates
      const overHits = values.filter(v => v > line).length;
      const underHits = values.filter(v => v < line).length;
      const overHitRate = overHits / values.length;
      const underHitRate = underHits / values.length;

      // Determine recommended side
      const bestSide = overHitRate >= underHitRate ? 'OVER' : 'UNDER';
      const bestHitRate = Math.max(overHitRate, underHitRate);

      analyzed++;

      // Qualifying threshold: 50%+ hit rate with 3+ games
      if (bestHitRate < 0.50 || values.length < 3) continue;

      const category = classifyNhlCategory(prop.prop_type);

      // Extract opponent from game_description for defense lookup
      let matchupAdjustment = 0;
      // We'll use the player's team from logs to find opponent defense
      const playerTeam = logs[0]?.team?.toUpperCase();

      const entry = {
        player_name: prop.player_name,
        prop_type: prop.prop_type,
        category,
        recommended_line: line,
        recommended_side: bestSide,
        actual_hit_rate: Math.round(bestHitRate * 100) / 100,
        l10_avg: Math.round(stats.avg * 100) / 100,
        l10_median: Math.round(stats.median * 100) / 100,
        l10_min: stats.min,
        l10_max: stats.max,
        l10_std_dev: Math.round(stats.stdDev * 100) / 100,
        l10_hit_rate: Math.round(bestHitRate * 100) / 100,
        confidence_score: Math.round(bestHitRate * 100),
        analysis_date: today,
        is_active: true,
        games_played: values.length,
        line_difference: Math.round((stats.avg - line) * 100) / 100,
        matchup_adjustment: matchupAdjustment,
        bookmaker: prop.bookmaker,
        actual_line: line,
        season_avg: Math.round(stats.avg * 100) / 100,
        quality_tier: bestHitRate >= 0.80 ? 'elite' : bestHitRate >= 0.70 ? 'strong' : bestHitRate >= 0.60 ? 'solid' : 'marginal',
        engine_version: 'nhl-scanner-v1',
        projection_source: 'l10_game_logs',
      };

      sweetSpots.push(entry);
      qualifying++;

      if (bestHitRate >= 0.70) {
        console.log(`[NHL Scanner] 🔥 ${prop.player_name} ${prop.prop_type} ${bestSide} ${line}: L10 ${Math.round(bestHitRate * 100)}% hit (avg ${stats.avg.toFixed(1)}, range ${stats.min}-${stats.max})`);
      }
    }

    console.log(`[NHL Scanner] Analyzed ${analyzed} props, ${qualifying} qualify (50%+ L10 hit rate)`);

    // 5. Upsert to category_sweet_spots
    if (sweetSpots.length > 0) {
      // Clear today's NHL entries first
      await supabase
        .from('category_sweet_spots')
        .delete()
        .eq('analysis_date', today)
        .like('category', 'NHL_%');

      const chunkSize = 50;
      let inserted = 0;
      for (let i = 0; i < sweetSpots.length; i += chunkSize) {
        const chunk = sweetSpots.slice(i, i + chunkSize);
        const { error } = await supabase
          .from('category_sweet_spots')
          .upsert(chunk, { onConflict: 'player_name,prop_type,analysis_date' });

        if (error) {
          console.error(`[NHL Scanner] Upsert error:`, error.message);
        } else {
          inserted += chunk.length;
        }
      }
      console.log(`[NHL Scanner] Inserted ${inserted} sweet spots`);
    }

    // Summary stats
    const byCategory: Record<string, number> = {};
    const byQuality: Record<string, number> = {};
    for (const ss of sweetSpots) {
      byCategory[ss.category] = (byCategory[ss.category] || 0) + 1;
      byQuality[ss.quality_tier] = (byQuality[ss.quality_tier] || 0) + 1;
    }

    const eliteCount = sweetSpots.filter(s => s.actual_hit_rate >= 0.80).length;
    const strongCount = sweetSpots.filter(s => s.actual_hit_rate >= 0.70 && s.actual_hit_rate < 0.80).length;

    const duration = Date.now() - startTime;
    console.log(`[NHL Scanner] Done in ${duration}ms | Elite: ${eliteCount} | Strong: ${strongCount} | Total: ${sweetSpots.length}`);

    await supabase.from('cron_job_history').insert({
      job_name: 'nhl-prop-sweet-spots-scanner',
      status: 'completed',
      started_at: new Date(startTime).toISOString(),
      completed_at: new Date().toISOString(),
      duration_ms: duration,
      result: { analyzed, qualifying, byCategory, byQuality, eliteCount, strongCount },
    });

    return new Response(JSON.stringify({
      success: true,
      duration_ms: duration,
      analyzed,
      sweetSpots: qualifying,
      eliteCount,
      strongCount,
      byCategory,
      byQuality,
      sample: sweetSpots.slice(0, 5),
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error) {
    console.error('[NHL Scanner] Fatal error:', error);
    return new Response(JSON.stringify({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
