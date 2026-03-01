

## Redesign Free Trial Banner to Match Reference Screenshot

### Overview
Update the existing `FreeTrialBanner` component to match the reference design -- a card-style layout with a header bar, feature checklist, and prominent CTA, while keeping the existing animations.

### Changes to `src/components/bot-landing/FreeTrialBanner.tsx`

Restructure the component layout to match the screenshot:

**Header Section:**
- Dark gradient header bar with "PARLAY BOT" in bold white/bebas font
- "MOST POPULAR" badge (with Zap icon) positioned top-right of the card

**Pricing Section:**
- Large "$99" with "/month" next to it
- Subtitle: "Cancel anytime · 3-day free trial"
- Thin separator line below

**Feature Checklist (6 items with check icons):**
1. Daily AI-generated parlay picks
2. Full parlay leg breakdowns and odds
3. Strategy analysis and reasoning
4. Performance calendar with P&L details
5. Telegram bot alerts and commands
6. Real-time live prop tracking

**Bottom Section:**
- Email input field
- CTA button text: "Start 3-Day Free Trial — $99/mo"
- Button styled with primary blue gradient

**Animations (kept/enhanced):**
- Container: `animate-fade-in` with delay
- Badge: `animate-scale-in`
- Glow orbs: `animate-pulse` on corners
- Border: `border-2 border-primary/40` with shadow glow
- CTA: `hover:scale-105` transition
- Feature list items: staggered fade-in using inline `animationDelay`

### Technical Details
- Single file change: `src/components/bot-landing/FreeTrialBanner.tsx`
- Import `Check` from lucide-react (replacing `Clock`)
- Keep existing props interface, price ID, and checkout logic unchanged
- Remove the "Free trial ends March 12th" urgency line (replaced by "Cancel anytime · 3-day free trial" subtitle)

