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

function normKey(player: string, prop: string): string {
  return `${player.toLowerCase().trim()}|${prop.replace(/^(player_|batter_|pitcher_)/, '').toLowerCase().trim()}`;
}

interface VerdictCandidate {
  player_name: string;
  prop_type: string;
  side: string;
  line: number | null;
  sport: string;
  // 5 cross-reference signals
  fanduel_signal_type: string | null;
  fanduel_accuracy: number | null;
  high_conviction_match: boolean;
  line_projection_agrees: boolean;
  category_weight: number | null;
  category_blocked: boolean;
  line_drift_ok: boolean;
  engines_agreeing: string[];
  engine_details: Record<string, any>;
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
  const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const supabase = createClient(supabaseUrl, supabaseKey);
  const today = getEasternDate();
  const log = (msg: string) => console.log(`[FinalVerdict] ${msg}`);

  try {
    log(`Starting cross-reference for ${today}`);

    // ── 1. Fetch all data sources in parallel ──
    const [
      fanduelRes,
      highConvRes,
      lineProjRes,
      catWeightsRes,
      unifiedPropsRes,
      mispricedRes,
    ] = await Promise.all([
      // FanDuel prediction signals (PERFECT/STRONG only, unsettled)
      supabase.from('fanduel_prediction_accuracy')
        .select('player_name, prop_type, prediction, signal_type, sport, confidence_at_signal, edge_at_signal, signal_factors, event_id')
        .gte('created_at', `${today}T00:00:00`)
        .is('was_correct', null)
        .in('signal_type', ['PERFECT', 'STRONG', 'perfect_line_perfect', 'live_line_moving', 'take_it_now']),

      // High conviction results (already cross-engine validated)
      supabase.from('high_conviction_results')
        .select('player_name, prop_type, signal, edge_pct, confidence_tier, conviction_score, engines, sport, side_agreement')
        .eq('analysis_date', today),

      // Line projection results
      supabase.from('line_projection_results')
        .select('player_name, prop_type, projected_value, fanduel_line, edge_pct, edge_grade, predicted_line_direction, recommended_side')
        .eq('game_date', today),

      // Category weights (Bayesian performance)
      supabase.from('bot_category_weights')
        .select('category, side, weight, bayesian_hit_rate, is_blocked'),

      // Verified FanDuel lines (active props with a line)
      supabase.from('unified_props')
        .select('player_name, prop_type, current_line')
        .eq('is_active', true)
        .not('current_line', 'is', null),

      // Mispriced lines for drift detection
      supabase.from('mispriced_lines')
        .select('player_name, prop_type, signal, edge_pct, book_line, player_avg_l10, sport')
        .eq('analysis_date', today),
    ]);

    const fdSignals = fanduelRes.data || [];
    const hcResults = highConvRes.data || [];
    const lpResults = lineProjRes.data || [];
    const catWeights = catWeightsRes.data || [];
    const verifiedProps = unifiedPropsRes.data || [];
    const mispricedLines = mispricedRes.data || [];

    log(`Sources: FD=${fdSignals.length}, HC=${hcResults.length}, LP=${lpResults.length}, CatW=${catWeights.length}, Props=${verifiedProps.length}, Mispriced=${mispricedLines.length}`);

    // ── 2. Build lookup maps ──

    // High Conviction map
    const hcMap = new Map<string, typeof hcResults[0]>();
    for (const hc of hcResults) {
      hcMap.set(normKey(hc.player_name, hc.prop_type), hc);
    }

    // Line Projection map
    const lpMap = new Map<string, typeof lpResults[0]>();
    for (const lp of lpResults) {
      lpMap.set(normKey(lp.player_name, lp.prop_type), lp);
    }

    // Category weight map
    const cwMap = new Map<string, { weight: number; blocked: boolean; hitRate: number }>();
    for (const cw of catWeights) {
      const key = `${cw.category}|${cw.side}`;
      cwMap.set(key, { weight: cw.weight || 0.5, blocked: cw.is_blocked || false, hitRate: cw.bayesian_hit_rate || 0.5 });
    }

    // Verified lines map
    const verifiedMap = new Map<string, number>();
    for (const vp of verifiedProps) {
      verifiedMap.set(normKey(vp.player_name, vp.prop_type), vp.line);
    }

    // Mispriced map for drift detection
    const mispricedMap = new Map<string, typeof mispricedLines[0]>();
    for (const ml of mispricedLines) {
      mispricedMap.set(normKey(ml.player_name, ml.prop_type), ml);
    }

    // ── 3. Build candidates starting from FanDuel signals ──
    const candidates = new Map<string, VerdictCandidate>();

    // Seed from FanDuel predictions
    for (const fd of fdSignals) {
      if (!fd.player_name || !fd.prop_type) continue;
      const key = normKey(fd.player_name, fd.prop_type);
      if (!verifiedMap.has(key)) continue; // FanDuel-only mandate

      const predLower = (fd.prediction || '').toLowerCase();
      const side = predLower.includes('under') ? 'under' : 'over';
      const sf = (fd.signal_factors || {}) as Record<string, any>;

      candidates.set(key, {
        player_name: fd.player_name,
        prop_type: fd.prop_type,
        side,
        line: sf.line ?? sf.fanduel_line ?? verifiedMap.get(key) ?? null,
        sport: fd.sport || '',
        fanduel_signal_type: fd.signal_type,
        fanduel_accuracy: fd.confidence_at_signal,
        high_conviction_match: false,
        line_projection_agrees: false,
        category_weight: null,
        category_blocked: false,
        line_drift_ok: true,
        engines_agreeing: ['fanduel_prediction'],
        engine_details: { fanduel: { signal: fd.signal_type, edge: fd.edge_at_signal, confidence: fd.confidence_at_signal } },
      });
    }

    // Also seed from high-conviction results (they already passed multi-engine cross-ref)
    for (const hc of hcResults) {
      const key = normKey(hc.player_name, hc.prop_type);
      if (!verifiedMap.has(key)) continue;
      if (candidates.has(key)) continue; // FD signal takes priority as seed

      candidates.set(key, {
        player_name: hc.player_name,
        prop_type: hc.prop_type,
        side: (hc.signal || 'over').toLowerCase(),
        line: verifiedMap.get(key) ?? null,
        sport: hc.sport || '',
        fanduel_signal_type: null,
        fanduel_accuracy: null,
        high_conviction_match: true,
        line_projection_agrees: false,
        category_weight: null,
        category_blocked: false,
        line_drift_ok: true,
        engines_agreeing: ['high_conviction'],
        engine_details: { high_conviction: { score: hc.conviction_score, tier: hc.confidence_tier, engines: hc.engines } },
      });
    }

    log(`Candidates seeded: ${candidates.size}`);

    // ── 4. Cross-reference each candidate against all 5 signals ──
    for (const [key, c] of candidates) {
      // Signal 1: FanDuel — already set during seeding
      const hasFD = c.fanduel_signal_type !== null;

      // Signal 2: High Conviction match
      const hc = hcMap.get(key);
      if (hc) {
        c.high_conviction_match = true;
        if (!c.engines_agreeing.includes('high_conviction')) {
          c.engines_agreeing.push('high_conviction');
        }
        c.engine_details.high_conviction = { score: hc.conviction_score, tier: hc.confidence_tier, agreement: hc.side_agreement };
      }

      // Signal 3: Line Projection confirmation
      const lp = lpMap.get(key);
      if (lp) {
        const lpDirection = (lp.direction || '').toLowerCase();
        if (lpDirection === c.side || (lpDirection === '' && lp.edge_pct > 0)) {
          c.line_projection_agrees = true;
          c.engines_agreeing.push('line_projection');
          c.engine_details.line_projection = { projected: lp.projected_value, fdLine: lp.fanduel_line, edge: lp.edge_pct, grade: lp.signal_grade };
        }
      }

      // Signal 4: Category weight check
      // Try to match category from prop_type mapping
      const propNorm = c.prop_type.replace(/^(player_|batter_|pitcher_)/, '').toLowerCase();
      const catKey = `${propNorm}|${c.side}`;
      // Also try broader lookups
      for (const [cwKey, cwVal] of cwMap) {
        if (cwKey.toLowerCase().includes(propNorm) && cwKey.toLowerCase().includes(c.side)) {
          c.category_weight = cwVal.weight;
          c.category_blocked = cwVal.blocked;
          if (cwVal.weight >= 0.55 && !cwVal.blocked) {
            c.engines_agreeing.push('category_weight');
            c.engine_details.category = { weight: cwVal.weight, hitRate: cwVal.hitRate };
          }
          break;
        }
      }

      // Signal 5: Line drift check
      const ml = mispricedMap.get(key);
      if (ml) {
        const mlSide = ml.signal.toLowerCase();
        // If mispriced line agrees with our side, drift is favorable
        if (mlSide === c.side) {
          c.line_drift_ok = true;
          c.engines_agreeing.push('line_drift');
          c.engine_details.line_drift = { edge_pct: ml.edge_pct, bookLine: ml.book_line, l10Avg: ml.player_avg_l10 };
        } else {
          c.line_drift_ok = false; // Line moved against us
        }
      }
    }

    // ── 5. Grade and filter ──
    const graded: Array<VerdictCandidate & { consensus_score: number; verdict_grade: string }> = [];

    for (const [_, c] of candidates) {
      const score = c.engines_agreeing.length;
      if (score < 3) continue; // Minimum Silver threshold

      // Block toxic categories
      if (c.category_blocked) continue;

      const grade = score >= 5 ? 'DIAMOND' : score >= 4 ? 'GOLD' : 'SILVER';
      graded.push({ ...c, consensus_score: score, verdict_grade: grade });
    }

    // Sort: Diamond first, then by score
    graded.sort((a, b) => b.consensus_score - a.consensus_score);

    log(`Graded picks: ${graded.length} (💎${graded.filter(g => g.verdict_grade === 'DIAMOND').length} 🥇${graded.filter(g => g.verdict_grade === 'GOLD').length} 🥈${graded.filter(g => g.verdict_grade === 'SILVER').length})`);

    // ── 6. Persist to final_verdict_picks ──
    if (graded.length > 0) {
      await supabase.from('final_verdict_picks').delete().eq('verdict_date', today);

      const rows = graded.map(g => ({
        verdict_date: today,
        player_name: g.player_name,
        prop_type: g.prop_type,
        side: g.side,
        line: g.line,
        sport: g.sport,
        verdict_grade: g.verdict_grade,
        consensus_score: g.consensus_score,
        fanduel_signal_type: g.fanduel_signal_type,
        fanduel_accuracy: g.fanduel_accuracy,
        high_conviction_match: g.high_conviction_match,
        line_projection_agrees: g.line_projection_agrees,
        category_weight: g.category_weight,
        category_blocked: g.category_blocked,
        line_drift_ok: g.line_drift_ok,
        engines_agreeing: g.engines_agreeing,
        engine_details: g.engine_details,
      }));

      const { error: insertErr } = await supabase.from('final_verdict_picks').insert(rows);
      if (insertErr) {
        log(`Insert error: ${insertErr.message}`);
      } else {
        log(`Persisted ${rows.length} final verdict picks`);
      }
    }

    // ── 7. Telegram digest ──
    const GRADE_EMOJI: Record<string, string> = { DIAMOND: '💎', GOLD: '🥇', SILVER: '🥈' };
    const SPORT_EMOJI: Record<string, string> = { NBA: '🏀', MLB: '⚾', NHL: '🏒', NFL: '🏈', NCAAB: '🏀' };

    const msgLines: string[] = [
      `💎 *FINAL VERDICT — Cross-Engine Consensus*`,
      `${graded.length} picks passed 3+ independent validations`,
      '',
    ];

    for (const pick of graded.slice(0, 12)) {
      const ge = GRADE_EMOJI[pick.verdict_grade] || '⭐';
      const se = SPORT_EMOJI[pick.sport?.toUpperCase()] || '🎯';
      const propLabel = pick.prop_type.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());

      msgLines.push(`${ge} *${pick.verdict_grade}* (${pick.consensus_score}/5) ${se}`);
      msgLines.push(`*${pick.player_name}* ${pick.side.toUpperCase()} ${propLabel}${pick.line ? ` ${pick.line}` : ''}`);

      // Show which engines agree
      const engineLabels: string[] = [];
      if (pick.fanduel_signal_type) engineLabels.push(`FD:${pick.fanduel_signal_type}`);
      if (pick.high_conviction_match) engineLabels.push('HC✓');
      if (pick.line_projection_agrees) engineLabels.push('LP✓');
      if (pick.engines_agreeing.includes('category_weight')) engineLabels.push(`CW:${(pick.category_weight! * 100).toFixed(0)}%`);
      if (pick.engines_agreeing.includes('line_drift')) engineLabels.push('Drift✓');
      msgLines.push(`📊 ${engineLabels.join(' · ')}`);

      // FanDuel accuracy badge if available
      if (pick.fanduel_accuracy != null) {
        const accPct = (pick.fanduel_accuracy * 100).toFixed(0);
        const badge = pick.fanduel_accuracy >= 0.75 ? '🟢' : pick.fanduel_accuracy >= 0.60 ? '🟡' : '🔴';
        msgLines.push(`${badge} Signal Accuracy: ${accPct}%`);
      }

      msgLines.push('');
    }

    if (graded.length > 12) {
      msgLines.push(`_...and ${graded.length - 12} more Silver picks_`);
    }

    msgLines.push(`_Cross-referenced: FanDuel Predictions × High Conviction × Line Projection × Category Weights × Line Drift_`);

    const message = msgLines.join('\n');

    try {
      const teleResp = await fetch(`${supabaseUrl}/functions/v1/bot-send-telegram`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${supabaseKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ message, parse_mode: 'Markdown', admin_only: true }),
      });
      const teleResult = await teleResp.json();
      log(`Telegram sent: ${teleResult.success}`);
    } catch (tgErr) {
      log(`Telegram error: ${tgErr}`);
    }

    return new Response(JSON.stringify({
      success: true,
      total: graded.length,
      diamond: graded.filter(g => g.verdict_grade === 'DIAMOND').length,
      gold: graded.filter(g => g.verdict_grade === 'GOLD').length,
      silver: graded.filter(g => g.verdict_grade === 'SILVER').length,
      picks: graded.slice(0, 15),
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    log(`Error: ${msg}`);
    return new Response(JSON.stringify({ success: false, error: msg }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
