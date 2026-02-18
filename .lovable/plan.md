
# Smart Stake Plan: Path to $1,000–$5,000+ Daily Profit

## What the Real Data Shows

From the last 9 days of settled parlays, here is the actual bot performance:

| Metric | Reality |
|---|---|
| Total settled parlays | 117 |
| Overall win rate | 28.2% (33 of 117) |
| Average stake | $83.85 |
| Net profit so far | +$23,696 |
| Average odds | +1203 (~13x payout) |
| Best leg count | 3-leg (37.1% win rate) |
| Worst leg count | 2-leg (11.8% win rate) |

The bot is actually profitable — the issue is that the **stakes are inconsistent and too low on high-confidence parlays**, and the **2-leg and single-leg parlays are dragging down returns**.

---

## The Core Profit Math

The bot generates roughly **13-20 settled parlays per day** across 3 tiers. At the current 28% win rate and average +1203 odds:

```
Daily parlays:     15 settled
Win rate:          28% = ~4 wins/day
Average odds:      +600 (conservative for 3-leg)
Stake per parlay:  $100

Gross on wins:     4 × $100 × 7 = $2,800
Losses:            11 × $100 = $1,100
Net daily profit:  ~$1,700/day
```

To hit $3,000–$5,000/day, we need two changes:
1. **Raise stakes on high-confidence tiers** (execution tier: $200–$500 per parlay)
2. **Kill 2-leg parlays entirely** (11.8% win rate, negative net profit)
3. **Focus volume on 3-leg parlays** (37.1% win rate — best performer)

---

## The 4-Tier Smart Stake Plan

### Tier Structure by Confidence

| Tier | Legs | Win Rate | New Stake | Max/Day | Daily EV |
|---|---|---|---|---|---|
| Execution (cash lock) | 3-leg | 37% | $300 | 5 parlays | +$2,160 |
| Validation | 3-leg | 33% | $150 | 8 parlays | +$1,188 |
| Exploration | 3-leg | 30% | $50 | 10 parlays | +$225 |
| Bankroll Doubler | 6-leg | 50% (small sample) | $25 | 2 parlays | +$237 |

**Projected daily net profit: $2,800–$5,000** at these stake levels.

**Monthly projection: $56,000–$100,000** over 20 betting days.

---

## What We Build: Profit Maximizer Dashboard

A new page/panel (in the bot analytics tab or as a standalone `/profit-plan` route) with 5 sections:

### Section 1 — Live Stake Calculator
- User inputs their bankroll (e.g. $5,000)
- System auto-suggests optimal stakes per tier using Half-Kelly formula
- Shows projected daily EV and monthly profit range

### Section 2 — Tier Performance Breakdown
- Real-time table showing each tier's: win rate, avg odds, net profit, stake, and EV
- Color-coded: green = profitable, red = losing money
- **Action buttons**: "Raise Stake" / "Lower Stake" / "Pause Tier"

### Section 3 — Leg Count Audit
- Bar chart: win rate vs leg count (1, 2, 3, 4, 5, 6 legs)
- Clearly shows 2-leg is the worst, 3-leg is the best
- Recommendation badge: "Kill 2-leg parlays — they've cost $716 this month"

### Section 4 — Daily Profit Projector
- Slider: set your stake per tier
- Live recalculates: projected daily profit, monthly profit, risk of ruin %
- Shows the math: "At $300/execution parlay, 5 parlays/day, 37% win rate = +$2,160 expected daily"

### Section 5 — Stake Override Panel (admin)
- Update `TIER_CONFIG` stakes in `bot-generate-daily-parlays` via a simple form
- Fields: Execution stake, Validation stake, Exploration stake
- Saves to a `bot_stake_config` table (new small table, 1 row, user-editable)
- Bot reads this table at generation time — no code deploys needed to change stakes

---

## Database Change Needed

Add one small table `bot_stake_config`:

```sql
CREATE TABLE bot_stake_config (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  execution_stake numeric NOT NULL DEFAULT 300,
  validation_stake numeric NOT NULL DEFAULT 150,
  exploration_stake numeric NOT NULL DEFAULT 50,
  bankroll_doubler_stake numeric NOT NULL DEFAULT 25,
  max_daily_parlays_execution int DEFAULT 5,
  max_daily_parlays_validation int DEFAULT 8,
  max_daily_parlays_exploration int DEFAULT 10,
  block_two_leg_parlays boolean DEFAULT true,
  updated_at timestamptz DEFAULT now()
);
```

The `bot-generate-daily-parlays` edge function reads from this table at start of each run, overriding the hardcoded `TIER_CONFIG` stakes.

---

## Files to Create/Edit

| File | Change |
|---|---|
| `src/pages/ProfitPlan.tsx` | New page with 5 sections above |
| `src/components/bot/StakeConfigPanel.tsx` | Admin panel to update stakes |
| `src/components/bot/TierPerformanceTable.tsx` | Real win rate/profit by tier |
| `src/components/bot/LegCountAudit.tsx` | Bar chart, leg count vs win rate |
| `src/components/bot/DailyProfitProjector.tsx` | Slider-driven profit calculator |
| `supabase/functions/bot-generate-daily-parlays/index.ts` | Read `bot_stake_config` table at run start |
| `App.tsx` | Add `/profit-plan` route |

---

## The Immediate Quick Wins (No UI needed)

Even before the dashboard is built, we can make two changes right now that will immediately increase profit:

1. **Update `TIER_CONFIG` execution stake from $100 to $300** — this alone triples execution tier EV
2. **Set `max_mini_parlays_2leg = 0` in Execution tier** — stops generating the worst-performing parlay type

These two changes to `bot-generate-daily-parlays` take 5 minutes and could add $1,000–$2,000/day in expected profit starting tomorrow.
