export type Sport = "NBA" | "NFL" | "MLB" | "NHL" | "WNBA" | "NCAAB" | "NCAAF" | "SOCCER" | string;
export type SignalTier = "S" | "A" | "B" | "Watch" | "Unknown";
export type LegKind = "player" | "team";
export type Side = "over" | "under" | "ml" | "spread" | "total" | string;
export type SafetyTier = "lock" | "strong" | "lean" | "drop";
export type TicketTier = "CORE" | "EDGE" | "LOTTERY";
export type StrategyName = "lock_2" | "strong_3" | "stretch_4" | "lottery_5";

export interface ResearchInput {
  boost?: number;
  notes?: string[];
}

export interface LegInput {
  id: string;
  sport: Sport;
  gameId: string;
  decimalOdds?: number;
  americanOdds?: number;
  confidence: number;
  verifierMult?: number;
  signalTier?: SignalTier;
  edge?: number;
  kind?: LegKind;
  team?: string;
  opponent?: string;
  player?: string;
  prop?: string;
  side?: Side;
  isHome?: boolean;
  spread?: number;
  total?: number;
  line?: number;
  l10HitRate?: number;
  l10Games?: number;
  floorMargin?: number;
  medianMargin?: number;
  modelP?: number;
  impliedProb?: number;
  structuralBump?: number;
  research?: ResearchInput;
}

export interface ScoredLeg extends LegInput {
  decimalOdds: number;
  americanOdds: number;
  impliedProb: number;
  kind: LegKind;
  signalTier: SignalTier;
  verifierMult: number;
  edge: number;
  legQuality: number;
  safety: number;
  safetyTier: SafetyTier;
  reasons: string[];
}

export interface PairLiftInput {
  a: string;
  b: string;
  lift: number;
}

export interface BankrollInput {
  bankroll?: number;
  hits?: number;
  n?: number;
  rollingEvPerUnit?: number;
  enabled?: boolean;
}

export interface GeneratorInput {
  legs: LegInput[];
  stake?: number;
  bankroll?: BankrollInput;
  pairLifts?: PairLiftInput[];
  maxTickets?: number;
}

export interface ParlayTicket {
  id: string;
  strategy: StrategyName | "custom";
  tier: TicketTier;
  legs: ScoredLeg[];
  prob: number;
  correlatedProb: number;
  decimalOdds: number;
  americanOdds: number;
  payout: number;
  ev: number;
  parlayEdge: number;
  parlayScore: number;
  stake: number;
  rankingScore: number;
  reasons: string[];
}
