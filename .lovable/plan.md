

## Add Free Trial Paywall Banner Above Performance Calendar

### Overview
Create an animated promotional banner component that appears between the HeroStats and PerformanceCalendar sections on the Bot Landing page. It highlights the $99/mo subscription with a free trial ending March 12th, and includes a "Join Now" CTA that triggers checkout.

### New Component: `src/components/bot-landing/FreeTrialBanner.tsx`

A visually striking, animated paywall card featuring:
- Gradient background with glowing accents (consistent with existing design language)
- Animated entrance using `animate-fade-in` and `animate-scale-in` keyframes already in the project
- Pulsing border glow effect using Tailwind animation
- "FREE TRIAL" badge at top
- Headline: "Start Your 3-Day Free Trial"
- Price display: "$99/month after trial"
- Urgency line: "Free trial ends March 12th" with a clock/timer icon
- "Join Now" CTA button (gradient style matching existing buttons)
- Email input field (matches PricingSection pattern -- email required for checkout)
- Calls `create-bot-checkout` with the Parlay Bot price ID on submit
- Only shown to non-subscribers (same `hasBotAccess || isAdmin` guard used elsewhere)

### Changes to `src/pages/BotLanding.tsx`

Insert the `FreeTrialBanner` component between `HeroStats` and `PerformanceCalendar`:

```
<HeroStats />
<FreeTrialBanner />       <-- NEW
<PerformanceCalendar />
```

Pass `onSubscribe` and `isLoading` props (same as PricingSection) so checkout works identically.

### Animation Details
- Container: `animate-fade-in` with slight delay for staggered entrance after hero
- Inner glow orbs: CSS `animate-pulse` on pseudo-elements for ambient glow
- CTA button: `hover:scale-105` transition + `shadow-lg shadow-primary/30` glow
- Urgency text: subtle `animate-pulse` on the deadline to draw attention
- Border: `border-primary/40` with gradient shimmer effect

### Design Spec
- Uses existing color tokens (`primary`, `accent`, `destructive` for urgency)
- Rounded-2xl card with `backdrop-blur-sm` glass effect
- Max-width `max-w-2xl mx-auto` to match page content width
- Responsive padding and text sizing
