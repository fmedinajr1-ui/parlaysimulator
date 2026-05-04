import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { checkHrbLine, hrbKey, type HardRockLine, loadHardRockLines, __resetHrbCache } from "./hardrock-lines.ts";

function mkMap(rows: HardRockLine[]): Map<string, HardRockLine> {
  const m = new Map<string, HardRockLine>();
  for (const r of rows) m.set(hrbKey(r.event_id, r.player, r.prop_type), r);
  return m;
}

Deno.test("hrbKey is case-insensitive on player/prop", () => {
  assertEquals(hrbKey('E1', 'Andre Drummond', 'PLAYER_POINTS'), hrbKey('E1', 'andre drummond', 'player_points'));
});

Deno.test("checkHrbLine: missing entry returns no_hrb_listing", () => {
  const m = mkMap([]);
  const r = checkHrbLine(m, { event_id: 'E1', player: 'X', prop_type: 'player_points', side: 'Over', line: 5 });
  assertEquals(r.ok, false);
  assertEquals(r.reason, 'no_hrb_listing');
});

Deno.test("checkHrbLine: line tolerance — same line passes", () => {
  const m = mkMap([{ event_id: 'E1', player: 'andre drummond', prop_type: 'player_points', line: 5.5, over_price: -110, under_price: -110 }]);
  const r = checkHrbLine(m, { event_id: 'E1', player: 'Andre Drummond', prop_type: 'player_points', side: 'Over', line: 5.5 });
  assert(r.ok);
});

Deno.test("checkHrbLine: line tolerance — 1.0 gap fails", () => {
  const m = mkMap([{ event_id: 'E1', player: 'andre drummond', prop_type: 'player_points', line: 6.5, over_price: -110, under_price: -110 }]);
  const r = checkHrbLine(m, { event_id: 'E1', player: 'Andre Drummond', prop_type: 'player_points', side: 'Over', line: 5.5 });
  assertEquals(r.ok, false);
  assert(r.reason?.startsWith('line_mismatch'));
});

Deno.test("checkHrbLine: juice gate rejects worse than -200", () => {
  const m = mkMap([{ event_id: 'E1', player: 'x', prop_type: 'player_points', line: 5.5, over_price: -250, under_price: 180 }]);
  const r = checkHrbLine(m, { event_id: 'E1', player: 'X', prop_type: 'player_points', side: 'Over', line: 5.5 });
  assertEquals(r.ok, false);
  assert(r.reason?.startsWith('juice_too_high'));
});

Deno.test("loadHardRockLines: returns empty map without API key", async () => {
  __resetHrbCache();
  const prev = Deno.env.get('THE_ODDS_API_KEY');
  Deno.env.delete('THE_ODDS_API_KEY');
  const m = await loadHardRockLines({ apiKey: undefined });
  assertEquals(m.size, 0);
  if (prev) Deno.env.set('THE_ODDS_API_KEY', prev);
});