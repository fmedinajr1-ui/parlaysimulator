

# Fix: Settlement Premature Loss + Missing Prop Type in Telegram Display

## Issues Found

### Issue 1: Premature "LOST" marking in settlement
**Location**: `supabase/functions/bot-settle-and-learn/index.ts`, lines 271-275

The settlement logic marks a parlay as "lost" the moment **any single leg misses**, even if other legs haven't been settled yet. Yesterday (Feb 9): 30 parlays still pending, 20 already marked lost -- many with only 1 miss but unsettled legs remaining.

```
Current logic:
  if (some settled AND any missed) --> outcome = 'lost'

Correct logic:
  if (some settled AND any missed) --> outcome = 'pending' (wait for all legs)
  Only mark 'lost' when ALL legs are settled
```

### Issue 2: Missing prop type in Telegram leg display
**Location**: `supabase/functions/telegram-webhook/index.ts`, line 688-703

`formatLegDisplay()` outputs: `"Cooper Flagg OVER 0.5 (+138)"`
Should output: `"Cooper Flagg OVER 0.5 Threes (+138)"`

The `prop_type` field (e.g., "threes", "assists", "points") exists in every leg object but is never shown. This makes it impossible to know what the bet is actually on.

### Issue 3: "View Legs" callback shows pending parlays as LOST
**Location**: `supabase/functions/telegram-webhook/index.ts`, line 1212

The callback handler has:
```
if (parlay.outcome) msg += ` | ${parlay.outcome === 'won' ? '✅ WON' : '❌ LOST'}`
```
Since `outcome = 'pending'` is truthy, it falls into the else branch and displays "LOST" for games that haven't even been played yet. This is what the screenshot shows.

### Issue 4: Yesterday's 30 pending parlays need re-settlement
Feb 9 currently has: 20 lost, 1 won, 30 still pending. Those 30 pending parlays may have legs that can now be graded against game logs.

---

## Fixes

### Fix 1: Settlement logic -- only mark lost when ALL legs settled
In `bot-settle-and-learn/index.ts`, remove the early "lost" shortcut at lines 271-275. A parlay should only be marked "lost" when every leg has been graded. If some legs are hit and some are missed but others remain pending, keep the parlay as "pending".

### Fix 2: Add prop type to formatLegDisplay
In `telegram-webhook/index.ts`, update `formatLegDisplay()` to include `leg.prop_type` in the output string. Format it as a readable label (e.g., "threes" becomes "3PT", "assists" becomes "AST", "points" becomes "PTS", etc.).

### Fix 3: Handle pending outcome in callback handler
In `telegram-webhook/index.ts`, update line 1212 to handle all three states:
- `won` --> "WON"
- `lost` --> "LOST"  
- `pending` --> "PENDING"

Also update the `/parlays` handler (line 529) which has the same issue.

### Fix 4: Fix yesterday's prematurely-lost parlays
Reset the 20 "lost" parlays from Feb 9 that have unsettled legs back to "pending" so the next settlement run can properly grade them.

---

## Technical Details

### File: `supabase/functions/bot-settle-and-learn/index.ts`
- Lines 271-278: Remove the early-exit `lost` branch. Only determine outcome when `legsHit + legsMissed === legs.length`.

### File: `supabase/functions/telegram-webhook/index.ts`
- Lines 688-704: Add prop type mapping and include in display string
- Line 529: Fix outcome emoji to handle `'pending'` state
- Line 1212: Fix callback handler to handle `'pending'` state

### SQL fix for yesterday's data
Reset Feb 9 parlays that were prematurely marked lost (where `legs_hit + legs_missed < leg_count`):
```sql
UPDATE bot_daily_parlays
SET outcome = 'pending', profit_loss = 0
WHERE parlay_date = '2026-02-09'
  AND outcome = 'lost'
  AND legs_hit + legs_missed < leg_count;
```

### Prop type label mapping
```text
threes    -> 3PT
points    -> PTS
assists   -> AST
rebounds  -> REB
steals    -> STL
blocks    -> BLK
turnovers -> TO
pra       -> PRA
pts_rebs  -> P+R
pts_asts  -> P+A
rebs_asts -> R+A
```
