import { describe, expect, it } from "vitest";
import { DEFAULT_RESEARCH_FILTERS, filterResearchRows } from "./researchFilters";
import type { PlayerSummary } from "./nbaBoxScoreMath";

function row(player: string, l5Hit: number, l10Hit: number, trend: PlayerSummary["trend"], l10Median = 20): PlayerSummary {
  return {
    player,
    lastOpponent: "BOS",
    lastDate: "2026-11-06",
    l5: { median: l10Median, floor: 10, ceiling: 30, hitRate: l5Hit, games: 5 },
    l10: { median: l10Median, floor: 10, ceiling: 30, hitRate: l10Hit, games: 10 },
    trend,
    recent: [],
  };
}

const players = [
  row("Alpha", 0.8, 0.7, "hot", 24),
  row("Beta", 0.4, 0.8, "cold", 22),
  row("Gamma", 0.6, 0.5, "flat", 20),
];

describe("research table filters", () => {
  it("filters L5 hit rate independently", () => {
    const result = filterResearchRows(players, { ...DEFAULT_RESEARCH_FILTERS, minL5Hit: 0.6 });
    expect(result.map((r) => r.player)).toEqual(["Alpha", "Gamma"]);
  });

  it("filters L10 hit rate independently", () => {
    const result = filterResearchRows(players, { ...DEFAULT_RESEARCH_FILTERS, minL10Hit: 0.7 });
    expect(result.map((r) => r.player)).toEqual(["Alpha", "Beta"]);
  });

  it("requires both L5 and L10 minimums when both are set", () => {
    const result = filterResearchRows(players, { ...DEFAULT_RESEARCH_FILTERS, minL5Hit: 0.6, minL10Hit: 0.7 });
    expect(result.map((r) => r.player)).toEqual(["Alpha"]);
  });

  it("filters hot, cold, and flat trends exactly", () => {
    expect(filterResearchRows(players, { ...DEFAULT_RESEARCH_FILTERS, trend: "hot" }).map((r) => r.player)).toEqual(["Alpha"]);
    expect(filterResearchRows(players, { ...DEFAULT_RESEARCH_FILTERS, trend: "cold" }).map((r) => r.player)).toEqual(["Beta"]);
    expect(filterResearchRows(players, { ...DEFAULT_RESEARCH_FILTERS, trend: "flat" }).map((r) => r.player)).toEqual(["Gamma"]);
  });

  it("sorts by either hit-rate window without changing the source array", () => {
    const original = players.map((r) => r.player);
    const byL5 = filterResearchRows(players, { ...DEFAULT_RESEARCH_FILTERS, sort: "l5Hit" });
    const byL10 = filterResearchRows(players, { ...DEFAULT_RESEARCH_FILTERS, sort: "l10Hit" });
    expect(byL5.map((r) => r.player)).toEqual(["Alpha", "Gamma", "Beta"]);
    expect(byL10.map((r) => r.player)).toEqual(["Beta", "Alpha", "Gamma"]);
    expect(players.map((r) => r.player)).toEqual(original);
  });
});
