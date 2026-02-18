
# 7-Day Profit Audit — Build Plan

## What This Builds

A new **Profit Audit** component that lives inside the existing BotDashboard Analytics tab. It pulls the last 7 days of settled parlays from `bot_daily_parlays`, aggregates by day and tier, and surfaces two intelligence panels:
1. **Day-by-Day Table** — date, total staked, gross won, net profit, ROI% per tier row
2. **Best ROI Finder** — which tier wins most and which day-of-week produces the highest ROI (so volume can be concentrated there)

All data already exists in `bot_daily_parlays` with `parlay_date`, `tier`, `outcome`, `simulated_stake`, `profit_loss`, and `expected_odds` columns — confirmed live in the database.

---

## Data Model (confirmed from live query)

The audit aggregates at `(parlay_date × tier)` level and produces:

| Field | Source |
|---|---|
| Total Staked | `SUM(simulated_stake)` |
| Gross Won | `SUM(stake + profit_loss)` where won |
| Net Profit | `SUM(profit_loss)` |
| ROI % | `net_profit / total_staked × 100` |

Day-of-week is derived from `parlay_date` using `date-fns` `getDay()` — no extra DB column needed.

---

## Files to Create / Edit

### 1. `src/hooks/useProfitAudit.ts` (NEW)
A focused query hook that:
- Fetches all settled parlays from the last 7 days from `bot_daily_parlays`
- Groups by `(parlay_date, tier)` in-memory
- Computes: `totalStaked`, `grossWon`, `netProfit`, `roiPct`, `parlayCount`, `wins`, `losses`
- Rolls up a `dayOfWeek` dimension (0=Sun → 6=Sat)
- Returns:
  - `dailyTierRows[]` — sorted newest-first, one row per (day, tier) combination
  - `tierSummary[]` — overall 7-day ROI per tier, sorted by ROI descending
  - `dowSummary[]` — ROI aggregated by day-of-week across all tiers, sorted by ROI descending
  - `bestTier` — the tier with highest 7-day ROI
  - `bestDow` — day-of-week name with highest 7-day ROI
  - `totalNetProfit`, `totalStaked`, `overallROI`

### 2. `src/components/bot/ProfitAuditCard.tsx` (NEW)
A self-contained card component with three visual sections:

**Section A — 7-Day Summary Banner**
Three stat chips: Total Staked / Net Profit / Overall ROI%

**Section B — Daily Breakdown Table**
Scrollable table with columns: Date | Tier | Parlays | Staked | Net P&L | ROI%
- Color-coded ROI cells (green ≥ 0, red < 0)
- Grouped by date with a subtle date header row
- Tier labels: Execution / Validation / Exploration (already used in `TierPerformanceTable`)

**Section C — Intelligence Panel (the "focus volume here" output)**
Two highlight cards side by side:
- Best Tier badge: tier name + its 7-day ROI%
- Best Day-of-Week badge: day name (e.g. "Thursday") + avg ROI%
- Below each: a mini bar chart using Recharts `BarChart` (already a dependency) showing all tiers/days for comparison

### 3. `src/pages/BotDashboard.tsx` (EDIT — minimal)
- Import `ProfitAuditCard`
- Add it to the **Analytics tab** section, positioned after `BotLearningAnalytics` and before `CategoryWeightsChart`

---

## Layout Sketch (mobile-first)

```text
┌─────────────────────────────────┐
│  📊 7-Day Profit Audit          │
│  Feb 12 – Feb 18                │
├─────────────────────────────────┤
│  $2,810 staked │ +$892 net      │
│  Overall ROI: +31.7%            │
├─────────────────────────────────┤
│  DATE      TIER    #  STAKED ROI│
│  Feb 17    Exec    2   $200  -100%│
│            Valid   8   $400  -55%│
│            Explor  6   $145 -100%│
│  Feb 16    Exec    2   $200  -100%│
│            Valid   3    $60  +90%│
│            Explor  10  $205  -44%│
│  ...                             │
├─────────────────────────────────┤
│  BEST TIER          BEST DAY    │
│  ┌──────────┐  ┌──────────────┐ │
│  │Validation│  │  Thursday    │ │
│  │ +340% ROI│  │  +340% ROI   │ │
│  └──────────┘  └──────────────┘ │
│  [mini bar chart per tier/dow]  │
└─────────────────────────────────┘
```

---

## Technical Notes

- Uses the existing `americanToDecimal` / `calculateROI` utilities already in `src/utils/roiCalculator.ts` for consistency
- `profit_loss` field from the DB is the authoritative net figure — no odds recalculation needed
- `gross_won = simulated_stake + profit_loss` for won parlays; `0` for lost; `simulated_stake` for push
- Pending parlays are excluded from all calculations (only `won`, `lost`, `push` outcomes)
- The hook uses `@tanstack/react-query` with `queryKey: ['profit-audit-7d']` — consistent with existing bot hooks
- Recharts `BarChart` is already used in `BotPerformanceChart` so no new dependency needed
- Day-of-week mapping: `['Sun','Mon','Tue','Wed','Thu','Fri','Sat']`
- Tier label mapping reuses the existing `TIER_LABELS` constant pattern from `TierPerformanceTable`
- No new database tables or migrations required — purely a frontend analytics layer over existing data
