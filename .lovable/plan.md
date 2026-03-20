

# Smart Individual Pick Portfolio — Tonight's Plays

## The Math (Why This Works)

At -110 odds, you need **52.4%** to break even. Your system's individual picks hit at **66%+**. That means:

- **15 picks × $100 each = $1,500 total risk**
- At 66% hit rate: ~10 wins × $91 payout = **$910 back**
- Minus 5 losses × $100 = **-$500**
- **Net profit: ~$410 even with 5 losses**
- At 73% (your 100% L10 picks): ~11 wins = **$501 profit**

## Tonight's 15 Picks (Already Generated)

### TIER 1 — 100% L10 Hit Rate ($100 each, 6 picks = $600 risk)

| # | Player | Pick | Line | L10 Avg | Cushion |
|---|--------|------|------|---------|---------|
| 1 | **RJ Barrett** | PTS OVER | 14.5 | 24.1 | +66% above line |
| 2 | **RJ Barrett** | REB OVER | 2.5 | 5.7 | +128% above line |
| 3 | **Nickeil Alexander-Walker** | PTS OVER | 14.5 | 22.5 | +55% above line |
| 4 | **Nickeil Alexander-Walker** | 3PT OVER | 0.5 | 3.9 | huge cushion |
| 5 | **Amen Thompson** | PTS OVER | 14.5 | 21.6 | +49% above line |
| 6 | **Donovan Clingan** | REB OVER | 6.5 | 14.7 | +126% above line |

### TIER 2 — 90% L10 Hit Rate ($100 each, 8 picks = $800 risk)

| # | Player | Pick | Line |
|---|--------|------|------|
| 7 | **Kevin Durant** | PTS OVER | 14.5 |
| 8 | **Nikola Jokic** | PTS OVER | 14.5 |
| 9 | **Jaylen Brown** | PTS OVER | 14.5 |
| 10 | **Draymond Green** | AST OVER | 3.5 |
| 11 | **Christian Braun** | REB OVER | 2.5 |
| 12 | **Zaccharie Risacher** | REB OVER | 2.5 |
| 13 | **Sandro Mamukelashvili** | REB OVER | 2.5 |
| 14 | **Jalen Johnson** | AST OVER | 3.5 |

### TIER 3 — 80% L10 ($75, 1 pick = $75 risk)

| # | Player | Pick | Line |
|---|--------|------|------|
| 15 | **Ronald Holland II** | REB OVER | 2.5 |

## Total Portfolio: $1,475 risk

**Break-even**: Need 8/15 wins (53%) — your data says you hit 66%+

**Projected scenarios**:
- 10/15 hit (66%): **+$410 profit**
- 11/15 hit (73%): **+$501 profit**  
- 12/15 hit (80%): **+$592 profit**
- 8/15 hit (53%): **+$3 breakeven**
- 7/15 hit: **-$88 small loss** (unlikely given L10 data)

## What I'd Build (Enhancement)

The straight bet system already generates these picks and sends them to Telegram. To make this a **daily automated profit tracker**, I'd add:

1. **Daily P&L dashboard card** on the main dashboard showing straight bet performance (won/lost/pending, running profit)
2. **Kelly Criterion staking** — instead of flat $50-100, use optimal bet sizing based on edge: `stake = bankroll × (hit_rate × 1.91 - 1) / 0.91`
3. **Auto-settle straight bets** in the existing `bot-settle-and-learn` pipeline so you see results without manual tracking

No code changes needed to place tonight's bets — the 15 picks above are already in `bot_straight_bets` and were sent to Telegram. The enhancement would make this a tracked, optimized daily system.

