

## Add Help Tooltips to Every War Room Metric

### Overview
Wrap each metric label and badge across all War Room components with the existing `Tooltip` component so users can tap/hover to see a plain-English explanation of what it means -- without leaving the page.

### Metrics to Annotate

**WarRoomPropCard.tsx** (7 tooltips)
- **Fatigue Ring** -- already has a tooltip (no change needed)
- **Edge Score badge** (e.g., +3.2%) -- "Your estimated advantage over the book's implied odds. Positive = value bet."
- **Regression badge** (snowflake/flame) -- "Probability this player reverts to their average. Cold = due for a dip, Hot = due to cool off."
- **Hedge lightning bolt** -- "A hedge opportunity is available for this prop. Check the alerts panel."
- **Win prob** -- "Model's estimated chance this pick wins based on live game flow and projections."
- **Proj (projected final)** -- "AI projection of the player's final stat line based on current pace and game context."
- **Pace %** -- "How fast this game is being played compared to league average. Positive = more possessions = more stats."
- **AI confidence %** -- "Overall confidence score combining pace, matchup, fatigue, and regression factors."
- **L10 hit rate** -- "How often this player has cleared this line in their last 10 games."

**HedgeModeTable.tsx** (6 tooltips on column headers)
- **Now** -- "Player's current stat total in this game."
- **Need** -- "The line the player needs to hit for the bet to cash."
- **Progress** -- "Visual tracker: how close the player is to clearing the line."
- **Projected** -- "AI estimate of the player's final stat line."
- **Gap** -- "Difference between projected final and the line. Positive = on track, negative = behind."
- **Action** -- "Suggested action: LOCK (strong hold), HOLD (on pace), MONITOR (close), EXIT (consider hedging)."
- **Survival %** -- "Estimated chance your entire parlay survives based on current progress across all legs."

**AdvancedMetricsPanel.tsx** (4 tooltips on metric labels)
- **Monte Carlo Win %** -- "Win probability from 10,000 simulated game outcomes. More reliable than single-point estimates."
- **Blowout Risk** -- "Chance the game becomes a blowout, which reduces playing time for starters and hurts props."
- **Fatigue Impact** -- "Average fatigue across your prop players. Higher fatigue = lower efficiency and stat output."
- **Regression Probability** -- "Average likelihood that players in your picks revert to their mean performance."

**HedgeSlideIn.tsx** (3 tooltips)
- **Kelly %** -- "Kelly Criterion bet sizing: the mathematically optimal percentage of your bankroll to wager."
- **Projection** -- "AI's projected final stat for this player based on current pace."
- **Smart bookmaker tag** -- "The sportsbook offering the best line for this recommendation."

### Technical Approach

All tooltips use the existing `Tooltip`, `TooltipTrigger`, `TooltipContent`, and `TooltipProvider` from `@/components/ui/tooltip` (already used in `FatigueRing.tsx`).

Each metric label/badge gets wrapped like:
```tsx
<TooltipProvider>
  <Tooltip>
    <TooltipTrigger asChild>
      <span className="...existing classes... cursor-help border-b border-dotted border-muted-foreground/30">
        Pace:
      </span>
    </TooltipTrigger>
    <TooltipContent side="top" className="max-w-[200px] text-xs">
      How fast this game is being played vs league average.
    </TooltipContent>
  </Tooltip>
</TooltipProvider>
```

A subtle `border-dotted` underline on labels signals they're tappable/hoverable for help.

### Files Modified

| File | Changes |
|------|---------|
| `WarRoomPropCard.tsx` | Wrap 7 metric elements with Tooltip |
| `HedgeModeTable.tsx` | Wrap 7 column headers + survival badge with Tooltip |
| `AdvancedMetricsPanel.tsx` | Wrap 4 metric labels with Tooltip |
| `HedgeSlideIn.tsx` | Wrap 3 data labels with Tooltip |

**4 files modified. No database changes. No new dependencies.**

