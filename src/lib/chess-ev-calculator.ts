// CHESS EV Calculator - Injury Value System
// Formula: EV = (IV × (OE + DP)) + (LV × (1 − PI)) + (TT × (1 / MC))

export interface CHESSInputs {
  injuryValue: number;        // IV: 0-1, impact of injuries on team
  offensiveEdge: number;      // OE: 0-1, offensive advantage
  defensivePressure: number;  // DP: 0-1, defensive advantage
  lineValue: number;          // LV: 0-100, line mispricing amount
  publicInfluence: number;    // PI: 0-1, public betting influence
  trapTendency: number;       // TT: 0-1, trap pattern score
  marketConsensus: number;    // MC: 1-10, book consensus level
}

export interface CHESSResult {
  ev: number;
  normalized: number;
  breakdown: {
    injuryComponent: number;
    lineValueComponent: number;
    trapComponent: number;
  };
  rating: 'elite' | 'strong' | 'moderate' | 'weak' | 'negative';
}

export function calculateCHESSEV(inputs: CHESSInputs): CHESSResult {
  const {
    injuryValue,
    offensiveEdge,
    defensivePressure,
    lineValue,
    publicInfluence,
    trapTendency,
    marketConsensus
  } = inputs;

  // Component 1: Injury Impact
  // (IV × (OE + DP))
  const injuryComponent = injuryValue * (offensiveEdge + defensivePressure);

  // Component 2: Line Value
  // (LV × (1 − PI))
  const lineValueComponent = (lineValue / 100) * (1 - publicInfluence);

  // Component 3: Trap Detection
  // (TT × (1 / MC))
  const trapComponent = trapTendency * (1 / Math.max(marketConsensus, 1));

  // Final EV calculation
  const ev = injuryComponent + lineValueComponent + trapComponent;

  // Normalize to 0-100 scale
  const normalized = Math.min(100, Math.max(0, ev * 50));

  // Rating based on EV
  let rating: CHESSResult['rating'];
  if (ev >= 1.5) rating = 'elite';
  else if (ev >= 1.0) rating = 'strong';
  else if (ev >= 0.5) rating = 'moderate';
  else if (ev >= 0) rating = 'weak';
  else rating = 'negative';

  return {
    ev,
    normalized,
    breakdown: {
      injuryComponent,
      lineValueComponent,
      trapComponent
    },
    rating
  };
}

// Calculate injury value based on injury reports
export function calculateInjuryValue(
  teamInjuries: { playerName: string; impactLevel: string; status: string }[],
  opponentInjuries: { playerName: string; impactLevel: string; status: string }[]
): number {
  const impactWeights: Record<string, number> = {
    'high': 0.4,
    'medium': 0.2,
    'low': 0.1
  };

  const statusMultipliers: Record<string, number> = {
    'out': 1.0,
    'doubtful': 0.8,
    'questionable': 0.5,
    'probable': 0.2
  };

  const calculateTeamImpact = (injuries: typeof teamInjuries) => {
    return injuries.reduce((total, injury) => {
      const impact = impactWeights[injury.impactLevel] || 0.1;
      const multiplier = statusMultipliers[injury.status.toLowerCase()] || 0.5;
      return total + (impact * multiplier);
    }, 0);
  };

  const teamImpact = calculateTeamImpact(teamInjuries);
  const opponentImpact = calculateTeamImpact(opponentInjuries);

  // Positive value means opponent has more injuries (advantage)
  return Math.min(1, Math.max(-1, opponentImpact - teamImpact));
}

// Calculate odds sweetspot score
export function calculateOddsSweetspot(odds: number): number {
  // Optimal range: +150 to +400
  if (odds < 150) return Math.max(0, (odds - 100) / 50 * 30);
  if (odds <= 250) return 100; // Peak sweetspot
  if (odds <= 400) return 100 - ((odds - 250) / 150 * 40);
  return Math.max(0, 60 - ((odds - 400) / 200 * 60));
}

// Calculate line mispricing
export function calculateLineMispricing(
  currentOdds: number,
  estimatedTrueOdds: number
): number {
  const impliedProb = currentOdds > 0 
    ? 100 / (currentOdds + 100) 
    : Math.abs(currentOdds) / (Math.abs(currentOdds) + 100);
  
  const trueProb = estimatedTrueOdds > 0
    ? 100 / (estimatedTrueOdds + 100)
    : Math.abs(estimatedTrueOdds) / (Math.abs(estimatedTrueOdds) + 100);

  // Positive means underdog is undervalued
  const mispricing = (trueProb - impliedProb) * 100;
  
  return Math.min(100, Math.max(0, mispricing * 5 + 50));
}

// Calculate upset value score
export function calculateUpsetValueScore(
  lineValue: number,
  trapPressure: number,
  oddsSweetspot: number
): number {
  // UV = (LineValue × 2) + (TrapPressure × 1.2) + (OddsSweetspot × 1.5)
  const uv = (lineValue * 2) + (trapPressure * 1.2) + (oddsSweetspot * 1.5);
  return Math.min(100, Math.max(0, uv / 4.7 * 100));
}

// Calculate historical day boost
export function calculateHistoricalDayBoost(date: Date = new Date()): number {
  const dayMultipliers: Record<number, number> = {
    0: 1.05,  // Sunday
    1: 1.10,  // Monday
    2: 1.05,  // Tuesday
    3: 1.08,  // Wednesday
    4: 1.15,  // Thursday
    5: 1.08,  // Friday
    6: 1.20   // Saturday
  };

  const dayOfWeek = date.getDay();
  const multiplier = dayMultipliers[dayOfWeek] || 1.0;
  
  // Formula: HDB = 50 × (dayMultiplier − 1.0)
  return Math.min(100, Math.max(0, 50 * (multiplier - 1.0) + 50));
}

// Calculate home court advantage impact
export function calculateHomeCourtImpact(
  homeWinRate: number,
  homeUpsetRate: number,
  awayUpsetRate: number,
  isUnderdogHome: boolean
): number {
  if (isUnderdogHome) {
    // Underdog at home - boost based on home upset rate
    return Math.min(100, homeUpsetRate * 200 + 30);
  } else {
    // Underdog away - reduce based on opponent's home strength
    const awayBoost = awayUpsetRate * 150;
    const homePenalty = (homeWinRate - 0.5) * 50;
    return Math.min(100, Math.max(0, awayBoost - homePenalty + 40));
  }
}
