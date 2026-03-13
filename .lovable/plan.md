
Root cause confirmed: this is a timing/order issue, not the L3 fix regressing.

What I found:
- Integrity alert fired at 16:00:40 ET with 5 duplicate-leg violations.
- Diversity rebalance auto-ran at 16:00:42 ET and voided excess exposure (cleaned the issue).
- You tapped “Void Bad Parlays” at 16:01:52 ET; by then nothing remained to void, so Telegram replied “No bad parlays found — slate is clean.”

Implementation plan (concise):
1) Stop pre-rebalance integrity alerts in generation subflows
- File: `supabase/functions/bot-generate-daily-parlays/index.ts`
- Add a guard so Step 11 integrity check is skipped for pipeline sub-sources that are followed by rebalance (at minimum: `quality_regen_*` and `smart_review`).
- Keep integrity check for true standalone/manual generation paths.

2) Run integrity check after rebalance in the optimizer flow
- File: `supabase/functions/bot-review-and-optimize/index.ts`
- After `bot-daily-diversity-rebalance`, call `bot-parlay-integrity-check` once.
- This ensures alerting reflects post-cleanup state (real violations only).

3) Improve Telegram callback message for stale alerts
- File: `supabase/functions/telegram-webhook/index.ts` (`integrity_void_bad` branch)
- When `totalVoided === 0`, change message to explicitly indicate likely auto-resolution (e.g., “Already auto-cleaned by rebalance; slate is currently clean”) instead of implying the alert was wrong.

4) Optional hardening (recommended)
- Normalize duplicate-leg key building consistently across integrity check and button handler using the same prop normalization map used by rebalance (threes/3pm/three_pointers/etc.).
- Files: `bot-parlay-integrity-check`, `telegram-webhook` (shared helper pattern).

Validation plan:
- Trigger a run that previously produced duplicate alerts.
- Confirm sequence becomes: generation → rebalance → integrity check (single, final verdict).
- Confirm no “integrity alert” is sent if rebalance already resolved exposure.
- Tap “Void Bad Parlays” on an older alert and verify the new “already auto-cleaned” response text appears.
- Confirm real unresolved violations still generate alerts and are voided by button action.
