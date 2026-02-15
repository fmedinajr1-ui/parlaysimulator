export interface ParlayLegContextualFactors {
  injuryImpact?: number;     // -1 to 0, negative reduces probability
  defenseRating?: number;    // >1 = strong defense, <1 = weak defense
  isBackToBack?: boolean;    // 6% fatigue penalty
  paceAdjustment?: number;   // multiplier (e.g., 1.05 = 5% faster pace)
  recentForm?: number;       // multiplier (e.g., 1.1 = hot streak)
}

export interface ParlayLeg {
  id: string;
  description: string;
  odds: number; // American odds
  impliedProbability: number;
  riskLevel: 'low' | 'medium' | 'high' | 'extreme';
  aiAnalysis?: LegAnalysis;
  contextualFactors?: ParlayLegContextualFactors;
}

export interface InjuryAlert {
  player: string;
  team: string;
  status: 'OUT' | 'DOUBTFUL' | 'QUESTIONABLE' | 'PROBABLE' | 'DAY-TO-DAY';
  injuryType: string;
  injuryDetails: string;
  impactLevel: 'critical' | 'high' | 'medium' | 'low';
}

export interface UsageProjection {
  playerName: string;
  propType: string;
  line: number;
  projectedMinutes: { min: number; max: number; avg: number };
  requiredRate: number;
  historicalRate: number;
  efficiencyMargin: number;
  recentGames: { date: string; value: number; minutes: number }[];
  hitRate: { hits: number; total: number; percentage: number };
  paceImpact: number;
  fatigueImpact: number;
  opponentDefenseRank: number | null;
  verdict: 'FAVORABLE' | 'NEUTRAL' | 'UNFAVORABLE';
  verdictReason: string;
}

export interface UnifiedPropData {
  pvsScore: number;
  pvsTier: string;
  hitRateScore: number;
  trapScore: number;
  fatigueScore: number;
  recommendation: string;
  confidence: number;
  sharpMoneyScore: number;
}

export interface UpsetData {
  upsetScore: number;
  isTrapFavorite: boolean;
  suggestion: string;
  confidence: string;
  chaosModeActive: boolean;
}

export interface JuiceData {
  juiceLevel: string;
  juiceDirection: string;
  juiceAmount: number;
  finalPick: string;
  movementConsistency: number;
}

export interface FatigueData {
  fatigueScore: number;
  fatigueCategory: string;
  recommendedAngle: string;
  isBackToBack: boolean;
  travelMiles: number;
}

export interface EngineSignal {
  engine: string;
  status: 'agree' | 'disagree' | 'neutral' | 'no_data';
  score: number | null;
  reason: string;
  confidence?: number;
}

export interface EngineConsensus {
  agreeingEngines: string[];
  disagreingEngines: string[];
  consensusScore: number;
  totalEngines: number;
  engineSignals?: EngineSignal[];
}

export interface LegAnalysis {
  sport: string;
  betType: 'moneyline' | 'spread' | 'total' | 'player_prop' | 'other';
  team?: string;
  player?: string;
  insights: string[];
  riskFactors: string[];
  trendDirection: 'favorable' | 'neutral' | 'unfavorable';
  adjustedProbability: number;
  calibratedProbability?: number;
  confidenceLevel: 'high' | 'medium' | 'low';
  vegasJuice: number;
  correlatedWith?: number[];
  injuryAlerts?: InjuryAlert[];
  sharpRecommendation?: 'pick' | 'fade' | 'caution' | null;
  sharpReason?: string;
  sharpSignals?: string[];
  sharpConfidence?: number;
  sharpFinalPick?: string;
  usageProjection?: UsageProjection;
  // New enhanced data from all engines
  unifiedPropData?: UnifiedPropData;
  upsetData?: UpsetData;
  juiceData?: JuiceData;
  fatigueData?: FatigueData;
  engineConsensus?: EngineConsensus;
  avoidPatterns?: string[];
  researchSummary?: ResearchSummary;
  hitRatePercent?: number;
  medianLockData?: MedianLockData;
  coachData?: CoachData;
}

export interface ResearchSignal {
  engine: 'hitrate' | 'medianlock' | 'sharp' | 'pvs' | 'fatigue' | 'usage' | 'coaching' | 'godmode' | 'juiced';
  status: 'positive' | 'negative' | 'neutral';
  headline: string;
  icon: string;
  details?: string;
  score?: number;
}

export interface ResearchSummary {
  signals: ResearchSignal[];
  overallVerdict: 'STRONG_PICK' | 'LEAN_PICK' | 'NEUTRAL' | 'LEAN_FADE' | 'STRONG_FADE';
  verdictReason: string;
  strengthScore: number;
}

export interface MedianLockData {
  classification: string;
  confidence_score: number;
  bet_side: string;
  hit_rate: number;
  parlay_grade: boolean;
  edge_percent: number;
  projected_minutes: number;
  adjusted_edge: number;
}

export interface CoachData {
  coachName: string;
  teamName: string;
  sport: string;
  offensiveBias: number;
  defensiveBias: number;
  recommendation: string;
  confidence: number;
  propRelevance: string;
  propAdjustment: number;
}

export interface CorrelatedLegPair {
  indices: number[];
  reason: string;
}

export interface CorrelationAnalysis {
  hasCorrelation: boolean;
  avgCorrelation: number;
  maxCorrelation: number;
  independentProbability: number;
  correlatedProbability: number;
  correlationImpact: number;
  correlatedPairs: { leg1: number; leg2: number; correlation: number; type: string }[];
}

export interface ParlayAnalysis {
  legAnalyses: Array<LegAnalysis & { legIndex: number }>;
  correlatedLegs: CorrelatedLegPair[];
  overallAssessment: string;
  correlationAnalysis?: CorrelationAnalysis;
}

export interface ParlaySimulation {
  legs: ParlayLeg[];
  stake: number;
  totalOdds: number;
  potentialPayout: number;
  combinedProbability: number;
  degenerateLevel: DegenerateLevel;
  expectedValue: number;
  simulationHighlights: SimulationHighlight[];
  trashTalk: string[];
  aiAnalysis?: ParlayAnalysis;
}

export type DegenerateLevel = 
  | 'LOAN_NEEDED'
  | 'LOTTERY_TICKET'
  | 'SWEAT_SEASON'
  | 'NOT_TERRIBLE'
  | 'RESPECTABLE';

export interface SimulationHighlight {
  legIndex: number;
  message: string;
  emoji: string;
}

export const DEGEN_TIERS: Record<DegenerateLevel, { label: string; emoji: string; color: string; subtext: string }> = {
  LOAN_NEEDED: {
    label: "YOU'RE GONNA NEED A LOAN",
    emoji: "💀",
    color: "neon-red",
    subtext: "The books are sending you a thank you card."
  },
  LOTTERY_TICKET: {
    label: "LOTTERY TICKET",
    emoji: "🎟️",
    color: "neon-orange",
    subtext: "You'd have better odds at a scratch-off."
  },
  SWEAT_SEASON: {
    label: "SWEAT SEASON",
    emoji: "😰",
    color: "neon-yellow",
    subtext: "Clear your Sunday. This one's gonna hurt."
  },
  NOT_TERRIBLE: {
    label: "NOT TERRIBLE, NOT GREAT",
    emoji: "🤷",
    color: "neon-purple",
    subtext: "Could be worse. Could also be way better."
  },
  RESPECTABLE: {
    label: "RESPECTABLE ACTION",
    emoji: "✅",
    color: "neon-green",
    subtext: "Okay, we see you. Sharp-ish."
  }
};
