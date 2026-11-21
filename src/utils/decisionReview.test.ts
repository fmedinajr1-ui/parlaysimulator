import { describe, expect, it } from "vitest";
import { reviewDecision, decisionShortlist, type DecisionQuote } from "./decisionReview";
import type { EdgePick } from "@/hooks/useResearchData";
import type { GameLog } from "./nbaBoxScoreMath";
import { restProfile } from "../../supabase/functions/_shared/research/restProfile";

const games: GameLog[] = Array.from({ length: 15 }, (_, i) => ({ player_name: "Player A", game_date: `2026-11-${String(i + 1).padStart(2, "0")}`, minutes_played: 30, points: 20, assists: 5, rebounds: 5, threes_made: 2, opponent: "Opponent" }));
const pick: EdgePick = { player: "Player A", stat: "assists", line: 3.5, median: 5, edge: 1.5, side: "over", hitRate: 0.78, ev: 0.3, odds: -110, notes: [], reasons: [], trend: "flat", lastDate: "2026-11-15", lastOpponent: "Opponent", tonight: "Opponent", thisSeason: 15, hitsL10: 10, gamesL10: 10, home: true, team: "Team A", rest: restProfile(games, "2026-11-16") };
const quote: DecisionQuote = { market: "sportsbook", line: 3.5, odds: -110 };
const review = (p = pick, gs = games, q: DecisionQuote | null = quote, injury = "") => reviewDecision(p, gs, "2026-11-16", q, injury);

describe("platform decision review", () => {
  it("withholds a decision without an exact platform line", () => { expect(review(pick, games, null).status).toBe("unavailable"); });
  it("never substitutes -110 when the real price is missing", () => { expect(review(pick, games, { market: "sportsbook", line: 3.5 }).estimate).toBeNull(); });
  it("needs ten complete season games and excludes today/future games", () => {
    expect(review(pick, [...games.slice(0, 9), { ...games[0], game_date: "2026-11-16" }]).status).toBe("unavailable");
    expect(review(pick, games.map(g => ({ ...g, assists: null }))).status).toBe("unavailable");
  });
  it("keeps the same NBA season when the calendar rolls into January", () => {
    expect(reviewDecision(pick, games, "2027-01-01", quote).games).toBe(10);
  });
  it("uses the lower model/sim number instead of averaging shared evidence upward", () => { expect(review().estimate).toBe(0.78); expect(review().status).toBe("caution"); });
  it("requires confirmed Power payout and calculates its actual hurdle", () => {
    const pp: DecisionQuote = { market: "prizepicks", line: 3.5, payout: 3, legs: 2, payoutConfirmed: true };
    expect(review(pick, games, pp).hurdle).toBeCloseTo(Math.sqrt(1 / 3));
    expect(review(pick, games, { ...pp, payoutConfirmed: false }).status).toBe("unavailable");
  });
  it("re-simulates the exact PP line, never importing the sportsbook percentage", () => {
    const r = review(pick, games, { market: "prizepicks", line: 8.5, payout: 3, legs: 2, payoutConfirmed: true });
    expect(r.estimate).toBeLessThan(0.1); expect(r.status).toBe("pass"); expect(r.hits).toBe(0);
  });
  it("treats Gordon-style season and role expansion as caution, not false agreement", () => {
    const r = review({ ...pick, stat: "pra", side: "under", line: 18.5, median: 13.6, hitRate: 0.71, mateMinutesOut: 32 }, games, { ...quote, line: 18.5 });
    expect(r.flags).toContain("Season average is at or above this Under line.");
    expect(r.flags).toContain("Teammates out may expand this player's role against the Under.");
    expect(r.status).not.toBe("review");
  });
  it("passes below 65% even when the book hurdle is low", () => { expect(review({ ...pick, hitRate: 0.64 }).status).toBe("pass"); });
  it("passes with less than a five-point margin above break-even", () => { expect(review(pick, games, { ...quote, odds: -300 }).status).toBe("pass"); });
  it("blocks unavailable players and flags uncertain health", () => {
    expect(review(pick, games, quote, "out").status).toBe("pass");
    expect(review(pick, games, quote, "questionable").flags).toContain("Health/return status needs confirmation before considering a play.");
  });
  it("does not mutate model probabilities or input history", () => {
    const before = JSON.stringify({ pick, games }); review(); expect(JSON.stringify({ pick, games })).toBe(before);
  });
  it("allows an empty shortlist and caps overlapping players and teams", () => {
    expect(decisionShortlist([review()])).toEqual([]);
    const clean = { ...review(), status: "review" as const, flags: [] };
    const rows = [clean, { ...clean, pick: { ...pick, stat: "points" as const } }, { ...clean, pick: { ...pick, player: "B" } }, { ...clean, pick: { ...pick, player: "C", team: "Team C" } }];
    expect(decisionShortlist(rows).map(r => r.pick.player)).toEqual(["Player A", "C"]);
  });
});

describe("decision shortlist", () => {
  const clean = { ...review(), status: "review" as const, flags: [] };
  const candidate = (player: string, team: string, cushion: number) => ({ ...clean, cushion, pick: { ...pick, player, team } });
  it("orders by break-even cushion, not the raw headline percentage", () => {
    expect(decisionShortlist([candidate("A", "A", 0.06), candidate("B", "B", 0.2)])[0].pick.player).toBe("B");
  });
  it("never fills missing places with caution picks", () => {
    expect(decisionShortlist([{ ...clean, status: "caution" }])).toEqual([]);
  });
  it("caps the default list at three independently named players and teams", () => {
    expect(decisionShortlist(["A", "B", "C", "D"].map(n => candidate(n, n, 0.1)))).toHaveLength(3);
  });
  it("requires a verified team before checking overlap", () => {
    expect(decisionShortlist([{ ...clean, pick: { ...pick, team: null } }])).toEqual([]);
  });
  it("leaves the underlying review order untouched", () => {
    const rows = [candidate("A", "A", 0.1), candidate("B", "B", 0.2)];
    decisionShortlist(rows);
    expect(rows.map(r => r.pick.player)).toEqual(["A", "B"]);
  });
});