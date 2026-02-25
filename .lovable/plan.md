

## Tonight's Longshot Parlay V2 — All High-Floor Overs

### Lessons Applied from Yesterday's Miss
- **No contrarian unders** (Kam Jones U8.5 PTS missed badly — he scored 13)
- **All OVER legs only** with 60%+ mispriced edge where possible
- **Floor protection**: every player's L10 avg comfortably clears the line
- **No repeat players** to avoid correlated risk

### Tonight's 6-Leg Selection (Feb 25)

| # | Player | Prop | Line | Side | Edge | L10 Avg | Why |
|---|--------|------|------|------|------|---------|-----|
| 1 | Jaylen Wells | assists | 0.5 | OVER | 280% | 1.9 | Ultra-safe 0.5 line, nearly 4x the line |
| 2 | Cade Cunningham | blocks | 0.5 | OVER | 163% | 1.4 | Star floor, nearly 3x the line |
| 3 | Ausar Thompson | steals | 1.5 | OVER | 63% | 2.6 | Strong volume, 73% above line |
| 4 | Daniss Jenkins | rebounds | 1.5 | OVER | 62% | 2.5 | Consistent floor, 67% above line |
| 5 | Cason Wallace | steals | 1.5 | OVER | 59% | 2.3 | High volume defender, 53% above line |
| 6 | Duncan Robinson | threes | 2.5 | OVER | 35% | 3.6 | Sharpshooter, 44% above line — adds odds multiplier |

### Changes

#### Update `supabase/functions/bot-insert-longshot-parlay/index.ts`

Replace the hardcoded legs array with tonight's v2 picks:
- All 6 legs are OVERS — zero contrarian unders
- Update `selection_rationale` to reference the v2 approach and yesterday's lesson
- Keep the same insert + Telegram broadcast flow

#### Update Telegram message context

The announcement data sent to `bot-send-telegram` will include the new legs and reference "v2 — all high-floor overs" in the broadcast.

### Files Modified
- `supabase/functions/bot-insert-longshot-parlay/index.ts` — new v2 legs, updated rationale

