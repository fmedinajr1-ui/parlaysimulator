import type { PairLiftInput, ScoredLeg } from "./models.ts";
import { clamp01 } from "./scoring.ts";

function pairKey(a: string, b: string): string {
  return [a, b].sort().join("::");
}

export function buildPairLiftMap(pairLifts: PairLiftInput[] = []): Map<string, number> {
  const map = new Map<string, number>();
  for (const pair of pairLifts) {
    if (pair.a && pair.b && Number.isFinite(pair.lift) && pair.lift > 0) {
      map.set(pairKey(pair.a, pair.b), pair.lift);
    }
  }
  return map;
}

export function correlationAdjustedProbability(legs: ScoredLeg[], pairLifts: Map<string, number>): number {
  const baseP = legs.reduce((product, leg) => product * leg.confidence, 1);
  const lifts: number[] = [];

  for (let i = 0; i < legs.length; i += 1) {
    for (let j = i + 1; j < legs.length; j += 1) {
      if (legs[i].gameId !== legs[j].gameId) continue;
      lifts.push(pairLifts.get(pairKey(legs[i].id, legs[j].id)) ?? 1);
    }
  }

  if (!lifts.length) return clamp01(baseP);
  const meanLift = Math.exp(lifts.reduce((sum, lift) => sum + Math.log(Math.max(lift, 0.01)), 0) / lifts.length);
  return clamp01(baseP * meanLift);
}
