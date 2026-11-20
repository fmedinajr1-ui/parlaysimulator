import { describe, it, expect } from "vitest";
import { ppStat, parsePrizePicks, ppVerdict } from "./prizePicks";

describe("prizePicks", () => {
  it("maps PrizePicks stat names", () => {
    expect(ppStat("Pts+Rebs+Asts")).toBe("pra");
    expect(ppStat("3-PT Made")).toBe("threes_made");
    expect(ppStat("Fantasy Score")).toBeNull();
  });
  it("2-pick Power needs over 57.7%", () => {
    expect(ppVerdict(0.58)).toBe("beats power");
    expect(ppVerdict(0.577)).toBe("beats flex");
  });
  it("Flex needs over 54.3%", () => {
    expect(ppVerdict(0.55)).toBe("beats flex");
    expect(ppVerdict(0.543)).toBe("below hurdle");
  });
  it("keeps standard lines and drops goblins/demons", () => {
    const body = {
      included: [{ type: "new_player", id: "1", attributes: { name: "RJ Barrett" } }],
      data: [
        { attributes: { stat_type: "Assists", line_score: 3.5, odds_type: "standard" }, relationships: { new_player: { data: { id: "1" } } } },
        { attributes: { stat_type: "Assists", line_score: 2.5, odds_type: "goblin" }, relationships: { new_player: { data: { id: "1" } } } },
      ],
    };
    expect(parsePrizePicks(body)).toEqual([{ player: "RJ Barrett", stat: "assists", line: 3.5 }]);
  });
  it("skips unknown players and stats", () => {
    const body = { included: [], data: [{ attributes: { stat_type: "Points", line_score: 20 }, relationships: { new_player: { data: { id: "9" } } } }] };
    expect(parsePrizePicks(body)).toEqual([]);
  });
});
