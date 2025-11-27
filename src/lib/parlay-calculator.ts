import { ParlayLeg, ParlaySimulation, DegenerateLevel, SimulationHighlight } from '@/types/parlay';

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
export function simulateParlay(legs: ParlayLeg[], stake: number): ParlaySimulation {
  // Calculate combined probability
  const combinedProbability = legs.reduce((acc, leg) => acc * leg.impliedProbability, 1);
  
  // Calculate total decimal odds
  const totalDecimalOdds = legs.reduce((acc, leg) => acc * americanToDecimal(leg.odds), 1);
  
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
  
  // Convert total odds back to American
  let totalOdds: number;
  if (totalDecimalOdds >= 2) {
    totalOdds = Math.round((totalDecimalOdds - 1) * 100);
  } else {
    totalOdds = Math.round(-100 / (totalDecimalOdds - 1));
  }
  
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
