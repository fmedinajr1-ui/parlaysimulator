

# Deep L10 Cross-Reference for HRB RBI Alerts

## Problem
Cascade alerts show "Over RBIs (undefined)" in Telegram because:
1. Cascade signals skip L10 validation entirely — no per-player RBI stats are fetched
2. The cascade metadata doesn't include `line` (always 0.5 for RBIs)
3. No individual player breakdown — just a blob of names with no context on who actually supports the OVER/UNDER call

## Fix — Enrich Cascades with Per-Player L10 Analysis

**File: `supabase/functions/hrb-mlb-rbi-analyzer/index.ts`**

### 1. Add per-player L10 lookup for cascade alerts
Before inserting cascade alerts, fetch L10 RBI stats for every player in the cascade from `mlb_player_game_logs`. For each player compute:
- **L10 RBI avg** (e.g., 0.7)
- **L10 hit rate vs 0.5 line** — how many of last 10 games had RBIs > 0.5 (OVER) or < 0.5 (UNDER)
- **L3 RBI avg** — recent 3-game trend to detect hot/cold streaks
- **Individual lean** — does this player's history support the cascade direction?

### 2. Split cascade into confirmed vs. contradicted players
- **Confirmed**: L10 avg supports the cascade direction (e.g., Over + L10 avg > 0.5, or Under + L10 avg ≤ 0.3)
- **Neutral**: L10 avg is borderline (0.3–0.5 for Under, 0.5–0.7 for Over)
- **Contradicted**: L10 avg opposes the cascade direction

Adjust cascade confidence based on confirmation ratio. If <40% of players confirm, downgrade or block the alert.

### 3. Fix the "undefined" line in Telegram messages
- Always set `metadata.line = 0.5` on cascade alerts (RBI lines are always 0.5)
- Include per-player breakdown in Telegram message:
  ```
  🌊 CASCADE
  Athletics @ New York Yankees → Over 0.5 RBIs
  🎯 88% conf | 8/12 players confirm

  ✅ Aaron Judge: L10 avg 0.7 (7/10 over)
  ✅ Jazz Chisholm Jr.: L10 avg 0.9 (8/10 over)
  ⚠️ Jose Caballero: L10 avg 0.2 (2/10 over)
  ...
  ```

### 4. Enrich individual alerts too
For non-cascade alerts that already have L10, also add:
- **L10 hit rate** (games hitting over/under the line) — not just average
- **L3 trend** — hot or cold indicator
- Include in Telegram: `L10: 0.7 avg (7/10 over) | L3: 1.0 🔥`

### 5. Strengthen L10 blocking logic
Current blocking thresholds are too loose (Over blocked only if L10 < 0.25, Under blocked only if L10 > 1.0). Tighten:
- **Over 0.5 RBIs**: Block if L10 hit rate < 30% (player rarely gets RBIs)
- **Under 0.5 RBIs**: Block if L10 hit rate > 80% (player almost always gets RBIs)

## Technical Details

- Batch L10 lookups: collect all unique player names across all cascade alerts, query once with `.in('player_name', [...])`, then distribute results
- L3 computed from the first 3 rows of the same L10 query (no extra DB call)
- Hit rate = count of games where `rbis >= 1` / total games (for Over 0.5 line)
- Cascade confirmation ratio directly modifies confidence: `adjusted = base * (confirmedRatio * 0.6 + 0.4)`
- No new tables or migrations needed

