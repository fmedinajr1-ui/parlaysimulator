

# Diagnosis: Bidirectional Scanner — Team-Level vs Player-Level Gap

## What Went Wrong

I checked the actual data in the database. The rank directions are **correct**:

| Team | off_rebounds_rank | opp_rebounds_rank |
|------|-------------------|-------------------|
| WAS  | 2 (2nd best rebounding offense) | 30 (worst rebound defense) |
| UTA  | 30 (worst rebounding offense) | 29 (2nd worst rebound defense) |
| MIA  | 14 | 7 |
| BKN  | 24 | 22 |

The scanner correctly identified that **as a team**, Washington grabs lots of rebounds and Utah's defense allows lots of rebounds. Score = 29.0 (Elite). That's directionally accurate at the **team level**.

**The problem**: The scanner outputs "WAS Rebounds OVER" as a blanket team signal, but the bets were placed on individual bench players (Bub Carrington Over 3.5, Will Riley Over 4.5, Anthony Gill Over 4.5, Bilal Coulibaly Over 3.5) who have low individual usage and rebound ceilings. Same issue with MIA Threes — the scanner said "MIA 3PT Elite" but Bam Adebayo (Over 1.5 Threes) barely shoots 3s.

**The scanner is a team-level environmental signal being misapplied as individual player prop advice.**

## Fix Plan

### 1. Add player-level validation to the broadcast (`nba-matchup-daily-broadcast`)

Before broadcasting a recommendation, cross-reference with `category_sweet_spots` to find **specific players** whose L10 averages actually support the direction:
- For "WAS Rebounds OVER" → only name players whose L10 rebound avg comfortably clears their line
- For "MIA Threes OVER" → only name players who actually shoot 3s (L10 3PM avg > 1.0)
- Skip/warn about players where the team signal doesn't translate individually

### 2. Restructure the broadcast message format

Change from:
```
🔥 WAS Rebounds vs UTA DEF (Score: 29.0) → Target: WAS Rebounds Over
```

To:
```
🔥 WAS vs UTA — Rebounds Environment: ELITE (29.0)
  🏀 Team Signal: WAS should dominate boards
  ✅ Player Targets: [only players with L10 avg > line + 0.5]
  ⚠️ Avoid: Low-usage players despite favorable team matchup
```

### 3. Add a "confidence filter" in the scanner output

Tag each recommendation with whether there are actual player sweet spots backing it up. If the team signal is elite but zero individual players have supporting L10 data, downgrade or flag it as "environment only — no individual targets."

### Files Changed
1. **`supabase/functions/nba-matchup-daily-broadcast/index.ts`** — Cross-reference team signals with `category_sweet_spots` to name specific player targets and add warnings
2. **`supabase/functions/bot-matchup-defense-scanner/index.ts`** — Add `player_backed: boolean` flag to recommendations indicating whether individual player data supports the team signal

