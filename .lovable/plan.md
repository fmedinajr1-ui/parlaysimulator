

## Add Homepage Analyzer to the Landing Page

The analyzer component (`HomepageAnalyzer`) currently lives on the unused `Index.tsx` page. The actual landing page at `/` is `BotLanding.tsx`. This plan moves the analyzer onto the real landing page.

### What Changes

**`src/pages/BotLanding.tsx`** (edit)
- Import `HomepageAnalyzer` from `@/components/home/HomepageAnalyzer`
- Add `<HomepageAnalyzer />` between the `HeroStats` section and the `PerformanceCalendar` section
- This places the free analyzer front-and-center for all visitors, no account required

### Result
- Visitors land on `/` and immediately see the parlay analyzer after the hero stats
- Free analysis (probability, risk labels, leg breakdown) works without sign-up
- The $20 "Unlock Full Analysis" upgrade is available inline below the free results
- No other files need to change -- the component and edge functions are already built and deployed

