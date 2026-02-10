

# Fix: UTC Date Bug in Telegram Bot + Settlement

## Root Cause

The Telegram bot (`telegram-webhook/index.ts`) uses `new Date().toISOString().split("T")[0]` in **25 places** to determine "today." After 7 PM EST, this returns the next UTC date (Feb 10 instead of Feb 9), so `/parlays` shows the old stale Feb 10 batch -- which contains Haliburton and other inactive players.

The same bug exists in `bot-settle-and-learn/index.ts` (1 instance).

## The Fix

Add an EST-aware date helper at the top of both files, then replace all 26 instances:

```text
function getEasternDate(): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/New_York',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
}
```

### File 1: `supabase/functions/telegram-webhook/index.ts`

Replace all 25 occurrences of `new Date().toISOString().split("T")[0]` or `new Date().toISOString().split('T')[0]` with `getEasternDate()`.

Key locations:
- Line 82 (`getStatus`)
- Line 113 (`getParlays`)
- Line 632 (`/tiers` command)
- Line 687 (`/explore` command)
- Line 718 (`/validate` command)
- Plus ~20 more throughout the file

### File 2: `supabase/functions/bot-settle-and-learn/index.ts`

- Line 303: Replace UTC date with `getEasternDate()`

## Post-Deploy

After deploying:
1. Delete the stale Feb 10 parlays (the old 38 batch generated before fixes)
2. Trigger a fresh generation for Feb 9 to get the final clean batch
3. Test `/parlays` in Telegram to confirm it shows Feb 9 parlays with no Haliburton

## Why Haliburton Appeared

The `/parlays` command was querying `parlay_date = '2026-02-10'` (UTC date) and returning the old 38-parlay batch from 01:29 UTC -- generated before the category diversification fix and before any injury data existed. The correct Feb 9 batch (22 parlays, no Haliburton) was invisible to Telegram because it was filed under a different date.
