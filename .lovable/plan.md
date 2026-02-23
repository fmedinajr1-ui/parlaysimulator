

## New Subscriber Welcome Tips Banner

### What
Add a prominent tips/reminder card on the landing page for users who just got bot access. This card will display key tips like placing all parlays provided to get the full experience.

### Where
**File: `src/pages/BotLanding.tsx`**

Add a new `WelcomeTipsCard` component that renders when the user has bot access (`hasBotAccess || isAdmin`). It will appear between the success banner and the HeroStats section.

### New Component: `src/components/bot-landing/WelcomeTipsCard.tsx`

A dismissible card with key onboarding tips:

- "Place ALL parlays provided each day to get the full experience -- the system is designed around volume"
- "Join the Telegram bot for real-time alerts" (with link)
- "Check the Performance Calendar daily to track your results"
- "Parlays are generated fresh each morning -- don't miss a day"

The card will be dismissible via localStorage so returning users don't see it every time (key: `bot-welcome-dismissed`). It will always show when `?success=true` is in the URL (fresh signup).

### Design
- Gradient border card with a lightbulb or info icon
- Compact, mobile-friendly layout with tips as a bulleted list
- "Got it" dismiss button at the bottom
- Matches existing dark theme styling (bg-card, border-border)

### Changes Summary

| File | Change |
|------|--------|
| `src/components/bot-landing/WelcomeTipsCard.tsx` | New component with tips list and dismiss logic |
| `src/pages/BotLanding.tsx` | Import and render `WelcomeTipsCard` when user has bot access |

