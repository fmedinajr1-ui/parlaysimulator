

## Fix Free Trial Banner: Add March 12th Deadline + Glowing Animations

### Changes to `src/components/bot-landing/FreeTrialBanner.tsx`

**1. Add "Free trial ends March 12th" urgency line**
- Add below the "Cancel anytime · 3-day free trial" subtitle
- Use destructive color with a Clock icon and `animate-pulse` class

**2. Add glowing border animation to the card**
- Apply `animate-pulse-glow` (already defined in tailwind config) to the outer container
- Add a glowing `box-shadow` using `shadow-[0_0_30px_hsl(var(--primary)/0.3)]` on the card
- Make the border shimmer with a pulsing primary color effect

**3. Add glowing CTA button**
- Apply `animate-pulse-glow` or similar pulsing glow shadow to the "Start 3-Day Free Trial" button
- Enhance the existing `shadow-lg shadow-primary/30` to a more visible pulsing glow

**4. Enhance glow orbs**
- Increase size and opacity of the existing corner glow orbs for more visible ambient glow effect

### Technical Details
- Single file change: `src/components/bot-landing/FreeTrialBanner.tsx`
- Re-import `Clock` from lucide-react alongside `Check` and `Zap`
- Use existing `animate-pulse-glow` keyframe from tailwind.config.ts for the card border glow
- No new keyframes needed -- leverage what's already configured

