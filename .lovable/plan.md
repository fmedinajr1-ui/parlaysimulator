

## Remove Welcome Tips Card from Homepage

The "Welcome Tips" card currently shows on the Bot Landing page (which is the `/` route). It will be removed.

### Changes

**File: `src/pages/BotLanding.tsx`**
- Remove the `WelcomeTipsCard` import (line 15)
- Remove the `WelcomeTipsCard` rendering block (lines 132-134)

**File: `src/components/bot-landing/WelcomeTipsCard.tsx`**
- Delete this file entirely since it's no longer used anywhere

