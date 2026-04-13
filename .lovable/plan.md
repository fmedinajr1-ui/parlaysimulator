

# Ensure Subscribe Button is Always Visible for New Customers

## Problem
The glowing subscribe button (FreeTrialBanner) only appears once in the middle of the page. As users scroll through the wins feed, daily winners, calendar, etc., there's no persistent CTA visible. New customers could lose the impulse to subscribe.

## Solution
Add a **sticky floating subscribe button** at the bottom of the screen for non-subscribers, so the glowing CTA is always visible regardless of scroll position.

### Changes

**1. New component: `StickySubscribeCTA.tsx`**
A fixed-bottom bar with a glowing "Start Free Trial" button that stays visible as users scroll. Includes:
- Semi-transparent backdrop blur background
- The same `animate-pulse-glow` effect as the FreeTrialBanner button
- Compact layout: price on the left ("$99/mo"), glowing CTA button on the right
- Slides up on mount with animation
- Only shows for non-subscribers (controlled by parent)

**2. Update `BotLanding.tsx`**
- Import and render `StickySubscribeCTA` outside the main content flow, at the bottom of the page
- Same `!(hasBotAccess || isAdmin)` guard
- Clicking the sticky button scrolls to the FreeTrialBanner section (or opens checkout directly)
- Add bottom padding to the page content so the sticky bar doesn't cover the last section

### Files
- `src/components/bot-landing/StickySubscribeCTA.tsx` (new)
- `src/pages/BotLanding.tsx` (add sticky CTA + bottom padding)

