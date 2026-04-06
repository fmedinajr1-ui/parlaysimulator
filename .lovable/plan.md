

# Fix MLB Moneyline Labels + Add Team Quality Context

## Problems (from screenshot)

1. **Wrong labels**: Colorado Rockies MONEYLINE says "Action: UNDER 154" and "Line dropping — market signals UNDER". Moneylines don't have OVER/UNDER — should say **TAKE** (back this team) or **FADE** (bet against)
2. **No team quality context**: The bot blindly follows market direction without considering team quality. If a line drops from +168 to +154, that might mean sharp money is on the Rockies — but the Rockies are terrible. Meanwhile, an all-star team or a game with a rookie pitcher on the other side should factor in

## Fix

### A. Relabel Moneyline Alerts: TAKE/FADE instead of OVER/UNDER

In `fanduel-prediction-alerts/index.ts`, at every point where `snapDirection` is used for display on moneyline/h2h props:

- When market is moving **toward** the team (odds getting shorter / more negative) → **TAKE** (market backing this team)
- When market is moving **away** from the team (odds getting longer / more positive) → **FADE** (market moving off this team)

Specifically update:
- **Line 1069-1073**: Non-NBA direction reason text — detect moneyline and use "TAKE/FADE" labels
- **Line 1141**: Action line — change from `OVER/UNDER {line}` to `TAKE/FADE {teamName} ({odds})`
- **Line 927**: Velocity/cascade action line — same TAKE/FADE for moneyline
- **`fdLineBadge` function (line 95-98)**: When prop is moneyline, show odds format properly (no over/under price split)
- **`fmtOdds` usage**: For moneyline action, show the team's odds directly

### B. Add MLB Team Quality Context to Moneyline Decisions

**Problem**: No MLB standings in `team_season_standings` (only NBA/NFL). And no pitcher matchup data available for the game.

**Solution**: Query `mlb_player_game_logs` to build a lightweight MLB team quality signal:
1. Query recent pitcher game logs for the starting pitchers in the matchup (if detectable from the event's player props)
2. Check if any of the team's pitchers have rookie-level innings (low IP avg, high ERA indicators)
3. Add this as context in the Telegram alert and as a gate modifier

**Specifically**:
- Before the Take It Now loop, for MLB moneyline signals, look up which players from each team have active props in the current scan — if a team has pitcher props, extract that pitcher's L10 ERA/K stats
- Add a helper `getMlbMoneylineContext()` that returns:
  - Pitcher quality badge (e.g., "🔥 Ace: 8.2 K/9, 2.1 ERA" or "⚠️ Rookie/Struggling: 4.8 ERA")
  - Team strength estimate from recent game log aggregates
- Factor pitcher quality into confidence: ace pitcher = +10, rookie/struggling = -10
- Show in Telegram: `⚾ SP: Cole (8.2 K/9 L10) vs TBD — pitching edge`

### C. MLB-Specific Moneyline Direction Logic

For MLB moneyline, instead of blind "drift down = UNDER", apply:
- **Line shortening** (e.g., +168 → +154, or -110 → -130): Market backing this team → **TAKE** (unless team is bottom-tier)
- **Line lengthening** (e.g., -130 → -110, or +150 → +180): Market fading → **FADE**
- **Override**: If available pitcher data shows the opposing team has an ace and this team has a struggling pitcher, override to FADE regardless of line movement

### D. Rule Registry

Add `mlb_moneyline_context` rule to `bot_owner_rules`:
- "MLB moneyline uses TAKE/FADE labels. Pitcher quality and team strength factor into direction. Never blindly follow line movement on bottom-tier teams."

## Scope
- 1 edge function modified (`fanduel-prediction-alerts`)
- 1 migration (new rule)
- No new tables — uses existing `mlb_player_game_logs` for pitcher context

