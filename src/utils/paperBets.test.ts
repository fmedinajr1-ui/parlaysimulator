import { describe, it, expect } from "vitest";
import { winProfit, settleBet, summarize, type PaperBet } from "./paperBets";
import type { GameLog } from "./nbaBoxScoreMath";

const bet = (o: Partial<PaperBet> = {}): PaperBet => ({
  id: "1", player: "A", stat: "points", side: "over", line: 20.5, odds: -110, stake: 110,
  gameDate: "2026-11-04", placedAt: "", ...o,
});
const log = (o: Partial<GameLog> = {}): GameLog => ({
  player_name: "A", game_date: "2026-11-04", opponent: "X", minutes_played: 30,
  points: 25, rebounds: 5, assists: 5, threes_made: 2, ...o,
});

describe("paper bets", () => {
  it("pays American odds", () => {
    expect(winProfit(110, -110)).toBe(100);
    expect(winProfit(100, 150)).toBe(150);
  });
  it("grades over and under", () => {
    expect(settleBet(bet(), [log()])).toBe("won");
    expect(settleBet(bet({ side: "under" }), [log()])).toBe("lost");
  });
  it("stays open until the game is in", () => {
    expect(settleBet(bet(), [])).toBe("open");
  });
  it("voids when the player did not play and pushes on the exact line", () => {
    expect(settleBet(bet(), [log({ minutes_played: 0 })])).toBe("void");
    expect(settleBet(bet({ line: 25 }), [log()])).toBe("push");
  });
  it("bankroll = start + profit - open stakes", () => {
    const s = summarize(1000, [
      { bet: bet(), status: "won" },
      { bet: bet({ stake: 50 }), status: "lost" },
      { bet: bet({ stake: 20 }), status: "open" },
    ]);
    expect(s.profit).toBe(50);
    expect(s.bankroll).toBe(1030);
  });
});
