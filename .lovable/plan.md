

## Investigation: Why Mar 1-5 Parlays Aren't Settling

### Root Cause: Settlement Window Too Narrow

The `bot-settle-and-learn` function (line 592-612) defaults to only settling parlays from **yesterday and two days ago**. Today is March 8, so only March 6 and March 7 are processed. Parlays from March 1-5 are completely outside this window and will never be automatically retried.

### Data Availability Confirmed

Game log data **does exist** for all dates March 1-6 in both NBA and NHL tables:

| Date | NBA Logs | NHL Logs |
|------|----------|----------|
| Mar 1 | 251 | 290 |
| Mar 2 | 92 | 50 |
| Mar 3 | 223 | 120 |
| Mar 4 | 139 | 262 |
| Mar 5 | 201 | 120 |
| Mar 6 | 158 | 191 |

Spot-checked: De'Aaron Fox has game logs for Mar 1 (steals=0, rebounds=3) but his legs in parlays from that date still show "pending."

### Backlog Summary

| Date | Total Parlays | Still Pending |
|------|--------------|---------------|
| Mar 1 | 18 | 6 |
| Mar 2 | 123 | 47 |
| Mar 3 | 77 | 21 |
| Mar 4 | 126 | 4 |
| Mar 5 | 87 | 5 |
| Mar 6 | 74 | 28 |

**Total: 111 pending parlays** with game data available but outside the settlement window.

### Fix Plan

**1. Expand `bot-settle-and-learn` default window** from 2 days to 7 days. Change the target date generation (lines 592-612) to loop back 7 days instead of just yesterday + two days ago. This ensures any stragglers from the past week are caught automatically on every run.

**2. Add a one-time backfill call** by invoking `bot-settle-and-learn` with each backlogged date (Mar 1-6) passed as `{ date: "2026-03-0X", force: true }`. This uses the existing `body.date` parameter support (line 582-584) to clear the current backlog immediately.

The function already has all the fallback matching logic (sweet spots, game log lookup, name aliases) — it just never gets a chance to run on older dates.

