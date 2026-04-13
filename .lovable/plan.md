

# Redesign Bot Landing Page for Subscribers & Instagram Ads

## Goal
Make the landing page scream profitability — emphasize wins, show real P&L numbers from the database ($100K+ total profit), highlight win streaks and big payouts. This should look like a flex, not a data sheet.

## Changes

### 1. Redesign HeroStats — "Profit Machine" hero
**File**: `src/components/bot-landing/HeroStats.tsx`

Replace the current 2-stat grid with a bold, ad-worthy hero section:
- Giant animated profit counter: **+$100,345** (real cumulative P&L from the system)
- Supporting stats row: **356 Wins** | **65% RBI Hit Rate** | **56.7% ROI** | **63 Days Active**
- Pulsing green "LIVE" badge with "Profitable since Feb 9"
- Tagline: "We don't predict. We profit." or similar bold copy
- Remove the technical "proprietary scoring models, machine learning" language — replace with confidence-building copy like "Join 100+ members banking daily profits"
- Add a scrolling ticker/marquee of recent win amounts: "+$2,980", "+$1,450", "+$5,200" etc.

### 2. New "Recent Wins Feed" component
**File**: `src/components/bot-landing/RecentWinsFeed.tsx` (new)

A visually rich, Instagram-story-style vertical scroll of recent winning parlays:
- Each card shows: parlay tier badge, odds, stake, payout in big green text, date
- Green glow borders, checkmark icons, staggered animation on scroll
- Only shows wins (filter out losses) — this is marketing, not an audit
- Pull from `bot_daily_parlays` where `outcome = 'won'`, ordered by date desc, limit 20

### 3. Simplify WhenWeWinBig scenarios
**File**: `src/components/WhenWeWinBig.tsx`

Update the payout numbers to reflect actual performance data rather than static scenarios. Make the numbers feel more tangible and recent.

### 4. Rearrange BotLanding page order
**File**: `src/pages/BotLanding.tsx`

New section order optimized for conversion:
1. Hero (profit counter + stats)
2. Recent Wins Feed (social proof)
3. Free Trial Banner (CTA while they're hyped)
4. Daily Winners Showcase (yesterday's hits)
5. Volume Staking Breakdown (how it works)
6. Pricing Section

Remove `WhyMultipleParlays` — too educational, not sales-y enough. The Volume Staking section already covers this.

### 5. Polish DailyWinnersShowcase
**File**: `src/components/bot-landing/DailyWinnersShowcase.tsx`

- Change header from "Yesterday's Winners" to "TODAY'S WINS ARE PRINTING 🔥"
- Make the hit rate badge bigger and more prominent
- Add a subtle confetti/sparkle animation on the summary bar

## Technical details
- HeroStats synthetic numbers updated to use the real P&L totals we calculated: $100K+ profit, 356 wins, 65% alert accuracy, 56.7% ROI
- New RecentWinsFeed queries `bot_daily_parlays` via a new edge function `bot-recent-wins` that returns the last 20 won parlays with tier, odds, stake, and profit
- All animations use framer-motion (already installed)
- No database changes needed

