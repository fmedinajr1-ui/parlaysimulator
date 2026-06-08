import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { checkFdLine, fdKey, type FanduelLine, loadFanduelLines, __resetFdCache } from "./fanduel-lines.ts";

function mkMap(rows: FanduelLine[]): Map<string, FanduelLine> {
  const m = new Map<string, FanduelLine>();
  for (const r of rows) m.set(fdKey(r.event_id, r.player, r.prop_type), r);
  return m;
}

Deno.test("fdKey is case-insensitive on player/prop", () => {
  assertEquals(fdKey('E1', 'Andre Drummond', 'PLAYER_POINTS'), fdKey('E1', 'andre drummond', 'player_points'));
});

Deno.test("checkFdLine: missing entry returns no_fd_listing", () => {
  const m = mkMap([]);
  const r = checkFdLine(m, { event_id: 'E1', player: 'X', prop_type: 'player_points', side: 'Over', line: 5 });
  assertEquals(r.ok, false);
  assertEquals(r.reason, 'no_fd_listing');
});

Deno.test("checkFdLine: line tolerance — same line passes", () => {
  const m = mkMap([{ event_id: 'E1', player: 'andre drummond', prop_type: 'player_points', line: 5.5, over_price: -110, under_price: -110 }]);
  const r = checkFdLine(m, { event_id: 'E1', player: 'Andre Drummond', prop_type: 'player_points', side: 'Over', line: 5.5 });
  assert(r.ok);
});

Deno.test("checkFdLine: line tolerance — 1.0 gap fails", () => {
  const m = mkMap([{ event_id: 'E1', player: 'andre drummond', prop_type: 'player_points', line: 6.5, over_price: -110, under_price: -110 }]);
  const r = checkFdLine(m, { event_id: 'E1', player: 'Andre Drummond', prop_type: 'player_points', side: 'Over', line: 5.5 });
  assertEquals(r.ok, false);
  assert(r.reason?.startsWith('line_mismatch'));
});

Deno.test("checkFdLine: juice gate rejects worse than -200", () => {
  const m = mkMap([{ event_id: 'E1', player: 'x', prop_type: 'player_points', line: 5.5, over_price: -250, under_price: 180 }]);
  const r = checkFdLine(m, { event_id: 'E1', player: 'X', prop_type: 'player_points', side: 'Over', line: 5.5 });
  assertEquals(r.ok, false);
  assert(r.reason?.startsWith('juice_too_high'));
});

Deno.test("loadFanduelLines: returns empty map without API key", async () => {
  __resetFdCache();
  const prev = Deno.env.get('THE_ODDS_API_KEY');
  Deno.env.delete('THE_ODDS_API_KEY');
  const m = await loadFanduelLines({ apiKey: undefined });
  assertEquals(m.size, 0);
  if (prev) Deno.env.set('THE_ODDS_API_KEY', prev);
});