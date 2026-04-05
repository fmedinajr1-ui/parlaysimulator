

# Honest System Rebuild — Stop Mixed Messaging + 3-Leg Focus

## The Real Problem

The app shows users inflated accuracy numbers that don't match betting reality:
1. **"Accuracy" = line movement, not bet wins.** The feedback loop (CLV) checks if a line moved in the right direction, not if the player hit the prop. A "75% accurate" signal means the line moved right 75% of the time — the bet can still lose.
2. **Trap Warning "100%" is fake.** Code auto-marks every trap_warning as `was_correct: true` with "informational" outcome. It's not a real betting signal.
3. **Snapback/Live Drift at 0-17% are still generating legs.** These are actively poisoning parlays.
4. **Projected win rates are fantasy math.** Multiplying CLV-based "win rates" produces numbers like "65% projected" that have no correlation to actual parlay outcomes.

## Plan (4 Changes)

### 1. Kill Snapback + Live Drift Everywhere
Add `snapback` and `live_drift` to the POISON_SIGNALS list in the gold engine and POISON_SIGNAL_SPORTS in the daily parlay generator. These two signal types are 0-6 and 3-14 respectively — they should never generate legs.

**Files:** `gold-signal-parlay-engine/index.ts`, `bot-generate-daily-parlays/index.ts`

### 2. Fix the Accuracy Dashboard to Show Honest Numbers
The Accuracy Dashboard currently shows CLV-based hit rates and calls them "accuracy." Changes:
- Add a clear label distinguishing **"Line Movement Accuracy"** (CLV) from **"Bet Win Rate"** (actual parlay outcomes)
- Surface the actual parlay win rate from `bot_daily_parlays` (settled W/L) prominently at the top
- Mark Trap Warning as "Informational — Not a Bet Signal" instead of showing "100%"
- Add a red warning banner on any signal type with <30% actual bet win rate
- Show the real number: "Your parlays are hitting at X% over the last 30 days"

**Files:** `src/components/accuracy/UnifiedAccuracyView.tsx`, `src/hooks/useUnifiedAccuracy.ts`, new `src/components/accuracy/HonestAccuracyBanner.tsx`

### 3. Rebuild 3-Leg Parlay Logic for Higher Hit Rate
The current 3-leg blueprint (Blueprint 5 in gold engine) has a weak 40% projected threshold and no special filtering. Rebuild it:
- **Require ALL 3 legs to be Tier 1 (80%+ historical CLV)** — no Tier 2 mixing
- **Require at least 2 different sports** (cross-sport diversification)
- **Require minimum 65% individual leg hit rate** from `fanduel_prediction_accuracy` settled data (actual was_correct, not projected)
- **Cap at 2 three-leg parlays per day** to reduce exposure
- **Block any leg where the player has missed their last 3 consecutive props** (recent form check)
- Add a "3-Leg Gold Lock" blueprint that's separate from the general 3-leg builder

**Files:** `gold-signal-parlay-engine/index.ts`

### 4. Fix Homepage Suggestions to Stop Overpromising
The `SuggestedParlays` component shows "Win Est." percentages that come from the same inflated CLV math. Changes:
- Replace "Win Est." label with "Edge Score" (a relative quality ranking, not a probability)
- Add the actual historical win rate for similar parlays from `bot_daily_parlays` settled data
- Show the real track record prominently: "AI Picks: X-Y record (Z% win rate)"
- If the system is on a losing streak, show an honest warning instead of generating more picks
- Remove the "Safe AI" label — nothing about a 2-leg parlay from a system on a cold streak is "safe"

**Files:** `src/components/suggestions/SuggestedParlays.tsx`, `src/components/suggestions/HomepageParlayCard.tsx`

---

## Summary

The core issue is the system conflates "the line moved in the right direction" with "this bet will win" and presents both as "accuracy." These changes make the numbers honest, kill the signals that are proven losers, and rebuild 3-leg parlays with much stricter gates so they actually have a chance of hitting.

