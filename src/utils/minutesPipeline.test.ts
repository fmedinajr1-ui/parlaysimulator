import { describe, expect, it } from "vitest";
import { buildMinutesForecasts, type ForecastInput } from "../../supabase/functions/_shared/research/minutesPipeline";

const logs = (name: string, minutes: number[], start = 7): ForecastInput["logs"] => minutes.map((minutes_played, i) => ({
  player_name: name, game_date: `2026-11-${String(start - i).padStart(2, "0")}`, minutes_played,
}));
const input = (overrides: Partial<ForecastInput> = {}): ForecastInput => ({
  today: "2026-11-09",
  preTeams: new Set(["Orlando Magic"]),
  lines: [{ player_name: "Player A" }],
  roster: [{ player_name: "Player A", team: "Orlando Magic" }, { player_name: "Mate B", team: "Orlando Magic" }],
  injuries: [],
  logs: [...logs("Player A", [30, 30, 30, 30]), ...logs("Mate B", [30, 30, 30, 30])],
  ...overrides,
});

describe("automatic pregame minutes snapshots", () => {
  it("uses the same steady-minutes forecast as the desk", () => {
    expect(buildMinutesForecasts(input())).toEqual([expect.objectContaining({ player_name: "Player A", projected_minutes: 30, baseline_minutes: 30 })]);
  });
  it("skips teams whose games already started", () => {
    expect(buildMinutesForecasts(input({ preTeams: new Set() }))).toEqual([]);
  });
  it("skips roster players without a posted prop line", () => {
    expect(buildMinutesForecasts(input({ lines: [{ player_name: "Mate B" }] })).map((r) => r.player_name)).toEqual(["Mate B"]);
  });
  it("adds the capped role bump for an Out teammate", () => {
    const rows = buildMinutesForecasts(input({ injuries: [{ player_name: "Mate B", status: "Out" }] }));
    expect(rows[0]).toMatchObject({ projected_minutes: 33, baseline_minutes: 30 });
  });
  it("does not treat Questionable as Out", () => {
    const rows = buildMinutesForecasts(input({ injuries: [{ player_name: "Mate B", status: "Questionable" }] }));
    expect(rows[0].projected_minutes).toBe(30);
  });
  it("requires three played games before forecasting", () => {
    expect(buildMinutesForecasts(input({ logs: logs("Player A", [30, 30]) }))).toEqual([]);
  });
  it("excludes DNPs and same-day results from the baseline", () => {
    const history = [...logs("Player A", [30, 30, 30]), { player_name: "Player A", game_date: "2026-11-09", minutes_played: 48 }, { player_name: "Player A", game_date: "2026-11-06", minutes_played: 0 }];
    expect(buildMinutesForecasts(input({ logs: history }))[0].projected_minutes).toBe(30);
  });
});
