

## What's actually happening

The user's screenshot is from `/` which renders `BotLanding.tsx`, NOT `Index.tsx`. My previous inline grader change went into `Index.tsx` (a different route the user wasn't on). On `BotLanding.tsx` the Free Slip Grader is still the click-through link card from an earlier edit.

## Fix

Replace the link-style card on `BotLanding.tsx` with the inline `InlineSlipGraderPromo` component (already built and working on Index.tsx) so the grader runs right there on the landing page next to the pricing/CTA, no navigation required.

### Single change
**File**: `src/pages/BotLanding.tsx` (lines ~160-184)
- Remove the `<Link to="/grade">` card block
- Mount `<InlineSlipGraderPromo />` in its place
- Add the import

Pricing (`PricingSection`) on the bot landing page sits in a separate band below — the inline grader will read as a free companion offer right above it, matching the "promo next to subscription" intent.

### Out of scope
- Index.tsx already has the correct inline promo — leave it
- `/grade` standalone page stays for direct links/shares
- No backend, no new components, no styling system changes

### Testing
1. Load `/` on mobile (393px) → see inline grader card with textarea, not a link
2. Paste a slip → grade renders inline on the same page
3. Submit email → subscriber row + welcome email queued
4. Verify pricing CTA still sits below and renders correctly
5. `/grade` standalone page still works for direct visitors

