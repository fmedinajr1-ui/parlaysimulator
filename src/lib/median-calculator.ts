export function median(arr: number[]): number {
  if (arr.length === 0) return 0;
  const sorted = [...arr].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 !== 0 
    ? sorted[mid] 
    : (sorted[mid - 1] + sorted[mid]) / 2;
}

export type StatType = 'points' | 'rebounds' | 'assists';
export type GameLocation = 'home' | 'away';
export type InjuryContext = 'none' | 'teammate_out' | 'minutes_limit';

export interface MedianCalcInput {
  gameStats: number[];
  sportsbookLine: number;
  statType: StatType;
  expectedMinutes?: number;
  spread?: number;
  gameLocation?: GameLocation;
  injuryContext?: InjuryContext;
}

export interface MedianCalcResult {
  trueMedian: number;
  edge: number;
  recommendation: 'STRONG OVER' | 'LEAN OVER' | 'STRONG UNDER' | 'LEAN UNDER' | 'NO BET';
  confidence: number;
  m1FormMedian: number;
  m2MinutesWeighted: number;
  adjustments: {
    blowoutRisk: number;
    injuryBoost: number;
    minutesLimit: number;
    homeAdvantage: number;
  };
  reasonSummary: string;
}

export function calculateMedianEdge(input: MedianCalcInput): MedianCalcResult {
  const { 
    gameStats, 
    sportsbookLine, 
    statType,
    expectedMinutes = 32,
    spread = 0,
    gameLocation = 'home',
    injuryContext = 'none'
  } = input;

  // Filter out zeros and validate
  const validStats = gameStats.filter(s => s > 0);
  if (validStats.length === 0) {
    return {
      trueMedian: 0,
      edge: 0,
      recommendation: 'NO BET',
      confidence: 0,
      m1FormMedian: 0,
      m2MinutesWeighted: 0,
      adjustments: { blowoutRisk: 0, injuryBoost: 0, minutesLimit: 0, homeAdvantage: 0 },
      reasonSummary: 'Enter at least one game stat to calculate.'
    };
  }

  // M1: Form Median (25% weight) - Raw recent performance
  const m1FormMedian = median(validStats);
  
  // M2: Minutes-weighted (75% weight)
  // Assumes average of 32 mins in past games, adjusts for expected minutes
  const avgMinutes = 32;
  const minutesRatio = expectedMinutes / avgMinutes;
  const minutesAdjusted = validStats.map(s => s * minutesRatio);
  const m2MinutesWeighted = median(minutesAdjusted);
  
  // TRUE MEDIAN (25% form, 75% minutes-adjusted)
  let trueMedian = (m1FormMedian * 0.25) + (m2MinutesWeighted * 0.75);
  
  // Apply adjustments
  const adjustments = { 
    blowoutRisk: 0, 
    injuryBoost: 0, 
    minutesLimit: 0,
    homeAdvantage: 0
  };
  
  // Blowout risk adjustment (large spread = potential garbage time)
  if (Math.abs(spread) >= 10) {
    const blowoutPenalty = statType === 'points' ? -1.5 : -0.5;
    adjustments.blowoutRisk = blowoutPenalty;
    trueMedian += blowoutPenalty;
  } else if (Math.abs(spread) >= 7) {
    const blowoutPenalty = statType === 'points' ? -0.75 : -0.25;
    adjustments.blowoutRisk = blowoutPenalty;
    trueMedian += blowoutPenalty;
  }
  
  // Injury context adjustments
  if (injuryContext === 'teammate_out') {
    const injuryBoost = statType === 'points' ? 2.0 : statType === 'rebounds' ? 1.5 : 1.0;
    adjustments.injuryBoost = injuryBoost;
    trueMedian += injuryBoost;
  }
  
  if (injuryContext === 'minutes_limit') {
    const minutesDeduction = statType === 'points' ? -3.0 : -1.5;
    adjustments.minutesLimit = minutesDeduction;
    trueMedian += minutesDeduction;
  }
  
  // Home/away slight adjustment
  if (gameLocation === 'home') {
    const homeBoost = statType === 'points' ? 0.5 : 0.2;
    adjustments.homeAdvantage = homeBoost;
    trueMedian += homeBoost;
  } else {
    const awayPenalty = statType === 'points' ? -0.3 : -0.1;
    adjustments.homeAdvantage = awayPenalty;
    trueMedian += awayPenalty;
  }
  
  // Round to 1 decimal
  trueMedian = Math.round(trueMedian * 10) / 10;
  
  // EDGE calculation
  const edge = Math.round((trueMedian - sportsbookLine) * 10) / 10;
  
  // RECOMMENDATION with confidence
  let recommendation: MedianCalcResult['recommendation'] = 'NO BET';
  let confidence = 0;
  
  if (edge >= 3.0) {
    recommendation = 'STRONG OVER';
    confidence = Math.min(95, 70 + (edge - 3) * 5);
  } else if (edge >= 1.5) {
    recommendation = 'LEAN OVER';
    confidence = 50 + (edge - 1.5) * 13;
  } else if (edge <= -3.0) {
    recommendation = 'STRONG UNDER';
    confidence = Math.min(95, 70 + (Math.abs(edge) - 3) * 5);
  } else if (edge <= -1.5) {
    recommendation = 'LEAN UNDER';
    confidence = 50 + (Math.abs(edge) - 1.5) * 13;
  } else {
    confidence = 30 + Math.abs(edge) * 10;
  }
  
  confidence = Math.round(confidence);
  
  // REASON SUMMARY
  const direction = edge > 0 ? 'exceeds' : 'falls below';
  const absEdge = Math.abs(edge);
  const reasonSummary = edge === 0 
    ? `True median matches the book line exactly at ${sportsbookLine}.`
    : `True median of ${trueMedian} ${direction} book line of ${sportsbookLine} by ${absEdge} ${statType}.`;
  
  return {
    trueMedian,
    edge,
    recommendation,
    confidence,
    m1FormMedian: Math.round(m1FormMedian * 10) / 10,
    m2MinutesWeighted: Math.round(m2MinutesWeighted * 10) / 10,
    adjustments,
    reasonSummary
  };
}

export function getRecommendationColor(recommendation: MedianCalcResult['recommendation']): {
  bg: string;
  text: string;
  border: string;
  glow: string;
} {
  switch (recommendation) {
    case 'STRONG OVER':
      return {
        bg: 'bg-emerald-500/20',
        text: 'text-emerald-400',
        border: 'border-emerald-500/50',
        glow: 'shadow-emerald-500/30'
      };
    case 'LEAN OVER':
      return {
        bg: 'bg-emerald-500/10',
        text: 'text-emerald-300',
        border: 'border-emerald-500/30',
        glow: 'shadow-emerald-500/20'
      };
    case 'STRONG UNDER':
      return {
        bg: 'bg-red-500/20',
        text: 'text-red-400',
        border: 'border-red-500/50',
        glow: 'shadow-red-500/30'
      };
    case 'LEAN UNDER':
      return {
        bg: 'bg-red-500/10',
        text: 'text-red-300',
        border: 'border-red-500/30',
        glow: 'shadow-red-500/20'
      };
    default:
      return {
        bg: 'bg-muted/30',
        text: 'text-muted-foreground',
        border: 'border-muted/50',
        glow: ''
      };
  }
}
