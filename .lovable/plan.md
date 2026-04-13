<final-text>
Fix RBI alert direction, clean Telegram wording, and stabilize the mega parlay flow.

What I found
- `SB` means `Stolen Bases`.
- The HRB RBI analyzer can still create `Over` alerts because its odds-movement logic still resolves some patterns to `Over`, while the `0.4–0.7` average gate only blocks bad `Under` picks. So Over-side RBI alerts can still slip through.
- Telegram formatting is using shorthand MLB labels (`SB`, `TB`, `HR`, `Ks`) in customer/admin messages, which is why those alerts read unclearly.
- The mega parlay error message is too generic because the rebuild pipeline only reports “non-2xx status code” instead of surfacing the real scanner failure.
- There is also a pipeline mismatch right now: one orchestrator has lottery disabled, while `refresh-l10-and-rebuild` still calls `nba-mega-parlay-scanner`.

Plan
1. Make HRB RBI alerts truly Under-only
   - Update `supabase/functions/hrb-mlb-rbi-analyzer/index.ts`.
   - Fix the odds-direction mapping for `price_drift`, `velocity_spike`, and `cascade`.
   - Add a hard final guard so only `Under 0.5 RBI` alerts can be inserted or sent.
   - Keep the tightened `0.4–0.7` L10 average gate, hit-rate checks, caps, and dedup on those Under picks.

2. Clean up Telegram labels
   - Update `supabase/functions/bot-send-telegram/index.ts`.
   - Replace shorthand MLB labels with human-readable text in user-facing summaries:
     - `SB` → `Stolen Bases`
     - `TB` → `Total Bases`
     - `Ks/K` → `Strikeouts`
   - Apply this to slate status, lottery, and related pick summaries so messages are easier to read.

3. Make pipeline error alerts useful
   - Update `supabase/functions/refresh-l10-and-rebuild/index.ts`.
   - Surface the actual failed step and scanner error instead of only “Edge Function returned a non-2xx status code”.
   - Treat expected no-output cases as clean skips/zero-output notices instead of hard failure spam when appropriate.

4. Fix the mega parlay failure path
   - First inspect the latest live function logs and recent run output for `nba-mega-parlay-scanner`.
   - Patch the actual failure inside `supabase/functions/nba-mega-parlay-scanner/index.ts`.
   - Then align orchestration so lottery is handled consistently across pipelines instead of being disabled in one place and still executed in another.

5. Verify end-to-end
   - Re-run the RBI analyzer and confirm new RBI alerts are Under-only.
   - Re-send a slate status message and confirm labels are fully readable.
   - Run the mega parlay step end-to-end and confirm it either produces tickets or exits cleanly with a readable reason.

Technical details
- RBI alert logic: `supabase/functions/hrb-mlb-rbi-analyzer/index.ts`
- Telegram formatter: `supabase/functions/bot-send-telegram/index.ts`
- Pipeline summary/error wording: `supabase/functions/refresh-l10-and-rebuild/index.ts`
- Mega parlay engine: `supabase/functions/nba-mega-parlay-scanner/index.ts`
- Related slate sender: `supabase/functions/bot-slate-status-update/index.ts`
</final-text>