import { describe, expect, it } from "vitest";
import { gradeResearchPick } from "../../supabase/functions/_shared/research/grading";

const game = { minutes_played: 30, points: 20, rebounds: 8, assists: 6, threes_made: 3 };

describe("shared research grading", () => {
  it("grades an Over win", () => {
    expect(gradeResearchPick({ stat: "points", side: "over", line: 19.5 }, game)).toEqual({ status: "won", result_value: 20 });
  });

  it("grades an Under loss", () => {
    expect(gradeResearchPick({ stat: "rebounds", side: "under", line: 8.5 }, game)).toEqual({ status: "lost", result_value: 8 });
  });

  it("grades an exact-line result as a push", () => {
    expect(gradeResearchPick({ stat: "assists", side: "over", line: 6 }, game)).toEqual({ status: "push", result_value: 6 });
  });

  it("voids a player who did not play", () => {
    expect(gradeResearchPick({ stat: "points", side: "over", line: 19.5 }, { ...game, minutes_played: 0 })).toEqual({ status: "void", result_value: 20 });
  });

  it("adds points, rebounds and assists for PRA", () => {
    expect(gradeResearchPick({ stat: "pra", side: "under", line: 35.5 }, game)).toEqual({ status: "won", result_value: 34 });
  });
});
