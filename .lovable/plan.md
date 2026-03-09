

## Resolve 13 Pending March 8th Parlays

### Root Cause Analysis

There are **two distinct blockers** keeping 13 parlays in pending state:

| Blocker | Parlays Affected | Cause |
|---------|-----------------|-------|
| Andrew Wiggins | 6 parlays | GSW didn't play March 8th. Engine incorrectly assigned him to Miami Heat. No game log exists. |
| NHL players (Minten, McTavish, Geekie, Meier, Hartman, etc.) | 5 parlays | NHL game logs for March 8th not yet ingested |
| Bidirectional bench under | 2 parlays | Unclear — may have team-level legs with missing data |

### Plan

**Step 1 — Void Andrew Wiggins legs and re-settle affected parlays**

Andrew Wiggins (GSW) had no game on March 8th. His legs should be voided, and the 6 parlays containing them should be re-evaluated with the remaining legs. This requires directly updating the `legs` JSONB to set his leg outcome to `void`, then re-running settlement logic on those specific parlays.

I'll write a targeted SQL migration or invoke the settle function after updating the legs.

**Step 2 — Run NHL stats ingestion for March 8th**

Invoke `nhl-stats-fetcher` to pull in March 8th NHL game logs so the 5 NHL-blocked parlays can settle.

**Step 3 — Re-run `bot-settle-and-learn`**

After both data gaps are filled, re-run settlement to resolve all remaining pending parlays.

**Step 4 — Add a guard in the parlay builder**

To prevent the Andrew Wiggins issue from recurring: when a player is assigned to a parlay, verify that their team actually has a game scheduled on the parlay date. This is a data quality fix in the engine that generated the parlay (likely `bot-matchup-defense-scanner` or the role stacked builder).

### Technical Details

- Andrew Wiggins' 6 parlays: void his leg in JSONB, then determine parlay outcome from remaining legs
- NHL ingestion: call `nhl-stats-fetcher` edge function
- Settlement: call `bot-settle-and-learn` after data is available
- Guard: add team schedule validation in parlay generation pipeline

