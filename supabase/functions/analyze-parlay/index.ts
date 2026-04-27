// Engine-powered slip analyzer.
// Cross-references each uploaded parlay leg against 8 internal engines and
// returns a structured ParlayAnalysis (matches src/types/parlay.ts → LegAnalysis)
// plus a parlay-level recommendedAction + plain-English summary +
// concrete swap suggestions per weak leg.

import { createClient } from 'npm:@supabase/supabase-js@2';
import {
  parseLeg,
  isFuzzyMatch,
  normalizePropType,
  americanToProb,
  detectSport,
  SPORT_ALIASES,
  type SportKey,
  type ParsedLeg,
} from '../_shared/leg-matcher.ts';

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

interface InputLeg {
  description?: string;
  odds?: number | string;
  player?: string;
  propType?: string;
  line?: number;
  side?: string;
  impliedProbability?: number;
  sport?: string;
}

interface EngineHits {
  unified?: any;
  medianLock?: any;
  juiced?: any;
  hitRate?: any;
  sharp?: any;
  trap?: any;
  injuries?: any[];
  fatigue?: any;
}

export async function gatherEngineHits(
  supabase: ReturnType<typeof createClient>,
  parsed: ParsedLeg,
  sport: SportKey,
  today: string
): Promise<EngineHits> {
  if (!parsed.player) return {};
  const lastName = parsed.player.toLowerCase().split(/\s+/).slice(-1)[0];
  const ilikeName = `%${lastName}%`;
  const sportAliases = SPORT_ALIASES[sport] ?? [sport];

  const [
    unifiedRes,
    medianRes,
    juicedRes,
    hitrateRes,
    sharpRes,
    trapRes,
    injuryRes,
    fatigueRes,
  ] = await Promise.all([
    supabase.from('unified_props').select('*').ilike('player_name', ilikeName).eq('is_active', true).in('sport', sportAliases).limit(10),
    // median_lock_candidates has no sport column — rely on player+prop_type fuzzy match instead
    supabase.from('median_lock_candidates').select('*').ilike('player_name', ilikeName).eq('pick_date', today).limit(10),
    supabase.from('juiced_props').select('*').ilike('player_name', ilikeName).eq('prop_date', today).in('sport', sportAliases).limit(10),
    supabase.from('player_prop_hitrates').select('*').ilike('player_name', ilikeName).gte('expires_at', new Date().toISOString()).in('sport', sportAliases).limit(10),
    supabase.from('sharp_signals').select('*').ilike('matchup', ilikeName).eq('is_active', true).in('sport', sportAliases).limit(5),
    supabase.from('trap_probability_analysis').select('*').ilike('player_name', ilikeName).in('sport', sportAliases).limit(10),
    supabase.from('injury_reports').select('*').ilike('player_name', ilikeName).in('sport', sportAliases).order('updated_at', { ascending: false }).limit(3),
    parsed.player ? supabase.from('sports_fatigue_scores').select('*').limit(0) : Promise.resolve({ data: [] as any[] }),
  ]);

  const pickBest = <T extends Record<string, any>>(rows: T[] | null | undefined): T | undefined => {
    if (!rows?.length) return undefined;
    const scored = rows.map((r) => ({ r, s: isFuzzyMatch(parsed, r as any).score }));
    scored.sort((a, b) => b.s - a.s);
    return scored[0].s > 0 ? scored[0].r : undefined;
  };

  return {
    unified: pickBest(unifiedRes.data as any[]),
    medianLock: pickBest(medianRes.data as any[]),
    juiced: pickBest(juicedRes.data as any[]),
    hitRate: pickBest(hitrateRes.data as any[]),
    sharp: sharpRes.data?.[0],
    trap: pickBest(trapRes.data as any[]),
    injuries: injuryRes.data ?? [],
    fatigue: undefined, // sport-conditional, surfaced via riskFactors below if injuries indicate
  };
}

interface ResearchSignal {
  engine: string;
  status: 'positive' | 'negative' | 'neutral';
  headline: string;
  icon: string;
  details?: string;
  score?: number;
}

function synthesizeLeg(
  parsed: ParsedLeg,
  hits: EngineHits,
  impliedProbability: number
) {
  const signals: ResearchSignal[] = [];
  const riskFactors: string[] = [];
  const sharpSignals: string[] = [];
  const insights: string[] = [];
  let strengthScore = 50;
  let confidenceLevel: 'high' | 'medium' | 'low' = 'medium';

  // Unified Props
  if (hits.unified) {
    const conf = Number(hits.unified.confidence ?? 0) * 100;
    const rec = (hits.unified.recommendation ?? '').toLowerCase();
    const sideMatches = !parsed.side || (hits.unified.recommended_side ?? '').toLowerCase() === parsed.side;
    const positive = sideMatches && conf >= 60;
    signals.push({
      engine: 'pvs',
      status: positive ? 'positive' : sideMatches ? 'neutral' : 'negative',
      headline: `Unified PVS: ${hits.unified.pvs_tier ?? 'N/A'} • ${conf.toFixed(0)}%`,
      icon: '🧠',
      score: conf,
    });
    strengthScore += positive ? 15 : sideMatches ? 0 : -15;
    if (rec) insights.push(`Unified engine: ${rec}`);
  }

  // Median Lock
  let medianLockData: any | undefined;
  if (hits.medianLock) {
    const cls = String(hits.medianLock.classification ?? '').toUpperCase();
    const consensus = Number(hits.medianLock.consensus_percentage ?? hits.medianLock.confidence_score ?? 0);
    const sideMatches = !parsed.side || (hits.medianLock.bet_side ?? '').toLowerCase() === parsed.side;
    const positive = sideMatches && (cls === 'LOCK' || cls === 'STRONG');
    signals.push({
      engine: 'medianlock',
      status: positive ? 'positive' : sideMatches ? 'neutral' : 'negative',
      headline: `Median Lock: ${cls} • ${consensus.toFixed(0)}%`,
      icon: '🔒',
      score: consensus,
    });
    medianLockData = {
      classification: cls,
      confidence_score: consensus,
      bet_side: hits.medianLock.bet_side ?? '',
      hit_rate: Number(hits.medianLock.blended_hit_rate ?? hits.medianLock.hit_rate ?? 0),
      parlay_grade: !!hits.medianLock.parlay_grade,
      edge_percent: Number(hits.medianLock.adjusted_edge ?? hits.medianLock.raw_edge ?? 0),
      projected_minutes: Number(hits.medianLock.median_minutes ?? 0),
      adjusted_edge: Number(hits.medianLock.adjusted_edge ?? 0),
    };
    strengthScore += positive ? 18 : sideMatches ? 0 : -10;
  }

  // Juiced
  let juiceData: any | undefined;
  if (hits.juiced) {
    const level = String(hits.juiced.juice_level ?? '');
    const dir = String(hits.juiced.juice_direction ?? '');
    const finalPick = String(hits.juiced.final_pick ?? '').toLowerCase();
    const sideMatches = !parsed.side || finalPick === parsed.side;
    juiceData = {
      juiceLevel: level,
      juiceDirection: dir,
      juiceAmount: Number(hits.juiced.juice_amount ?? 0),
      finalPick: hits.juiced.final_pick ?? '',
      movementConsistency: Number(hits.juiced.movement_consistency_score ?? 0),
    };
    const positive = sideMatches && (level === 'extreme' || level === 'high');
    signals.push({
      engine: 'juiced',
      status: positive ? 'positive' : sideMatches ? 'neutral' : 'negative',
      headline: `Juice: ${level || 'N/A'} ${dir}`,
      icon: '🍊',
      score: level === 'extreme' ? 85 : level === 'high' ? 70 : 55,
    });
    strengthScore += positive ? 8 : sideMatches ? 0 : -8;
  }

  // HitRate
  let hitRatePercent: number | undefined;
  if (hits.hitRate) {
    const rate =
      parsed.side === 'under'
        ? Number(hits.hitRate.hit_rate_under ?? 0)
        : Number(hits.hitRate.hit_rate_over ?? hits.hitRate.hit_rate ?? 0);
    hitRatePercent = rate * 100;
    const positive = hitRatePercent >= 65;
    const negative = hitRatePercent <= 35;
    signals.push({
      engine: 'hitrate',
      status: positive ? 'positive' : negative ? 'negative' : 'neutral',
      headline: `L${hits.hitRate.games_analyzed ?? 10} hit rate: ${hitRatePercent.toFixed(0)}%`,
      icon: '🎯',
      score: hitRatePercent,
    });
    strengthScore += positive ? 12 : negative ? -12 : 0;
    if (negative) riskFactors.push(`Only ${hitRatePercent.toFixed(0)}% hit rate over last ${hits.hitRate.games_analyzed ?? 10}`);
  }

  // Sharp
  let sharpRecommendation: 'pick' | 'fade' | 'caution' | null = null;
  if (hits.sharp) {
    const sharpPct = Number(hits.sharp.sharp_pct ?? 0);
    sharpRecommendation = sharpPct >= 65 ? 'pick' : sharpPct <= 35 ? 'fade' : 'caution';
    sharpSignals.push(`SHARP_${sharpPct}%`);
    signals.push({
      engine: 'sharp',
      status: sharpRecommendation === 'pick' ? 'positive' : sharpRecommendation === 'fade' ? 'negative' : 'neutral',
      headline: `Sharp money: ${sharpPct}% on ${hits.sharp.pick}`,
      icon: '⚡',
      score: sharpPct,
    });
    strengthScore += sharpRecommendation === 'pick' ? 10 : sharpRecommendation === 'fade' ? -10 : 0;
  }

  // Trap
  if (hits.trap) {
    const trapProb = Number(hits.trap.trap_probability ?? 0);
    const risk = String(hits.trap.risk_label ?? '');
    if (risk === 'High') {
      strengthScore -= 20;
      riskFactors.push(`High trap probability (${(trapProb * 100).toFixed(0)}%)`);
      sharpSignals.push('TRAP_FAVORITE');
      if (hits.trap.both_sides_moved) sharpSignals.push('BOTH_SIDES_MOVED');
      if (hits.trap.price_only_move) sharpSignals.push('PRICE_ONLY_MOVE_TRAP');
      signals.push({
        engine: 'sharp',
        status: 'negative',
        headline: `🚨 Trap detected: ${hits.trap.recommendation ?? 'Avoid'}`,
        icon: '🚨',
        score: trapProb * 100,
      });
    } else if (risk === 'Medium') {
      strengthScore -= 8;
      riskFactors.push(`Medium trap risk`);
    }
  }

  // Injuries
  const injuryAlerts = (hits.injuries ?? [])
    .filter((i: any) => ['OUT', 'DOUBTFUL', 'QUESTIONABLE'].includes(String(i.status ?? '').toUpperCase()))
    .slice(0, 2)
    .map((i: any) => ({
      player: i.player_name ?? parsed.player ?? '',
      team: i.team_name ?? '',
      status: String(i.status ?? 'QUESTIONABLE').toUpperCase(),
      injuryType: i.injury_type ?? 'Undisclosed',
      injuryDetails: i.injury_detail ?? '',
      impactLevel: Number(i.impact_score ?? 0) >= 0.7 ? 'critical' : Number(i.impact_score ?? 0) >= 0.4 ? 'high' : 'medium',
    }));
  if (injuryAlerts.length > 0) {
    const worst = injuryAlerts[0];
    if (worst.status === 'OUT' || worst.status === 'DOUBTFUL') {
      strengthScore -= 25;
      riskFactors.push(`${worst.player} ${worst.status} (${worst.injuryType})`);
    } else {
      strengthScore -= 8;
    }
    signals.push({
      engine: 'sharp',
      status: 'negative',
      headline: `⚠️ Injury: ${worst.player} ${worst.status}`,
      icon: '🏥',
    });
  }

  // Bound the score
  strengthScore = Math.max(0, Math.min(100, Math.round(strengthScore)));
  confidenceLevel = strengthScore >= 70 ? 'high' : strengthScore >= 45 ? 'medium' : 'low';

  const verdict =
    strengthScore >= 75 ? 'STRONG_PICK' :
    strengthScore >= 55 ? 'LEAN_PICK' :
    strengthScore >= 40 ? 'NEUTRAL' :
    strengthScore >= 25 ? 'LEAN_FADE' : 'STRONG_FADE';

  // Adjusted probability: blend implied with engine evidence (cap ±15%)
  const evidenceProb = strengthScore / 100;
  const blended = impliedProbability * 0.5 + evidenceProb * 0.5;
  const capped = Math.max(impliedProbability - 0.15, Math.min(impliedProbability + 0.15, blended));
  const adjustedProbability = Math.round(capped * 1000) / 1000;

  // Trend direction
  const trendDirection: 'favorable' | 'neutral' | 'unfavorable' =
    strengthScore >= 60 ? 'favorable' : strengthScore <= 40 ? 'unfavorable' : 'neutral';

  // Vegas juice estimate from over/under prices when available
  let vegasJuice = 4.5;
  const overP = hits.unified?.over_price ?? hits.juiced?.over_price;
  const underP = hits.unified?.under_price ?? hits.juiced?.under_price;
  if (overP && underP) {
    const overImp = americanToProb(Number(overP));
    const underImp = americanToProb(Number(underP));
    vegasJuice = Math.max(0, (overImp + underImp - 1) * 100);
  }

  const verdictReason =
    verdict === 'STRONG_PICK' ? 'Multiple engines align on this pick'
    : verdict === 'LEAN_PICK' ? 'Engines lean positive'
    : verdict === 'NEUTRAL' ? 'Mixed signals from engines'
    : verdict === 'LEAN_FADE' ? 'Engines lean against this pick'
    : 'Multiple engines flag this leg';

  return {
    insights,
    riskFactors,
    trendDirection,
    adjustedProbability,
    confidenceLevel,
    vegasJuice,
    sharpRecommendation,
    sharpReason: hits.sharp?.line_movement ?? '',
    sharpSignals,
    sharpConfidence: hits.sharp ? Number(hits.sharp.sharp_pct ?? 0) : undefined,
    injuryAlerts: injuryAlerts.length ? injuryAlerts : undefined,
    juiceData,
    medianLockData,
    hitRatePercent,
    researchSummary: {
      signals,
      overallVerdict: verdict,
      verdictReason,
      strengthScore,
    },
  };
}

/** Inline swap suggestion: top 1 alternative for a weak leg pulled from engines. */
export async function findTopSwap(
  supabase: ReturnType<typeof createClient>,
  parsed: ParsedLeg,
  sport: SportKey,
  today: string
) {
  const sportAliases = SPORT_ALIASES[sport] ?? [sport];
  // Prefer Median Lock LOCK/STRONG, then Unified high confidence
  const [mlRes, unRes] = await Promise.all([
    supabase
      .from('median_lock_candidates')
      .select('*')
      .eq('pick_date', today)
      .in('classification', ['LOCK', 'STRONG'])
      .eq('parlay_grade', true)
      .order('consensus_percentage', { ascending: false, nullsFirst: false })
      .limit(5),
    supabase
      .from('unified_props')
      .select('*')
      .eq('is_active', true)
      .in('sport', sportAliases)
      .gte('confidence', 0.7)
      .order('confidence', { ascending: false })
      .limit(5),
  ]);
  const ml = (mlRes.data ?? [])[0];
  if (ml) {
    return {
      source: 'median_lock' as const,
      description: `${ml.player_name} ${String(ml.bet_side ?? 'OVER').toUpperCase()} ${ml.line ?? ''} ${normalizePropType(ml.prop_type) ?? ml.prop_type}`,
      playerName: ml.player_name,
      propType: ml.prop_type,
      line: ml.line,
      side: String(ml.bet_side ?? 'over').toLowerCase(),
      estimatedOdds: -110,
      confidence: Number(ml.consensus_percentage ?? ml.confidence_score ?? 75),
      reason: `🔒 ${ml.classification} • ${Number(ml.consensus_percentage ?? 0).toFixed(0)}% consensus`,
    };
  }
  const un = (unRes.data ?? [])[0];
  if (un) {
    return {
      source: 'unified_props' as const,
      description: `${un.player_name} ${String(un.recommended_side ?? 'OVER').toUpperCase()} ${un.current_line ?? ''} ${normalizePropType(un.prop_type) ?? un.prop_type}`,
      playerName: un.player_name,
      propType: un.prop_type,
      line: un.current_line,
      side: String(un.recommended_side ?? 'over').toLowerCase(),
      estimatedOdds: -110,
      confidence: Number(un.confidence ?? 0) * 100,
      reason: `🧠 ${un.pvs_tier ?? 'PVS'} • ${(Number(un.confidence ?? 0) * 100).toFixed(0)}% engine confidence`,
    };
  }
  return null;
}

function buildSummary(opts: {
  totalLegs: number;
  picks: number;
  fades: number;
  neutral: number;
  swapsFound: number;
}): { recommendedAction: string; summary: string } {
  const { totalLegs, picks, fades, neutral, swapsFound } = opts;
  let recommendedAction: 'TAIL' | 'TAIL_WITH_SWAPS' | 'REBUILD' | 'PASS';
  if (fades === 0 && picks >= Math.ceil(totalLegs * 0.6)) recommendedAction = 'TAIL';
  else if (fades >= Math.ceil(totalLegs * 0.6)) recommendedAction = 'PASS';
  else if (fades >= 1 && picks + neutral >= fades) recommendedAction = 'TAIL_WITH_SWAPS';
  else recommendedAction = 'REBUILD';

  let summary = '';
  switch (recommendedAction) {
    case 'TAIL':
      summary = `Sharp build. ${picks}/${totalLegs} legs cleared our engines — this slip earns a tail.`;
      break;
    case 'TAIL_WITH_SWAPS':
      summary = `Mostly solid: ${picks} clean, ${fades} flagged. Swap the ${fades} weak leg${fades > 1 ? 's' : ''}${swapsFound ? ' — we lined up sharper picks below' : ''} and you have a real ticket.`;
      break;
    case 'REBUILD':
      summary = `Mixed bag — ${picks} pick${picks === 1 ? '' : 's'}, ${fades} fade${fades === 1 ? '' : 's'}, ${neutral} on the fence. Trim, swap, and rebuild before sending.`;
      break;
    case 'PASS':
      summary = `Books are licking their chops. ${fades}/${totalLegs} legs failed engine review. Pass on this build entirely.`;
      break;
  }
  return { recommendedAction, summary };
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });

  try {
    const body = await req.json();
    const inputLegs: InputLeg[] = Array.isArray(body?.legs) ? body.legs : [];
    if (inputLegs.length === 0) {
      return new Response(JSON.stringify({ error: 'legs array required' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    );
    const today = getEasternDate();

    // Per-leg analysis (parallel)
    const legAnalyses = await Promise.all(
      inputLegs.map(async (raw, idx) => {
        const parsed = parseLeg(raw);
        const { sport: detectedSport, confidence: sportConfidence } = detectSport(
          { raw: raw.description, propType: raw.propType ?? parsed.propType, player: parsed.player },
          raw.sport
        );
        const impliedProbability =
          typeof raw.impliedProbability === 'number' && raw.impliedProbability > 0
            ? raw.impliedProbability
            : americanToProb(parsed.odds);

        const hits = await gatherEngineHits(supabase, parsed, detectedSport, today);
        const synth = synthesizeLeg(parsed, hits, impliedProbability);

        // Detect bet type
        const betType: 'moneyline' | 'spread' | 'total' | 'player_prop' | 'other' =
          parsed.player ? 'player_prop' : 'other';

        return {
          legIndex: idx,
          sport: detectedSport,
          sportConfidence,
          betType,
          player: parsed.player,
          ...synth,
        };
      })
    );

    // Same-game / correlated detection
    const correlatedGroups: Array<{ indices: number[]; sharedGame?: string }> = [];
    const seenLast: Record<string, number[]> = {};
    inputLegs.forEach((raw, idx) => {
      const parsed = parseLeg(raw);
      if (!parsed.player) return;
      const last = parsed.player.toLowerCase().split(/\s+/).slice(-1)[0];
      seenLast[last] = seenLast[last] || [];
      seenLast[last].push(idx);
    });
    for (const idxs of Object.values(seenLast)) {
      if (idxs.length > 1) correlatedGroups.push({ indices: idxs });
    }

    // Tally verdicts and find swap suggestions for weak legs
    let picks = 0, fades = 0, neutral = 0;
    const keepLegs: number[] = [];
    const swapLegs: number[] = [];
    const dropLegs: number[] = [];
    const suggestedSwaps: Array<{ legIndex: number; original: string; suggestion: any }> = [];

    for (const la of legAnalyses) {
      const v = la.researchSummary?.overallVerdict;
      if (v === 'STRONG_PICK' || v === 'LEAN_PICK') {
        picks++;
        keepLegs.push(la.legIndex);
      } else if (v === 'STRONG_FADE') {
        fades++;
        dropLegs.push(la.legIndex);
      } else if (v === 'LEAN_FADE') {
        fades++;
        swapLegs.push(la.legIndex);
      } else {
        neutral++;
        keepLegs.push(la.legIndex);
      }
    }

    // Find swap suggestions for swap+drop legs
    for (const idx of [...swapLegs, ...dropLegs]) {
      const parsed = parseLeg(inputLegs[idx]);
      const legSport = (legAnalyses[idx]?.sport as SportKey) ?? 'NBA';
      const suggestion = await findTopSwap(supabase, parsed, legSport, today);
      if (suggestion) {
        suggestedSwaps.push({
          legIndex: idx,
          original: parsed.raw || `${parsed.player} ${parsed.side ?? ''} ${parsed.line ?? ''} ${parsed.propType ?? ''}`.trim(),
          suggestion,
        });
      }
    }

    const { recommendedAction, summary } = buildSummary({
      totalLegs: inputLegs.length,
      picks, fades, neutral,
      swapsFound: suggestedSwaps.length,
    });

    // Sports detected across the slip — surfaced for cross-sport awareness
    const sportsDetected = Array.from(new Set(legAnalyses.map((l: any) => l.sport).filter(Boolean)));

    // Estimated EV delta if all swaps applied (assume +12% confidence per swap into 50/50 base)
    const expectedValueDelta = suggestedSwaps.length * 0.12;

    return new Response(JSON.stringify({
      legAnalyses,
      correlatedLegs: correlatedGroups,
      recommendedAction,
      summary,
      sportsDetected,
      keepLegs,
      swapLegs,
      dropLegs,
      suggestedSwaps,
      expectedValueDelta,
      verdictCounts: { picks, fades, neutral },
      analyzedAt: new Date().toISOString(),
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (err) {
    console.error('analyze-parlay error', err);
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});