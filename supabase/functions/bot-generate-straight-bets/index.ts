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
  const s = side.toUpperCase();
  if (s === 'OVER') {
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
 * Load learned pick score weights from pick_score_weights table
 */
async function loadPickScoreWeights(supabase: any): Promise<Record<string, { weight: number; avgHit: number; avgMiss: number }>> {
  const { data, error } = await supabase
    .from('pick_score_weights')
    .select('signal_name, weight, avg_when_hit, avg_when_miss');

  if (error || !data || data.length === 0) {
    console.log('[StraightBets] No pick score weights found');
    return {};
  }

  const weights: Record<string, { weight: number; avgHit: number; avgMiss: number }> = {};
  for (const row of data) {
    weights[row.signal_name] = {
      weight: row.weight || 0,
      avgHit: row.avg_when_hit || 0,
      avgMiss: row.avg_when_miss || 0,
    };
  }
  return weights;
}

/**
 * Calculate pick_score using learned DNA weights (0-100 scale)
 */
function calculatePickScore(
  candidate: { l10_hit_rate: number; l10_avg: number; buffer_pct: number; composite_score: number },
  sweetSpot: any,
  weights: Record<string, { weight: number; avgHit: number; avgMiss: number }>
): number {
  const signals: Record<string, number | null> = {
    l10_hit_rate: candidate.l10_hit_rate / 100, // normalize to 0-1
    l10_std_dev: sweetSpot?.l10_std_dev ?? null,
    buffer_pct: candidate.buffer_pct,
    confidence_score: sweetSpot?.confidence_score ?? null,
    matchup_adjustment: sweetSpot?.matchup_adjustment ?? null,
    pace_adjustment: sweetSpot?.pace_adjustment ?? null,
    h2h_matchup_boost: sweetSpot?.h2h_matchup_boost ?? null,
    bounce_back_score: sweetSpot?.bounce_back_score ?? null,
    line_difference: sweetSpot?.line_difference ?? null,
    season_avg: sweetSpot?.season_avg ?? null,
  };

  // Compute trend if we have l3 and l10
  if (sweetSpot?.l3_avg && candidate.l10_avg && candidate.l10_avg > 0) {
    signals.trend_l3_vs_l10 = ((sweetSpot.l3_avg - candidate.l10_avg) / candidate.l10_avg) * 100;
  }

  // Range ratio
  if (sweetSpot?.l10_max && sweetSpot?.l10_min && sweetSpot?.l10_median && sweetSpot.l10_median > 0) {
    signals.range_ratio = (sweetSpot.l10_max - sweetSpot.l10_min) / sweetSpot.l10_median;
  }

  let rawScore = 0;
  let signalsUsed = 0;

  for (const [name, value] of Object.entries(signals)) {
    if (value == null || !weights[name]) continue;
    const w = weights[name];
    // Score contribution: how close is this value to the "hit" average vs "miss" average
    // Normalized: if value is at avgHit, contribute +weight; at avgMiss, contribute -weight
    const range = Math.abs(w.avgHit - w.avgMiss);
    if (range === 0) continue;

    const closenessToHit = 1 - Math.abs(value - w.avgHit) / (range * 2);
    rawScore += closenessToHit * w.weight;
    signalsUsed++;
  }

  if (signalsUsed === 0) return 50; // neutral

  // Normalize to 0-100
  const normalized = ((rawScore / signalsUsed) + 1) * 50;
  return Math.max(0, Math.min(100, Math.round(normalized * 10) / 10));
}
/**
 * Build a FanDuel line lookup map from unified_props
 * Key: normalized "playerName|propType" → { line, bookmaker }
 */
async function buildFanDuelLineMap(supabase: any, today: string): Promise<Map<string, { line: number; odds: number }>> {
  const map = new Map<string, { line: number; odds: number }>();

  const { data, error } = await supabase
    .from('unified_props')
    .select('player_name, prop_type, current_line, over_price, under_price, bookmaker')
    .eq('bookmaker', 'fanduel')
    .gte('created_at', `${today}T00:00:00`)
    .not('current_line', 'is', null);

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
      map.set(key, { line: row.current_line, odds: row.over_price || -110 });
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
): { line: number; source: string; odds: number } | null {
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

  // No FanDuel line found — return null to signal skip
  return null;
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

    // Fetch FanDuel lines, historical rates, and pick DNA weights in parallel
    const [fdMap, historicalRates, pickWeights] = await Promise.all([
      buildFanDuelLineMap(supabase, today),
      getHistoricalPropRates(supabase),
      loadPickScoreWeights(supabase),
    ]);

    const usePickDNA = Object.keys(pickWeights).length >= 3;
    console.log(`[StraightBets] Pick DNA: ${usePickDNA ? `${Object.keys(pickWeights).length} signals loaded` : 'not enough signals, using legacy scoring'}`);

    // Query sweet spots with high hit rates
    const { data: sweetSpots, error: ssErr } = await supabase
      .from('category_sweet_spots')
      .select('player_name, prop_type, recommended_line, recommended_side, l10_hit_rate, confidence_score, l10_avg, l3_avg, l5_avg, l10_std_dev, l10_median, l10_min, l10_max, season_avg, line_difference, matchup_adjustment, pace_adjustment, h2h_matchup_boost, bounce_back_score, category, actual_line')
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
      pick_score: number;
      source: string;
      historical_rate: number;
      line_source: string;
      buffer_pct: number;
      l10_avg: number;
    }> = [];

    let skippedBuffer = 0;
    let skippedHistorical = 0;

    for (const ss of (sweetSpots || [])) {
      const side = (ss.recommended_side || 'OVER').toUpperCase();
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

      // Resolve real FanDuel line — SKIP if no verified line exists
      const resolved = resolveLine(ss.player_name, ss.prop_type, ss.recommended_line, ss.actual_line, fdMap);
      if (!resolved) {
        console.log(`[StraightBets] SKIP ${ss.player_name} ${ss.prop_type} ${side} — no FanDuel line`);
        continue;
      }

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

      // Calculate pick DNA score if weights available
      const candidateData = { l10_hit_rate: hr, l10_avg: l10Avg, buffer_pct: Math.round(buffer * 10) / 10, composite_score: score };
      const pickScore = usePickDNA ? calculatePickScore(candidateData, ss, pickWeights) : 50;

      candidates.push({
        player_name: ss.player_name,
        prop_type: ss.prop_type,
        line: resolved.line,
        side,
        l10_hit_rate: hr,
        composite_score: score,
        pick_score: pickScore,
        source: 'sweet_spot',
        historical_rate: histRate,
        line_source: resolved.source,
        buffer_pct: Math.round(buffer * 10) / 10,
        l10_avg: l10Avg,
      });
    }

    for (const pp of (poolPicks || [])) {
      const side = (pp.recommended_side || 'OVER').toUpperCase();
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

      // Resolve real FanDuel line — SKIP if no verified line exists
      const resolved = resolveLine(pp.player_name, pp.prop_type, pp.recommended_line || 0, null, fdMap);
      if (!resolved) {
        console.log(`[StraightBets] SKIP ${pp.player_name} ${pp.prop_type} ${side} — no FanDuel line`);
        continue;
      }

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

      const candidateData2 = { l10_hit_rate: hr, l10_avg: l10Avg, buffer_pct: Math.round(buffer * 10) / 10, composite_score: score };
      const pickScore = usePickDNA ? calculatePickScore(candidateData2, pp, pickWeights) : 50;

      candidates.push({
        player_name: pp.player_name,
        prop_type: pp.prop_type,
        line: resolved.line,
        side,
        l10_hit_rate: hr,
        composite_score: score,
        pick_score: pickScore,
        source: 'pick_pool',
        historical_rate: histRate,
        line_source: resolved.source,
        buffer_pct: Math.round(buffer * 10) / 10,
        l10_avg: l10Avg,
      });
    }

    console.log(`[StraightBets] ${candidates.length} candidates after filters (skipped: ${skippedBuffer} buffer, ${skippedHistorical} historical)`);

    // Sort by pick_score (DNA) if available, else composite score
    if (usePickDNA) {
      candidates.sort((a, b) => b.pick_score - a.pick_score || b.l10_hit_rate - a.l10_hit_rate);
      // Skip picks with DNA score < 40
      const dnaFiltered = candidates.filter(c => c.pick_score >= 40);
      console.log(`[StraightBets] DNA filter: ${candidates.length} → ${dnaFiltered.length} (removed ${candidates.length - dnaFiltered.length} with score < 40)`);
      candidates.length = 0;
      candidates.push(...dnaFiltered);
    } else {
      candidates.sort((a, b) => b.composite_score - a.composite_score || b.l10_hit_rate - a.l10_hit_rate);
    }
    const selected = candidates.slice(0, maxPicks);

    if (selected.length === 0) {
      console.log('[StraightBets] No qualifying picks found');
      return new Response(JSON.stringify({ success: true, message: 'No qualifying picks', count: 0, skippedBuffer, skippedHistorical }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Insert standard straight bets
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
      bet_type: 'standard',
    }));

    const { error: insertErr } = await supabase
      .from('bot_straight_bets')
      .insert(betsToInsert);

    if (insertErr) throw insertErr;

    console.log(`[StraightBets] Inserted ${betsToInsert.length} standard straight bets`);

    // ═══════════════════════════════════════════════════════════
    // CEILING LINE SCANNER — L3 + H2H Matchup elevated lines
    // ═══════════════════════════════════════════════════════════
    console.log(`[CeilingScanner] Starting ceiling line scan...`);

    const { data: ceilingCandidates, error: ceilErr } = await supabase
      .from('category_sweet_spots')
      .select('player_name, prop_type, actual_line, l3_avg, l10_avg, l10_max, h2h_matchup_boost, l10_hit_rate, confidence_score, recommended_side')
      .eq('is_active', true)
      .eq('analysis_date', today)
      .not('actual_line', 'is', null)
      .not('l3_avg', 'is', null)
      .not('l10_max', 'is', null)
      .gt('h2h_matchup_boost', 0);

    const ceilingBets: any[] = [];

    if (!ceilErr && ceilingCandidates) {
      for (const c of ceilingCandidates) {
        const stdLine = c.actual_line;
        const l3 = c.l3_avg;
        const l10Max = c.l10_max;
        const h2hBoost = c.h2h_matchup_boost || 0;

        // Gate: L3 must clear the book line
        if (l3 <= stdLine) continue;
        // Gate: L10 max must show 25%+ ceiling above line
        if (l10Max < stdLine * 1.25) continue;

        // Calculate ceiling line
        const rawCeil = Math.min(l3 * 0.95, l10Max * 0.8);
        // Round to nearest 0.5
        const ceilLine = Math.round(rawCeil * 2) / 2;

        // Ceiling must be above the standard line
        if (ceilLine <= stdLine) continue;

        // Don't duplicate a standard bet we already placed at this line
        const alreadyPlaced = betsToInsert.some(
          b => b.player_name === c.player_name && b.prop_type === c.prop_type
        );
        if (alreadyPlaced) {
          // Still create ceiling if it's a meaningfully higher line (≥1.5 above standard)
          const existingBet = betsToInsert.find(b => b.player_name === c.player_name && b.prop_type === c.prop_type);
          if (existingBet && ceilLine < existingBet.line + 1.5) continue;
        }

        const hr = (c.l10_hit_rate || 0) <= 1 ? (c.l10_hit_rate || 0) * 100 : (c.l10_hit_rate || 0);
        const reason = `L3 avg ${l3} clears line ${stdLine} | L10 max ${l10Max} (${((l10Max/stdLine - 1)*100).toFixed(0)}% above) | H2H boost +${h2hBoost}`;

        ceilingBets.push({
          bet_date: today,
          player_name: c.player_name,
          prop_type: c.prop_type,
          line: ceilLine,
          side: 'OVER',
          l10_hit_rate: hr,
          composite_score: c.confidence_score || 0,
          simulated_stake: Math.max(25, Math.round(getKellyStake(hr, bankroll) * 0.6)), // smaller stake for higher risk
          simulated_payout: 0, // will be calculated below
          american_odds: -110,
          source: 'ceiling_scanner',
          line_source: 'ceiling',
          buffer_pct: Math.round(((l3 - ceilLine) / ceilLine) * 100 * 10) / 10,
          l10_avg: c.l10_avg || 0,
          bet_type: 'ceiling_straight',
          ceiling_line: ceilLine,
          standard_line: stdLine,
          h2h_boost: h2hBoost,
          ceiling_reason: reason,
        });
      }

      // Calculate payouts
      for (const cb of ceilingBets) {
        cb.simulated_payout = Math.round(cb.simulated_stake * 0.91 * 100) / 100;
      }

      // Limit to top 5 ceiling picks by buffer
      ceilingBets.sort((a: any, b: any) => b.buffer_pct - a.buffer_pct);
      const topCeilings = ceilingBets.slice(0, 5);

      if (topCeilings.length > 0) {
        const { error: cInsertErr } = await supabase
          .from('bot_straight_bets')
          .insert(topCeilings);

        if (cInsertErr) {
          console.error(`[CeilingScanner] Insert error:`, cInsertErr.message);
        } else {
          console.log(`[CeilingScanner] Inserted ${topCeilings.length} ceiling straight bets`);
        }
      }
    }

    console.log(`[CeilingScanner] Found ${ceilingBets.length} candidates, inserted ${Math.min(ceilingBets.length, 5)}`);

    // Build Telegram message
    const totalStake = betsToInsert.reduce((sum, b) => sum + b.simulated_stake, 0);
    const fdCount = betsToInsert.filter(b => b.line_source === 'fanduel').length;

    let msg = `📊 *STRAIGHT BETS — ${today}*\n`;
    msg += `${betsToInsert.length} picks | $${totalStake} total risk\n`;
    msg += `${fdCount}/${betsToInsert.length} FanDuel lines | Min buffer: ${minBuffer}%\n`;
    if (usePickDNA) msg += `🧬 Pick DNA scoring active\n`;
    msg += `\n`;

    for (let i = 0; i < selected.length; i++) {
      const s = selected[i];
      const b = betsToInsert[i];
      const label = PROP_LABELS[b.prop_type] || b.prop_type;
      const arrow = b.side === 'OVER' ? '⬆️' : '⬇️';
      const histKey = `${b.prop_type}|${b.side}`;
      const hRate = historicalRates[histKey] ?? '?';
      const srcTag = b.line_source === 'fanduel' ? '(FD)' : b.line_source === 'actual_line' ? '(AL)' : '(RC)';
      const dnaTag = usePickDNA ? ` | DNA: ${s.pick_score}` : '';
      msg += `${arrow} *${b.player_name}* ${b.side} ${b.line} ${label} ${srcTag}\n`;
      msg += `   L10: ${b.l10_hit_rate}% | Avg: ${b.l10_avg} | Buf: +${b.buffer_pct}%${dnaTag} | $${b.simulated_stake}\n`;
    }

    // Append ceiling picks to Telegram
    const insertedCeilings = ceilingBets.slice(0, 5);
    if (insertedCeilings.length > 0) {
      const ceilStake = insertedCeilings.reduce((s: number, c: any) => s + c.simulated_stake, 0);
      msg += `\n🚀 *CEILING STRAIGHTS* (${insertedCeilings.length} picks | $${ceilStake} risk)\n`;
      for (const c of insertedCeilings) {
        const label = PROP_LABELS[c.prop_type] || c.prop_type;
        msg += `⬆️ *${c.player_name}* OVER ${c.ceiling_line} ${label}\n`;
        msg += `   Book: ${c.standard_line} → Ceil: ${c.ceiling_line} | L3: ${c.l10_avg} | H2H: +${c.h2h_boost} | $${c.simulated_stake}\n`;
      }
    }

    msg += `\n_Buffer ≥${minBuffer}% | Hist ≥55%${usePickDNA ? ' | DNA scored' : ''} | Kelly @ $${bankroll}_`;

    // Send via bot-send-telegram
    await supabase.functions.invoke('bot-send-telegram', {
      body: {
        type: 'straight_bets',
        data: {
          message: msg,
          picks: [...betsToInsert, ...insertedCeilings],
          totalStake: totalStake + insertedCeilings.reduce((s: number, c: any) => s + c.simulated_stake, 0),
        },
      },
    });

    // Log activity
    const totalCeilings = Math.min(ceilingBets.length, 5);
    await supabase.from('bot_activity_log').insert({
      event_type: 'straight_bets_generated',
      message: `Generated ${betsToInsert.length} standard + ${totalCeilings} ceiling straight bets, $${totalStake} risk, ${fdCount} FD lines`,
      metadata: { date: today, count: betsToInsert.length, ceilingCount: totalCeilings, totalStake, fdCount, skippedBuffer, skippedHistorical },
      severity: 'info',
    });

    return new Response(JSON.stringify({
      success: true,
      count: betsToInsert.length,
      ceilingCount: totalCeilings,
      totalStake,
      fdLines: fdCount,
      skippedBuffer,
      skippedHistorical,
      standardPicks: betsToInsert.map(b => `${b.player_name} ${b.side} ${b.line} ${b.prop_type} [${b.line_source}] +${b.buffer_pct}%`),
      ceilingPicks: insertedCeilings.map((c: any) => `${c.player_name} OVER ${c.ceiling_line} ${c.prop_type} (book: ${c.standard_line}, h2h: +${c.h2h_boost})`),
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
