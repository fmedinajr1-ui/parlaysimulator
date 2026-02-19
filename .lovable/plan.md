

## Move Analyzer to Bottom of Landing Page

### Change

**`src/pages/BotLanding.tsx`** (edit)
- Move `<HomepageAnalyzer />` from its current position (between HeroStats and PerformanceCalendar) to after the WhyMultipleParlays section and before the PricingSection
- This places the analyzer near the bottom of the page, just above the subscription pricing cards

### Updated Page Order
```text
1. Navigation
2. Success Banner (conditional)
3. HeroStats
4. PerformanceCalendar
5. WhyMultipleParlays
6. HomepageAnalyzer  <-- moved here
7. PricingSection (subscription tiers, hidden if subscribed)
```

### Existing Paywalls (no changes needed)
| Paywall | Location | Price | Type |
|---|---|---|---|
| Subscription Tiers | PricingSection at bottom of landing page | $99/mo and $750/mo | Monthly subscription |
| Advanced Analysis | Inside HomepageAnalyzer (blurred VIP gate after free results) | $20 | One-time payment |
| Auto Picks | AutoPicksPaywall on /sweet-spots page | $9.99/mo | Monthly subscription |

All three paywalls remain functional -- only the analyzer's position on the page changes.

