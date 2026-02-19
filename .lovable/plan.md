
# Add "When We Win, We Win Big" — Payout Preview Banner to Landing Page

## Goal

Create a visually striking, marketing-focused payout preview section on the home page (`/`) that converts visitors by showing the real dollar returns when the bot hits. This is distinct from the admin `StakeConfigPanel` version — it needs to be bold, emotional, and designed to attract.

---

## What's Being Built

A new standalone component: `src/components/WhenWeWinBig.tsx`

It will be inserted in `src/pages/Index.tsx` — placed **between the Elite 3PT Fixed Parlay and the Daily Parlay Hub** (the highest-traffic scroll area), so it appears right as users start engaging with today's picks.

---

## Visual Design

### Top Bar — Headline with fire energy
```
🔥 WHEN WE WIN, WE WIN BIG
   One hit changes your week.
```

### Three payout cards — stacked, each with a neon glow border

Each card shows:
- Tier badge (EXECUTION / VALIDATION / EXPLORATION)
- Parlay description (e.g. "3-Leg Parlay · +596 odds")
- Win probability from real data (37% hit rate)
- BIG green profit number: `+$2,980`
- Smaller: `$500 stake → $3,480 return`
- Daily EV line: `EV: +$620/day across 3 parlays`

### Bottom — animated pulse CTA
```
[🎯 See Today's Picks]
```

---

## The Three Payout Scenarios

| Tier | Stake | Odds | Profit | Win Rate | EV/Day |
|---|---|---|---|---|---|
| Execution (3-leg) | $500 | +596 | **+$2,980** | 37% | +$620 |
| Validation (4-leg) | $200 | +1,228 | **+$2,456** | 22% | +$240 |
| Exploration (3-leg) | $75 | +596 | **+$447** | 37% | +$93 |

Formula used (same as `StakeConfigPanel`):
```ts
profit = stake * (odds / 100)       // e.g. 500 * 5.96 = $2,980
evPerDay = count * (prob * profit - (1-prob) * stake)
```

---

## Component Structure

```text
WhenWeWinBig.tsx
├── Outer wrapper: FeedCard variant="glow" with neon-green glow border
├── Header row
│   ├── 🔥 emoji
│   ├── "WHEN WE WIN, WE WIN BIG" — Bebas Neue font-display
│   └── subtitle: "One hit changes everything"
├── Three payout cards (grid on desktop, vertical stack on mobile)
│   ├── Tier badge pill (color-coded: green/yellow/muted)
│   ├── Parlay type label + odds badge
│   ├── GIANT profit number: text-3xl font-bold text-primary
│   ├── Stake → Return line in muted text
│   └── EV/day in small accent text
└── CTA Button → /best-bets (links to today's top picks)
```

---

## Files Changed

| File | Change |
|---|---|
| `src/components/WhenWeWinBig.tsx` | **Create new** — the entire payout preview component |
| `src/pages/Index.tsx` | **Import + insert** `<WhenWeWinBig />` between `Elite3PTFixedParlay` and `DailyParlayHub` |

No database queries. No edge function changes. No migrations. Pure UI component using static payout math that mirrors the live stake config values ($500 / $200 / $75 already set in the database).

---

## Key Styling Choices

- **Card border**: `neon-border` class (existing CSS — gradient neon green-to-cyan border) to make it visually pop
- **Profit numbers**: `text-gradient-neon` (existing CSS utility — green-to-cyan gradient text) for the big dollar amounts
- **Background**: `bg-gradient-to-br from-primary/5 to-accent/5` — subtle glow tying it to the site palette
- **Tier badges**: green for Execution, yellow-500 for Validation, muted for Exploration (consistent with `StakeConfigPanel`)
- **Animation**: `animate-pulse` on a small green dot next to "LIVE PICKS ACTIVE" subtitle to create urgency
- **Font**: `font-display` (Bebas Neue) for the main headline — matches the existing `HowItWorks` and `HeroBanner` styling
