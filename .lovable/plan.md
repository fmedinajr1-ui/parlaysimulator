

# Straight Bets: Admin-Only Telegram + $500 Bankroll

## Current Issues

1. **Telegram not receiving picks** — `straight_bets` type hits the default handler in `bot-send-telegram` which returns a generic one-liner instead of the detailed pick list
2. **Bankroll default is $5000** — needs to be $500; at $500 with 5% Kelly cap, every pick = $25
3. **UI card exists but shouldn't** — you want this admin-only via Telegram, no dashboard card needed

## Kelly Math at $500 Bankroll

At $500 with half-Kelly capped at 5%, every pick stakes **$25** (the floor equals the cap). With 15 picks:
- Total risk: **$375**
- At 66% (10/15 wins): +$228 payout - $125 losses = **+$103 profit**
- At 73% (11/15 wins): +$250 - $100 = **+$150 profit**
- Break-even: 8/15 (53%)

## Changes

### 1. Fix `bot-send-telegram` to handle `straight_bets` type
Add a case in `formatMessage` that uses the pre-built `data.message` (which the generator already constructs with all pick details, hit rates, and stakes).

### 2. Update bankroll default in `bot-generate-straight-bets`
Line 59: change `body.bankroll ?? 5000` → `body.bankroll ?? 500`

### 3. Remove duplicate console.log
Line 63 is a duplicate of line 61 — remove it.

### 4. Remove `StraightBetsPnLCard` from dashboard
Remove the import and usage from `BotDashboard.tsx`. Keep the component file in case you want it later, just remove it from the page.

### Pick Count
With the current filters (L10 hit rate ≥ 70%, sourced from sweet spots + pick pool), the number of picks depends on the slate. Yesterday generated 15. The `max_picks` default is 15, which is the cap. On lighter slates you may get 5-10.

