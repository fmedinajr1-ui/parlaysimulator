/**
 * analyze-pick-dna — Learns which pre-game signals predict wins
 * 
 * Queries all settled picks from category_sweet_spots, computes
 * signal separation (avg_when_hit - avg_when_miss) / stddev,
 * stores learned weights in pick_score_weights table,
 * and sends a DNA report to Telegram.
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface SettledPick {
  outcome: string;
  l10_hit_rate: number | null;
  l10_avg: number | null;
  l5_avg: number | null;
  l3_avg: number | null;
  l10_std_dev: number | null;
  l10_median: number | null;
  l10_min: number | null;
  l10_max: number | null;
  confidence_score: number | null;
  season_avg: number | null;
  line_difference: number | null;
  matchup_adjustment: number | null;
  pace_adjustment: number | null;
  h2h_avg_vs_opponent: number | null;
  h2h_matchup_boost: number | null;
  bounce_back_score: number | null;
  actual_line: number | null;
  recommended_line: number | null;
  recommended_side: string | null;
  games_played: number | null;
  projected_value: number | null;
}

interface SignalStats {
  name: string;
  avgHit: number;
  avgMiss: number;
  stddev: number;
  separation: number;
  weight: number;
  hitCount: number;
  missCount: number;
}

function safeNum(v: any): number | null {
  if (v == null) return null;
  const n = Number(v);
  return isFinite(n) ? n : null;
}

function extractSignals(pick: SettledPick): Record<string, number | null> {
  const l10Avg = safeNum(pick.l10_avg);
  const line = safeNum(pick.actual_line) ?? safeNum(pick.recommended_line);
  const side = (pick.recommended_side || 'OVER').toUpperCase();

  let bufferPct: number | null = null;
  if (l10Avg != null && line != null && line > 0) {
    bufferPct = side === 'OVER'
      ? ((l10Avg - line) / line) * 100
      : ((line - l10Avg) / line) * 100;
  }

  // Trend: L3 vs L10 (positive = heating up)
  const l3 = safeNum(pick.l3_avg);
  const l10 = safeNum(pick.l10_avg);
  let trend: number | null = null;
  if (l3 != null && l10 != null && l10 > 0) {
    trend = ((l3 - l10) / l10) * 100;
  }

  // Range ratio: (max - min) / median — measures consistency
  const max = safeNum(pick.l10_max);
  const min = safeNum(pick.l10_min);
  const median = safeNum(pick.l10_median);
  let rangeRatio: number | null = null;
  if (max != null && min != null && median != null && median > 0) {
    rangeRatio = (max - min) / median;
  }

  return {
    l10_hit_rate: safeNum(pick.l10_hit_rate),
    l10_std_dev: safeNum(pick.l10_std_dev),
    buffer_pct: bufferPct,
    trend_l3_vs_l10: trend,
    confidence_score: safeNum(pick.confidence_score),
    matchup_adjustment: safeNum(pick.matchup_adjustment),
    pace_adjustment: safeNum(pick.pace_adjustment),
    h2h_matchup_boost: safeNum(pick.h2h_matchup_boost),
    bounce_back_score: safeNum(pick.bounce_back_score),
    line_difference: safeNum(pick.line_difference),
    range_ratio: rangeRatio,
    season_avg: safeNum(pick.season_avg),
  };
}

function computeStats(signalName: string, hitVals: number[], missVals: number[]): SignalStats | null {
  if (hitVals.length < 10 || missVals.length < 10) return null;

  const avgHit = hitVals.reduce((a, b) => a + b, 0) / hitVals.length;
  const avgMiss = missVals.reduce((a, b) => a + b, 0) / missVals.length;

  // Combined stddev
  const all = [...hitVals, ...missVals];
  const mean = all.reduce((a, b) => a + b, 0) / all.length;
  const variance = all.reduce((sum, v) => sum + (v - mean) ** 2, 0) / all.length;
  const stddev = Math.sqrt(variance);

  if (stddev === 0) return null;

  const separation = (avgHit - avgMiss) / stddev;

  return {
    name: signalName,
    avgHit: Math.round(avgHit * 1000) / 1000,
    avgMiss: Math.round(avgMiss * 1000) / 1000,
    stddev: Math.round(stddev * 1000) / 1000,
    separation: Math.round(separation * 1000) / 1000,
    weight: 0, // computed after normalization
    hitCount: hitVals.length,
    missCount: missVals.length,
  };
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
  const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const supabase = createClient(supabaseUrl, supabaseKey);

  try {
    console.log('[PickDNA] Starting signal analysis...');

    // Fetch ALL settled picks
    const { data: settled, error: fetchErr } = await supabase
      .from('category_sweet_spots')
      .select(`
        outcome, l10_hit_rate, l10_avg, l5_avg, l3_avg, l10_std_dev,
        l10_median, l10_min, l10_max, confidence_score, season_avg,
        line_difference, matchup_adjustment, pace_adjustment,
        h2h_avg_vs_opponent, h2h_matchup_boost, bounce_back_score,
        actual_line, recommended_line, recommended_side
      `)
      .in('outcome', ['hit', 'miss']);

    if (fetchErr) throw fetchErr;

    const picks = (settled || []) as SettledPick[];
    const totalPicks = picks.length;
    console.log(`[PickDNA] Loaded ${totalPicks} settled picks`);

    if (totalPicks < 50) {
      return new Response(JSON.stringify({
        success: false,
        message: `Only ${totalPicks} settled picks — need at least 50 for analysis`,
      }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    // Collect signal values grouped by outcome
    const hitSignals: Record<string, number[]> = {};
    const missSignals: Record<string, number[]> = {};

    for (const pick of picks) {
      const signals = extractSignals(pick);
      const isHit = pick.outcome === 'hit';
      const bucket = isHit ? hitSignals : missSignals;

      for (const [name, value] of Object.entries(signals)) {
        if (value == null) continue;
        if (!bucket[name]) bucket[name] = [];
        bucket[name].push(value);
      }
    }

    // Compute separation for each signal
    const allSignalNames = new Set([...Object.keys(hitSignals), ...Object.keys(missSignals)]);
    const stats: SignalStats[] = [];

    for (const name of allSignalNames) {
      const hitVals = hitSignals[name] || [];
      const missVals = missSignals[name] || [];
      const result = computeStats(name, hitVals, missVals);
      if (result) stats.push(result);
    }

    // Normalize weights: scale separations to -1..+1
    const maxAbsSep = Math.max(...stats.map(s => Math.abs(s.separation)), 0.01);
    for (const s of stats) {
      s.weight = Math.round((s.separation / maxAbsSep) * 1000) / 1000;
    }

    // Sort by absolute separation descending
    stats.sort((a, b) => Math.abs(b.separation) - Math.abs(a.separation));

    console.log('[PickDNA] Signal weights computed:');
    for (const s of stats) {
      console.log(`  ${s.name}: sep=${s.separation}, weight=${s.weight}, hit=${s.avgHit}, miss=${s.avgMiss}`);
    }

    // Upsert into pick_score_weights
    const now = new Date().toISOString();
    for (const s of stats) {
      await supabase
        .from('pick_score_weights')
        .upsert({
          signal_name: s.name,
          weight: s.weight,
          avg_when_hit: s.avgHit,
          avg_when_miss: s.avgMiss,
          separation: s.separation,
          sample_size: s.hitCount + s.missCount,
          calibrated_at: now,
        }, { onConflict: 'signal_name' });
    }

    console.log(`[PickDNA] Upserted ${stats.length} signal weights`);

    // Build Telegram report
    const hitCount = picks.filter(p => p.outcome === 'hit').length;
    const missCount = picks.filter(p => p.outcome === 'miss').length;
    const hitRate = Math.round((hitCount / totalPicks) * 1000) / 10;

    const topSignals = stats.filter(s => Math.abs(s.separation) >= 0.3).slice(0, 6);
    const weakSignals = stats.filter(s => Math.abs(s.separation) < 0.15);

    let msg = `🧬 *PICK DNA REPORT*\n`;
    msg += `📊 ${totalPicks.toLocaleString()} settled picks analyzed\n`;
    msg += `✅ ${hitCount} hits (${hitRate}%) | ❌ ${missCount} misses\n\n`;

    msg += `*Top Win Signals:*\n`;
    for (let i = 0; i < topSignals.length; i++) {
      const s = topSignals[i];
      const dir = s.separation > 0 ? '↑' : '↓';
      // For l10_std_dev, lower is better (negative separation means lower = hit)
      const desc = s.name === 'l10_std_dev'
        ? `Winners avg ${s.avgHit}, losers avg ${s.avgMiss}`
        : `Winners avg ${s.avgHit}, losers avg ${s.avgMiss}`;
      msg += `${i + 1}. *${s.name}* (${Math.abs(s.separation).toFixed(2)} sep ${dir})\n`;
      msg += `   ${desc}\n`;
    }

    if (weakSignals.length > 0) {
      msg += `\n*Weak Signals (don't predict wins):*\n`;
      for (const s of weakSignals.slice(0, 3)) {
        msg += `• ${s.name} (${Math.abs(s.separation).toFixed(2)} sep)\n`;
      }
    }

    msg += `\n_Weights applied to tomorrow's pick scoring_`;

    // Send Telegram
    await supabase.functions.invoke('bot-send-telegram', {
      body: {
        type: 'pick_dna',
        data: { message: msg },
      },
    });

    // Log
    await supabase.from('bot_activity_log').insert({
      event_type: 'pick_dna_analysis',
      message: `Analyzed ${totalPicks} picks, computed ${stats.length} signal weights`,
      metadata: {
        total_picks: totalPicks,
        hit_rate: hitRate,
        top_signals: topSignals.map(s => ({ name: s.name, separation: s.separation, weight: s.weight })),
      },
      severity: 'info',
    });

    return new Response(JSON.stringify({
      success: true,
      totalPicks,
      hitRate,
      signalCount: stats.length,
      topSignals: topSignals.map(s => ({
        name: s.name,
        separation: s.separation,
        weight: s.weight,
        avgHit: s.avgHit,
        avgMiss: s.avgMiss,
      })),
    }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Unknown error';
    console.error('[PickDNA] Error:', msg);
    return new Response(JSON.stringify({ success: false, error: msg }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
