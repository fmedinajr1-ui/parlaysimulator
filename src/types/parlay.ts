export interface ParlayLeg {
  id: string;
  description: string;
  odds: number; // American odds
  impliedProbability: number;
  riskLevel: 'low' | 'medium' | 'high' | 'extreme';
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
