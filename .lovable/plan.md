

# Fix Duplicate Parlays, Settlement Leaks, and Stake Sizing

## Problem Summary

Three compounding issues are causing losses despite winning parlays:

1. **Duplicate parlays polluting the slate** — Identical legs generated across multiple regen attempts are not being cleaned up. Today: dozens of identical `elite_categories_v1_execution_shootout_stack` and `role_stacked_5leg` tickets exist.

2. **Settlement is re-processing voided parlays** — The "void recovery" logic (lines 644-659) picks up ALL voided parlays with pending legs and tries to settle them. This means 146 parlays voided for "defense-aware rebuild" and 33 for "protocol upgrade" can get re-settled as losses, inflating loss counts.

3. **Stake sizing bleeds money** — Execution tier: 146 losses × $210 avg = $30,760 lost vs 29 wins × $195 avg = $22,420 won. The 17% win rate requires either much higher payouts or much lower stakes on losses. The auto-double mechanism (2x after a profitable day) amplifies this.

## Financial Analysis (Last 7 Days)

```text
Date       | Won | Lost | Net P&L
-----------+-----+------+--------
Mar 3      |  11 |   45 | -$1,865
Mar 2      |   9 |   57 | -$2,598
Mar 1      |   2 |   10 |   +$670
Feb 28     |   5 |   24 |   -$724
Feb 27     |   3 |   30 |   -$923
Feb 26     |  59 |  191 | +$12,494
Feb 25     |  41 |   59 | +$13,670

Core problem: Winning 16% of bets at 5:1 avg odds
needs to stake LESS on losses and MORE on high-confidence wins.
```

## Plan

### 1. Clean duplicates from today's slate (DB migration)
Delete all but the earliest copy of any identical-legs parlay for today:
```sql
DELETE FROM bot_daily_parlays 
WHERE id IN (
  SELECT id FROM (
    SELECT id, ROW_NUMBER() OVER (
      PARTITION BY parlay_date, legs::text 
      ORDER BY created_at ASC
    ) as rn
    FROM bot_daily_parlays 
    WHERE parlay_date = '2026-03-04'
  ) t WHERE rn > 1
);
```

### 2. Fix settlement void recovery — skip intentionally voided parlays
In `bot-settle-and-learn/index.ts` (lines 644-653), add a filter to only recover parlays voided by *settlement data lag* (no `lesson_learned` or `lesson_learned = 'no_data'`), NOT parlays voided by diversity rebalance, protocol upgrades, or defense-aware rebuilds:

```typescript
// Only recover parlays that were voided due to missing data (not intentional voids)
const { data: voidedParlays } = await supabase
  .from('bot_daily_parlays')
  .select('*')
  .in('parlay_date', targetDates)
  .eq('outcome', 'void')
  .or('lesson_learned.is.null,lesson_learned.eq.no_data,lesson_learned.eq.settlement_no_data');
```

This prevents the 146 "defense-aware rebuild" and 33 "protocol upgrade" voided parlays from being re-settled as losses.

### 3. Reconfigure stake sizing — risk-proportional model
Replace flat tier stakes with a probability-based model in `bot-generate-daily-parlays`:

**New stake formula:**
```text
Tier        | Base  | Max Parlays | Logic
------------+-------+-------------+------
Execution   | $100  | 3           | Only 3-leg parlays with 60%+ combined prob
Validation  | $50   | 3           | 3-4 leg, 40-60% combined prob  
Exploration | $20   | 5           | Lower conviction, capped exposure
Lottery     | $5    | 3           | High odds fun tickets
```

**Key changes:**
- Cut execution baseline from $500 → $100 (was bleeding $210/loss × 146 losses)
- Cut validation from $200 → $50
- Cut exploration from $75 → $20
- Total daily max risk: ~$500 instead of ~$3,000+

### 4. Remove auto-double streak multiplier
The auto-double logic (lines 1563-1613 in `bot-settle-and-learn`) doubles all stakes after a profitable day. With a 16% parlay win rate, this guarantees amplified losses the next day. Replace with a flat 1.0 multiplier always.

### 5. Add dedup guard to generation pipeline
In `bot-generate-daily-parlays`, add a fingerprint check before inserting any new parlay:
- Hash `JSON.stringify(sorted_legs)` 
- Skip insert if fingerprint already exists for today's date
- This prevents dupes at the source instead of relying on post-hoc cleanup

### 6. Update `bot_stake_config` table with new baselines
```sql
UPDATE bot_stake_config SET
  execution_stake = 100,
  baseline_execution_stake = 100,
  validation_stake = 50,
  baseline_validation_stake = 50,
  exploration_stake = 20,
  baseline_exploration_stake = 20,
  bankroll_doubler_stake = 10,
  baseline_bankroll_doubler_stake = 10,
  streak_multiplier = 1.0,
  updated_at = NOW();
```

## Expected Outcome
- No duplicate parlays in the slate
- Voided parlays stay voided (no ghost losses)
- Daily risk exposure drops from ~$3,000 to ~$500
- Same win rate but dramatically less bleed on losses
- Net profitability even at 16% parlay win rate (avg +500 odds × $100 stake = $500 win vs $100 loss per bet → breakeven at 17%)

