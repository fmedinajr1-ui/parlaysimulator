

# Expand to MMA, Soccer, Golf, and Lacrosse

## Current State

Your system already scrapes NBA, NHL, MLB, WNBA, NCAAB, College Baseball, and Tennis. The **team market signals** (Moneyline, Spreads, Totals) are your strongest performers across all sports — MLB moneyline hits at 69.4%, spreads at 66.7%, NHL spreads at 62.1%.

## What the Odds API Supports

| Sport | API Key | Markets Available | Player Props? |
|-------|---------|-------------------|---------------|
| MMA/UFC | `mma_mixed_martial_arts` | h2h (fight winner) | No |
| Soccer (MLS) | `soccer_usa_mls` | h2h, spreads, totals | No |
| Soccer (EPL) | `soccer_epl` | h2h, spreads, totals | No |
| Lacrosse (PLL) | `lacrosse_pll` | h2h | No |
| Lacrosse (NCAA) | `lacrosse_ncaa` | h2h | No |
| Golf (PGA) | Already active | outrights | No |

**Important**: None of these sports have player props on the Odds API. All signals will be **team/match market** based — which is actually where your best win rates already are.

## What Gets Built

### 1. Add Sports to Scraper Config

Add MMA, Soccer (MLS + EPL), and Lacrosse to `TIER_2_SPORTS` in `whale-odds-scraper/index.ts`. They'll automatically get scraped for h2h, spreads, and totals when in season.

### 2. Update Alert Engine

Update `fanduel-prediction-alerts` to handle these sports:
- **MMA**: h2h only — detect fight winner line movement, velocity spikes, snapbacks
- **Soccer**: h2h + spreads + totals — same signal types as MLB/NHL team markets
- **Lacrosse**: h2h — moneyline movement tracking
- **Golf**: already scraped, just needs alert pipeline integration for outright odds movement

### 3. Sport-Specific Signal Tuning

Each sport needs adjusted thresholds:
- **MMA**: Wider drift ranges (fight odds swing more), higher velocity spike threshold, TAKE/FADE labels
- **Soccer**: Draw market awareness (3-way h2h), lower total lines (2.5 is standard), tighter spread thresholds
- **Lacrosse**: Similar to hockey model, small sample initially so higher confidence gates
- **Golf**: Outright futures are different — track which golfers' odds are steaming vs fading

### 4. Telegram Formatting

Add sport emojis and context:
```text
🥊 TAKE IT NOW — UFC
Max Holloway vs Ilia Topuria
Open: -150 → Now: -180 (steaming)
📊 Confidence: 82%
✅ Action: TAKE Holloway (-180)

⚽ VELOCITY SPIKE — MLS
Inter Miami vs LAFC
Moneyline: +120 → +105 (sharp action)
📊 Confidence: 75%
✅ Action: TAKE Inter Miami (+105)
```

## Scope

| Action | File | What |
|--------|------|------|
| Edit | `whale-odds-scraper/index.ts` | Add 5 sport keys to TIER_2_SPORTS |
| Edit | `fanduel-prediction-alerts/index.ts` | Add sport-specific thresholds and formatting |
| Edit | `telegram-webhook/index.ts` | Add sport emoji mapping for alerts |

No new tables needed — `unified_props` and `fanduel_prediction_accuracy` already support arbitrary sport values. All existing signal types (Take It Now, Velocity Spike, Correlation, etc.) work on team markets out of the box.

## API Budget Note

Each new sport costs ~1 API call per scan cycle for odds. With 5 new sport keys at 4 scans/hour, that's ~20 extra calls/hour. Manageable within the existing quota.

