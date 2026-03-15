

# Alt-Line Hedge Accuracy: Find Nearby Lines That Improve Hit Rate

## The Problem

Right now, hedge accuracy tracks whether the **original line** hits or misses. When the system says "HOLD" at halftime and it shows 100% accuracy, that's only true for the exact line the user originally bet. But during a live game, the line on the book may have moved — and a nearby alt line might give a better hedge opportunity or more accurate projection.

**Example**: You bet OVER 24.5 points. At halftime, status is "HOLD" and projection says 26.2. But the live book now shows 22.5. The accuracy card says HOLD = 100% hit rate — but that's at 24.5. If the player finishes at 25, you barely cleared. A smarter system would show: "At line 22.5 (current book), HOLD hits 95% — consider locking profit."

## Solution: Alt-Line Accuracy Layer

Add a **"Smart Line"** recommendation to the hedge monitor that:

1. **Captures the live book line** at each quarter snapshot (already stored in `live_book_line` column)
2. **Calculates accuracy at the live line** in addition to the original line
3. **Shows alt-line accuracy in the accuracy card** — e.g., "HOLD at halftime: 100% at original line, 87% at live line"
4. **Recommends the optimal hedge line** — the closest line to original that maintains a high hit probability

## Technical Changes

### 1. New DB Function: `get_hedge_accuracy_with_alt_lines`
- Extends `get_hedge_status_accuracy` to also evaluate outcomes against `live_book_line`
- For each snapshot, checks: would the pick have hit at the live book line too?
- Returns both `hit_rate_original` and `hit_rate_at_live_line`

### 2. Update `HedgeStatusAccuracyCard.tsx`
- Add a column or tooltip showing "Live Line Hit Rate" alongside the original
- Highlight when there's a significant gap (e.g., original = 100% but live line = 60%)
- Add insight: "HOLD picks hit 100% at original line but only 65% at live line — lock profit early"

### 3. Enhance `HedgeRecommendation.tsx` with Suggested Hedge Line
- When status is HOLD/MONITOR, show the live book line and its projected probability
- Use the existing `projection-aggregator.ts` `getLineRecommendation()` to find the optimal nearby line
- Display: "Original: O 24.5 | Live: O 22.5 | Lock at 22.5 for 92% probability"

### 4. Update War Room Hedge Panel
- In the hedge opportunities slide-in, show the **accuracy-backed recommendation**
- E.g., "Historically, HOLD at this quarter + this gap hits 85% — consider locking"

## File Changes

| File | Change |
|------|--------|
| New migration SQL | `get_hedge_accuracy_with_alt_lines` function |
| `HedgeStatusAccuracyCard.tsx` | Add live-line hit rate column |
| `HedgeRecommendation.tsx` | Show suggested hedge line with probability |
| `CustomerHedgeIndicator.tsx` | Add "Smart Line" badge when live line differs from original |
| `WarRoomPropCard.tsx` | Show live vs original line comparison |

