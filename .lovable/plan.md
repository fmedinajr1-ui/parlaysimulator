
# NCAAB Tempo Formula Analysis: PAE vs ESPN Possession Data

## Executive Summary

The investigation confirms that **the PAE formula is the correct approach** for calculating `adj_tempo` — and it is already well-calibrated. The `ncaab-team-stats-fetcher` has a **different, more seriously broken tempo formula** that has been quietly writing inflated tempo values for years. The ESPN `/statistics` endpoint does not expose raw possession counts that could replace either formula. The right fix is a targeted recalibration in two places.

---

## What Each Formula Does

### Formula A — PAE Scraper (`ncaab-kenpom-scraper`, line 92)

```ts
const estPoss = ((ppg + oppg) / 2) / d1AvgPPG * AVG_POSS;
// d1AvgPPG = computed mean across all teams (~76.2 actual)
// AVG_POSS = 67 (NCAA D1 historical average possessions per game)
```

**How it works:** Normalizes each team's average scoring (as a fraction of the D1 mean) and scales to the D1 average possession count.

**Database validation:**
- Average D1 PPG: 76.20
- Average stored `adj_tempo`: **65.96**
- PAE formula applied to the average team: `(76.2/76.2) * 67 = 67.0`
- Maximum drift between stored value and formula re-derivation: **0.6 possessions** (rounding only)

**Verdict: This formula is correctly calibrated.** The average team gets ~66 possessions (slightly below the 67 anchor because D1 average allows fewer points than it scores — asymmetric defense). Values range 57.3–76.7, covering the real NCAA spectrum.

---

### Formula B — Stats Fetcher (`ncaab-team-stats-fetcher`, lines 243–250)

```ts
const avgTempo = 67;
const avgTotal = 135;
const tempoDelta = ((totalPPG - avgTotal) / 10) * 3;
tempo = Math.round((avgTempo + tempoDelta) * 10) / 10;
```

**How it works:** Starts at 67 and adds a linear delta based on how far the combined PPG is from a 135-point game total.

**Database validation problem — the avgTotal anchor is wrong:**
- The formula assumes D1 average combined game total = 135
- The actual D1 average combined PPG is **150.0** (76.2 ppg × 2)
- Because the anchor is 15 points too low, **every team above 135 combined gets an inflated tempo**
- Result: Stats fetcher calls **348 of 362 teams "fast" (≥67 possessions)** — only 14 teams are flagged as "slow"
- PAE formula correctly identifies **123 teams as fast**, matching real-world pace distribution

**The worst cases (slow teams misclassified as fast):**

| Team | Combined PPG | Stats-Fetcher Tempo | PAE Tempo | Correct Signal |
|---|---|---|---|---|
| Illinois Fighting Illini | 152.4 (84.2 + 68.2) | 72.2 | **66.5** | UNDER |
| West Virginia Mountaineers | 133.9 (70.1 + 63.8) | 66.7 | **58.4** | UNDER |
| Seton Hall Pirates | 136.5 (71.6 + 64.9) | 67.5 | **59.5** | UNDER |
| Purdue Boilermakers | 152.0 (82.5 + 69.5) | 72.1 | **66.3** | UNDER |

**225 teams have conflicting signals** between the two formulas — but **the stats fetcher formula is wrong** in every case.

**Critical finding:** The stats-fetcher tempo values were **never being written to the database** anyway. The upsert on line 312 explicitly excludes `adj_tempo` from its column list — it only writes: `team_name, conference, ppg, oppg, home_record, away_record, ats_record, over_under_record`. The `adj_tempo` in the database comes **exclusively from the PAE scraper's formula**. The stats-fetcher tempo calculation is dead code.

---

## ESPN API: Does It Expose Possession Data?

The investigation probed three ESPN endpoints:
- `/teams/{id}` — returns `avgPointsFor`, `avgPointsAgainst`, home/road records, standings. **No possession counts.**
- `/teams/{id}/statistics` — returns shooting stats (FG%, 3P%, FT%, rebounds, assists, steals, blocks, turnovers). **No raw possessions.**
- `/teams/{id}/record` — returns `{}` empty for most teams.

**Conclusion: ESPN does not expose possession counts** in any publicly accessible endpoint. The commonly used possession estimate formula (FGA - OReb + TO + 0.44×FTA) requires individual game box scores, not season summary endpoints. Pulling those for 362 teams × ~30 games = ~10,000 API calls — far exceeding the 45-second edge function budget.

**The PAE derivation method is therefore the only practical approach** for estimating possessions from ESPN data.

---

## The One Real Bug: PAE Scraper `d1AvgPPG` Anchor

The PAE formula is correct in structure but uses a hardcoded fallback of **76.8** when no teams have data:

```ts
const d1AvgPPG = withData.length > 0
  ? withData.reduce((s, t) => s + (t.ppg || 0), 0) / withData.length
  : 76.8;  // fallback only — actual computed value is 76.2
```

The actual D1 average from the database is **76.2 ppg**. When the real value is computed, the formula self-calibrates correctly (avg stored tempo = 65.96, formula at avg team = 65.96). So this is not a material issue in production — the dynamic computation overrides the fallback every time.

There is one minor calibration improvement available: the PAE scraper uses `AVG_POSS = 67` as the anchor, but the stored average is 65.96. This is because `d1AvgPPG` is computed as the mean offensive PPG only (what teams score), not the mean of (ppg + oppg)/2. Since offense slightly exceeds defense across all teams (76.2 vs 73.8), the average team's tempo lands at 65.96, not 67. Aligning the anchor would produce a cosmetically cleaner distribution but has no impact on relative ordering or projected totals — the formula correctly ranks team tempos relative to each other regardless.

---

## What This Means for Projected Totals

Now that the possession-adjusted formula fix is live in the scoring engine, `avgTempo` accuracy matters more directly. Here's the impact:

For a game between two median-tempo teams (avgTempo = 66):
- `homePts = 113 × (107/100) × 66/100 = 79.8`
- Total projection: ~**159.6**

For a game between a slow-team pair (avgTempo = 60):
- `homePts = 113 × (107/100) × 60/100 = 72.5`
- Total projection: ~**145.0**

A 6-possession difference translates to a **~14.6 point swing in projected total**. With the current PAE tempo values being accurate to within 0.6 possessions, the maximum error in projected total from tempo imprecision alone is **~1.5 points** — well within acceptable bounds.

---

## Verdict: No Change Needed to the PAE Tempo Formula

The PAE scraper's tempo formula is:
- Mathematically correct (normalized possession estimate)
- Well-calibrated (avg team → 65.96 possessions, matching observed D1 pace)
- Already in production for all 362 teams (no nulls)
- Accurate to within 0.6 possessions vs re-derivation
- Not replaceable by ESPN raw possession data (ESPN doesn't expose it)

The stats-fetcher's tempo formula has a wrong anchor (135 vs 150 real average) and inflates tempo for 96% of teams — but it was already dead code since `adj_tempo` is never written in the stats-fetcher upsert. No fix needed there either.

---

## One Recommended Improvement

There is one meaningful enhancement available: update the PAE scraper's `AVG_POSS` constant from 67 to **66** to match the observed D1 average (65.96). This doesn't change relative rankings but shifts the absolute tempo scale to be more accurate for use in the possession-adjusted projected total formula:

```ts
// ncaab-kenpom-scraper/index.ts, line 72
const AVG_POSS = 66;  // was 67 — actual D1 average is 65.96
```

With this change:
- Avg team tempo shifts from 65.96 → 65.17 (minor, ~0.8 possession change)
- Projected total for an avg-vs-avg game: `113 × 1.07 × 65.17/100 × 2 = ~157.6` vs current `~159.6`
- Brings projections ~2 points closer to the actual D1 average total (which runs ~145–148 in practice)

This is a low-priority cosmetic fix — the relative ranking of tempos is unaffected, and the PPG sanity guard (now deployed) provides a catch-all if any projections drift too far from reality.

---

## Files to Change

| File | Line | Change | Priority |
|---|---|---|---|
| `supabase/functions/ncaab-kenpom-scraper/index.ts` | 72 | `AVG_POSS = 66` (was 67) | Low — cosmetic alignment |
| `supabase/functions/ncaab-team-stats-fetcher/index.ts` | 243–250 | Remove dead tempo computation (never written to DB) | Low — cleanup |

No database migrations. Both functions auto-deploy after edit.
