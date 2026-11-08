# Automatic v6 minutes trial activation

## What changes
- Save pregame minutes forecasts during the existing 8 AM research update, using the same minutes formula as the desk. No new schedule, AI call, or paid feed.
- Finish a slate promptly when a player did not play: once that team's game is final, exclude the missing forecast instead of holding the whole slate open for three days.
- Keep the existing accuracy gate: the latest three completed slates must average no more than two minutes of absolute error. V5 stays the default; v6 activates only as a tracked shadow model.
- When the gate passes, save v5 and v6 pregame picks and show matching player/stat picks side by side, with same-slate wins, losses, pushes, and units.

## Technical work
- Add a shared server-side minutes snapshot helper and call it after lines and injuries sync in `research-daily`.
- Update minutes grading to use completed ESPN games for immediate DNP/missing-player exclusion.
- Refine `MinutesComparison` so activation is automatic from the saved record and comparisons are paired by player and stat.
- Add at least five independent tests for each new pipeline/helper behavior; preserve historical pick records.
- Deploy the two affected functions, run the focused tests, and verify the trial status and comparison layout on mobile.

## Current trial status
- November 7 has 55 graded forecasts averaging 4.68 minutes of error, plus one unresolved forecast.
- November 8 has 81 open forecasts.
- V6 will not be forced on if the three-slate average remains above two minutes.
