
# Board Cleanup + Fresh Generation

## What's Happening

The Parlays tab shows **52 total parlays** from pre-deploy runs today:
- **5 × 1-leg** straight bets (the exact flood we fixed — generated at 9:45 AM before the deploy)
- **40 × 2-leg** mini-parlays (from 5:02 AM and earlier runs)
- **7 × 3-leg** standard parlays

Smart Generate is correctly deployed but generates **0 new parlays** because the generator pre-loads `existingParlays` from today's DB at startup, which maxes out all team/game usage caps before it even tries to build new ones. With 52 parlays already logged, every team slot is saturated.

## The Good News

The **stake badge UI is fully working** — every card correctly shows the `$25` pill badge in the header. The expanded "To win" calculation also works (pending cards compute payout from `expected_odds`). The visual changes are correct.

## The Fix: Delete Today's Stale Parlays

The cleanest solution is a targeted SQL delete of today's parlays so the next Smart Generate run starts from a clean slate. This is safe — all these parlays are `pending` (no settled results to lose), and they're from pre-deploy runs using the old broken logic.

**SQL to run:**
```sql
DELETE FROM bot_daily_parlays
WHERE parlay_date = '2026-02-18'
  AND outcome = 'pending';
```

This will remove all 52 pending parlays from today. After that, a Smart Generate run will:
1. Start with zero existing parlays (no cap pre-population)
2. Skip single-leg fallback (since 0 < 3 threshold only fires below 3 — and the real threshold check is that standard parlays generated must be < 3)
3. Generate proper 3–5 leg multi-leg parlays per the new logic
4. Keep mini-parlays capped at 6 max

## Implementation Steps

**Step 1 — Database migration** to delete today's stale pending parlays:
```sql
DELETE FROM bot_daily_parlays
WHERE parlay_date = '2026-02-18'
  AND outcome = 'pending';
```

**Step 2 — Trigger Smart Generate** immediately after deletion via the dashboard button (or via edge function call).

**Step 3 — Verify** the new board in the Parlays tab shows:
- Multi-leg parlays (2+ legs) only
- No 1-leg straight bets
- Correct stake badges on all cards
- Correct "To win" amounts in expanded view

## Technical Details

- **Table affected:** `bot_daily_parlays`
- **Rows deleted:** ~52 (all `outcome = 'pending'` for `parlay_date = 2026-02-18'`)
- **Risk:** None — these are pending simulation bets only, not real money
- **After deletion:** Dashboard will show "No parlays yet" until Smart Generate completes (~30–60 seconds)
