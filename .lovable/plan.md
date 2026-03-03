

## Plan: Fix Branding in Lottery Card Generation

The previous plan referenced "PARLAY BOT" and "parlaysimulator.com" branding. This update ensures the new `generate-lottery-cards` edge function uses:

- **Logo/Brand**: "PARLAY FARM" with the 🔥 emoji (matching `ShareableImageCard` footer)
- **URL**: `parlayfarm.com` (not parlaysimulator)
- **Logo asset**: Reference `ParlayFarmLogo` / `/parlay-farm-logo.png` in the image prompt

### File: `supabase/functions/generate-lottery-cards/index.ts` (new)

When constructing the AI image generation prompt for each lottery card:
- Footer text: `🔥 PARLAY FARM` on the left, `parlayfarm.com` on the right
- Card header badge: "PARLAY FARM" branding instead of "PARLAY BOT"
- Caption text sent with Telegram photo: include "parlayfarm.com"

This is a single branding correction applied during implementation of the lottery card generator — no additional files or logic changes needed beyond what was already planned.

