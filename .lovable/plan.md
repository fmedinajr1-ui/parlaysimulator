

# Fix Settlement for Team News Shift & Correlated Movement Signals

## Root Causes

**1. `predicted_direction` is empty on insert** (behavior-analyzer line 1533)
The insert uses `a.direction` but these signals store direction as `a.dominant_direction`. So `predicted_direction` is always null.

**2. No settlement handler** (accuracy-feedback)
The settlement engine has handlers for velocity_spike, line_about_to_move, cascade, take_it_now, snapback, perfect_line, etc. — but nothing for `team_news_shift` or `correlated_movement`. These signals are fetched as unverified but silently skipped.

**3. `prediction` text says "Unknown signal" for correlated_movement** (behavior-analyzer)
The correlated_movement prediction text IS being built correctly on line 1496-1499, but the DB shows "Unknown signal" for some older entries — likely from before that code was added. Current inserts should be fine.

## Fixes

### A. Fix `predicted_direction` on insert (behavior-analyzer, line 1533)

Change:
```
predicted_direction: a.direction || (a.type === "snapback" ? "revert" : null)
```
To:
```
predicted_direction: a.direction || a.dominant_direction || (a.type === "snapback" ? "revert" : null)
```

This ensures team_news_shift and correlated_movement signals get their `dominant_direction` (e.g., "rising", "dropping") stored.

### B. Add settlement handler (accuracy-feedback, after the snapback block ~line 395)

Add a new block for these aggregate signals. Settlement logic:

- **Player prop correlations** (prop_type starts with "player_"): Check if the individual players' lines continued moving in the predicted direction. Look up each player from `signal_factors.players_moving` in `fanduel_line_timeline`, check if their closing line moved in the dominant direction vs their line at signal time.
- **Derived totals**: Check if game total line moved in the predicted direction (OVER = line rose, UNDER = line dropped). Use `fanduel_line_timeline` with the event's totals prop.
- **Derived moneyline**: Check if the moneyline moved in the predicted direction using the same CLV approach.

```
if (pred.signal_type === "team_news_shift" || pred.signal_type === "correlated_movement") {
  const sf = pred.signal_factors || {};
  const players = sf.players_moving || [];
  const dominant = sf.dominant_direction || pred.predicted_direction;
  
  if (players.length > 0 && dominant) {
    // For player prop aggregates: check if majority of individual players' lines moved correctly
    let hitsCount = 0;
    for (const p of players) {
      const pTimeline = timeline.filter(t => t.player_name === p.name && t.prop_type === pred.prop_type);
      if (pTimeline.length >= 2) {
        const close = pTimeline[0].line;
        const open = pTimeline[pTimeline.length - 1].line;
        if (dominant === "dropping" && close < open) hitsCount++;
        if (dominant === "rising" && close > open) hitsCount++;
      }
    }
    const hitRate = hitsCount / players.length;
    wasCorrect = hitRate >= 0.5; // majority moved correctly
    actualOutcome = wasCorrect 
      ? `CORRELATION_CONFIRMED (${hitsCount}/${players.length})` 
      : `CORRELATION_MISSED (${hitsCount}/${players.length})`;
  } else if (pred.prop_type === "totals" || pred.prop_type === "moneyline") {
    // Derived team market: use CLV on the game line
    const predText = (pred.prediction || "").toUpperCase();
    const isOver = predText.includes("OVER") || predText.includes("BACK");
    const isUnder = predText.includes("UNDER") || predText.includes("FADE");
    const sigLine = sf.current_line ?? sf.line ?? pred.line_at_alert;
    if (sigLine != null && closingLine != null) {
      if (isOver) { wasCorrect = closingLine >= sigLine; actualOutcome = wasCorrect ? "CLV_POSITIVE_OVER" : "CLV_NEGATIVE_OVER"; }
      else if (isUnder) { wasCorrect = closingLine <= sigLine; actualOutcome = wasCorrect ? "CLV_POSITIVE_UNDER" : "CLV_NEGATIVE_UNDER"; }
    }
  }
}
```

### C. Backfill existing records

Update the 11 existing unsettled records to populate `predicted_direction` from their `signal_factors->>'dominant_direction'` field, so the settlement engine can process them on next run.

## Scope
- 1 edge function edited (`fanduel-behavior-analyzer`) — 1 line change
- 1 edge function edited (`fanduel-accuracy-feedback`) — new settlement block
- 1 data update (backfill predicted_direction on existing records)

