

## Add ParlayFarm logo to the homepage header

Replace the emoji + text wordmark in `FarmNav` with the actual `ParlayFarmLogo` component so the brand logo shows in the sticky header on every page that uses the farm theme.

### Changes

- **`src/components/farm/FarmNav.tsx`**: swap the current `<a href="#top">` block (which renders a green 🐕 circle + "ParlayFarm" text) for `<ParlayFarmLogo size="sm" />` wrapped in the same anchor. Keep the link target, spacing, and nav layout identical.
- Logo sits on the left, nav links stay centered/right, "Join the Farm" CTA stays on the far right. On mobile (current 402px viewport) the logo stays visible since the link row is already `hidden md:flex`.

### Out of scope

- No changes to `StickyMobileBar`, hero, or footer branding
- No new logo asset — reuses the existing `/parlay-farm-logo.png` already served by `ParlayFarmLogo`

