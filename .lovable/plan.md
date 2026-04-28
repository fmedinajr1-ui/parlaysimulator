# Add Example Slips Carousel to Free Slip Upload Section

Add a swipeable carousel of real-feel example slips (with verdict tier badges, grade scores, and the "killer leg" call-out) directly above the upload form on the Home page. This lets visitors *feel* the value of the analyzer before committing to upload their own slip.

## What the user will see

Right above the "Drop your parlay" upload card on the Home page, a new **"Real verdicts. Real slips."** section appears with a horizontally swipeable carousel of 5 example slip cards across different sports. Each card shows:

- **Sport badge** (NBA / MLB / NHL / NFL / Tennis) with sport emoji
- **Verdict tier ribbon**: 💎 LOCK, 🔥 HEAT, ⚖️ COIN FLIP, ⚠️ RISKY, or 💀 COOKED — color-coded
- **Grade score** (e.g. "92/100") with a circular progress ring
- **2–4 leg preview** (player + line + over/under) with each leg color-dotted green/yellow/red based on individual hit probability
- **AI verdict line** — short punchy call (e.g. "Leg 3 (Tatum O27.5) misses 71% of sims — swap to O24.5 for +18% EV")
- **"Killer leg" highlight** when applicable, with a subtle red glow on that leg row

The carousel is swipeable on mobile (touch gestures via Embla), shows snap-pagination dots, and has arrow buttons on desktop. Auto-advances every ~5s with pause-on-hover.

A small caption under the carousel: *"This is what your verdict looks like — drop yours below 👇"* with a soft arrow pointing to the upload card.

## Where it goes

In `src/components/farm/UploadForm.tsx`, between the heading block (ending around line 85) and the `done`/form conditional (starting line 87). The carousel sits inside the same `max-w-3xl` container so it lines up with the form.

## Technical implementation

**1. New component: `src/components/farm/ExampleSlipsCarousel.tsx`**
- Use `embla-carousel-react` (already in the project — see `src/components/ExampleCarousel.tsx` for the existing pattern to copy).
- Add `embla-carousel-autoplay` plugin for auto-advance (already a transitive dep via embla; if not, fall back to a `setInterval` calling `emblaApi.scrollNext()`).
- Pure presentational, no data fetching — example slips are a hardcoded constant array typed as `ExampleSlip[]`.

**2. New helper file: `src/components/farm/exampleSlipsData.ts`**
Export 5 example slips covering NBA, MLB, NHL, NFL, and Tennis, each with realistic player/line data, a verdict tier, grade score, killer-leg index, and a 1-line AI verdict. Tiers map to colors:
- `lock` → green (`--sharp-green`)
- `heat` → orange
- `coin_flip` → yellow
- `risky` → amber-red
- `cooked` → red

**3. Sub-component: `ExampleSlipCard`** (inside the carousel file)
- Card uses the existing `farm-panel` class for visual consistency.
- Verdict ribbon styled like the existing "100% Free Verdict" ribbon in `UploadForm.tsx`.
- Grade ring built with a small inline SVG (no extra deps).
- Each leg row: dot + player name + line + odds, with red-glow ring when `index === killerLegIndex`.

**4. Wire into `UploadForm.tsx`**
- Import `ExampleSlipsCarousel`.
- Render it after the social-proof row (after line 85), before the `done` ternary (line 87).
- Wrap with a small section heading: "Real verdicts. Real slips. 🎯".

## Layout sketch

```text
┌──────────────────────────────────────────┐
│   Is your slip cooked or a lock?         │  (existing heading)
│   12,400+ slips graded · ★★★★★ 4.9       │
├──────────────────────────────────────────┤
│   Real verdicts. Real slips. 🎯          │  (new)
│   ┌────────┐  ┌────────┐  ┌────────┐    │
│   │ 💎LOCK │  │🔥 HEAT │  │💀COOKED│ →  │  (swipeable)
│   │ 92/100 │  │ 78/100 │  │ 31/100 │    │
│   │ NBA    │  │ MLB    │  │ NFL    │    │
│   │ 4 legs │  │ 3 legs │  │ 5 legs │    │
│   └────────┘  └────────┘  └────────┘    │
│   • • ● • •                              │  (dots)
│   "This is what your verdict looks like" │
├──────────────────────────────────────────┤
│   [ Existing upload form card ]          │
└──────────────────────────────────────────┘
```

## Out of scope

- No backend / no database changes — purely static example data.
- No real OCR or live grading on the carousel cards.
- Does not modify the actual analyzer flow.
