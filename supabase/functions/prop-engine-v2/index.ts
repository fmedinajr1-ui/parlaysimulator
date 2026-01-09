import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// ============================================
// 🔥 PROP ENGINE v2.1 - Sharp-Aligned | Trap-Aware | Bankroll-First
// ============================================

// HIGH-MINUTE REBOUNDER BLACKLIST (Dynamic)
const HIGH_MINUTE_REBOUNDER_BLACKLIST = [
  'Julius Randle',
  'Giannis Antetokounmpo',
  'Domantas Sabonis',
  'Nikola Jokic',
  'Rudy Gobert',
  'Bam Adebayo',
  'Anthony Davis',
  'Karl-Anthony Towns',
  'Evan Mobley',
  'Jaren Jackson Jr.',
];

// COMBO STAT TYPES (for .5 Under Ban)
const COMBO_STAT_TYPES = [
  'pts+reb',
  'pts+ast',
  'reb+ast',
  'pts+reb+ast',
  'pra',
  'points+rebounds',
  'points+assists',
  'rebounds+assists',
  'points+rebounds+assists',
];

interface PropInput {
  player_name: string;
  prop_type: string;
  line: number;
  side: 'over' | 'under';
  event_id?: string;
  team_name?: string;
  opponent_name?: string;
  odds?: number;
  avg_minutes?: number;
  rolling_median?: number;
  recent_games?: number[];
  spread?: number;
  position?: string;
  market_type?: 'Standard' | 'Goblin' | 'Demon';
}

interface SESComponents {
  median_gap_score: number;       // 40% weight
  line_structure_score: number;   // 20% weight
  minutes_certainty_score: number; // 15% weight
  market_type_score: number;      // 15% weight
  blowout_pace_score: number;     // 10% weight
}

interface EngineResult {
  player_name: string;
  prop_type: string;
  line: number;
  line_structure: string;
  side: string;
  ses_score: number;
  decision: 'BET' | 'LEAN' | 'NO_BET';
  decision_emoji: string;
  key_reason: string;
  player_archetype: string;
  market_type: string;
  rolling_median: number | null;
  median_gap: number | null;
  minutes_certainty: string;
  blowout_risk: boolean;
  auto_fail_reason: string | null;
  ses_components: SESComponents;
  event_id: string | null;
  team_name: string | null;
  opponent_name: string | null;
  odds: number | null;
}

// ============================================
// HELPER FUNCTIONS
// ============================================

function getLineStructure(line: number): '.0' | '.5' {
  return line % 1 === 0.5 ? '.5' : '.0';
}

function isComboStat(propType: string): boolean {
  const normalized = propType.toLowerCase().replace(/\s+/g, '');
  return COMBO_STAT_TYPES.some(combo => 
    normalized.includes(combo.replace(/\s+/g, '')) ||
    normalized.includes('pra') ||
    (normalized.includes('pts') && normalized.includes('reb')) ||
    (normalized.includes('pts') && normalized.includes('ast')) ||
    (normalized.includes('reb') && normalized.includes('ast'))
  );
}

function inferArchetype(position: string | undefined, propType: string): 'Guard' | 'Wing' | 'Big' {
  if (!position) {
    // Infer from prop type
    if (propType.toLowerCase().includes('reb')) return 'Big';
    if (propType.toLowerCase().includes('ast')) return 'Guard';
    return 'Wing';
  }
  
  const pos = position.toUpperCase();
  if (pos.includes('C') || pos.includes('PF')) return 'Big';
  if (pos.includes('PG') || pos.includes('SG')) return 'Guard';
  return 'Wing';
}

function calculateMedian(games: number[]): number {
  if (!games || games.length === 0) return 0;
  const sorted = [...games].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 !== 0 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function getMinutesCertainty(avgMinutes: number | undefined): 'LOCKED' | 'MEDIUM' | 'RISKY' {
  if (!avgMinutes) return 'MEDIUM';
  if (avgMinutes >= 32) return 'LOCKED';
  if (avgMinutes >= 24) return 'MEDIUM';
  return 'RISKY';
}

// ============================================
// HARD AUTO-FAIL RULES (NON-NEGOTIABLE)
// ============================================

function checkAutoFailRules(prop: PropInput, archetype: string): { fail: boolean; reason: string | null } {
  const lineStructure = getLineStructure(prop.line);
  const isCombo = isComboStat(prop.prop_type);
  const isUnder = prop.side === 'under';
  const spread = prop.spread || 0;
  const medianGap = prop.rolling_median ? prop.line - prop.rolling_median : 0;

  // RULE 1: 0.5 COMBO UNDER BAN
  // NEVER take unders on P+R, PRA, Rebs+Ast when line ends in .5
  if (isCombo && isUnder && lineStructure === '.5') {
    return { 
      fail: true, 
      reason: 'RULE 1: 0.5 COMBO UNDER BAN - Late-game padding + rebound randomness makes .5 combo unders too risky' 
    };
  }

  // RULE 2: MEDIAN DEAD-ZONE FILTER (±0.5 for ALL sides)
  // If line within ±0.5 of median → AUTO NO BET (coin-flip with no edge)
  if (prop.rolling_median && Math.abs(medianGap) <= 0.5) {
    return { 
      fail: true, 
      reason: 'RULE 2: MEDIAN DEAD-ZONE - Line within ±0.5 of median is a coin-flip with no edge' 
    };
  }

  // RULE 3: HIGH-MINUTE REBOUNDER IMMUNITY
  // AUTO-BAN unders on combo stats for high-minute bigs
  if (archetype === 'Big' && isCombo && isUnder) {
    const isBlacklisted = HIGH_MINUTE_REBOUNDER_BLACKLIST.some(
      name => prop.player_name.toLowerCase().includes(name.toLowerCase())
    );
    if (isBlacklisted) {
      // Exception: unless line >= median + 2
      if (!prop.rolling_median || prop.line < prop.rolling_median + 2) {
        return { 
          fail: true, 
          reason: `RULE 3: HIGH-MINUTE REBOUNDER IMMUNITY - ${prop.player_name} is blacklisted for combo unders` 
        };
      }
    }
  }

  // RULE 4: BLOWOUT OVERRULE (Affects confidence, not auto-fail for OVER)
  // But if spread >= 8 and taking UNDER on 30+ min player, warn heavily
  if (isUnder && spread >= 8 && prop.avg_minutes && prop.avg_minutes >= 30) {
    return { 
      fail: true, 
      reason: 'RULE 4: BLOWOUT OVERRULE - Never fade 30+ min players in potential blowouts (spread >= 8)' 
    };
  }

  return { fail: false, reason: null };
}

// ============================================
// SES SCORING SYSTEM (0-100)
// ============================================

function calculateSES(prop: PropInput, archetype: string): { score: number; components: SESComponents } {
  const lineStructure = getLineStructure(prop.line);
  const medianGap = prop.rolling_median ? prop.line - prop.rolling_median : 0;
  const minutesCertainty = getMinutesCertainty(prop.avg_minutes);
  const marketType = prop.market_type || 'Standard';
  const spread = Math.abs(prop.spread || 0);
  const isOver = prop.side === 'over';

  // 1. MEDIAN GAP SCORE (40% weight) - max 40 points
  let medianGapScore = 0;
  if (prop.rolling_median) {
    const gapMagnitude = Math.abs(medianGap);
    if (isOver) {
      // For OVER: want line BELOW median (negative gap)
      if (medianGap <= -2) medianGapScore = 40;
      else if (medianGap <= -1) medianGapScore = 32;
      else if (medianGap <= 0) medianGapScore = 24;
      else if (medianGap <= 1) medianGapScore = 12;
      else medianGapScore = 0;
    } else {
      // For UNDER: want line ABOVE median (positive gap)
      if (medianGap >= 2) medianGapScore = 40;
      else if (medianGap >= 1) medianGapScore = 28;
      else if (medianGap >= 0.5) medianGapScore = 16;
      else medianGapScore = 0; // Dead zone or wrong direction
    }
  } else {
    medianGapScore = 15; // No median data = neutral
  }

  // 2. LINE STRUCTURE SCORE (20% weight) - max 20 points
  let lineStructureScore = 0;
  if (lineStructure === '.0') {
    lineStructureScore = 20; // Safer
  } else {
    // .5 lines are riskier, especially for unders
    lineStructureScore = isOver ? 12 : 6;
  }

  // 3. MINUTES CERTAINTY SCORE (15% weight) - max 15 points
  let minutesCertaintyScore = 0;
  if (minutesCertainty === 'LOCKED') minutesCertaintyScore = 15;
  else if (minutesCertainty === 'MEDIUM') minutesCertaintyScore = 10;
  else minutesCertaintyScore = 4;

  // 4. MARKET TYPE SCORE (15% weight) - max 15 points
  let marketTypeScore = 0;
  if (marketType === 'Standard') {
    marketTypeScore = 15;
  } else if (marketType === 'Goblin') {
    // Goblin lines require extra caution
    marketTypeScore = medianGap >= 2 ? 10 : 3;
  } else if (marketType === 'Demon') {
    // Demon lines only OK if median clears by 20%+
    const clearancePercent = prop.rolling_median ? (medianGap / prop.rolling_median) * 100 : 0;
    marketTypeScore = clearancePercent >= 20 && minutesCertainty === 'LOCKED' ? 12 : 2;
  }

  // 5. BLOWOUT/PACE CONTEXT SCORE (10% weight) - max 10 points
  let blowoutPaceScore = 0;
  if (spread >= 8) {
    // Blowout risk
    if (isOver && archetype === 'Big') blowoutPaceScore = 10; // Bigs get more rebounds in blowouts
    else if (isOver) blowoutPaceScore = 6;
    else blowoutPaceScore = 2; // Unders risky in blowouts
  } else if (spread >= 4) {
    blowoutPaceScore = 7; // Moderate
  } else {
    blowoutPaceScore = 8; // Competitive game = more predictable
  }

  // Apply archetype adjustments
  if (archetype === 'Guard' && prop.prop_type.toLowerCase().includes('ast') && isOver) {
    medianGapScore = Math.min(40, medianGapScore + 4); // Guards safer for assists overs
  }
  if (archetype === 'Big' && prop.prop_type.toLowerCase().includes('reb') && !isOver && lineStructure === '.5') {
    lineStructureScore = Math.max(0, lineStructureScore - 6); // NEVER fade rebounds on .5 for bigs
  }

  const totalScore = medianGapScore + lineStructureScore + minutesCertaintyScore + marketTypeScore + blowoutPaceScore;

  return {
    score: Math.min(100, Math.max(0, Math.round(totalScore))),
    components: {
      median_gap_score: medianGapScore,
      line_structure_score: lineStructureScore,
      minutes_certainty_score: minutesCertaintyScore,
      market_type_score: marketTypeScore,
      blowout_pace_score: blowoutPaceScore,
    },
  };
}

// ============================================
// DECISION ENGINE
// ============================================

function makeDecision(sesScore: number, autoFailed: boolean): { decision: 'BET' | 'LEAN' | 'NO_BET'; emoji: string } {
  if (autoFailed) {
    return { decision: 'NO_BET', emoji: '🚫' };
  }

  if (sesScore >= 72) {
    return { decision: 'BET', emoji: '✅' };
  } else if (sesScore >= 64) {
    return { decision: 'LEAN', emoji: '⚠️' };
  } else {
    return { decision: 'NO_BET', emoji: '🚫' };
  }
}

function generateKeyReason(prop: PropInput, sesScore: number, autoFailReason: string | null, components: SESComponents): string {
  if (autoFailReason) {
    return autoFailReason.split(' - ')[1] || autoFailReason;
  }

  const lineStructure = getLineStructure(prop.line);
  const medianGap = prop.rolling_median ? prop.line - prop.rolling_median : null;
  const isOver = prop.side === 'over';

  if (sesScore >= 72) {
    if (medianGap !== null) {
      const gapDirection = isOver ? 'below' : 'above';
      return `Strong edge: Line ${Math.abs(medianGap).toFixed(1)} ${gapDirection} median with ${lineStructure} structure`;
    }
    return `High SES (${sesScore}) with favorable line structure`;
  } else if (sesScore >= 64) {
    return `Marginal edge (SES ${sesScore}) - parlay only, not straight bet`;
  } else {
    if (components.median_gap_score < 15) {
      return 'Weak median gap - line too close to expected value';
    }
    if (components.line_structure_score < 10) {
      return `.5 line structure creates unnecessary risk`;
    }
    return `Insufficient edge (SES ${sesScore}) - PASS`;
  }
}

// ============================================
// MAIN ENGINE FUNCTION
// ============================================

function runPropEngineV2(prop: PropInput): EngineResult {
  const archetype = inferArchetype(prop.position, prop.prop_type);
  const lineStructure = getLineStructure(prop.line);
  const minutesCertainty = getMinutesCertainty(prop.avg_minutes);
  const blowoutRisk = (prop.spread || 0) >= 8;
  const medianGap = prop.rolling_median ? prop.line - prop.rolling_median : null;

  // Check hard auto-fail rules first
  const autoFail = checkAutoFailRules(prop, archetype);

  // Calculate SES score
  const { score: sesScore, components } = calculateSES(prop, archetype);

  // Make decision
  const { decision, emoji } = makeDecision(sesScore, autoFail.fail);

  // Generate key reason
  const keyReason = generateKeyReason(prop, sesScore, autoFail.reason, components);

  return {
    player_name: prop.player_name,
    prop_type: prop.prop_type,
    line: prop.line,
    line_structure: lineStructure,
    side: prop.side,
    ses_score: sesScore,
    decision,
    decision_emoji: emoji,
    key_reason: keyReason,
    player_archetype: archetype,
    market_type: prop.market_type || 'Standard',
    rolling_median: prop.rolling_median || null,
    median_gap: medianGap,
    minutes_certainty: minutesCertainty,
    blowout_risk: blowoutRisk,
    auto_fail_reason: autoFail.reason,
    ses_components: components,
    event_id: prop.event_id || null,
    team_name: prop.team_name || null,
    opponent_name: prop.opponent_name || null,
    odds: prop.odds || null,
  };
}

// ============================================
// BANKROLL BUILDER MODE (2-Leg Only)
// ============================================

interface BankrollBuilderResult {
  success: boolean;
  parlay: EngineResult[] | null;
  combined_ses: number;
  reason: string;
}

function buildBankrollParlay(results: EngineResult[]): BankrollBuilderResult {
  // Filter to only picks meeting criteria
  const eligiblePicks = results.filter(r => 
    r.decision !== 'NO_BET' && 
    r.ses_score >= 68 &&
    !r.auto_fail_reason
  );

  if (eligiblePicks.length < 2) {
    return {
      success: false,
      parlay: null,
      combined_ses: 0,
      reason: 'Insufficient qualifying picks (need 2+ with SES >= 68)',
    };
  }

  // Rule: At least one OVER
  const hasOver = eligiblePicks.some(p => p.side === 'over');
  if (!hasOver) {
    return {
      success: false,
      parlay: null,
      combined_ses: 0,
      reason: 'No OVER picks available - bankroll builder requires at least 1 OVER',
    };
  }

  // Rule: Must be from different teams
  const overPicks = eligiblePicks.filter(p => p.side === 'over');
  const underPicks = eligiblePicks.filter(p => p.side === 'under');

  // Try to find best 2-leg parlay
  let bestParlay: EngineResult[] | null = null;
  let bestCombinedSES = 0;

  // Prefer 1 OVER + 1 UNDER from different teams
  for (const over of overPicks) {
    for (const under of underPicks) {
      if (over.team_name !== under.team_name || !over.team_name) {
        const combinedSES = Math.round((over.ses_score + under.ses_score) / 2);
        if (combinedSES > bestCombinedSES) {
          bestParlay = [over, under];
          bestCombinedSES = combinedSES;
        }
      }
    }
  }

  // If no OVER+UNDER combo, try 2 OVERs from different teams
  if (!bestParlay) {
    for (let i = 0; i < overPicks.length; i++) {
      for (let j = i + 1; j < overPicks.length; j++) {
        if (overPicks[i].team_name !== overPicks[j].team_name || !overPicks[i].team_name) {
          const combinedSES = Math.round((overPicks[i].ses_score + overPicks[j].ses_score) / 2);
          if (combinedSES > bestCombinedSES) {
            bestParlay = [overPicks[i], overPicks[j]];
            bestCombinedSES = combinedSES;
          }
        }
      }
    }
  }

  if (!bestParlay) {
    return {
      success: false,
      parlay: null,
      combined_ses: 0,
      reason: 'Cannot build parlay: all qualifying picks are from same team',
    };
  }

  return {
    success: true,
    parlay: bestParlay,
    combined_ses: bestCombinedSES,
    reason: `Bankroll Builder: 2-leg parlay with combined SES ${bestCombinedSES}`,
  };
}

// ============================================
// HTTP HANDLER
// ============================================

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    const { action, props, mode, save_results } = await req.json();

    console.log(`[Prop Engine v2] Action: ${action}, Props: ${props?.length || 0}, Mode: ${mode}`);

    if (action === 'analyze') {
      // Analyze provided props
      if (!props || !Array.isArray(props) || props.length === 0) {
        return new Response(
          JSON.stringify({ error: 'No props provided for analysis' }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      const results = props.map((prop: PropInput) => runPropEngineV2(prop));

      // Bankroll Builder mode
      let bankrollBuilder: BankrollBuilderResult | null = null;
      if (mode === 'bankroll_builder') {
        bankrollBuilder = buildBankrollParlay(results);
      }

      // Save results if requested
      if (save_results) {
        const today = new Date().toISOString().split('T')[0];
        
        const picksToInsert = results.map(r => ({
          player_name: r.player_name,
          prop_type: r.prop_type,
          line: r.line,
          line_structure: r.line_structure,
          side: r.side,
          ses_score: r.ses_score,
          decision: r.decision,
          decision_emoji: r.decision_emoji,
          key_reason: r.key_reason,
          player_archetype: r.player_archetype,
          market_type: r.market_type,
          rolling_median: r.rolling_median,
          median_gap: r.median_gap,
          minutes_certainty: r.minutes_certainty,
          blowout_risk: r.blowout_risk,
          auto_fail_reason: r.auto_fail_reason,
          ses_components: r.ses_components,
          game_date: today,
          event_id: r.event_id,
          team_name: r.team_name,
          opponent_name: r.opponent_name,
          odds: r.odds,
        }));

        const { error } = await supabase
          .from('prop_engine_v2_picks')
          .upsert(picksToInsert, { 
            onConflict: 'player_name,prop_type,game_date',
            ignoreDuplicates: false 
          });

        if (error) {
          console.error('[Prop Engine v2] Save error:', error);
        } else {
          console.log(`[Prop Engine v2] Saved ${picksToInsert.length} picks`);
        }
      }

      return new Response(
        JSON.stringify({
          success: true,
          results,
          bankroll_builder: bankrollBuilder,
          summary: {
            total: results.length,
            bets: results.filter(r => r.decision === 'BET').length,
            leans: results.filter(r => r.decision === 'LEAN').length,
            passes: results.filter(r => r.decision === 'NO_BET').length,
            avg_ses: Math.round(results.reduce((sum, r) => sum + r.ses_score, 0) / results.length),
          },
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    if (action === 'get_picks') {
      // Fetch today's analyzed picks
      const today = new Date().toISOString().split('T')[0];
      
      const { data: picks, error } = await supabase
        .from('prop_engine_v2_picks')
        .select('*')
        .eq('game_date', today)
        .order('ses_score', { ascending: false });

      if (error) throw error;

      return new Response(
        JSON.stringify({
          success: true,
          picks: picks || [],
          summary: {
            total: picks?.length || 0,
            bets: picks?.filter(p => p.decision === 'BET').length || 0,
            leans: picks?.filter(p => p.decision === 'LEAN').length || 0,
            passes: picks?.filter(p => p.decision === 'NO_BET').length || 0,
          },
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    return new Response(
      JSON.stringify({ error: 'Invalid action' }),
      { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('[Prop Engine v2] Error:', error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return new Response(
      JSON.stringify({ error: errorMessage }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
