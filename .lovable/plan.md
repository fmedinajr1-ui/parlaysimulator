
Implement a new Sweet Spot-backed parlay builder flow that starts from the widest scanner-ranked Sweet Spot slate, then recommends the safest 2-, 3-, and 4-leg combinations by ranking rather than by stacking more hard filters.

### What will change

#### 1. Reposition the builder around the Sweet Spot ranked slate
The current builder still pulls from older category/risk-engine sources and then applies multiple hard rejections:
- H2H blocks
- winning-pattern blocks
- minimum-edge hard blocks
- fixed category-formula quotas
- fixed 6-leg target

I’ll refactor it so the primary input is the scanner-aware Sweet Spot slate from the same ranking logic already used by the Sweet Spots experience:
- widest eligible slate first
- market-aware ordering first
- softer downgrade logic preserved
- safest combinations selected from the ranked pool

#### 2. Add a “widest ranked slate” intake mode
The builder will load candidates in this order:
1. active scanner-valid Sweet Spots first
2. then stale/scanning-but-still-usable Sweet Spots if needed
3. exclude only true off-market/broken entries

That means the intake becomes:
```text
Load broad ranked slate
→ keep all scanner-valid candidates
→ do not re-kill picks for weaker stats
→ rank and recommend safest combinations
```

#### 3. Replace fixed 6-leg formula building with 2–4 leg recommendation packs
Instead of one formula-driven 6-leg Dream Team, the builder will generate:
- safest 2-leg
- safest 3-leg
- safest 4-leg

These will be auto-recommended from the same ranked pool, so you can immediately use the safest compact combinations instead of forcing a larger slip.

#### 4. Remove secondary hard rejection layers from final recommendation
The current core builder blocks too much after picks are already admitted:
- H2H rejection
- pattern rejection
- minimum projection/edge rejection
- category formula enforcement

I’ll change those from binary rejection to ranking penalties or informational metadata, except for true structural blockers:
- off-market / no valid line
- exact opposite-side same-player conflict
- duplicate player leg collision
- clearly broken data row

Everything else becomes score impact, not elimination.

#### 5. Score for safety instead of gatekeeping
The recommendation engine will compute a “safest parlay” score from the ranked slate using:
- Sweet Spot score
- quality tier
- market status/freshness
- line drift
- confidence score
- L10 hit rate when present
- mild correlation/synergy effects
- diversity across players/teams when helpful

This keeps the selection intelligent without deleting half the slate.

#### 6. Add a builder mode/funnel option
The new builder should follow the same Sweet Spot funnel language already used elsewhere:
- Core: tighter recommended combos from active premium-quality candidates
- Aggressive: broader ranked pool with fallback scanner-valid candidates

This keeps the parlay builder aligned with the Core vs Aggressive Sweet Spot experience instead of inventing another hidden funnel.

#### 7. Update the UI to show the new recommendation structure
The current `SweetSpotDreamTeamParlay` UI is framed as one “Optimal Parlay” and assumes a larger fixed build. I’ll update it to show:
- safest 2-leg card
- safest 3-leg card
- safest 4-leg card
- active funnel badge (Core or Aggressive)
- why a combo is recommended
- wider-slate count / candidate pool count

The add-to-builder action will work per recommendation, not only as one monolithic build.

#### 8. Preserve explanations instead of silent filtering
For each recommended combo, the UI will explain why it floated to the top:
- fresh active book
- high Sweet Spot score
- strong L10 support
- low drift
- low internal conflict
- downgraded but still viable if in Aggressive mode

That way weaker candidates are visible as lower-ranked, not mysteriously absent.

### Files to update

- `src/hooks/useSweetSpotParlayBuilder.ts`
  - refactor intake source toward ranked Sweet Spot pool
  - add funnel-aware candidate selection
  - generate safest 2/3/4-leg recommendations
  - replace hard filters with score penalties where possible
- `src/components/market/SweetSpotDreamTeamParlay.tsx`
  - redesign from one fixed parlay into recommended 2–4 leg packs
  - add funnel indicator and add-to-builder per pack
- `src/hooks/useDailyParlays.ts`
  - adapt any consumers expecting only one `optimalParlay`
- `src/hooks/useSweetSpotParlayBuilder.test.ts`
  - rewrite/add tests for ranked-slate intake and 2/3/4-leg outputs
- possibly `src/types/sweetSpot.ts`
  - only if a shared recommendation/metadata type is needed

### Technical design

#### New builder shape
Instead of:
```text
fetch mixed sources
→ hard reject heavily
→ force formula categories
→ fill to 6 legs
```

It will become:
```text
fetch broad Sweet Spot ranked slate
→ keep scanner-valid candidates
→ apply soft safety scoring
→ build best 2-leg, 3-leg, 4-leg recommendations
```

#### Hard blocks that should remain
Only keep truly necessary blockers:
- off-market candidate
- missing selected line / broken line row
- duplicate exact leg
- same-player opposite-side conflict
- impossible combination state

#### Soft penalties instead of blocks
These become score reductions:
- weaker H2H
- weaker L10
- stale/scanning status
- lower confidence
- drift
- weaker pattern fit
- thinner projection support

#### Output contract
The hook should return something like:
- `recommendedParlays.twoLeg`
- `recommendedParlays.threeLeg`
- `recommendedParlays.fourLeg`
- `candidatePool`
- `funnelMode`
- `poolStats`

This will make the UI simpler and keep downstream consumers explicit.

### Verification

1. Core mode recommends 2-, 3-, and 4-leg combos from the tightest active Sweet Spot pool.
2. Aggressive mode widens the candidate pool without collapsing into empty results.
3. Picks no longer disappear because of extra H2H/pattern/edge kill gates.
4. Off-market and broken-line candidates still stay out.
5. Add-to-builder works for each recommended combo.
6. Tests cover deterministic output for ranked intake and combo sizes 2/3/4.

### Expected outcome

After this change:
- the builder will start from the widest valid Sweet Spot slate
- you’ll get instant safest 2–4 leg recommendations
- stronger picks rise by score instead of weaker picks getting hard-killed
- Core and Aggressive behavior will stay aligned with the Sweet Spot funnel
- the parlay builder will feel much broader, faster, and more usable
