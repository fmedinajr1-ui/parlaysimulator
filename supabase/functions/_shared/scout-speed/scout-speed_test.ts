import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { isRelevant, EVENT_MARKET_MAP } from "./relevance.ts";
import { scoreEdge, evPerUnit, halfKellyStake, impactScore } from "./scoring.ts";
import { verifyHmac } from "./hmac.ts";
import { tierFor, formatSpeedEdgeAlert } from "./telegram-format.ts";

Deno.test("relevance map gates event/market pairs correctly", () => {
  assert(isRelevant("ASSIST", "player_ast"));
  assert(isRelevant("SHOT_MADE", "player_pra"));
  assert(!isRelevant("ASSIST", "live_total"));
  assert(!isRelevant("UNKNOWN", "player_pts"));
  assertEquals(EVENT_MARKET_MAP["INJURY"]?.includes("live_spread"), true);
});

Deno.test("scoreEdge is monotonic in excess_lag and capped", () => {
  const a = scoreEdge({ excess_lag: 2, event_impact: 0.7 });
  const b = scoreEdge({ excess_lag: 8, event_impact: 0.7 });
  assert(b.prob > a.prob);
  assert(b.expectedMove > a.expectedMove);
  const huge = scoreEdge({ excess_lag: 100, event_impact: 1 });
  assert(huge.prob <= 0.95);
});

Deno.test("EV floor + half-Kelly stake non-negative", () => {
  const f = { excess_lag: 5, event_impact: impactScore("ASSIST") };
  const { prob, expectedMove } = scoreEdge(f);
  const ev = evPerUnit(prob, expectedMove);
  assert(ev > 0.03);
  const stake = halfKellyStake(prob, expectedMove);
  assert(stake >= 0);
  // negative EV scenario floors at 0
  assertEquals(halfKellyStake(0.1, 0.5), 0);
});

Deno.test("HMAC verify accepts matching signature and rejects bad ones", async () => {
  const body = '{"hello":"world"}';
  const secret = "test-secret";
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(body));
  const hex = Array.from(new Uint8Array(sig)).map((b) => b.toString(16).padStart(2, "0")).join("");
  assert(await verifyHmac(body, `sha256=${hex}`, secret));
  assert(!(await verifyHmac(body, "sha256=deadbeef", secret)));
  assert(!(await verifyHmac(body, null, secret)));
  // no secret configured → skip
  assert(await verifyHmac(body, null, undefined));
});

Deno.test("Telegram formatter uses full property labels and tier emoji", () => {
  assertEquals(tierFor(0.12), "🔥 FIRE");
  assertEquals(tierFor(0.07), "⚡ STRONG");
  assertEquals(tierFor(0.04), "👀 WATCH");
  const msg = formatSpeedEdgeAlert(
    {
      player_name: "Brunson",
      edge_type: "player_ast",
      market_delay_seconds: 8.2,
      excess_lag_seconds: 4.2,
      confidence: 0.91,
      expected_move: 0.45,
      model_edge: 0.12,
      stake_units: 0.041,
      expires_at: new Date(Date.now() + 12_000).toISOString(),
    },
    "ASSIST",
    { sportsbook: "DraftKings", line: 8.5 },
  );
  assert(msg.includes("Assists 8.5"));
  assert(msg.includes("🔥 FIRE"));
  assert(msg.includes("Brunson"));
  assert(!msg.includes("player_ast"));
});