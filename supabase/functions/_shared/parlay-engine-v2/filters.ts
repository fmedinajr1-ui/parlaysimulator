import {
  MAX_COMBINED_AMERICAN_ODDS,
  MAX_SAME_GAME_SHARE,
  MAX_TEAM_LEG_SHARE_FOR_3_PLUS,
  MAX_TEAM_LEGS_PER_GAME,
  MIN_COMBINED_AMERICAN_ODDS,
  MIN_DISTINCT_GAMES,
  MIN_LEG_CONFIDENCE,
  MIN_OVER_L10_HIT_RATE,
  MIN_PARLAY_EDGE,
} from "./config.ts";
import type { ScoredLeg } from "./models.ts";
import { decimalToAmerican } from "./scoring.ts";

export function parlayEdge(legs: ScoredLeg[]): number {
  const confidenceProduct = legs.reduce((product, leg) => product * leg.confidence, 1);
  const inverseOdds = 1 / legs.reduce((product, leg) => product * leg.decimalOdds, 1);
  return inverseOdds > 0 ? confidenceProduct / inverseOdds - 1 : -1;
}

export function ticketGateReasons(legs: ScoredLeg[]): string[] {
  const reasons: string[] = [];
  if (legs.some((leg) => leg.confidence < MIN_LEG_CONFIDENCE)) reasons.push("min_leg_confidence");
  if (legs.some((leg) => leg.safetyTier === "drop")) reasons.push("dropped_leg");
  if (legs.some((leg) => leg.kind === "player" && (leg.side ?? "").toLowerCase() === "over" && (leg.l10HitRate ?? 1) < MIN_OVER_L10_HIT_RATE)) {
    reasons.push("over_l10_hit_rate");
  }

  const distinctGames = new Set(legs.map((leg) => leg.gameId)).size;
  if (distinctGames < MIN_DISTINCT_GAMES) reasons.push("distinct_games");

  const gameCounts = new Map<string, number>();
  const teamLegCounts = new Map<string, number>();
  let teamLegs = 0;
  const playerPropKeys = new Set<string>();
  for (const leg of legs) {
    gameCounts.set(leg.gameId, (gameCounts.get(leg.gameId) ?? 0) + 1);
    if (leg.kind === "team") {
      teamLegs += 1;
      teamLegCounts.set(leg.gameId, (teamLegCounts.get(leg.gameId) ?? 0) + 1);
    }
    if (leg.kind === "player" && leg.player) {
      const key = `${leg.player.toLowerCase()}::${(leg.prop ?? "").toLowerCase()}`;
      if (playerPropKeys.has(key)) reasons.push("player_prop_dupe");
      playerPropKeys.add(key);
    }
  }

  const maxSameGameShare = Math.max(...gameCounts.values()) / legs.length;
  if (maxSameGameShare > MAX_SAME_GAME_SHARE) reasons.push("same_game_share");
  if ([...teamLegCounts.values()].some((count) => count > MAX_TEAM_LEGS_PER_GAME)) reasons.push("team_legs_per_game");
  if (legs.length >= 3 && teamLegs / legs.length > MAX_TEAM_LEG_SHARE_FOR_3_PLUS) reasons.push("team_leg_share");
  if (legs.length >= 5 && !legs.some((leg) => leg.kind === "player")) reasons.push("lottery_requires_player_leg");

  const decimalOdds = legs.reduce((product, leg) => product * leg.decimalOdds, 1);
  const americanOdds = decimalToAmerican(decimalOdds);
  if (americanOdds < MIN_COMBINED_AMERICAN_ODDS || americanOdds > MAX_COMBINED_AMERICAN_ODDS) {
    reasons.push("combined_odds_band");
  }

  if (parlayEdge(legs) < MIN_PARLAY_EDGE) reasons.push("min_parlay_edge");
  return [...new Set(reasons)];
}

export function passesTicketGates(legs: ScoredLeg[]): boolean {
  return ticketGateReasons(legs).length === 0;
}
