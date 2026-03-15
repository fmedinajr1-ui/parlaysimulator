

# Update March 14 `bot_activation_status` Row

## Current State (March 14 row)
| Field | Current | Correct |
|-------|---------|---------|
| daily_profit_loss | 36 | **2,188.76** |
| parlays_won | 1 | **4** |
| parlays_lost | 4 | **5** |
| parlays_generated | 5 | **21** |
| is_profitable_day | true | true |
| simulated_bankroll | 88,922.48 | **91,075.24** (+2,152.76 delta) |

**Note:** The actual settled P&L from the database is **+$2,188.76** (4W for +$2,648.76, 5L for -$460), not +$1,924.76. There is also still **1 pending** parlay remaining.

## Changes

### 1. Update March 14 row via data update tool
```sql
UPDATE bot_activation_status 
SET daily_profit_loss = 2188.76,
    parlays_won = 4,
    parlays_lost = 5,
    parlays_generated = 21,
    simulated_bankroll = 91075.2366207307
WHERE check_date = '2026-03-14';
```

### 2. Cascade bankroll to March 15
The March 15 row's `simulated_bankroll` must also shift by the same +2,152.76 delta:
```sql
UPDATE bot_activation_status 
SET simulated_bankroll = 90829.2366207307
WHERE check_date = '2026-03-15';
```
(March 15 P&L is 0, so bankroll = March 14 bankroll - March 14's old contribution + new contribution. Specifically: current 88676.48 + 2152.76 = 90829.24)

### 3. Update `bot-public-stats` edge function
No code changes needed — the stats function already reads directly from `bot_activation_status`.

