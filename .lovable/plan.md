

## Plan: Safer Alt Lines for Under Plays (Ghost Line Fallback)

### Problem
Yesterday's OG Anunoby U 1.5 3PM missed (actual: 2), but U 2.5 would have hit. The lottery scanner's alt line logic only shops for **over** plays (higher line + over odds). It completely ignores under plays — never tries to bump an under line to a safer (higher) number.

### Solution
Extend the alt line hunting in `nba-mega-parlay-scanner/index.ts` with two mechanisms:

#### 1. Alt Line Shopping for Unders (lines ~826-841)
After the existing over-side alt swap, add a parallel block for UNDER plays:
- For any under pick where `l10Avg` or `l10Median` exists, fetch alt lines (already fetched for volume candidates)
- Look for alt lines where `al.line > prop.line` (higher line = safer under) AND `al.underOdds <= -130` (not too juiced — keeps ticket value)
- Pick the **lowest viable alt** above the current line (safest without excessive juice)
- Apply a +3 composite bonus for successfully swapped under lines

#### 2. Ghost Line Fallback (when no alt lines exist from API)
If no alternate lines are returned from the API for an under pick, apply a **ghost line bump**:
- **Condition**: Side is UNDER, prop is `threes`/`player_threes`, and `l10Median >= line + 1` (median is at least 1 full unit above the book line)
- **Action**: Bump the line by +1.0 (e.g., 1.5 → 2.5) and apply an odds penalty of -40 (reduces implied value since we're taking a safer line the book didn't offer)
- **Logging**: Tag the leg as `ghost_alt: true` so it's visible in Telegram reports and settlement
- This is conservative — only applies to threes unders where the median strongly supports the safer line

#### 3. Expand Alt Line Fetch to Include Under Candidates
Currently, alt line fetching (line 795) only targets `volumeCandidate` props. Extend this to also include:
- Any under pick on threes where `l10Median >= line + 1`
- This ensures the system at least **tries** to get real alt lines before falling back to ghost lines

### Files Changed

| File | Change |
|------|--------|
| `supabase/functions/nba-mega-parlay-scanner/index.ts` | Add under-side alt line swap logic, ghost line fallback for threes unders, expand alt fetch candidates |

### Ghost Line Safety
- Ghost lines only apply to threes unders (the exact scenario from yesterday)
- Requires L10 median to be at least 1 unit above the current line (strong statistical support)
- Odds penalty ensures the parlay doesn't get inflated ticket odds from a line the book didn't actually offer
- Tagged in leg data so settlement can track ghost line performance separately

