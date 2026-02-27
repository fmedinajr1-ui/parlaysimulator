/**
 * bot-update-engine-hit-rates
 * 
 * Refreshes ALL performance tables after settlement:
 * A) bot_strategies - rolling 7-day win rates
 * B) bot_prop_type_performance - leg-level aggregation with auto-block/boost
 * C) bot_player_performance - deduplicated player stats
 * D) strategy_performance - per-strategy daily stats
 * 
 * Called after bot-settle-and-learn and via daily 11:30 PM ET cron safety net.
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

function getDateDaysAgo(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/New_York',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(d);
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
  const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const supabase = createClient(supabaseUrl, supabaseKey);

  const today = getEasternDate();
  const sevenDaysAgo = getDateDaysAgo(7);

  const results: Record<string, unknown> = {};

  try {
    console.log(`[Hit Rates] Starting refresh. Today=${today}, 7d window=${sevenDaysAgo}`);

    // ========================================
    // A) UPDATE bot_strategies WITH ACTUAL WIN RATES
    // ========================================
    const { data: settledParlays, error: parlayErr } = await supabase
      .from('bot_daily_parlays')
      .select('strategy_name, outcome, parlay_date')
      .in('outcome', ['won', 'lost'])
      .gte('parlay_date', sevenDaysAgo);

    if (parlayErr) throw new Error(`Failed to fetch parlays: ${parlayErr.message}`);

    // Extract base strategy name (e.g. "elite_categories_v1" from "elite_categories_v1_execution_grind_stack")
    function extractBaseStrategy(strategyName: string): string {
      // Remove tier suffixes like _execution_grind_stack, _exploration, _validation, etc.
      const cleaned = strategyName
        .replace(/_execution_.*$/, '')
        .replace(/_exploration.*$/, '')
        .replace(/_validation.*$/, '')
        .replace(/_bankroll_doubler.*$/, '');
      return cleaned;
    }

    // Also track sub-strategy (the full name minus the base)
    function extractSubStrategy(strategyName: string): string {
      // Extract parts after base: e.g. "shootout_stack", "grind_stack", "mispriced_edge"
      const match = strategyName.match(/_(execution|exploration|validation)_?(.*)$/);
      if (match) {
        const tier = match[1];
        const variant = match[2] || 'default';
        return `${variant}_${tier}`.replace(/_$/, '');
      }
      return strategyName;
    }

    // Group by base strategy
    const strategyStats: Record<string, { won: number; total: number }> = {};
    for (const p of (settledParlays || [])) {
      const base = extractBaseStrategy(p.strategy_name);
      if (!strategyStats[base]) strategyStats[base] = { won: 0, total: 0 };
      strategyStats[base].total++;
      if (p.outcome === 'won') strategyStats[base].won++;
    }

    // Also compute all-time stats
    const { data: allTimeParlays } = await supabase
      .from('bot_daily_parlays')
      .select('strategy_name, outcome')
      .in('outcome', ['won', 'lost']);

    const allTimeStats: Record<string, { won: number; total: number }> = {};
    for (const p of (allTimeParlays || [])) {
      const base = extractBaseStrategy(p.strategy_name);
      if (!allTimeStats[base]) allTimeStats[base] = { won: 0, total: 0 };
      allTimeStats[base].total++;
      if (p.outcome === 'won') allTimeStats[base].won++;
    }

    // Update bot_strategies
    let strategiesUpdated = 0;
    const { data: strategies } = await supabase
      .from('bot_strategies')
      .select('id, strategy_name')
      .eq('is_active', true);

    for (const strat of (strategies || [])) {
      const stats7d = strategyStats[strat.strategy_name];
      const statsAll = allTimeStats[strat.strategy_name];

      const winRate = stats7d ? (stats7d.won / stats7d.total) * 100 : 0;
      const timesUsed = statsAll?.total || 0;
      const timesWon = statsAll?.won || 0;

      const { error: updateErr } = await supabase
        .from('bot_strategies')
        .update({
          win_rate: Math.round(winRate * 10) / 10,
          times_used: timesUsed,
          times_won: timesWon,
          updated_at: new Date().toISOString(),
        })
        .eq('id', strat.id);

      if (!updateErr) {
        strategiesUpdated++;
        console.log(`[Hit Rates] Strategy "${strat.strategy_name}": 7d=${stats7d?.won || 0}/${stats7d?.total || 0} (${winRate.toFixed(1)}%), all-time=${timesWon}/${timesUsed}`);
      }
    }
    results.strategiesUpdated = strategiesUpdated;

    // ========================================
    // B) REFRESH bot_prop_type_performance
    // ========================================
    // Get all settled parlays with legs
    const { data: allSettled } = await supabase
      .from('bot_daily_parlays')
      .select('legs, outcome')
      .in('outcome', ['won', 'lost']);

    const propStats: Record<string, { total: number; won: number }> = {};

    for (const parlay of (allSettled || [])) {
      const legs = (parlay.legs as any[]) || [];
      for (const leg of legs) {
        const propType = leg.prop_type || leg.category || 'unknown';
        if (!propStats[propType]) propStats[propType] = { total: 0, won: 0 };
        propStats[propType].total++;
        if (leg.outcome === 'hit' || leg.outcome === 'won') {
          propStats[propType].won++;
        }
      }
    }

    let propsUpdated = 0;
    let propsBlocked = 0;
    let propsBoosted = 0;

    for (const [propType, stats] of Object.entries(propStats)) {
      const hitRate = stats.total > 0 ? (stats.won / stats.total) * 100 : 0;
      const isBlocked = hitRate < 25 && stats.total >= 10;
      const isBoosted = hitRate > 65 && stats.total >= 10;

      if (isBlocked) propsBlocked++;
      if (isBoosted) propsBoosted++;

      const { error: upsertErr } = await supabase
        .from('bot_prop_type_performance')
        .upsert({
          prop_type: propType,
          hit_rate: Math.round(hitRate * 10) / 10,
          total_legs: stats.total,
          legs_won: stats.won,
          is_blocked: isBlocked,
          is_boosted: isBoosted,
          last_updated: new Date().toISOString(),
        }, { onConflict: 'prop_type' });

      if (!upsertErr) propsUpdated++;
    }

    results.propsUpdated = propsUpdated;
    results.propsBlocked = propsBlocked;
    results.propsBoosted = propsBoosted;
    console.log(`[Hit Rates] Props: ${propsUpdated} updated, ${propsBlocked} blocked, ${propsBoosted} boosted`);

    // ========================================
    // C) REFRESH bot_player_performance (DEDUPLICATED)
    // ========================================
    const playerStats: Record<string, { 
      player_name: string; prop_type: string; side: string;
      total: number; won: number; edges: number[];
      recentOutcomes: { date: string; hit: boolean }[];
    }> = {};

    for (const parlay of (allSettled || [])) {
      const legs = (parlay.legs as any[]) || [];
      for (const leg of legs) {
        if (!leg.player_name || leg.type === 'team') continue;
        const key = `${leg.player_name}|${leg.prop_type || 'unknown'}|${leg.side || 'over'}`;
        
        if (!playerStats[key]) {
          playerStats[key] = {
            player_name: leg.player_name,
            prop_type: leg.prop_type || 'unknown',
            side: leg.side || 'over',
            total: 0, won: 0, edges: [],
            recentOutcomes: [],
          };
        }
        
        const ps = playerStats[key];
        ps.total++;
        const isHit = leg.outcome === 'hit' || leg.outcome === 'won';
        if (isHit) ps.won++;
        if (leg.edge) ps.edges.push(leg.edge);
        ps.recentOutcomes.push({ date: new Date().toISOString(), hit: isHit });
      }
    }

    let playersUpdated = 0;
    for (const [, stats] of Object.entries(playerStats)) {
      if (stats.total < 1) continue;

      const hitRate = (stats.won / stats.total) * 100;
      const avgEdge = stats.edges.length > 0
        ? stats.edges.reduce((a, b) => a + b, 0) / stats.edges.length
        : 0;

      // Calculate streak from recent outcomes (last 5)
      const recent = stats.recentOutcomes.slice(-5);
      let streak = 0;
      for (let i = recent.length - 1; i >= 0; i--) {
        if (i === recent.length - 1) {
          streak = recent[i].hit ? 1 : -1;
        } else {
          if (recent[i].hit && streak > 0) streak++;
          else if (!recent[i].hit && streak < 0) streak--;
          else break;
        }
      }

      const { error: upsertErr } = await supabase
        .from('bot_player_performance')
        .upsert({
          player_name: stats.player_name,
          prop_type: stats.prop_type,
          side: stats.side,
          legs_played: stats.total,
          legs_won: stats.won,
          hit_rate: Math.round(hitRate * 10) / 10,
          avg_edge: Math.round(avgEdge * 1000) / 1000,
          streak,
          last_updated: new Date().toISOString(),
        }, { onConflict: 'player_name,prop_type,side' });

      if (!upsertErr) playersUpdated++;
    }

    results.playersUpdated = playersUpdated;
    console.log(`[Hit Rates] Players: ${playersUpdated} updated (from ${Object.keys(playerStats).length} unique combos)`);

    // ========================================
    // D) UPDATE strategy_performance TABLE
    // ========================================
    // Group by full strategy name for granular tracking
    const fullStratStats: Record<string, { won: number; lost: number; pending: number; odds: number[] }> = {};
    
    for (const p of (allTimeParlays || [])) {
      if (!fullStratStats[p.strategy_name]) {
        fullStratStats[p.strategy_name] = { won: 0, lost: 0, pending: 0, odds: [] };
      }
      if (p.outcome === 'won') fullStratStats[p.strategy_name].won++;
      else fullStratStats[p.strategy_name].lost++;
    }

    // Get pending counts
    const { data: pendingParlays } = await supabase
      .from('bot_daily_parlays')
      .select('strategy_name')
      .is('outcome', null);

    for (const p of (pendingParlays || [])) {
      if (!fullStratStats[p.strategy_name]) {
        fullStratStats[p.strategy_name] = { won: 0, lost: 0, pending: 0, odds: [] };
      }
      fullStratStats[p.strategy_name].pending++;
    }

    let stratPerfUpdated = 0;
    for (const [stratName, stats] of Object.entries(fullStratStats)) {
      const total = stats.won + stats.lost;
      const winRate = total > 0 ? (stats.won / total) * 100 : 0;

      const { error } = await supabase
        .from('strategy_performance')
        .upsert({
          strategy_name: stratName,
          total_won: stats.won,
          total_lost: stats.lost,
          total_pending: stats.pending,
          total_suggestions: stats.won + stats.lost + stats.pending,
          win_rate: Math.round(winRate * 10) / 10,
          last_updated: new Date().toISOString(),
        }, { onConflict: 'strategy_name' });

      if (!error) stratPerfUpdated++;
    }

    results.strategyPerformanceUpdated = stratPerfUpdated;
    console.log(`[Hit Rates] Strategy performance: ${stratPerfUpdated} rows updated`);

    // ========================================
    // LOG RESULTS
    // ========================================
    await supabase.from('bot_activity_log').insert({
      event_type: 'engine_hit_rates_updated',
      message: `Hit rates refreshed: ${strategiesUpdated} strategies, ${propsUpdated} props (${propsBlocked} blocked, ${propsBoosted} boosted), ${playersUpdated} players`,
      metadata: results,
      severity: 'info',
    });

    console.log(`[Hit Rates] ✅ Complete:`, results);

    return new Response(
      JSON.stringify({ success: true, ...results }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (error) {
    console.error('[Hit Rates] Error:', error);

    await supabase.from('bot_activity_log').insert({
      event_type: 'engine_hit_rates_error',
      message: `Hit rate refresh failed: ${error.message}`,
      metadata: { error: error.message },
      severity: 'error',
    }).catch(() => {});

    return new Response(
      JSON.stringify({ success: false, error: error.message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
