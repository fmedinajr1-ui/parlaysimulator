
## Rebuild Sweet Spots as a scanner-aware ranking layer, not a separate gated silo

### What will change

You’re right: Sweet Spots should not behave like an isolated model. They need to work cohesively with the live book scanners so the system is using the same line truth, freshness rules, drift checks, and bookmaker priorities everywhere.

Right now the codebase has a split:
- `nba-player-prop-risk-engine` writes Sweet Spot-style picks into `category_sweet_spots`
- `useDeepSweetSpots` rebuilds another Sweet Spot slate directly from `unified_props`
- parlay/scanner systems already use book-aware rules like bookmaker priority, freshness, `is_active`, and line-drift gates

That means Sweet Spots can feel disconnected from what the scanners consider valid.

### Implementation plan

#### 1. Make Sweet Spots consume the same scanner truth model
I’ll align Sweet Spots with the live odds/scanner layer so they use the same core inputs and rules:
- active lines from `unified_props`
- bookmaker-awareness (`fanduel`, `draftkings`, `betmgm`, etc.)
- freshness using `odds_updated_at` / `updated_at`
- line-drift awareness
- side-specific price availability (`over_price` / `under_price`)

This makes Sweet Spots a ranked overlay on top of scanner-verified book data instead of an independent funnel.

#### 2. Introduce scanner-aware Sweet Spot eligibility tiers
Instead of one hard “approved or rejected” Sweet Spot gate, I’ll move to scanner-aware tiers:

```text
Core
- active preferred-book line
- fresh odds
- low drift
- strongest stat/profile score

Aggressive
- active line still available
- fresh enough, but weaker score or more drift
- still usable, just ranked lower

Watch
- scanner sees the prop, but line moved / weaker stat case / stale-ish context
- visible for monitoring, not premium placement
```

This keeps cohesion with scanners while still giving you more volume.

#### 3. Keep only the scanner protections that must remain hard
These should stay as hard blocks because they are book-integrity issues:
- no active book line
- no price on the chosen side
- no usable `current_line`
- extremely stale odds
- severe line drift from the recommended number
- broken prop mapping / unsupported market

This preserves market truth.

#### 4. Soften the stat-side Sweet Spot gates into ranking penalties
These are the parts that should become softer so Sweet Spots stay broad:
- L10 floor
- reliability tier
- some confidence minimums
- some prop-specific edge thresholds
- some context mismatches

Instead of disappearing, these picks drop from Core to Aggressive or Watch.

That gives you “less gates” while still honoring scanner validity.

#### 5. Refactor `useDeepSweetSpots` to become scanner-cohesive
`useDeepSweetSpots` already builds off `unified_props`, which is the right direction. I’ll tighten its relationship to scanners by:
- adding bookmaker preference logic similar to parlay engine behavior
- scoring based on freshest preferred available line, not just any FanDuel row
- exposing line freshness and drift status in the spot metadata
- reducing silent skips and replacing them with tier downgrades
- preserving multi-book context where available for ranking and UI display

This will make the Sweet Spots page feel like an extension of the scanner ecosystem.

#### 6. Bring homepage Sweet Spots in line with scanner-backed ranking
`SweetSpotPicksCard` is currently too restrictive and only shows a thin subset. I’ll update it so it:
- prioritizes scanner-valid Core picks first
- includes Aggressive picks when Core supply is thin
- shows why a pick is downgraded instead of hiding it
- uses broader but still book-aware visibility rules

Result: more live picks, but still tied to real book availability.

#### 7. Make Sweet Spot output reusable by book-scanner-powered engines
I’ll make sure the widened Sweet Spot layer can feed cleanly into:
- Sweet Spot parlay builder
- Heat/line movement workflows
- scanner-based live monitoring
- downstream ranking components

That means normalizing shared fields like:
- selected bookmaker
- line freshness
- drift from original line
- quality tier
- scanner status

So every downstream system reads the same truth instead of reinventing it.

#### 8. Add shared scanner metadata to Sweet Spot objects
I’ll extend the Sweet Spot shape so each pick can carry book-aware metadata such as:
- `selectedBook`
- `lineFreshness`
- `lineDrift`
- `hasActiveBookLine`
- `marketStatus`
- `tierReason`

This lets the UI and builders explain why a pick is Core vs Aggressive vs Watch.

#### 9. Preserve parlay/scanner consistency with existing market rules
The parlay engine already uses:
- `BOOKMAKER_PRIORITY`
- `MAX_BOOK_LINE_AGE_MIN`
- `MAX_LINE_DRIFT`
- active line checks

I’ll mirror those rules in the Sweet Spot path so Sweet Spots do not recommend props the scanner/parlay layer would later reject.

This is the key cohesion fix.

### Files likely involved

- `src/hooks/useDeepSweetSpots.ts`
- `src/types/sweetSpot.ts`
- `src/components/market/SweetSpotPicksCard.tsx`
- `src/pages/SweetSpots.tsx`
- `src/hooks/useSweetSpotParlayBuilder.ts`
- `supabase/functions/nba-player-prop-risk-engine/index.ts`
- possibly shared scanner-aligned constants/utilities extracted from existing book-aware logic

### Technical details

#### Current cohesion gap
- `useDeepSweetSpots` currently reads only FanDuel rows from `unified_props`
- parlay engine already has explicit bookmaker priority + freshness + drift logic
- backend Sweet Spot generation is stricter on statistical gates than on scanner alignment
- homepage Sweet Spots hide too many valid scanner-supported candidates

#### New design direction
Sweet Spots become:
- scanner-verified first
- statistically ranked second
- tiered instead of binary
- reusable by builders and live tracking

#### Core rule
```text
If the scanner would reject the market as invalid, Sweet Spots should not surface it as a premium pick.
If the scanner accepts the market but the stats are weaker, downgrade it instead of deleting it.
```

### Verification after implementation

1. Sweet Spot picks always map to active scanner-visible book lines.
2. Picks shown on homepage and Sweet Spots page align with current market availability.
3. Core/Aggressive/Watch counts increase without surfacing broken or stale lines.
4. Sweet Spot parlay builder can use the broader pool without fighting the scanner truth model.
5. Picks rejected by scanner-level market rules do not leak into premium Sweet Spot surfaces.
6. UI clearly explains whether a pick is downgraded due to drift, freshness, or weaker statistical quality.

### Expected outcome

After this change:
- Sweet Spots will feel like part of the live book scanner system, not a disconnected side engine
- more picks will surface because stat gates are softer
- book integrity stays protected because scanner rules remain hard
- homepage, Sweet Spots page, and parlay builder will all use the same market truth
- the system will be broader, faster, and much more coherent
