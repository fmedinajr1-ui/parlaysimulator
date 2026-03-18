

# FFG Score Verification Against Actual Data

## Manual Verification: Checking Scanner FFG vs Real Game Logs

### Player 1: Jaylen Brown (BOS vs GSW) — Scanner FFG: +1.1 (Neutral)

**Actual L10 from game logs:**
| Date | Opp | FGA | FGM | FG% | 3PA | 3PM |
|------|-----|-----|-----|-----|-----|-----|
| 3/16 | PHX | 20 | 10 | 50% | 5 | 2 |
| 3/14 | WAS | 13 | 6 | 46% | 5 | 0 |
| 3/12 | OKC | 25 | 10 | 40% | 4 | 1 |
| 3/10 | SAS | 8 | 4 | 50% | 0 | 0 |
| 3/08 | CLE | 17 | 7 | 41% | 3 | 1 |
| 3/06 | DAL | 17 | 9 | 53% | 5 | 2 |
| 3/04 | CHA | 19 | 7 | 37% | 4 | 1 |
| 3/01 | PHI | 17 | 9 | 53% | 6 | 2 |
| 2/27 | BKN | 12 | 9 | 75% | 4 | 4 |
| 2/25 | DEN | 21 | 7 | 33% | 6 | 1 |

**Actual L10 averages:** FGA=16.9, FGM=7.8, FG%=46.2%, 3PA=4.2, 3PM=1.4

**Scanner reported:** `l10_fga: 16.9, l10_fgm: 7.8, l10_fg_pct: 46.2, l10_3pa: 4.2` — ✅ **Volume data matches perfectly**

**FFG math walkthrough (points, over, vs GSW):**
- Volume bonus: (16.9 - 12) × 0.3 = 1.47, capped at 3 → **+1.47**
- Efficiency: (0.462 - 0.46) × 10 = 0.02 → **+0.02**
- GSW def rank for points: rank 12 → ((12 - 15) / 15) × 2 = -0.4 → **-0.4**
- Total: 1.47 + 0.02 - 0.4 = **1.09 → rounds to 1.1** ✅ **Matches scanner output**

---

### Player 2: Payton Pritchard (BOS vs GSW) — Scanner FFG: +0.9 (Neutral, UNDER)

**Actual L10 averages:** FGA=12.1, FGM=4.9, FG%=40.5%, 3PA=6.3

**Scanner reported:** `l10_fga: 12.1, l10_fg_pct: 40.5, l10_3pa: 6.3` — ✅ **Matches**

**FFG math (points, under, vs GSW):**
- Volume bonus (points): (12.1 - 12) × 0.3 = 0.03 → **+0.03**
- Efficiency: (0.405 - 0.46) × 10 = -0.55 → **-0.55**
- GSW def rank 12: -0.4 → **-0.4**
- Raw total: 0.03 - 0.55 - 0.4 = **-0.92**
- Flipped for under: **+0.92 → 0.9** ✅ **Matches**

---

### Issues Found

1. **3P% calculation is buggy (line 493-495):**
   ```typescript
   const l103pPct = shooting.threes_att > 0
     ? (l3Cache.get(playerName)?.threes ?? 0) / (shooting.threes_att / shooting.games)
     : 0;
   ```
   This divides L3 threes made by L10 threes attempted per game — mixing L3 and L10 data. It should be `shooting.threes_made / shooting.threes_att` for a proper L10 3P%.

2. **FFG doesn't use zone-level defense data.** The `team_zone_defense` table has granular data (e.g., GSW allows 37.5% on above-break-3s, 44.5% in paint) but the FFG formula only uses the team's overall defensive rank. Incorporating zone data would make the formula significantly more accurate for shot-profile-specific players.

3. **"Neutral" label is too broad.** Scores from -1 to +3.9 are all "neutral", meaning a +3.5 (which is actually quite favorable) gets the same label as a 0. Consider tightening thresholds.

## Proposed Fixes

| File | Change |
|------|--------|
| `supabase/functions/bot-matchup-defense-scanner/index.ts` | Fix L10 3P% calculation (use `shooting.threes_made / shooting.threes_att`) |
| Same file | Optionally adjust FFG label thresholds: elite ≥4, strong ≥1.5, neutral ≥-1.5, weak below |
| Same file | Optionally incorporate zone defense data from `team_zone_defense` for points/threes props to weight FFG by the zones the player actually shoots from |

**Bottom line:** The volume data and core FFG math are correct and verified. The main bug is the 3P% calculation mixing L3/L10 data, and the labeling thresholds could be tightened so "strong" captures more of the meaningful positive scores.

