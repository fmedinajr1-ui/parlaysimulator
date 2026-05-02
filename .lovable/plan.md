## Goal
Resend today's Court.Edge tennis picks to the admin Telegram chat using a plain, easy-to-read format (no drilldown, no tables, no markdown clutter).

## Today's picks (from `court_edge_picks`, last 24h)
1. STRONG OVER — Mirra Andreeva vs Marta Kostyuk — Match Total Over 22.5 (proj 24.02, +6.8% edge) — Madrid Open, clay
2. STRONG UNDER — Jannik Sinner vs Alexander Zverev — Match Total Under 22.5 (proj 21.02, -6.6% edge) — Madrid Open, clay (tomorrow's match, generated today)
3. PASS — Sinner/Zverev 21.5 line — skipped (informational only, not sent)

## What I'll do
1. One-shot invoke `bot-send-telegram` with a single clean message containing the 2 actionable picks.
2. Use plain text format like:
   ```
   🎾 Tennis Picks — Today

   🟢 STRONG OVER
   Andreeva vs Kostyuk — Over 22.5 games
   Projection: 24.02 (+6.8% edge)
   Madrid Open · Clay · 11:00 AM ET

   🔴 STRONG UNDER
   Sinner vs Zverev — Under 22.5 games
   Projection: 21.02 (-6.6% edge)
   Madrid Open · Clay · Tomorrow 11:00 AM ET
   ```
3. No drilldown, no role breakdowns, no formula details — just verdict, matchup, line, projection, edge, tournament/surface, time.

## Technical details
- Use existing `bot-send-telegram` edge function (admin-only path, already wired to `TELEGRAM_CHAT_ID`).
- Single POST with `parse_mode: "Markdown"` and short body.
- No DB writes, no schema changes, no new functions — just one invocation.

## Out of scope
- Not changing the Court.Edge generator or drilldown format.
- Not re-running any pipelines.
- Not touching subscriber broadcast lists (admin chat only, matches how today's tennis picks were sent earlier).