

## Free Homepage Analyzer with $20 Advanced Upgrade

### Overview
Add an inline parlay analyzer directly on the homepage that works without sign-up. Users enter or upload their parlay, get instant free analysis (probability, basic leg breakdown, risk label), then see a paywall to unlock advanced features like AI swap suggestions and our picks for $20 (one-time payment).

### User Flow

```text
Homepage
  |
  v
[Inline Parlay Input] -- paste/upload slip or type legs manually
  |
  v
[Free Analysis] -- runs extract-parlay + basic simulation
  - Win probability %
  - Leg breakdown with implied odds
  - Risk label (Degen / Risky / Solid)
  - Basic verdict ("3 of 5 legs look strong")
  |
  v
[Blurred/Locked Premium Section] -- $20 one-time unlock
  - AI-powered leg-by-leg analysis (analyze-parlay engine)
  - Smart Swap suggestions (find-swap-alternatives engine)
  - Our picks to replace weak legs
  - Trap detection
  - Fatigue impact
```

### What Runs Free (No Auth)
- **Client-side only**: `simulateParlay()` -- calculates combined probability, EV, risk label
- **extract-parlay** edge function (already exists) -- OCR from screenshot to structured legs
- No database writes, no user tracking needed

### What's Behind the $20 Paywall
- **analyze-parlay** -- AI leg-by-leg analysis with confidence scores
- **find-swap-alternatives** -- suggests better picks from our data
- Trap detection, fatigue, coaching insights
- Essentially the full Results page experience

### Implementation

**1. New Stripe Product: "Advanced Parlay Analysis" -- $20 one-time**
- Create via Stripe tools (product + price)
- One-time payment, not subscription

**2. New file: `src/components/home/HomepageAnalyzer.tsx`**
- Compact inline card on homepage
- Two input modes: screenshot upload OR manual leg entry (2-3 fields)
- Uses `extract-parlay` for OCR (no auth required -- function already works without JWT)
- Runs `simulateParlay()` client-side for free results
- Shows free tier results: probability donut, risk label, basic leg list
- Below free results: locked "Advanced Analysis" section with blur overlay
- CTA button: "Unlock Full Analysis -- $20" triggers checkout

**3. New edge function: `supabase/functions/create-analysis-checkout/index.ts`**
- Creates a Stripe checkout session for the $20 one-time payment
- Does NOT require auth (guest checkout via email on Stripe)
- Stores the parlay legs in session metadata so we can deliver results after payment
- Success URL returns to homepage with `?analysis_paid=true&session_id=xxx`

**4. New edge function: `supabase/functions/verify-analysis-payment/index.ts`**
- Called after redirect from Stripe
- Verifies the checkout session is paid
- Returns the session metadata (parlay legs) so we can run the advanced engines
- Runs `analyze-parlay` logic inline and returns the full analysis

**5. Update: `src/pages/Index.tsx`**
- Add `<HomepageAnalyzer />` component between the main CTA and the Slate Controls
- On `?analysis_paid=true`, auto-expand the analyzer with full results unlocked

**6. Update: `supabase/config.toml`**
- Add `create-analysis-checkout` and `verify-analysis-payment` with `verify_jwt = false` (guest access)

### Pricing Setup
| Product | Price | Type |
|---|---|---|
| Advanced Parlay Analysis | $20.00 | One-time payment |

### Technical Details

- The free analyzer is 100% usable without an account -- no auth gates
- Screenshot upload calls `extract-parlay` directly via `supabase.functions.invoke()` with just the anon key
- Client-side `simulateParlay()` handles all free math (no edge function needed)
- The $20 checkout uses Stripe's built-in email collection for guest users
- After payment, the advanced results render inline on the homepage (no navigation to /results)
- Session metadata preserves the parlay so results survive the Stripe redirect

### Files Changed

| File | Action |
|---|---|
| `src/components/home/HomepageAnalyzer.tsx` | Create -- inline analyzer with free/paid tiers |
| `supabase/functions/create-analysis-checkout/index.ts` | Create -- guest Stripe checkout for $20 |
| `supabase/functions/verify-analysis-payment/index.ts` | Create -- verify payment + run advanced analysis |
| `src/pages/Index.tsx` | Update -- add HomepageAnalyzer component |
| `supabase/config.toml` | Update -- add new functions with verify_jwt = false |
