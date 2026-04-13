

# Strengthen Team News Shift Totals with Cross-Validation

## Problem

The current "Team News Shift → Totals UNDER" alert fires when 3+ player props drop in the same game. But it doesn't verify **what kind** of props are dropping. It could be 3 players' stolen bases lines dropping — which says nothing about run scoring. We need to cross-check against run-producing stats and pitching before recommending a totals Under.

## Solution

Add a **Run Production Validation Gate** to the auto-totals derivation logic in `fanduel-behavior-analyzer/index.ts` (around line 509-533). Before emitting the totals UNDER/OVER signal, cross-reference:

### 1. Check batter hitting props for both teams
- Query `unified_props` for the game's batters: hits, home runs, RBIs, total bases
- If batter lines are **stable or rising**, the Under signal is weaker — downgrade confidence or block
- If batter lines are **also dropping**, that confirms the Under thesis — boost confidence

### 2. Check pitcher strikeout lines
- Query `unified_props` for pitcher strikeouts in the same game
- Pitcher K line **dropping** = weaker pitcher expected = more runs = contradicts Under
- Pitcher K line **rising or stable** = dominant pitcher = supports Under

### 3. Confidence adjustment logic
After the existing correlation check (lines 509-532):

```text
Run-scoring props dropping (hits/HR/RBI/TB)  → +10 confidence, confirm UNDER
Run-scoring props rising                      → -15 confidence, may block UNDER  
Pitcher Ks rising (dominant pitcher expected)  → +5 confidence for UNDER
Pitcher Ks dropping (weak pitcher)            → -10 confidence for UNDER
If net adjustment drops confidence below 55   → block the totals signal entirely
```

### 4. Enhanced Telegram message
Add a line showing the validation result:
```
✅ Action: UNDER — 3 player props dropping → game total likely lower
📊 Batters: 4/6 hitting lines dropping | Pitcher: K line rising (dominant arm)
```

## Files to edit

- `supabase/functions/fanduel-behavior-analyzer/index.ts` — Add cross-validation queries and confidence adjustments at the auto-totals generation block (lines ~509-533), and update the Telegram formatting section (lines ~1860-1870) to include the validation summary.

## What this achieves

- Totals UNDER only fires when batting stats confirm lower run production is expected
- Pitcher data adds a second confirmation layer
- Alerts that don't pass the cross-check are either blocked or downgraded to low confidence
- Users see exactly **why** the system recommends Under (batting lines + pitcher context)

