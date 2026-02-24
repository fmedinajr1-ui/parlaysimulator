

## Run Full Parlay Generation Cycle

Invoke `bot-generate-daily-parlays` to generate today's parlays with the new environment score engine and filtered categories active.

### Steps

1. **Invoke `bot-generate-daily-parlays`** with default parameters to trigger a full generation cycle against today's slate.
2. **Review the response** for:
   - `environment_score` appearing in leg breakdowns (replacing old `blowout_pace_score`)
   - No picks from blocked categories (`ELITE_REB_OVER`, `VOLUME_SCORER`)
   - REB/AST props showing non-neutral environment adjustments
3. **Query `bot_daily_parlays`** for today's date to see the generated parlays and their confidence scores.
4. **Report findings** — show which props were picked, their environment scores, and confirm the blocked categories are excluded.

### What to look for

- `environment_score` field populated in parlay leg metadata
- Zero appearances of `ELITE_REB_OVER` or `VOLUME_SCORER` in any generated parlay
- REB and AST props reflecting opponent-specific defensive context rather than neutral 0.5 defaults

