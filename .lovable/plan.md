

## Plan: Add Animated Volume Staking Section Below Calendar

### Placement
Insert `VolumeStakingBreakdown` in `BotLanding.tsx` directly after the `PerformanceCalendar` section (line ~130), before `WhyMultipleParlays`.

### New File: `src/components/bot-landing/VolumeStakingBreakdown.tsx`

**Structure:**
1. **Gradient headline** — "How Volume Staking Turns the Odds" with `framer-motion` `whileInView` fade-up
2. **3 animated concept cards** (staggered entrance, hover glow):
   - "20+ Parlays/Day" — volume reduces variance
   - "Half-Kelly Sizing" — math-based bankroll protection
   - "Compounding Edge" — 30% WR at +500 = profit
3. **Interactive bankroll slider** — Radix Slider, user picks bankroll ($500–$25K), see animated daily/monthly EV projections across 4 tiers using `halfKelly()` formula (copied from StakeCalculator)
4. **4 tier cards** — Execution/Validation/Exploration/Lottery showing stake + daily EV for selected bankroll, staggered entrance
5. **Reference table** — 5 bankroll levels with projected returns, rows fade in on scroll
6. **Trust footer** with subtle pulse

**Animations (framer-motion):**
- `whileInView` with `once: true` for all sections
- Staggered children delays (0.1s apart)
- Cards: `hover:scale-105` + `hover:shadow-[0_0_20px_hsl(var(--primary)/0.15)]`
- Count-up effect on EV numbers using `useEffect` + `requestAnimationFrame`
- Gradient text: `bg-clip-text text-transparent bg-gradient-to-r from-primary to-accent`

### Edit: `src/pages/BotLanding.tsx`
- Import `VolumeStakingBreakdown`
- Add `useSectionView('volume_staking')` ref
- Insert after `PerformanceCalendar` div (~line 130)

### No backend changes needed.

