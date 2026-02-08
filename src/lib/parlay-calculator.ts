import { ParlayLeg, ParlaySimulation, DegenerateLevel, SimulationHighlight } from '@/types/parlay';

// ============= ODDS VALUE SCORING =============

/**
 * Calculate value score based on odds vs implied probability
 * Range: -200 to +200 American odds
 * 
 * Returns: value score from 0-100
 * - 100 = Maximum value (plus money on high-probability pick)
 * - 50 = Fair value (standard -110 juice)
 * - 0 = Poor value (heavily juiced line)
 */
export function calculateOddsValueScore(
  americanOdds: number,
  estimatedHitRate: number
): number {
  // Convert odds to implied probability
  const impliedProb = americanToImplied(americanOdds);
  
  // Calculate edge (estimated - implied)
  const edge = estimatedHitRate - impliedProb;
  
  // Juice factor: how much are you overpaying?
  // -110 = 52.4% implied (fair)
  // -130 = 56.5% implied (overpaying)
  // +110 = 47.6% implied (value)
  const juicePenalty = Math.max(0, impliedProb - 0.524) * 100;
  const juiceBonus = Math.max(0, 0.524 - impliedProb) * 80;
  
  // Edge contribution (bigger edge = better)
  const edgeScore = Math.min(40, edge * 400);
  
  // Base score + edge + juice adjustment
  const score = 50 + edgeScore - juicePenalty + juiceBonus;
  
  return Math.max(0, Math.min(100, score));
}

/**
 * Calculate composite bot score for a pick
 * Combines hit rate, edge, odds value, and category weight
 */
export function calculateCompositeBotScore(
  hitRate: number,      // 0-100 (percentage)
  edge: number,         // projection - line
  oddsValueScore: number, // 0-100
  categoryWeight: number  // 0.5-1.5
): number {
  // Component weights
  const WEIGHTS = {
    hitRate: 0.30,       // Historical accuracy
    edge: 0.25,          // Projection vs line
    oddsValue: 0.25,     // Betting value
    categoryWeight: 0.20, // Bot learning weight
  };
  
  // Normalize components to 0-100 scale
  const hitRateScore = Math.min(100, hitRate);
  const edgeScore = Math.min(100, Math.max(0, edge * 20 + 50));
  const weightScore = categoryWeight * 66.67; // 1.5 max → 100
  
  // Weighted sum
  const composite = 
    (hitRateScore * WEIGHTS.hitRate) +
    (edgeScore * WEIGHTS.edge) +
    (oddsValueScore * WEIGHTS.oddsValue) +
    (weightScore * WEIGHTS.categoryWeight);
  
  return Math.round(composite);
}

/**
 * Check if odds are within acceptable range
 */
export function isOddsInRange(
  odds: number,
  minOdds: number = -200,
  maxOdds: number = 200
): boolean {
  return odds >= minOdds && odds <= maxOdds;
}

// ============= CORE PROBABILITY FUNCTIONS =============

// Convert American odds to implied probability
export function americanToImplied(odds: number): number {
  if (odds > 0) {
    return 100 / (odds + 100);
  } else {
    return -odds / (-odds + 100);
  }
}

// Convert American odds to decimal odds
export function americanToDecimal(odds: number): number {
  if (odds > 0) {
    return (odds / 100) + 1;
  } else {
    return (100 / -odds) + 1;
  }
}

// Determine risk level based on implied probability
export function getRiskLevel(impliedProb: number): 'low' | 'medium' | 'high' | 'extreme' {
  if (impliedProb >= 0.6) return 'low';
  if (impliedProb >= 0.4) return 'medium';
  if (impliedProb >= 0.25) return 'high';
  return 'extreme';
}

// Get degenerate level based on combined probability
export function getDegenerateLevel(probability: number): DegenerateLevel {
  const pct = probability * 100;
  if (pct >= 30) return 'RESPECTABLE';
  if (pct >= 15) return 'NOT_TERRIBLE';
  if (pct >= 5) return 'SWEAT_SEASON';
  if (pct >= 2) return 'LOTTERY_TICKET';
  return 'LOAN_NEEDED';
}

// Generate trash talk based on the parlay
export function generateTrashTalk(legs: ParlayLeg[], probability: number): string[] {
  const trash: string[] = [];
  const pct = probability * 100;
  
  // General roasts based on probability
  if (pct < 2) {
    trash.push("This parlay has more red flags than a Miami club. 🚩");
    trash.push("Bro… even your bookie is laughing. 😂");
  } else if (pct < 5) {
    trash.push("The books LOVE you for this one. 💸");
    trash.push("This is giving 'I'll pay rent next month' energy. 🏠");
  } else if (pct < 15) {
    trash.push("Not completely unhinged, but we're getting there. 😈");
    trash.push("Your palms are gonna be SWEATY watching this one. 💦");
  } else if (pct < 30) {
    trash.push("Okay, this isn't completely cooked. Just medium-rare. 🥩");
    trash.push("You might actually have a chance. Emphasis on 'might'. 🤞");
  } else {
    trash.push("Wait, this is actually reasonable? Who are you? 🧐");
    trash.push("The books might actually sweat this one. Respect. ✊");
  }

  // Leg-specific roasts
  const worstLeg = legs.reduce((worst, leg) => 
    leg.impliedProbability < worst.impliedProbability ? leg : worst
  );
  
  if (worstLeg.impliedProbability < 0.3) {
    trash.push(`"${worstLeg.description}" is carrying this parlay straight to the grave. ⚰️`);
  }

  if (legs.length > 4) {
    trash.push(`${legs.length} legs?! This isn't a parlay, it's a prayer circle. 🙏`);
  }

  if (legs.length > 6) {
    trash.push("At this point just light your money on fire. It's faster. 🔥");
  }

  // Add some randomized flavor
  const randomRoasts = [
    "Your last leg hasn't hit since the Obama administration. 📅",
    "This last leg is NOT cooked. It is RAW. 🍖",
    "Historical sims say: prepare for pain. 📊",
    "Vegas thanks you for your donation. 🎰",
    "This parlay called. It said 'I'm scared.' 📞",
  ];
  
  trash.push(randomRoasts[Math.floor(Math.random() * randomRoasts.length)]);

  return trash.slice(0, 6);
}

// Generate simulation highlights
export function generateHighlights(legs: ParlayLeg[]): SimulationHighlight[] {
  const highlights: SimulationHighlight[] = [];
  
  // Sort legs by probability (lowest first)
  const sortedLegs = [...legs].sort((a, b) => a.impliedProbability - b.impliedProbability);
  
  // Highlight the worst legs
  sortedLegs.slice(0, Math.min(3, legs.length)).forEach((leg, idx) => {
    const missRate = Math.round((1 - leg.impliedProbability) * 100);
    const originalIndex = legs.findIndex(l => l.id === leg.id);
    
    const messages = [
      `Leg ${originalIndex + 1} misses in ${missRate}% of sims. This one needs Jesus. 🙏`,
      `Leg ${originalIndex + 1} is the weak link. ${missRate}% miss rate. RIP. 💀`,
      `"${leg.description}" fails ${missRate}% of the time. Yikes. 😬`,
    ];
    
    highlights.push({
      legIndex: originalIndex,
      message: messages[idx % messages.length],
      emoji: ['🔥', '💀', '😈', '🤡', '📉'][idx % 5]
    });
  });

  // Add some general highlights
  if (legs.length > 3) {
    highlights.push({
      legIndex: -1,
      message: "Books FEAST on parlays like this. They're buying boats with your money. 🚤",
      emoji: "💸"
    });
  }

  return highlights;
}

// Main simulation function
// providedTotalOdds: American odds extracted from bet slip (e.g., +2456 or -150)
export function simulateParlay(
  legs: ParlayLeg[], 
  stake: number, 
  providedTotalOdds?: number
): ParlaySimulation {
  // Calculate combined probability from individual legs
  const combinedProbability = legs.reduce((acc, leg) => acc * leg.impliedProbability, 1);
  
  let totalOdds: number;
  let totalDecimalOdds: number;
  
  if (providedTotalOdds !== undefined) {
    // Use the provided total odds from the bet slip
    totalOdds = providedTotalOdds;
    totalDecimalOdds = americanToDecimal(providedTotalOdds);
  } else {
    // Calculate from individual legs
    totalDecimalOdds = legs.reduce((acc, leg) => acc * americanToDecimal(leg.odds), 1);
    
    // Convert total odds back to American
    if (totalDecimalOdds >= 2) {
      totalOdds = Math.round((totalDecimalOdds - 1) * 100);
    } else {
      totalOdds = Math.round(-100 / (totalDecimalOdds - 1));
    }
  }
  
  // Calculate potential payout
  const potentialPayout = stake * totalDecimalOdds;
  
  // Calculate EV
  const profit = potentialPayout - stake;
  const expectedValue = (combinedProbability * profit) - ((1 - combinedProbability) * stake);
  
  // Get degenerate level
  const degenerateLevel = getDegenerateLevel(combinedProbability);
  
  // Generate content
  const trashTalk = generateTrashTalk(legs, combinedProbability);
  const simulationHighlights = generateHighlights(legs);
  
  return {
    legs,
    stake,
    totalOdds,
    potentialPayout,
    combinedProbability,
    degenerateLevel,
    expectedValue,
    simulationHighlights,
    trashTalk
  };
}

// Create a leg from user input
export function createLeg(description: string, odds: number): ParlayLeg {
  const impliedProbability = americanToImplied(odds);
  return {
    id: crypto.randomUUID(),
    description,
    odds,
    impliedProbability,
    riskLevel: getRiskLevel(impliedProbability)
  };
}
