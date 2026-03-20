/**
 * bot-generate-straight-bets — Individual pick generator
 * 
 * Queries sweet spot / unified props pool, resolves REAL FanDuel lines,
 * applies buffer gate (≥15%) and historical prop win rate filtering,
 * then generates individual straight bets. Sends Telegram broadcast.
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

const PROP_LABELS: Record<string, string> = {
  threes: '3PT', points: 'PTS', assists: 'AST', rebounds: 'REB',
  steals: 'STL', blocks: 'BLK', turnovers: 'TO', pra: 'PRA',
  pts_rebs: 'P+R', pts_asts: 'P+A', rebs_asts: 'R+A',
  three_pointers_made: '3PT', player_points: 'PTS', player_rebounds: 'REB',
  player_assists: 'AST', player_threes: '3PT',
};

// Normalize prop type for matching between sweet spots and unified_props
const PROP_TYPE_MAP: Record<string, string[]> = {
  points: ['player_points', 'points'],
  rebounds: ['player_rebounds', 'rebounds'],
  assists: ['player_assists', 'assists'],
  threes: ['player_threes', 'three_pointers_made', 'threes'],
  steals: ['player_steals', 'steals'],
  blocks: ['player_blocks', 'blocks'],
  turnovers: ['player_turnovers', 'turnovers'],
  pra: ['player_pts_rebs_asts', 'pra'],
  pts_rebs: ['player_pts_rebs', 'pts_rebs'],
  pts_asts: ['player_pts_asts', 'pts_asts'],
  rebs_asts: ['player_rebs_asts', 'rebs_asts'],
};

/**
 * Kelly Criterion staking: stake = bankroll × (hit_rate × 1.91 - 1) / 0.91
 * Capped at 5% of bankroll, floored at $25
 */
function getKellyStake(hitRate: number, bankroll: number): number {
  const p = hitRate / 100;
  const edge = (p * 1.91 - 1) / 0.91;
  if (edge <= 0) return 25;
  const raw = bankroll * edge * 0.5;
  const capped = Math.min(raw, bankroll * 0.05);
  return Math.max(25, Math.round(capped));
}

/**
 * Calculate buffer percentage between L10 avg and line
 */
function calcBuffer(l10Avg: number, line: number, side: string): number {
  if (line <= 0) return 0;
  if (side === 'OVER') {
    return ((l10Avg - line) / line) * 100;
  } else {
    return ((line - l10Avg) / line) * 100;
  }
}

/**
 * Query historical win rates by prop_type + side from settled sweet spots
 */
async function getHistoricalPropRates(supabase: any): Promise<Record<string, number>> {
  const { data, error } = await supabase
    .from('category_sweet_spots')
    .select('prop_type, recommended_side, outcome')
    .in('outcome', ['hit', 'miss', 'push']);

  if (error || !data) {
    console.log('[StraightBets] Could not fetch historical rates, using defaults');
    return {};
  }

  const stats: Record<string, { hits: number; total: number }> = {};
  for (const row of data) {
    const key = `${row.prop_type}|${row.recommended_side || 'OVER'}`;
    if (!stats[key]) stats[key] = { hits: 0, total: 0 };
    stats[key].total++;
    if (row.outcome === 'hit') stats[key].hits++;
  }

  const rates: Record<string, number> = {};
  for (const [key, val] of Object.entries(stats)) {
    if (val.total >= 5) {
      rates[key] = Math.round((val.hits / val.total) * 1000) / 10;
    }
  }

  console.log('[StraightBets] Historical prop rates:', JSON.stringify(rates));
  return rates;
}

/**
 * Build a FanDuel line lookup map from unified_props
 * Key: normalized "playerName|propType" → { line, bookmaker }
 */
async function buildFanDuelLineMap(supabase: any, today: string): Promise<Map<string, { line: number; odds: number }>> {
  const map = new Map<string, { line: number; odds: number }>();

  const { data, error } = await supabase
    .from('unified_props')
    .select('player_name, prop_type, line, over_price, under_price, bookmaker')
    .eq('bookmaker', 'fanduel')
    .gte('created_at', `${today}T00:00:00`)
    .not('line', 'is', null);

  if (error || !data) {
    console.log('[StraightBets] Could not fetch FanDuel lines:', error?.message);
    return map;
  }

  for (const row of data) {
    const name = row.player_name?.toLowerCase().trim();
    const prop = row.prop_type?.toLowerCase().trim();
    if (!name || !prop) continue;

    const key = `${name}|${prop}`;
    // Keep the most recent entry (data is ordered by created_at desc by default)
    if (!map.has(key)) {
      map.set(key, { line: row.line, odds: row.over_price || -110 });
    }
  }

  console.log(`[StraightBets] FanDuel line map: ${map.size} entries`);
  return map;
}

/**
 * Resolve the best available line for a candidate
 */
function resolveLine(
  playerName: string,
  propType: string,
  recommendedLine: number,
  actualLine: number | null,
  fdMap: Map<string, { line: number; odds: number }>
): { line: number; source: string; odds: number } {
  const name = playerName.toLowerCase().trim();

  // Try all prop type aliases against FanDuel map
  const aliases = PROP_TYPE_MAP[propType] || [propType];
  for (const alias of aliases) {
    const key = `${name}|${alias}`;
    const fd = fdMap.get(key);
    if (fd) {
      return { line: fd.line, source: 'fanduel', odds: fd.odds };
    }
  }

  // Also try the raw prop type
  const directKey = `${name}|${propType}`;
  const directFd = fdMap.get(directKey);
  if (directFd) {
    return { line: directFd.line, source: 'fanduel', odds: directFd.odds };
  }

  // Fallback to actual_line from sweet spots
  if (actualLine != null && actualLine > 0) {
    return { line: actualLine, source: 'actual_line', odds: -110 };
  }

  // Last resort: recommended_line
  return { line: recommendedLine, source: 'recommended', odds: -110 };
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
  const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const supabase = createClient(supabaseUrl, supabaseKey);

  try {
    const body = await req.json().catch(() => ({}));
    const today = body.date || getEasternDate();
    const minHitRate = body.min_hit_rate ?? 70;
    const maxPicks = body.max_picks ?? 20;
    const bankroll = body.bankroll ?? 500;
    const minBuffer = body.min_buffer ?? 15; // 15% minimum buffer

    console.log(`[StraightBets] Generating for ${today} | minHitRate=${minHitRate} | maxPicks=${maxPicks} | bankroll=${bankroll} | minBuffer=${minBuffer}%`);

    // Check for existing straight bets today
    const { count: existing } = await supabase
      .from('bot_straight_bets')
      .select('*', { count: 'exact', head: true })
      .eq('bet_date', today);

    if ((existing || 0) > 0) {
      console.log(`[StraightBets] Already generated ${existing} bets for ${today}`);
      return new Response(JSON.stringify({ success: true, message: `Already generated ${existing} bets`, skipped: true }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Fetch FanDuel lines, historical rates in parallel
    const [fdMap, historicalRates] = await Promise.all([
      buildFanDuelLineMap(supabase, today),
      getHistoricalPropRates(supabase),
    ]);

    // Query sweet spots with high hit rates
    const { data: sweetSpots, error: ssErr } = await supabase
      .from('category_sweet_spots')
      .select('player_name, prop_type, recommended_line, recommended_side, l10_hit_rate, confidence_score, l10_avg, category, actual_line')
      .eq('is_active', true)
      .eq('analysis_date', today)
      .gte('l10_hit_rate', minHitRate / 100)
      .not('recommended_line', 'is', null)
      .order('l10_hit_rate', { ascending: false });

    if (ssErr) throw ssErr;

    // Also check daily pick pool
    const { data: poolPicks, error: poolErr } = await supabase
      .from('bot_daily_pick_pool')
      .select('player_name, prop_type, recommended_line, recommended_side, l10_hit_rate, composite_score, l10_avg')
      .eq('pick_date', today)
      .gte('l10_hit_rate', minHitRate)
      .order('l10_hit_rate', { ascending: false });

    if (poolErr) throw poolErr;

    // Combine and deduplicate by player+prop
    const seen = new Set<string>();
    const candidates: Array<{
      player_name: string;
      prop_type: string;
      line: number;
      side: string;
      l10_hit_rate: number;
      composite_score: number;
      source: string;
      historical_rate: number;
      line_source: string;
      buffer_pct: number;
      l10_avg: number;
    }> = [];

    let skippedBuffer = 0;
    let skippedHistorical = 0;

    for (const ss of (sweetSpots || [])) {
      const side = ss.recommended_side || 'OVER';
      const key = `${ss.player_name}|${ss.prop_type}|${side}`;
      if (seen.has(key)) continue;
      seen.add(key);

      const hr = (ss.l10_hit_rate || 0) <= 1 ? (ss.l10_hit_rate || 0) * 100 : (ss.l10_hit_rate || 0);
      const l10Avg = ss.l10_avg || 0;

      // Historical rate check
      const histKey = `${ss.prop_type}|${side}`;
      const histRate = historicalRates[histKey] ?? 60;
      if (histRate < 55) {
        console.log(`[StraightBets] SKIP ${ss.player_name} ${ss.prop_type} ${side} — historical rate ${histRate}% < 55%`);
        skippedHistorical++;
        continue;
      }

      // Resolve real FanDuel line
      const resolved = resolveLine(ss.player_name, ss.prop_type, ss.recommended_line, ss.actual_line, fdMap);

      // Buffer gate
      const buffer = calcBuffer(l10Avg, resolved.line, side);
      if (buffer < minBuffer) {
        console.log(`[StraightBets] SKIP ${ss.player_name} ${ss.prop_type} ${side} — buffer ${buffer.toFixed(1)}% < ${minBuffer}% (avg=${l10Avg}, line=${resolved.line}, src=${resolved.source})`);
        skippedBuffer++;
        continue;
      }

      let score = ss.confidence_score || 0;
      if (histRate >= 75) score += 15;
      else if (histRate >= 70) score += 10;
      else if (histRate < 60) score -= 20;

      // Bonus for FanDuel-sourced lines (more reliable)
      if (resolved.source === 'fanduel') score += 5;

      candidates.push({
        player_name: ss.player_name,
        prop_type: ss.prop_type,
        line: resolved.line,
        side,
        l10_hit_rate: hr,
        composite_score: score,
        source: 'sweet_spot',
        historical_rate: histRate,
        line_source: resolved.source,
        buffer_pct: Math.round(buffer * 10) / 10,
        l10_avg: l10Avg,
      });
    }

    for (const pp of (poolPicks || [])) {
      const side = pp.recommended_side || 'OVER';
      const key = `${pp.player_name}|${pp.prop_type}|${side}`;
      if (seen.has(key)) continue;
      seen.add(key);

      const hr = (pp.l10_hit_rate || 0) <= 1 ? (pp.l10_hit_rate || 0) * 100 : (pp.l10_hit_rate || 0);
      const l10Avg = pp.l10_avg || 0;

      const histKey = `${pp.prop_type}|${side}`;
      const histRate = historicalRates[histKey] ?? 60;
      if (histRate < 55) {
        skippedHistorical++;
        continue;
      }

      // Resolve real FanDuel line (pool picks don't have actual_line)
      const resolved = resolveLine(pp.player_name, pp.prop_type, pp.recommended_line || 0, null, fdMap);

      const buffer = calcBuffer(l10Avg, resolved.line, side);
      if (buffer < minBuffer) {
        console.log(`[StraightBets] SKIP ${pp.player_name} ${pp.prop_type} ${side} — buffer ${buffer.toFixed(1)}% < ${minBuffer}% (avg=${l10Avg}, line=${resolved.line})`);
        skippedBuffer++;
        continue;
      }

      let score = pp.composite_score || 0;
      if (histRate >= 75) score += 15;
      else if (histRate >= 70) score += 10;
      else if (histRate < 60) score -= 20;
      if (resolved.source === 'fanduel') score += 5;

      candidates.push({
        player_name: pp.player_name,
        prop_type: pp.prop_type,
        line: resolved.line,
        side,
        l10_hit_rate: hr,
        composite_score: score,
        source: 'pick_pool',
        historical_rate: histRate,
        line_source: resolved.source,
        buffer_pct: Math.round(buffer * 10) / 10,
        l10_avg: l10Avg,
      });
    }

    console.log(`[StraightBets] ${candidates.length} candidates after filters (skipped: ${skippedBuffer} buffer, ${skippedHistorical} historical)`);

    // Sort by boosted composite score desc, then hit rate desc
    candidates.sort((a, b) => b.composite_score - a.composite_score || b.l10_hit_rate - a.l10_hit_rate);
    const selected = candidates.slice(0, maxPicks);

    if (selected.length === 0) {
      console.log('[StraightBets] No qualifying picks found');
      return new Response(JSON.stringify({ success: true, message: 'No qualifying picks', count: 0, skippedBuffer, skippedHistorical }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Insert straight bets
    const betsToInsert = selected.map(s => ({
      bet_date: today,
      player_name: s.player_name,
      prop_type: s.prop_type,
      line: s.line,
      side: s.side,
      l10_hit_rate: s.l10_hit_rate,
      composite_score: s.composite_score,
      simulated_stake: getKellyStake(s.l10_hit_rate, bankroll),
      simulated_payout: Math.round(getKellyStake(s.l10_hit_rate, bankroll) * 0.91 * 100) / 100,
      american_odds: -110,
      source: s.source,
      line_source: s.line_source,
      buffer_pct: s.buffer_pct,
      l10_avg: s.l10_avg,
    }));

    const { error: insertErr } = await supabase
      .from('bot_straight_bets')
      .insert(betsToInsert);

    if (insertErr) throw insertErr;

    console.log(`[StraightBets] Inserted ${betsToInsert.length} straight bets`);

    // Build Telegram message
    const totalStake = betsToInsert.reduce((sum, b) => sum + b.simulated_stake, 0);
    const fdCount = betsToInsert.filter(b => b.line_source === 'fanduel').length;

    let msg = `📊 *STRAIGHT BETS — ${today}*\n`;
    msg += `${betsToInsert.length} picks | $${totalStake} total risk\n`;
    msg += `${fdCount}/${betsToInsert.length} FanDuel lines | Min buffer: ${minBuffer}%\n\n`;

    for (const b of betsToInsert) {
      const label = PROP_LABELS[b.prop_type] || b.prop_type;
      const arrow = b.side === 'OVER' ? '⬆️' : '⬇️';
      const histKey = `${b.prop_type}|${b.side}`;
      const hRate = historicalRates[histKey] ?? '?';
      const srcTag = b.line_source === 'fanduel' ? '(FD)' : b.line_source === 'actual_line' ? '(AL)' : '(RC)';
      msg += `${arrow} *${b.player_name}* ${b.side} ${b.line} ${label} ${srcTag}\n`;
      msg += `   L10: ${b.l10_hit_rate}% | Avg: ${b.l10_avg} | Buffer: +${b.buffer_pct}% | Hist: ${hRate}% | $${b.simulated_stake}\n`;
    }

    msg += `\n_Buffer-gated ≥${minBuffer}% | Hist-filtered ≥55% | Kelly @ $${bankroll}_`;

    // Send via bot-send-telegram
    await supabase.functions.invoke('bot-send-telegram', {
      body: {
        type: 'straight_bets',
        data: {
          message: msg,
          picks: betsToInsert,
          totalStake,
        },
      },
    });

    // Log activity
    await supabase.from('bot_activity_log').insert({
      event_type: 'straight_bets_generated',
      message: `Generated ${betsToInsert.length} straight bets, $${totalStake} total risk, ${fdCount} FD lines`,
      metadata: { date: today, count: betsToInsert.length, totalStake, fdCount, skippedBuffer, skippedHistorical },
      severity: 'info',
    });

    return new Response(JSON.stringify({
      success: true,
      count: betsToInsert.length,
      totalStake,
      fdLines: fdCount,
      skippedBuffer,
      skippedHistorical,
      picks: betsToInsert.map(b => `${b.player_name} ${b.side} ${b.line} ${b.prop_type} [${b.line_source}] +${b.buffer_pct}%`),
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Unknown error';
    console.error('[StraightBets] Error:', msg);
    return new Response(JSON.stringify({ success: false, error: msg }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
