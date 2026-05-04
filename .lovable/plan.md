## Problem

The current cascade alert (e.g. "Andre Drummond Over 2.5 Points", "Mitchell Robinson Over 5.5 Points") is built from `unified_props`, which only contains **DraftKings** and **FanDuel** rows. The user bets on **Hard Rock**, where those exact lines don't exist — so the alert is unactionable for them. We need to validate every cascade leg against an actual Hard Rock line before broadcasting.

## Solution

Pull live Hard Rock prop lines on each `signal-alert-engine` run, then filter the cascade legs so only props with a matching Hard Rock line/side at acceptable juice are kept. If a cascade no longer has enough qualifying legs after the Hard Rock filter, it is dropped (not alerted). Alerts also get tagged with the actual Hard Rock line + price the user will see.

## Steps

1. **New helper `_shared/hardrock-lines.ts`**
   - Fetches NBA player-prop lines from The Odds API filtered to `bookmakers=hardrockbet` (same pattern as `fetch-hardrock-longshots`).
   - Returns a `Map<key, { line, overPrice, underPrice }>` keyed by `event_id|player|prop_type`.
   - Caches result in-memory for the duration of the engine run.
   - Markets: `player_points, player_rebounds, player_assists, player_threes, player_points_rebounds_assists, player_steals, player_blocks`.

2. **Filter cascades in `signal-alert-engine/index.ts`**
   - Before inserting a cascade alert, look up each leg's `(event_id, player, prop_type)` in the Hard Rock map.
   - Drop a leg if:
     - No Hard Rock listing, OR
     - HRB line differs from the alerted line by more than 0.5, OR
     - The HRB price on the alerted side is worse than -200 (unbettable juice).
   - Require ≥3 surviving legs to still emit a cascade. Otherwise skip and increment a `stats.dropped_no_hrb` counter.
   - Replace each leg's `line`, `over_price`, `under_price`, `bookmaker` with the Hard Rock values so downstream Telegram/UI shows what the user will actually see.

3. **Tag the alert**
   - Set `bookmaker: 'hardrockbet'` on the inserted `fanduel_prediction_alerts` row.
   - Add `metadata.source_book: 'hardrockbet'` and `metadata.hrb_verified: true`.

4. **Telegram copy update (`signal-alert-telegram/index.ts`)**
   - Add a small footer line: `📘 Lines verified on Hard Rock` so the user knows the numbers are tradable.
   - No other layout changes — single-message format stays.

5. **Same gating for single-player signals**
   - Apply the same HRB lookup to non-cascade signal types in `signal-alert-engine` (velocity, miss-by-1, etc.) so every alert the user receives is HRB-tradable. If no HRB line, drop the alert.

6. **Tests (5, per testing-policy memory)**
   - `_shared/hardrock-lines.test.ts`:
     1. Map keying by event/player/prop is correct.
     2. Missing HRB entry returns `null`.
     3. Line tolerance: 5.5 vs HRB 5.5 passes; 5.5 vs HRB 6.5 fails.
     4. Juice gate: HRB under -250 → rejected.
     5. Cache hit on second call (no second fetch).

## Files Touched

- `supabase/functions/_shared/hardrock-lines.ts` (new)
- `supabase/functions/_shared/hardrock-lines.test.ts` (new)
- `supabase/functions/signal-alert-engine/index.ts` (HRB gating in cascade + single-leg paths)
- `supabase/functions/signal-alert-telegram/index.ts` (verified footer)

## Notes

- Uses existing `THE_ODDS_API_KEY` secret — no new keys required.
- Adds ~1 API call per active NBA event per engine run; mirrored on the longshots path so cost profile is known.
- If The Odds API returns no Hard Rock data (sport off-hours), the engine logs and skips broadcasting rather than falling back to FD/DK.
