import { PREFERRED_FLOOR, STRATEGY_COUNTS } from "./config.ts";
import { buildPairLiftMap, correlationAdjustedProbability } from "./correlation.ts";
import { dedupeTickets } from "./dedup.ts";
import { parlayEdge, ticketGateReasons } from "./filters.ts";
import { bankrollStake, kellyLiteStake } from "./kelly.ts";
import type { GeneratorInput, ParlayTicket, ScoredLeg, StrategyName, TicketTier } from "./models.ts";
import { decimalToAmerican, geomean, scoreLeg } from "./scoring.ts";

interface StrategyConfig {
  name: StrategyName;
  count: number;
  size: number;
  allowedTiers: Array<ScoredLeg["safetyTier"]>;
  minSports?: number;
  requireTeamLeg?: boolean;
  tier: TicketTier;
}

const STRATEGIES: StrategyConfig[] = [
  { name: "lock_2", count: STRATEGY_COUNTS.lock_2, size: 2, allowedTiers: ["lock"], tier: "CORE" },
  { name: "strong_3", count: STRATEGY_COUNTS.strong_3, size: 3, allowedTiers: ["lock", "strong"], minSports: 2, tier: "CORE" },
  { name: "stretch_4", count: STRATEGY_COUNTS.stretch_4, size: 4, allowedTiers: ["lock", "strong"], requireTeamLeg: true, tier: "EDGE" },
  { name: "lottery_5", count: STRATEGY_COUNTS.lottery_5, size: 5, allowedTiers: ["lock", "strong", "lean"], requireTeamLeg: true, tier: "LOTTERY" },
];

function combinations<T>(items: T[], size: number, limit = 4000): T[][] {
  const result: T[][] = [];
  const picked: T[] = [];
  const visit = (start: number) => {
    if (result.length >= limit) return;
    if (picked.length === size) {
      result.push([...picked]);
      return;
    }
    for (let i = start; i <= items.length - (size - picked.length); i += 1) {
      picked.push(items[i]);
      visit(i + 1);
      picked.pop();
    }
  };
  visit(0);
  return result;
}

function makeTicket(
  legs: ScoredLeg[],
  strategy: StrategyName,
  tier: TicketTier,
  baseStake: number,
  pairLiftMap: Map<string, number>,
  bankroll: GeneratorInput["bankroll"],
): ParlayTicket | null {
  const reasons = ticketGateReasons(legs);
  if (reasons.length) return null;

  const prob = legs.reduce((product, leg) => product * leg.confidence, 1);
  const correlatedProb = correlationAdjustedProbability(legs, pairLiftMap);
  const decimalOdds = legs.reduce((product, leg) => product * leg.decimalOdds, 1);
  const americanOdds = decimalToAmerican(decimalOdds);
  const edge = parlayEdge(legs);
  const safetyScore = geomean(legs.map((leg) => leg.safety));
  const avgConf = legs.reduce((sum, leg) => sum + leg.confidence, 0) / legs.length;
  const tierStake = baseStake * kellyLiteStake(tier, avgConf);
  const bankrolled = bankrollStake(bankroll, legs.length, decimalOdds, tierStake);
  if (bankrolled.dropReason) return null;
  const stake = bankrolled.stake ?? tierStake;
  const payout = stake * (decimalOdds - 1);
  const ev = correlatedProb * payout - (1 - correlatedProb) * stake;
  const sLegs = legs.filter((leg) => leg.signalTier === "S").length;
  const aLegs = legs.filter((leg) => leg.signalTier === "A").length;
  const oddsBonus = americanOdds >= 800 && americanOdds <= 1200 ? 1.15 : americanOdds >= 300 && americanOdds < 800 ? 1.05 : 1;
  const rankingScore = ev * oddsBonus * (1 + 0.05 * sLegs + 0.02 * aLegs);

  return {
    id: `${strategy}:${legs.map((leg) => leg.id).sort().join("-")}`,
    strategy,
    tier,
    legs,
    prob,
    correlatedProb,
    decimalOdds,
    americanOdds,
    payout: stake * (decimalOdds - 1),
    ev,
    parlayEdge: edge,
    parlayScore: safetyScore,
    stake,
    rankingScore,
    reasons,
  };
}

function applyDailyBankrollCap(tickets: ParlayTicket[], bankroll: GeneratorInput["bankroll"]): ParlayTicket[] {
  if (!bankroll?.enabled || !bankroll.bankroll || bankroll.bankroll <= 0) return tickets;
  const dailyCap = bankroll.bankroll * 0.20;
  let used = 0;

  return tickets.flatMap((ticket) => {
    const remaining = dailyCap - used;
    if (remaining <= 0) return [];
    if (ticket.stake <= remaining) {
      used += ticket.stake;
      return [ticket];
    }

    const stake = remaining;
    used += stake;
    const payout = stake * (ticket.decimalOdds - 1);
    return [{
      ...ticket,
      stake,
      payout,
      ev: ticket.correlatedProb * payout - (1 - ticket.correlatedProb) * stake,
      reasons: [...ticket.reasons, "daily_bankroll_cap_trimmed"],
    }];
  });
}

function strategyCandidates(legs: ScoredLeg[], strategy: StrategyConfig): ScoredLeg[][] {
  const pool = legs
    .filter((leg) => strategy.allowedTiers.includes(leg.safetyTier))
    .filter((leg) => leg.safety >= (strategy.name === "lottery_5" ? 0.60 : PREFERRED_FLOOR))
    .sort((a, b) => b.safety * b.legQuality - a.safety * a.legQuality)
    .slice(0, 28);

  return combinations(pool, strategy.size).filter((combo) => {
    if (strategy.minSports && new Set(combo.map((leg) => leg.sport)).size < strategy.minSports) return false;
    if (strategy.requireTeamLeg && !combo.some((leg) => leg.kind === "team")) return false;
    return true;
  });
}

export function generateParlayTickets(input: GeneratorInput): { legs: ScoredLeg[]; tickets: ParlayTicket[]; dropped: Array<{ id: string; reasons: string[] }> } {
  const pairLiftMap = buildPairLiftMap(input.pairLifts);
  const scoredLegs = input.legs.map(scoreLeg);
  const dropped = scoredLegs
    .filter((leg) => leg.safetyTier === "drop" || leg.confidence < 0.60)
    .map((leg) => ({ id: leg.id, reasons: [...leg.reasons, leg.confidence < 0.60 ? "min_leg_confidence" : ""].filter(Boolean) }));

  const tickets: ParlayTicket[] = [];
  for (const strategy of STRATEGIES) {
    const made = strategyCandidates(scoredLegs, strategy)
      .map((legs) => makeTicket(legs, strategy.name, strategy.tier, input.stake ?? 1, pairLiftMap, input.bankroll))
      .filter((ticket): ticket is ParlayTicket => Boolean(ticket))
      .sort((a, b) => b.rankingScore - a.rankingScore)
      .slice(0, strategy.count);
    tickets.push(...made);
  }

  return {
    legs: scoredLegs,
    tickets: applyDailyBankrollCap(dedupeTickets(tickets).slice(0, input.maxTickets ?? 25), input.bankroll),
    dropped,
  };
}
