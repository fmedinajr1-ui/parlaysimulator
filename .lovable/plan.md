
User wants the Free Slip Grader to be an inline promo on the homepage (not a link to /grade), positioned near the subscription/pricing area. The grading experience should happen right on the landing page.

Looking at Index.tsx, the current `/grade` link card sits high up. The PricingSection is at the bottom (only shown to non-subscribed users). I need to:

1. Remove the link-style CTA card on Index.tsx
2. Build an inline grader widget that runs the full flow (paste → grade → email gate) directly on the homepage, placed right next to/above the PricingSection
3. Reuse the existing `grade-slip` edge function and the existing `GradeReveal` + `EmailGate` components from `src/components/grade/`

Plan:

## Changes

### 1. New component: `src/components/grade/InlineSlipGraderPromo.tsx`
- Self-contained widget that runs the whole grader flow inline
- Compact textarea ("Paste your slip…") + "Grade it free" button
- On submit → calls `grade-slip` edge function → shows `GradeReveal` (letter grade + headline) inline
- After grade reveal → shows `EmailGate` to capture email + send welcome email with full breakdown
- Side-by-side promo framing on desktop, stacked on mobile
- Visual treatment matches the pricing area (border, gradient, "FREE" badge) so it reads as a companion offer to the paid plan

### 2. `src/pages/Index.tsx`
- Remove the standalone `/grade` link CTA block (the big gradient card linking to `/grade`)
- Mount `<InlineSlipGraderPromo />` directly above the `PricingSection` so the free option sits next to the paid subscription
- Keep `/grade` route alive (existing dedicated page still works for direct links / shares)

## Out of scope
- Screenshot upload + manual entry modes (keep paste-only on homepage for simplicity; full multi-mode UX stays on `/grade`)
- Share card (skip on the inline promo to keep it tight; still available on `/grade`)
- Any backend changes — `grade-slip`, `email_subscribers`, drip cron all stay as-is

## Files
**Create**: `src/components/grade/InlineSlipGraderPromo.tsx`
**Modify**: `src/pages/Index.tsx` (remove link card, add inline promo above pricing)

## Testing
1. Paste slip on homepage → grade letter + headline appears inline (no navigation)
2. Submit email after grade → subscriber row created, welcome email queued
3. Promo renders side-by-side with pricing on desktop, stacked on mobile (393px viewport)
4. Subscribed/admin users still don't see pricing — promo also hides for them (free funnel is for non-subs)
5. `/grade` standalone page still works
