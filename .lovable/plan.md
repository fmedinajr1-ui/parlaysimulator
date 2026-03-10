

## Plan: L3-Gated Mispriced Lines + Hybrid 5-Leg NBA Parlay

### Two changes across three files:

---

### 1. Add L3 to `detect-mispriced-lines/index.ts`

**NBA continuous props block (~line 296):** Add L3 computation alongside existing L5/L10/L20:
```typescript
const l3Logs = logs.slice(0, Math.min(3, logs.length));
const l3Values = l3Logs.map(l => getNbaStatValue(l, statKey)).filter(v => v !== null);
const avgL3 = l3Values.length >= 3 ? calcAvg(l3Values) : null;
```

**After team-total alignment (~line 437):** Apply L3 recency gate to `alignedEdgePct`:
- If L3 confirms signal direction (OVER + L3 > line, or UNDER + L3 < line): blend `alignedEdgePct = alignedEdgePct * 0.6 + l3EdgePct * 0.4`
- If L3 contradicts signal: halve `alignedEdgePct *= 0.5`
- If insufficient L3 data (< 3 games): no adjustment

**Store in `shooting_context` (~line 447):** Add `l3_avg`, `l3_edge_pct`, `l3_confirms` fields.

**Apply same logic to MLB block (~line 500+) and NHL block (~line 800+).**

---

### 2. Add hybrid strategy `l3_sweet_mispriced_hybrid` to `bot-generate-daily-parlays/index.ts`

**Profiles (exploration tier, ~line 694):**
```typescript
{ legs: 5, strategy: 'l3_sweet_mispriced_hybrid', sports: ['basketball_nba'], minHitRate: 50, sortBy: 'combined' },
{ legs: 4, strategy: 'l3_sweet_mispriced_hybrid', sports: ['basketball_nba'], minHitRate: 55, sortBy: 'combined' },
```

**Strategy block (after `isL3MatchupComboProfile` block, ~line 6962):**
1. Pull top 2 NBA picks from `pool.sweetSpots` — filter: L3 not null, L3 clears line, sorted by L3 score (same logic as `sweet_spot_l3`)
2. Pull top 3 NBA picks from `pool.mispricedPicks` — filter: `shooting_context.l3_confirms === true`, sorted by `edge_pct` descending
3. Deduplicate by player name across both pools
4. If combined < required legs, skip profile

**Add to `PRIORITY_STRATEGIES` set (~line 6682).** Exempt from ScoreGate/GodMode/ProjectionBuffer.

---

### 3. Whitelist in `broadcast-new-strategies/index.ts`

Add `'l3_sweet_mispriced_hybrid'` to the `strategy_name` array (~line 32).

---

### Post-deploy: Invoke pipeline

1. Invoke `detect-mispriced-lines` to regenerate mispriced data with L3 fields
2. Invoke `category-props-analyzer` with forceRefresh to backfill sweet spot L3
3. Invoke `bot-generate-daily-parlays` to build the hybrid parlay
4. Invoke `broadcast-new-strategies` to send via Telegram

