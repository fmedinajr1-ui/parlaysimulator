import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// Eastern Time helper for consistent NBA game dates
function getEasternDate(): string {
  const now = new Date();
  const formatter = new Intl.DateTimeFormat('en-CA', { 
    timeZone: 'America/New_York',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  });
  return formatter.format(now);
}

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

// PAE Game Context — populated from ncaab_team_stats for NCAAB props
interface GameContext {
  team_tempo?: number;
  opp_tempo?: number;
  team_adj_offense?: number;
  opp_adj_defense?: number;
  team_kenpom_rank?: number;
  opp_kenpom_rank?: number;
}

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
  sport?: string;
  game_context?: GameContext;
}

interface SESComponents {
  median_gap_score: number;       // 40% weight
  line_structure_score: number;   // 20% weight
  minutes_certainty_score: number; // 15% weight
  market_type_score: number;      // 15% weight
  environment_score: number;      // 10% weight (was blowout_pace_score)
}

// Unified Environment Score for prop-engine-v2 (NBA only, NCAAB uses PAE)
function calculateEnvironmentScoreV2(
  paceRating: number | null,
  oppDefenseRank: number | null,
  blowoutProbability: number | null,
  propType: string,
  side: string,
  oppRebRank?: number | null,
  oppAstRank?: number | null,
  oppPointsRank?: number | null,
  oppThreesRank?: number | null,
  offPointsRank?: number | null,
  offReboundsRank?: number | null,
  offAssistsRank?: number | null,
  offThreesRank?: number | null,
  offPaceRank?: number | null
): number {
  const isOver = side.toLowerCase() === 'over';
  const propLower = propType.toLowerCase();

  // --- Pace Factor (15%) ---
  let paceFactor = 0.5;
  if (paceRating != null) {
    paceFactor = Math.max(0, Math.min(1, (paceRating - 94) / 12));
    if (!isOver) paceFactor = 1 - paceFactor;
  }

  // --- Prop-Specific Defense Factor (30%) ---
  // Route to the specific defensive rank for this prop type
  let propDefRank = oppDefenseRank; // fallback to overall
  if (propLower.includes('pts') || propLower.includes('point')) {
    propDefRank = oppPointsRank ?? oppDefenseRank;
  } else if (propLower.includes('three') || propLower.includes('3p')) {
    propDefRank = oppThreesRank ?? oppDefenseRank;
  } else if (propLower.includes('reb')) {
    propDefRank = oppRebRank ?? oppDefenseRank;
  } else if (propLower.includes('ast') || propLower.includes('assist')) {
    propDefRank = oppAstRank ?? oppDefenseRank;
  }
  // Combo props: weighted average of relevant ranks
  if (propLower.includes('pts') && propLower.includes('reb')) {
    const pRank = oppPointsRank ?? oppDefenseRank ?? 15;
    const rRank = oppRebRank ?? oppDefenseRank ?? 15;
    propDefRank = Math.round(pRank * 0.6 + rRank * 0.4);
  } else if (propLower.includes('pts') && propLower.includes('ast')) {
    const pRank = oppPointsRank ?? oppDefenseRank ?? 15;
    const aRank = oppAstRank ?? oppDefenseRank ?? 15;
    propDefRank = Math.round(pRank * 0.6 + aRank * 0.4);
  } else if (propLower.includes('pra') || (propLower.includes('pts') && propLower.includes('reb') && propLower.includes('ast'))) {
    const pRank = oppPointsRank ?? oppDefenseRank ?? 15;
    const rRank = oppRebRank ?? oppDefenseRank ?? 15;
    const aRank = oppAstRank ?? oppDefenseRank ?? 15;
    propDefRank = Math.round(pRank * 0.5 + rRank * 0.25 + aRank * 0.25);
  }

  let defenseFactor = 0.5;
  if (propDefRank != null) {
    defenseFactor = (propDefRank - 1) / 29;
    if (!isOver) defenseFactor = 1 - defenseFactor;
  }

  // --- Offensive Matchup Factor (20%) - Bidirectional ---
  // How good is the player's team at generating this stat type?
  let offRank: number | null = null;
  if (propLower.includes('pts') || propLower.includes('point')) {
    offRank = offPointsRank;
  } else if (propLower.includes('three') || propLower.includes('3p')) {
    offRank = offThreesRank;
  } else if (propLower.includes('reb')) {
    offRank = offReboundsRank;
  } else if (propLower.includes('ast') || propLower.includes('assist')) {
    offRank = offAssistsRank;
  }

  let offenseFactor = 0.5;
  if (offRank != null) {
    // Lower rank = better offense (rank 1 is best), so invert
    offenseFactor = 1 - ((offRank - 1) / 29);
    if (!isOver) offenseFactor = 1 - offenseFactor;
  }

  // --- Pace Rank Boost (5%) ---
  let paceRankFactor = 0.5;
  if (offPaceRank != null) {
    paceRankFactor = 1 - ((offPaceRank - 1) / 29); // lower rank = faster pace
    if (!isOver) paceRankFactor = 1 - paceRankFactor;
  }

  const blowoutFactor = Math.max(0, Math.min(1, blowoutProbability ?? 0));

  // Weighted: defense 30%, offense 20%, pace 15%, pace_rank 5%, blowout -10%
  const envScore = (defenseFactor * 0.30) + (offenseFactor * 0.20) + (paceFactor * 0.15) + (paceRankFactor * 0.05) + (blowoutFactor * -0.10);

  // Scale to 0-10 range for SES component
  return Math.max(0, Math.min(10, Math.round(envScore * 12.5)));
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

  // RULE 5: CEILING CHECK (50% MAX RULE)
  // Reject UNDER if player's L10 MAX exceeds line by >50%
  if (isUnder && prop.recent_games && prop.recent_games.length >= 5) {
    const ceiling = Math.max(...prop.recent_games);
    const ceilingRatio = ceiling / prop.line;
    if (ceilingRatio > 1.5) {
      return { 
        fail: true, 
        reason: `RULE 5: CEILING CHECK - Player hit ${ceiling} in L10 (${Math.round((ceilingRatio - 1) * 100)}% above line ${prop.line})` 
      };
    }
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

  // 5. BLOWOUT/PACE + PAE GAME ENVIRONMENT SCORE (10% weight) - max 10 points
  let blowoutPaceScore = 0;
  const isNcaab = (prop.sport || '').toLowerCase().includes('ncaab') || (prop.sport || '').toLowerCase().includes('college');
  const ctx = prop.game_context;
  const isCountingStat = ['pts', 'reb', 'ast', 'points', 'rebounds', 'assists', 'pra', 'pts+reb', 'pts+ast', 'reb+ast']
    .some(s => prop.prop_type.toLowerCase().includes(s));

  if (isNcaab && ctx && isCountingStat) {
    // PAE Game Environment scoring replaces spread-based blowout for NCAAB counting stats
    let paeScore = 5; // neutral baseline

    const tempoAvg = (ctx.team_tempo && ctx.opp_tempo)
      ? (ctx.team_tempo + ctx.opp_tempo) / 2
      : null;

    if (tempoAvg !== null) {
      if (isOver) {
        if (tempoAvg > 69) paeScore += 4;       // Fast game = inflation
        else if (tempoAvg > 67) paeScore += 2;
        else if (tempoAvg < 63) paeScore -= 4;  // Grind = suppress overs
      } else {
        // Unders benefit from slow tempo
        if (tempoAvg < 63) paeScore += 4;
        else if (tempoAvg < 65) paeScore += 2;
        else if (tempoAvg > 69) paeScore -= 3;
      }
    }

    if (ctx.opp_adj_defense !== undefined) {
      if (isOver) {
        if (ctx.opp_adj_defense > 105) paeScore -= 3; // Strong D = harder to hit overs
        else if (ctx.opp_adj_defense < 97) paeScore += 3; // Weak D = favorable
      } else {
        if (ctx.opp_adj_defense > 105) paeScore += 3;
        else if (ctx.opp_adj_defense < 97) paeScore -= 2;
      }
    }

    if (isOver && ctx.team_adj_offense !== undefined && ctx.team_adj_offense > 125) {
      paeScore += 2; // Elite offense = better looks
    }

    blowoutPaceScore = Math.min(10, Math.max(0, paeScore));
  } else {
    // Unified Environment Score for NBA / non-NCAAB
    // Use pace and defense data if available via prop context
    const paceRating = (prop as any).pace_rating ?? null;
    const oppDefRank = (prop as any).opp_defense_rank ?? null;
    const blowoutProb = spread >= 8 ? Math.min(1, spread / 15) : spread >= 4 ? 0.2 : 0.1;
    const oppRebRank = (prop as any).opp_rebounds_rank ?? null;
    const oppAstRank = (prop as any).opp_assists_rank ?? null;
    const oppPointsRank = (prop as any).opp_points_rank ?? null;
    const oppThreesRank = (prop as any).opp_threes_rank ?? null;
    const offPointsRank = (prop as any).off_points_rank ?? null;
    const offReboundsRank = (prop as any).off_rebounds_rank ?? null;
    const offAssistsRank = (prop as any).off_assists_rank ?? null;
    const offThreesRank = (prop as any).off_threes_rank ?? null;
    const offPaceRank = (prop as any).off_pace_rank ?? null;
    blowoutPaceScore = calculateEnvironmentScoreV2(paceRating, oppDefRank, blowoutProb, prop.prop_type, prop.side, oppRebRank, oppAstRank, oppPointsRank, oppThreesRank, offPointsRank, offReboundsRank, offAssistsRank, offThreesRank, offPaceRank);
  }

  // Apply archetype adjustments
  if (archetype === 'Guard' && prop.prop_type.toLowerCase().includes('ast') && isOver) {
    medianGapScore = Math.min(40, medianGapScore + 4);
  }
  if (archetype === 'Big' && prop.prop_type.toLowerCase().includes('reb') && !isOver && lineStructure === '.5') {
    lineStructureScore = Math.max(0, lineStructureScore - 6);
  }

  const totalScore = medianGapScore + lineStructureScore + minutesCertaintyScore + marketTypeScore + blowoutPaceScore;

  return {
    score: Math.min(100, Math.max(0, Math.round(totalScore))),
    components: {
      median_gap_score: medianGapScore,
      line_structure_score: lineStructureScore,
      minutes_certainty_score: minutesCertaintyScore,
      market_type_score: marketTypeScore,
      environment_score: blowoutPaceScore,
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
  const ctx = prop.game_context;
  const isNcaab = (prop.sport || '').toLowerCase().includes('ncaab') || (prop.sport || '').toLowerCase().includes('college');

  // Build PAE context string if available
  let paeContext = '';
  if (isNcaab && ctx) {
    const tempoAvg = ctx.team_tempo && ctx.opp_tempo
      ? ((ctx.team_tempo + ctx.opp_tempo) / 2).toFixed(1)
      : null;
    if (tempoAvg && parseFloat(tempoAvg) > 69) {
      paeContext = ` — Elite tempo game (avg ${tempoAvg} poss) boosts counting stats`;
    } else if (tempoAvg && parseFloat(tempoAvg) < 63) {
      paeContext = ` — Grind matchup (avg ${tempoAvg} poss) suppresses overs`;
    }
    if (ctx.opp_adj_defense && ctx.opp_adj_defense > 105 && isOver) {
      paeContext += paeContext ? ', strong D' : ' — Strong opponent defense suppresses over';
    } else if (ctx.opp_adj_defense && ctx.opp_adj_defense < 97 && isOver) {
      paeContext += paeContext ? ', weak D matchup' : ' — Weak opponent defense favors over';
    }
  }

  if (sesScore >= 72) {
    if (medianGap !== null) {
      const gapDirection = isOver ? 'below' : 'above';
      return `Strong edge: Line ${Math.abs(medianGap).toFixed(1)} ${gapDirection} median with ${lineStructure} structure${paeContext}`;
    }
    return `High SES (${sesScore}) with favorable line structure${paeContext}`;
  } else if (sesScore >= 64) {
    return `Marginal edge (SES ${sesScore}) - parlay only, not straight bet${paeContext}`;
  } else {
    if (components.median_gap_score < 15) {
      return `Weak median gap - line too close to expected value${paeContext}`;
    }
    if (components.line_structure_score < 10) {
      return `.5 line structure creates unnecessary risk${paeContext}`;
    }
    return `Insufficient edge (SES ${sesScore}) - PASS${paeContext}`;
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

    // Helper function to extract stat values from game logs
    function getStatValue(log: any, propType: string): number {
      const type = propType.toLowerCase();
      
      // Combo stats
      if ((type.includes('pts') && type.includes('reb') && type.includes('ast')) || type.includes('pra')) {
        return (log.points || 0) + (log.rebounds || 0) + (log.assists || 0);
      }
      if (type.includes('pts') && type.includes('reb')) {
        return (log.points || 0) + (log.rebounds || 0);
      }
      if (type.includes('pts') && type.includes('ast')) {
        return (log.points || 0) + (log.assists || 0);
      }
      if (type.includes('reb') && type.includes('ast')) {
        return (log.rebounds || 0) + (log.assists || 0);
      }
      
      // Single stats
      if (type.includes('rebound') || type === 'reb') return log.rebounds || 0;
      if (type.includes('assist') || type === 'ast') return log.assists || 0;
      if (type.includes('point') || type === 'pts') return log.points || 0;
      if (type.includes('three') || type.includes('3pt') || type.includes('3-pointer')) return log.threes_made || 0;
      if (type.includes('block') || type === 'blk') return log.blocks || 0;
      if (type.includes('steal') || type === 'stl') return log.steals || 0;
      if (type.includes('turnover') || type === 'to') return log.turnovers || 0;
      
      return 0;
    }

    // ============================================
    // FULL SLATE MODE - Auto-fetch from Risk Engine
    // ============================================
    if (action === 'full_slate' || action === 'analyze_all' || mode === 'full_slate') {
      const today = getEasternDate();
      console.log(`[Prop Engine v2] Full slate mode for ${today}`);

      // Load NCAAB team stats for PAE game context enrichment
      const [ncaabStatsRes, paceRes, defRankRes] = await Promise.all([
        supabase.from('ncaab_team_stats').select('team_name, kenpom_adj_o, kenpom_adj_d, adj_tempo, kenpom_rank'),
        supabase.from('nba_team_pace_projections').select('team_abbrev, team_name, pace_rating'),
        supabase.from('team_defense_rankings').select('team_abbreviation, team_name, overall_rank, opp_points_rank, opp_threes_rank, opp_rebounds_rank, opp_assists_rank, off_points_rank, off_rebounds_rank, off_assists_rank, off_threes_rank, off_pace_rank').eq('is_current', true),
      ]);
      const ncaabStats = ncaabStatsRes.data;
      const ncaabMap = new Map(
        (ncaabStats ?? []).map((t: any) => [t.team_name.toLowerCase(), t])
      );
      // Build pace and defense lookup maps for NBA environment scoring
      const paceTeamMap = new Map<string, number>();
      (paceRes.data ?? []).forEach((p: any) => {
        paceTeamMap.set(p.team_abbrev, p.pace_rating);
        if (p.team_name) paceTeamMap.set(p.team_name.toLowerCase(), p.pace_rating);
      });
      const defTeamMap = new Map<string, { overall_rank: number; opp_points_rank: number | null; opp_threes_rank: number | null; opp_rebounds_rank: number | null; opp_assists_rank: number | null; off_points_rank: number | null; off_rebounds_rank: number | null; off_assists_rank: number | null; off_threes_rank: number | null; off_pace_rank: number | null }>();
      (defRankRes.data ?? []).forEach((d: any) => {
        const entry = { overall_rank: d.overall_rank, opp_points_rank: d.opp_points_rank, opp_threes_rank: d.opp_threes_rank, opp_rebounds_rank: d.opp_rebounds_rank, opp_assists_rank: d.opp_assists_rank, off_points_rank: d.off_points_rank, off_rebounds_rank: d.off_rebounds_rank, off_assists_rank: d.off_assists_rank, off_threes_rank: d.off_threes_rank, off_pace_rank: d.off_pace_rank };
        defTeamMap.set(d.team_abbreviation, entry);
        if (d.team_name) defTeamMap.set(d.team_name.toLowerCase(), entry);
      });
      console.log(`[Prop Engine v2] Loaded ${ncaabMap.size} NCAAB teams, ${paceTeamMap.size} pace entries, ${defTeamMap.size} defense entries`);
      
      // Fetch approved props from Risk Engine (uses nba_risk_engine_picks table)
      const { data: approvedProps, error: fetchError } = await supabase
        .from('nba_risk_engine_picks')
        .select('*')
        .eq('game_date', today);
      
      if (fetchError) {
        console.error('[Prop Engine v2] Error fetching approved props:', fetchError);
        throw fetchError;
      }
      
      if (!approvedProps || approvedProps.length === 0) {
        return new Response(
          JSON.stringify({ 
            success: false, 
            message: 'No approved props found from Risk Engine for today',
            total: 0
          }),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
      
      console.log(`[Prop Engine v2] Full slate: Processing ${approvedProps.length} approved props`);
      
      // Convert Risk Engine props to PropInput format with median calculation
      const propsToAnalyze: PropInput[] = [];
      
      for (const prop of approvedProps) {
        // Fetch game logs for median calculation and recent games
        const { data: gameLogs } = await supabase
          .from('nba_player_game_logs')
          .select('*')
          .eq('player_name', prop.player_name)
          .order('game_date', { ascending: false })
          .limit(10);
        
        // Calculate stats from game logs
        let recentGames: number[] = [];
        let rollingMedian = prop.true_median || 0;
        
        if (gameLogs && gameLogs.length > 0) {
          recentGames = gameLogs.map(log => getStatValue(log, prop.prop_type));
          
          // Calculate median if not provided
          if (!rollingMedian || rollingMedian <= 0) {
            rollingMedian = calculateMedian(recentGames);
          }
        }
        
        // Build PAE game context for NCAAB props
        const sportLower = (prop.sport || '').toLowerCase();
        const isNcaabProp = sportLower.includes('ncaab') || sportLower.includes('college');
        let gameContext: GameContext | undefined;
        if (isNcaabProp && ncaabMap.size > 0) {
          const teamKey = (prop.team_name || '').toLowerCase();
          const oppKey = (prop.opponent || '').toLowerCase();
          const teamStats = ncaabMap.get(teamKey) as any;
          const oppStats = ncaabMap.get(oppKey) as any;
          if (teamStats || oppStats) {
            gameContext = {
              team_tempo: teamStats?.adj_tempo ?? undefined,
              opp_tempo: oppStats?.adj_tempo ?? undefined,
              team_adj_offense: teamStats?.kenpom_adj_o ?? teamStats?.adj_offense ?? undefined,
              opp_adj_defense: oppStats?.kenpom_adj_d ?? oppStats?.adj_defense ?? undefined,
              team_kenpom_rank: teamStats?.kenpom_rank ?? undefined,
              opp_kenpom_rank: oppStats?.kenpom_rank ?? undefined,
            };
          }
        }

        // Enrich with pace and defense data for environment scoring
        const teamKey = (prop.team_name || '').toLowerCase();
        const oppKey = (prop.opponent || '').toLowerCase();
        const teamPace = paceTeamMap.get(teamKey) ?? paceTeamMap.get(prop.team_name || '') ?? null;
        const oppDef = defTeamMap.get(oppKey) ?? defTeamMap.get(prop.opponent || '') ?? null;

        // Also look up the player's own team defense entry for offensive ranks
        const teamDef = defTeamMap.get(teamKey) ?? defTeamMap.get(prop.team_name || '') ?? null;

        const enrichedProp: any = {
          player_name: prop.player_name,
          prop_type: prop.prop_type,
          line: prop.current_line || prop.line,
          side: (prop.side?.toLowerCase() || 'over') as 'over' | 'under',
          event_id: prop.event_id,
          team_name: prop.team_name,
          opponent_name: prop.opponent,
          rolling_median: rollingMedian,
          recent_games: recentGames,
          avg_minutes: prop.avg_minutes,
          spread: prop.spread,
          position: prop.player_role,
          market_type: 'Standard',
          sport: prop.sport,
          game_context: gameContext,
          pace_rating: teamPace,
          opp_defense_rank: oppDef?.overall_rank ?? null,
          opp_points_rank: oppDef?.opp_points_rank ?? null,
          opp_threes_rank: oppDef?.opp_threes_rank ?? null,
          opp_rebounds_rank: oppDef?.opp_rebounds_rank ?? null,
          opp_assists_rank: oppDef?.opp_assists_rank ?? null,
          off_points_rank: teamDef?.off_points_rank ?? null,
          off_rebounds_rank: teamDef?.off_rebounds_rank ?? null,
          off_assists_rank: teamDef?.off_assists_rank ?? null,
          off_threes_rank: teamDef?.off_threes_rank ?? null,
          off_pace_rank: teamDef?.off_pace_rank ?? null,
        };

        propsToAnalyze.push(enrichedProp);
      }
      
      console.log(`[Prop Engine v2] Prepared ${propsToAnalyze.length} props for analysis`);
      
      // Run engine on all props
      const results = propsToAnalyze.map(prop => runPropEngineV2(prop));
      
      // Save results to prop_engine_v2_picks
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

      const { error: saveError } = await supabase
        .from('prop_engine_v2_picks')
        .upsert(picksToInsert, { 
          onConflict: 'player_name,prop_type,game_date',
          ignoreDuplicates: false 
        });

      if (saveError) {
        console.error('[Prop Engine v2] Save error:', saveError);
      } else {
        console.log(`[Prop Engine v2] Saved ${picksToInsert.length} picks`);
      }
      
      // Build bankroll parlay
      const bankrollBuilder = buildBankrollParlay(results);
      
      const summary = {
        total: results.length,
        bets: results.filter(r => r.decision === 'BET').length,
        leans: results.filter(r => r.decision === 'LEAN').length,
        passes: results.filter(r => r.decision === 'NO_BET').length,
        avg_ses: results.length > 0 ? Math.round(results.reduce((sum, r) => sum + r.ses_score, 0) / results.length) : 0,
      };
      
      console.log(`[Prop Engine v2] Full slate complete: ${summary.bets} BETs, ${summary.leans} LEANs, ${summary.passes} PASSes`);
      
      return new Response(
        JSON.stringify({
          success: true,
          results,
          bankroll_builder: bankrollBuilder,
          summary,
          source: 'full_slate_from_risk_engine',
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

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
        const today = getEasternDate();
        
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
      const today = getEasternDate();
      
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
