

# RBI Parlays: Unders-Only with Pitcher Quality Gate

## What Changes

The RBI parlay generator will be restructured to build **Unders-only parlays** using Hard Rock Bet line data, with a mandatory pitcher quality gate ensuring every leg faces a strong arm.

## Changes to `generate-rbi-parlays/index.ts`

### 1. Unders Only
- Filter out all Over picks immediately after fetching alerts — only Under predictions enter the candidate pool
- Remove the conflict guard logic (no need to resolve Over vs Under — Overs are simply excluded)
- Remove L10 Over logic from scoring (no longer relevant)

### 2. Pitcher Quality Gate
Before scoring, look up each Under candidate's opposing pitcher using the MLB Stats API (same approach already used by `mlb-rbi-under-analyzer`):
- Fetch today's MLB schedule for probable pitchers
- Look up each pitcher's ERA and K/game rate
- **Hard gate**: Block any Under pick where the opposing pitcher has **K/game < 5 AND ERA > 3.5** — the batter must face a quality strikeout arm
- Add pitcher stats to metadata for narrative output

### 3. Pitcher Bonus in Scoring
- +15 for elite arms (K/game >= 7 or ERA < 2.5)
- +8 for good arms (K/game >= 5 or ERA <= 3.5)
- This ensures legs against aces rank highest

### 4. Enhanced Telegram Narrative
- Every leg includes pitcher info: "Facing [Pitcher] (X.XX ERA, Y K/game)"
- Parlay labels updated: "2-Leg RBI Under Lock", "3-Leg RBI Under Sniper"
- Header updated to reflect Unders-only strategy

### 5. Source from HRB Line Timeline
- Cross-reference candidates against `hrb_rbi_line_timeline` to confirm lines are from Hard Rock Bet
- Use HRB line data (current line, drift velocity) in scoring when available

## Flow After Changes

```text
Fetch Under-only alerts → L10 Hard Gate (hit rate ≤ 0.5)
  → Pitcher Quality Gate (K/g ≥ 5 OR ERA ≤ 3.5)
  → Cross-ref HRB lines → Score → Build 2-3 leg Under parlays
```

## File Changes
| File | Change |
|------|--------|
| `supabase/functions/generate-rbi-parlays/index.ts` | Filter Unders only, add MLB API pitcher lookup, add pitcher quality gate, add pitcher scoring bonus, update narratives, cross-ref HRB lines |

No database changes needed. After deploying, the function will be invoked to generate today's April 13th Under parlay picks.

