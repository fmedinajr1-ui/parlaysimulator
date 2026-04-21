

## Rebuild homepage to ParlayFarm spec — Option C, free tier with $0 SetupIntent card verification

Building the new homepage to the master prompt, creating fresh Stripe products at the spec prices, retiring Scout from the homepage, and verifying a card at signup for **all three tiers**.

### Pricing & Stripe products (newly created)

| Tier | Price | Trial | Card verification |
|---|---|---|---|
| 🐶 The Pup | **Free** | n/a | Stripe Checkout in `mode: setup` ($0 SetupIntent — card saved, not charged) |
| 🐕 Top Dog ⭐ | **$29.99/mo** | 7-day free trial | Stripe Checkout subscription + $50 auth hold |
| 🏆 Kennel Club | **$99/mo** | 3-day free trial | Stripe Checkout subscription + $50 auth hold |

Three new Stripe products created at $0 / $29.99 / $99. Legacy $99 Parlay Bot and $750 Scout products stay live in Stripe for existing subscribers but are removed from the homepage.

### Homepage sections (in order)

1. **Sticky Nav** — dog-mark logo + "ParlayFarm 🐕", links (Sharp Tracker / The Farm / Pricing), green "Join the Farm" CTA
2. **Hero** — drifting orbs, crop-row grid, H1 "The farm where *underdogs become top dogs* 🐕", 3 CTAs, 4-stat strip, infinite ticker
3. **How the Farm Runs** — 3 cards (Drop slip / AI sniffs / Verdict)
4. **Sharp Tracker** — 4 seeded rows, animated split bars, "Tail" → "✓ Tailed"
5. **Live AI Demo** — `<SlipCard>` + `<VerdictCard>` with the spec's 5 legs / 3 signals, auto-runs on scroll
6. **Why the Farm Works** — 6-card grid
7. **Top Dog Reel** — full-bleed infinite horizontal scroll
8. **Free Slip Upload** — dropzone + email, writes to `leads` table
9. **Pricing** — Pup / Top Dog ⭐ / Kennel Club, all three collect a card
10. **Final CTA** + **Footer** with 21+ / 1-800-GAMBLER
11. **Sticky mobile bar** — Free Slip / Join the Farm

### Subscription wiring

- **Top Dog & Kennel Club** → existing `create-bot-checkout` updated to accept the new price IDs, keeps $50 auth hold + trial behavior already shipping today
- **Pup (Free)** → new edge function `create-free-signup` runs Stripe Checkout in `mode: setup` (card saved, $0 charged), then writes the user record with `plan = 'pup'`
- All three CTAs share one inline email-capture modal → Stripe Checkout in a new tab → success → `/bot-success`

### What stays vs. moves

- Current homepage tools (DailyParlayHub, SweetSpotPicks, WeeklyHistory, Elite3PT, etc.) → moved intact to **`/dashboard`**, linked from the nav as "The Farm". Nothing deleted.
- Existing `customer-portal` keeps managing both legacy and new subscriptions

### Out of scope (separate tickets)

- Live `sharp_signals` data + pg_cron refresh — table seeded with the 4 hardcoded spec rows
- Real Claude prompt for `analyze-slip` — upload writes to `leads`, shows success state
- `/b` route + `ab_views` analytics
- Resend domain verification, OG cards, favicon swap, Lighthouse pass

### Technical execution

- **Stripe**: 3 new products via `stripe--create_stripe_product_and_price` (Pup $0, Top Dog $29.99, Kennel Club $99, all monthly recurring)
- **New edge function**: `create-free-signup` (Stripe Checkout `mode: setup`, $0 SetupIntent, customer + user row)
- **Updated edge function**: `create-bot-checkout` accepts new Top Dog / Kennel Club price IDs alongside legacy IDs (no breaking change)
- **DB migrations**: `leads` table (anon insert RLS), `sharp_signals` table (anon read RLS, seeded with 4 spec rows), add `plan` column on users (`pup` | `top_dog` | `kennel_club`)
- **New components** under `src/components/farm/`: `FarmNav`, `FarmHero`, `Steps`, `SharpTracker`, `SlipDemo`, `VerdictCard`, `FeatureGrid`, `TopDogReel`, `UploadForm`, `FarmPricing`, `FinalCTA`, `FarmFooter`, `StickyMobileBar`, `EmailCaptureModal`
- **Tailwind/CSS**: extend `index.css` with `--farm-bg #060806`, `--farm-panel #0b0f0b`, `--sharp-green #22ff9a`, `--trap-red #ef233c`, `--barn-amber #ffb020`; add Space Grotesk + Inter via Google Fonts
- **Routing**: `src/pages/Index.tsx` becomes thin section composition; legacy content moves to `src/pages/Dashboard.tsx` (route `/dashboard`)
- **Accessibility**: `prefers-reduced-motion` disables ticker, scan beam, orb drift, reel

