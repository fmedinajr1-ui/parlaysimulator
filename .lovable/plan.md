

# Multi-Fix Plan: Flip Logic, Void Reduction, Straight Bets, Lottery Loosening

## Summary

Four fixes targeting the four problems you identified:

1. **Weakest-leg flip logic** — When 2/3 legs hit and 1 misses, identify the losing leg pattern and avoid it in future parlays
2. **Reduce void rate** from 47% by loosening diversity rebalance caps
3. **Straight bet generation** — New system that bets individual picks at 66%+ hit rate for consistent profit
4. **Loosen lottery/hedge filters** so they actually generate on normal slates

---

## Fix 1: Weakest-Leg Flip Logic (Close Miss Tracker)

**Problem**: 2/3 legs hit consistently but the 3rd "weak link" kills the parlay. No system learns from which leg type fails.

**Solution**: Add a post-settlement analysis in `bot-settle-and-learn` (or a new function) that:

- After a parlay settles as "lost" with `legs_hit = 2, legs_missed = 1`, identifies the missed leg
- Logs the missed leg's `player_name + prop_type + side` to a `bot_weak_leg_tracker` table with miss count, last miss date, and context (defense rank, hit rate at time of pick)
- During parlay generation, **deprioritize** (not block) any leg that appears 3+ times in the weak leg tracker in the last 7 days — reduce its composite score by 20 points
- This creates a feedback loop: legs that keep being the "weak link" get naturally filtered out

**DB migration**: Create `bot_weak_leg_tracker` table:
```sql
CREATE TABLE bot_weak_leg_tracker (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  player_name text NOT NULL,
  prop_type text NOT NULL,
  side text NOT NULL,
  miss_count integer DEFAULT 1,
  last_miss_date date,
  context jsonb DEFAULT '{}'
);
```

**File changes**:
- New edge function `bot-close-miss-analyzer` — runs after settlement, finds 2/3 parlays, logs weak legs
- `bot-generate-daily-parlays/index.ts` — query weak leg tracker during pool building, apply -20 composite penalty to repeat weak legs

---

## Fix 2: Reduce Void Rate (47% → target <20%)

**Problem**: `bot-daily-diversity-rebalance` voids nearly half of generated parlays.

**Changes in `bot-daily-diversity-rebalance/index.ts`**:
- Raise player appearance cap: `10 → 15`
- Raise strategy family cap: `60% → 80%`
- Add a **hard floor**: never void below 20 active parlays (if voiding would drop below 20, stop voiding)
- Log but don't void "borderline" cases — tag them with `lesson_learned = 'diversity_warning'` instead of voiding

---

## Fix 3: Straight Bet System (Individual Picks)

**Problem**: 66% individual hit rate is profitable on straight bets (-110 juice needs 52.4% to break even), but no system generates or tracks them.

**Solution**: New edge function `bot-generate-straight-bets` that:

1. Queries the same sweet spot / unified props pool used by parlays
2. Filters for picks with **L10 hit rate ≥ 70%** and **composite score ≥ 65**
3. Generates individual "straight bet" records in a new `bot_straight_bets` table
4. Stakes $50-100 per pick based on hit rate tier (70-80% = $50, 80-90% = $75, 90%+ = $100)
5. Sends a Telegram broadcast: "📊 STRAIGHT BETS (X picks)" with each pick's line, hit rate, and recommended stake
6. Settles via the same grading pipeline

**DB migration**: Create `bot_straight_bets` table:
```sql
CREATE TABLE bot_straight_bets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  bet_date date NOT NULL DEFAULT CURRENT_DATE,
  player_name text NOT NULL,
  prop_type text NOT NULL,
  line numeric NOT NULL,
  side text NOT NULL,
  l10_hit_rate numeric,
  composite_score numeric,
  simulated_stake numeric DEFAULT 50,
  simulated_payout numeric,
  american_odds integer,
  outcome text DEFAULT 'pending' CHECK (outcome IN ('pending','won','lost','void','push')),
  profit_loss numeric DEFAULT 0,
  settled_at timestamptz,
  source text DEFAULT 'sweet_spot',
  created_at timestamptz DEFAULT now()
);
ALTER TABLE bot_straight_bets ENABLE ROW LEVEL SECURITY;
CREATE POLICY "public_read" ON bot_straight_bets FOR SELECT USING (true);
```

**Schedule**: Runs at 5:35 PM ET (right after parlay generation), picks the top 10-15 highest-confidence individual plays.

**Math**: At 66% hit rate with -110 odds, expected value per $100 bet = +$10. With 10 bets/day, that's ~$100/day expected profit even without any parlays hitting.

---

## Fix 4: Loosen Lottery & Hedge Filters

**Problem**: Tightened lottery filters (85% filler hit rate, defense rank ≥ 20) found zero qualifying legs yesterday.

**Changes in `nba-mega-parlay-scanner/index.ts`**:
- Filler hit rate: `85% → 80%`
- Defense rank floor: `≥ 20 → ≥ 18`
- Balanced leg floor: `75% → 70%`
- Fallback floor: `80% → 75%`
- Add a "relaxed mode": if zero tickets generate with strict filters, re-run with 5% lower thresholds and tag as `tier: 'standard_relaxed'`

This ensures at least 1-2 lottery tickets generate per day while still being meaningfully tighter than the pre-March-12 settings that were too loose.

---

## Implementation Order

1. DB migrations (2 new tables)
2. Fix 2 — Diversity rebalance loosening (quick edit)
3. Fix 4 — Lottery filter loosening (quick edit)
4. Fix 3 — Straight bet generator (new function + Telegram)
5. Fix 1 — Close miss analyzer (new function + generator integration)

## Technical Details

- Straight bets use the same `unified_props` and sweet spot data — no new data sources needed
- Close miss analyzer hooks into the existing `bot-settle-and-learn` pipeline
- All new functions follow the existing edge function pattern with CORS headers
- Telegram messages use the existing `bot-send-telegram` function

