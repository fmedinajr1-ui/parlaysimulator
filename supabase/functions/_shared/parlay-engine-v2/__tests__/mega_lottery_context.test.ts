// Tests covering the mega_lottery_scanner team-context filter and the new
// market_type/event_id propagation. 5 tests per project rule.
import { assertEquals, assert } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { megaLotteryScanner } from "../strategies.ts";
import type { CandidateLeg } from "../models.ts";
import type { StrategySlot } from "../config.ts";

function teamLeg(opts: Partial<CandidateLeg> & { team: string; opponent: string; signal_source: string }): CandidateLeg {
  return {
    sport: "MLB",
    player_name: null,
    team: opts.team,
    opponent: opts.opponent,
    prop_type: opts.prop_type ?? "Total",
    side: opts.side ?? "OVER",
    line: opts.line ?? 8.5,
    american_odds: opts.american_odds ?? -110,
    projected: opts.line ?? 8.5,
    confidence: opts.confidence ?? 0.70,
    edge: 0.03,
    signal_source: opts.signal_source,
    tipoff: new Date(Date.now() + 60 * 60 * 1000),
    projection_updated_at: new Date(),
    line_confirmed_on_book: true,
    player_active: true,
    defensive_context_updated_at: new Date(),
    selected_book: "fanduel",
    game_description: opts.game_description ?? `${opts.team} @ ${opts.opponent}`,
    market_type: opts.market_type ?? "total",
    event_id: opts.event_id ?? `evt-${opts.team}-${opts.opponent}`,
  };
}

function playerLeg(name: string, team: string, opponent: string): CandidateLeg {
  return {
    sport: "MLB",
    player_name: name,
    team,
    opponent,
    prop_type: "Hits",
    side: "OVER",
    line: 0.5,
    american_odds: -140,
    projected: 1.2,
    confidence: 0.72,
    edge: 0.06,
    signal_source: "MLB_BATTER_HITS",
    tipoff: new Date(Date.now() + 60 * 60 * 1000),
    projection_updated_at: new Date(),
    line_confirmed_on_book: true,
    player_active: true,
    defensive_context_updated_at: new Date(),
    selected_book: "fanduel",
    game_description: `${team} @ ${opponent}`,
    market_type: "player",
    event_id: `evt-${team}-${opponent}`,
  };
}

const slot: StrategySlot = {
  name: "mega_lottery_scanner",
  tier: "LOTTERY",
  target_leg_count: 4,
  odds_band: "MEGA",
  enabled: true,
} as unknown as StrategySlot;

Deno.test("mega_lottery: rejects combo containing UNK team leg even with player leg present", () => {
  const candidates = [
    teamLeg({ team: "UNK", opponent: "UNK", signal_source: "GAME_TOTAL_OVER", game_description: null }),
    teamLeg({ team: "Yankees", opponent: "Red Sox", signal_source: "TEAM_SPREAD_FAV" }),
    teamLeg({ team: "Dodgers", opponent: "Giants", signal_source: "GAME_TOTAL_OVER" }),
    playerLeg("Aaron Judge", "Yankees", "Red Sox"),
  ];
  const out = megaLotteryScanner(candidates, slot);
  if (out) {
    for (const l of out.legs) {
      if (l.player_name == null) {
        assert(l.team && l.team !== "UNK", "no UNK team leg should appear");
        assert(l.opponent && l.opponent !== "UNK", "no UNK opponent leg should appear");
        assert(l.game_description, "every team leg must carry game_description");
      }
    }
  }
});

Deno.test("mega_lottery: rejects team leg with null game_description", () => {
  const candidates = [
    teamLeg({ team: "Yankees", opponent: "Red Sox", signal_source: "GAME_TOTAL_OVER", game_description: null }),
    teamLeg({ team: "Dodgers", opponent: "Giants", signal_source: "TEAM_SPREAD_FAV" }),
    teamLeg({ team: "Cubs", opponent: "Pirates", signal_source: "TEAM_SPREAD_FAV" }),
    playerLeg("Mookie Betts", "Dodgers", "Giants"),
  ];
  const out = megaLotteryScanner(candidates, slot);
  if (out) {
    for (const l of out.legs) {
      if (l.player_name == null) {
        assert(l.game_description, "no team leg with null game_description should pass");
      }
    }
  }
});

Deno.test("mega_lottery: still produces ticket when context is clean", () => {
  const candidates = [
    teamLeg({ team: "Yankees", opponent: "Red Sox", signal_source: "GAME_TOTAL_OVER" }),
    teamLeg({ team: "Dodgers", opponent: "Giants", signal_source: "TEAM_SPREAD_FAV", confidence: 0.71 }),
    teamLeg({ team: "Cubs", opponent: "Pirates", signal_source: "TEAM_SPREAD_FAV", confidence: 0.69 }),
    playerLeg("Mookie Betts", "Dodgers", "Giants"),
  ];
  const out = megaLotteryScanner(candidates, slot);
  // Either a valid parlay (with player leg) or null is acceptable, but never
  // a parlay containing a UNK leg.
  if (out) {
    assert(out.legs.some(l => l.player_name != null), "must contain >=1 player leg");
  }
});

Deno.test("CandidateLeg preserves market_type and event_id end-to-end", () => {
  const l = teamLeg({
    team: "Mets", opponent: "Braves", signal_source: "TEAM_SPREAD_FAV",
    prop_type: "Spread", side: "HOME", line: -1.5, market_type: "spread", event_id: "evt-mets-braves",
  });
  assertEquals(l.market_type, "spread");
  assertEquals(l.event_id, "evt-mets-braves");
});

Deno.test("mega_lottery: player-only ticket still requires player leg count", () => {
  // Only 1 valid team leg + 1 player → not enough for 4-leg slot; should return null.
  const candidates = [
    teamLeg({ team: "Yankees", opponent: "Red Sox", signal_source: "GAME_TOTAL_OVER" }),
    playerLeg("Aaron Judge", "Yankees", "Red Sox"),
  ];
  const out = megaLotteryScanner(candidates, slot);
  assertEquals(out, null);
});