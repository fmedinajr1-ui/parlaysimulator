import { ParlaySimulation } from '@/types/parlay';

export interface ComparisonResult {
  simulations: ParlaySimulation[];
  rankings: {
    byProbability: number[];
    byEV: number[];
    byPayout: number[];
    overall: number[];
  };
  bestByMetric: {
    probability: number;
    ev: number;
    payout: number;
  };
  recommendation: string;
}

export function compareParlays(simulations: ParlaySimulation[]): ComparisonResult {
  if (simulations.length === 0) {
    return {
      simulations: [],
      rankings: { byProbability: [], byEV: [], byPayout: [], overall: [] },
      bestByMetric: { probability: -1, ev: -1, payout: -1 },
      recommendation: "Add parlays to compare"
    };
  }

  // Rank by probability (higher is better)
  const byProbability = [...simulations]
    .map((s, i) => ({ idx: i, value: s.combinedProbability }))
    .sort((a, b) => b.value - a.value)
    .map((item, rank) => ({ ...item, rank }));

  // Rank by EV (higher is better, less negative)
  const byEV = [...simulations]
    .map((s, i) => ({ idx: i, value: s.expectedValue }))
    .sort((a, b) => b.value - a.value)
    .map((item, rank) => ({ ...item, rank }));

  // Rank by payout (higher is better)
  const byPayout = [...simulations]
    .map((s, i) => ({ idx: i, value: s.potentialPayout }))
    .sort((a, b) => b.value - a.value)
    .map((item, rank) => ({ ...item, rank }));

  // Calculate overall score (lower is better)
  const overallScores = simulations.map((_, i) => {
    const probRank = byProbability.find(p => p.idx === i)?.rank ?? simulations.length;
    const evRank = byEV.find(p => p.idx === i)?.rank ?? simulations.length;
    const payoutRank = byPayout.find(p => p.idx === i)?.rank ?? simulations.length;
    // Weight: probability 40%, EV 40%, payout 20%
    return probRank * 0.4 + evRank * 0.4 + payoutRank * 0.2;
  });

  const overall = overallScores
    .map((score, idx) => ({ idx, score }))
    .sort((a, b) => a.score - b.score)
    .map(item => item.idx);

  // Get best indices
  const bestProbIdx = byProbability[0]?.idx ?? -1;
  const bestEVIdx = byEV[0]?.idx ?? -1;
  const bestPayoutIdx = byPayout[0]?.idx ?? -1;
  const overallBestIdx = overall[0] ?? -1;

  // Generate recommendation
  let recommendation = "";
  if (simulations.length === 1) {
    recommendation = "Add more parlays to compare!";
  } else {
    const bestSim = simulations[overallBestIdx];
    const probPct = (bestSim.combinedProbability * 100).toFixed(1);
    
    if (bestProbIdx === bestEVIdx && bestEVIdx === overallBestIdx) {
      recommendation = `Parlay ${overallBestIdx + 1} is the clear winner with ${probPct}% win probability and the best expected value. This is your smartest bet.`;
    } else if (bestProbIdx === overallBestIdx) {
      recommendation = `Parlay ${overallBestIdx + 1} has the best chance to hit at ${probPct}%. It's your safest choice.`;
    } else if (bestEVIdx === overallBestIdx) {
      recommendation = `Parlay ${overallBestIdx + 1} gives you the best bang for your buck with the highest EV.`;
    } else {
      const bestPayoutSim = simulations[bestPayoutIdx];
      if (bestPayoutIdx !== overallBestIdx && bestPayoutSim.potentialPayout > bestSim.potentialPayout * 1.5) {
        recommendation = `Parlay ${overallBestIdx + 1} is the balanced choice, but if you're feeling degen, Parlay ${bestPayoutIdx + 1} has the biggest payout.`;
      } else {
        recommendation = `Parlay ${overallBestIdx + 1} offers the best balance of probability and value at ${probPct}% win chance.`;
      }
    }
  }

  return {
    simulations,
    rankings: {
      byProbability: byProbability.map(p => p.idx),
      byEV: byEV.map(p => p.idx),
      byPayout: byPayout.map(p => p.idx),
      overall
    },
    bestByMetric: {
      probability: bestProbIdx,
      ev: bestEVIdx,
      payout: bestPayoutIdx
    },
    recommendation
  };
}

export function getMetricRank(comparisonResult: ComparisonResult, slotIndex: number, metric: 'probability' | 'ev' | 'payout' | 'overall'): number {
  const rankings = metric === 'overall' 
    ? comparisonResult.rankings.overall
    : metric === 'probability'
    ? comparisonResult.rankings.byProbability
    : metric === 'ev'
    ? comparisonResult.rankings.byEV
    : comparisonResult.rankings.byPayout;
  
  return rankings.indexOf(slotIndex) + 1;
}
