import type { ParlayTicket, ScoredLeg } from "./models.ts";

export function legSetKey(legs: ScoredLeg[]): string {
  return legs.map((leg) => leg.id).sort().join("|");
}

export function dedupeTickets(tickets: ParlayTicket[]): ParlayTicket[] {
  const byKey = new Map<string, ParlayTicket>();
  for (const ticket of tickets) {
    const key = legSetKey(ticket.legs);
    const current = byKey.get(key);
    if (!current || ticket.rankingScore > current.rankingScore) byKey.set(key, ticket);
  }
  return [...byKey.values()].sort((a, b) => b.rankingScore - a.rankingScore);
}
