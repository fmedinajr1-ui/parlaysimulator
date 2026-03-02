

## Real-Time Telegram Alerts: Per-Leg + Per-Parlay Settlement Updates

### What You'll Get
Two levels of live updates throughout game hours:

1. **Per-Leg Alerts** -- As individual legs settle (hit or miss), you get an immediate update showing the player, prop, line, actual value, and result. This lets you track progress on parlays before they fully resolve.

2. **Per-Parlay Alerts** -- When all legs in a parlay have resolved and the full parlay outcome is determined (won/lost), you get a summary with the complete leg breakdown, P&L, and running daily tally.

### Example Messages

**Leg Settled:**
```text
LEG HIT
LeBron James PTS O25.5 -- Actual: 28
Parlay: mixed_conviction_stack (+340) | 2/3 legs settled

LEG MISS
Stephen Curry PTS O28.5 -- Actual: 22
Parlay: elite_categories_v1 (+280) | PARLAY LOST
```

**Parlay Settled (full):**
```text
PARLAY WON -- mixed_conviction_stack (+340)
--------------------------------
1. LeBron James PTS O25.5 -- 28 (hit)
2. Luka Doncic AST O7.5 -- 9 (hit)
3. Jayson Tatum 3PT O2.5 -- 4 (hit)

Stake: $500 | Payout: $2,200 | Profit: +$1,700
Today: 3W-1L | +$800
```

### Technical Changes

#### 1. `bot-send-telegram` -- Add Two New Notification Types

- **`leg_settled_alert`**: Formats a compact per-leg message with player, prop, line, side, actual value, hit/miss emoji, and parlay context (strategy name, how many legs settled so far).

- **`parlay_settled_alert`**: Formats a full parlay outcome message with all legs listed, odds, stake, P&L, and a running daily W-L tally.

Both types are admin-only (sent only to admin chat IDs).

#### 2. `bot-settle-and-learn` -- Fire Alerts Inside Settlement Loop

- **Per-leg alert (line ~869)**: Right after each leg outcome is determined as `hit` or `miss`, fire a Telegram call with the leg details plus parlay context (strategy, total legs, how many settled so far).

- **Per-parlay alert (line ~931)**: Right after a parlay outcome is set to `won` or `lost`, fire a Telegram call with the full parlay details, P&L, and running daily counters.

- Both alerts are non-blocking `fetch()` calls so they don't slow down settlement.

#### 3. Throttling
To avoid message spam on heavy settlement runs:
- Batch per-leg alerts: collect all leg outcomes for a single settlement run and send as one consolidated message (max 30 legs per message) rather than one message per leg.
- Per-parlay alerts are sent individually since volume is lower (typically 10-50 parlays per run).

### Files Modified
- `supabase/functions/bot-send-telegram/index.ts` -- add `leg_settled_alert` and `parlay_settled_alert` notification types + formatters
- `supabase/functions/bot-settle-and-learn/index.ts` -- collect leg outcomes during loop, fire batched leg alert + individual parlay alerts after each parlay settles

### No Database Changes Needed
Uses existing data flowing through the settlement loop.

