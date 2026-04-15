
Root cause is not just “old messages.” I can see two active leak paths still in code:

1. `detect-mispriced-lines` / `bot-pipeline-doctor`
- This generic MLB mispriced engine still includes `batter_stolen_bases` in `MLB_PROP_TO_STAT`.
- It still computes `signal = edgePct > 0 ? "OVER" : "UNDER"` for all MLB props with no stolen-base exception.
- So it can still create fresh MLB stolen base UNDER rows in `mispriced_lines` and `mispriced_line_snapshots`.

2. Existing pending parlays still show in slate status
- `bot-slate-status-update` reads every `bot_daily_parlays` row where `outcome = 'pending'`.
- It does not exclude already-created pending parlays that contain stolen base UNDER legs.
- So even after source fixes, old pending parlays can keep appearing in Telegram status messages until they are voided/filtered.

Why the screenshot still makes sense
- The “Parlay #3 (l3 cross engine)” message can be an already-persisted `bot_daily_parlays` record.
- The “Whale Verdicts” stolen base UNDER is likely coming from `mispriced_line_snapshots` / `mispriced_line_verdicts`, which are still being fed by the generic mispriced engine.

Plan to fully remove them everywhere

1. Block stolen base UNDERs in the generic mispriced engine
- Edit `supabase/functions/detect-mispriced-lines/index.ts` (same logic file currently labeled as pipeline doctor).
- Add a hard skip for MLB stolen bases whenever computed signal is `UNDER`.
- Also preferably skip `batter_stolen_bases` entirely from the generic mispriced MLB path so only the dedicated Over-only SB analyzer owns that market.

2. Stop storing snapshot/verdict data for stolen base UNDERs
- In the same mispriced pipeline, ensure blocked SB UNDER rows never enter:
  - `mispriced_lines`
  - `correct_priced_lines`
  - `mispriced_line_snapshots`
- This prevents future “Whale Verdicts” from showing SB unders.

3. Prevent old pending parlays from surfacing
- Update `supabase/functions/bot-slate-status-update/index.ts` to ignore any pending parlay whose `legs` contain:
  - `batter_stolen_bases` / `stolen_bases`
  - side `under`
- This is a safety filter for Telegram display.

4. Clean up already-created bad records
- Void or mark inactive existing pending `bot_daily_parlays` records containing stolen base UNDER legs.
- Remove current-day `mispriced_lines`, `mispriced_line_snapshots`, and `mispriced_line_verdicts` rows for stolen base UNDERs.
- If needed, also remove stale `fanduel_prediction_alerts` stolen-base UNDER history still hanging around.

5. Add universal guardrails
- Add a shared helper or repeated hard check anywhere MLB picks are formatted/broadcast:
  - `bot-slate-status-update`
  - any mispriced report / webhook handlers that list raw `mispriced_lines`
- Goal: even if bad data somehow exists, it never gets broadcast.

6. Verify with 5 checks
- Run mispriced scan and confirm no new SB UNDER rows are produced.
- Run verdict generation and confirm no SB UNDER whale verdicts appear.
- Run L3 cross-engine generation and confirm no SB UNDER legs enter parlays.
- Run slate status and confirm no pending SB UNDER parlays are displayed.
- Inspect today’s database rows for `mispriced_lines`, `mispriced_line_snapshots`, `mispriced_line_verdicts`, and `bot_daily_parlays` to confirm cleanup.

Technical notes
- Files to update:
  - `supabase/functions/detect-mispriced-lines/index.ts`
  - `supabase/functions/bot-slate-status-update/index.ts`
  - possibly `supabase/functions/finalize-mispriced-verdicts/index.ts` as a final defensive filter
- Required non-read-only work after approval:
  - code edits
  - deploy affected functions
  - cleanup of existing bad rows/data
  - verification against current-day pipeline output
