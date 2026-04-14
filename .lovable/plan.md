

# Add Home Run Power Gate to RBI Under Picks

## Problem
Lawrence Butler had a 70% Under hit rate but hit a solo HR yesterday for 1 RBI, busting the parlay. His L10 shows 2 HRs in 10 games — players with HR power can produce RBIs from nothing (solo shots). The current system doesn't account for this.

## Fix

### Update `mlb-rbi-analyzer/index.ts`

Add a **HR Power Gate** after the existing L10 average gate:

- Calculate L10 HR count from game logs
- If a player has **2+ HRs in their L10**, block them from Under 0.5 RBI picks
- If a player has **1 HR in L10**, apply a confidence penalty (-10) but still allow
- Log blocked players with reason "HR_POWER_GATE"

This targets the specific leak: players who don't drive in runs through situational hitting but can produce RBIs via solo homers at any time.

### Where in the code
In the candidate evaluation loop, after the existing L10 average check (0.4-0.7 range), add:

```
// HR Power Gate - solo HRs bypass RBI situations
const l10HRs = playerLogs.reduce((sum, g) => sum + (g.home_runs || 0), 0);
if (l10HRs >= 2) {
  // Block - too much HR power for Under 0.5
  continue;
}
if (l10HRs === 1) {
  confidence -= 10; // Penalty but still allow
}
```

### Files
- `supabase/functions/mlb-rbi-analyzer/index.ts` — add HR power gate

### Impact
This would have blocked Lawrence Butler (2 HRs in L10) from yesterday's parlay. Players like him who are cold on traditional RBIs but still have pop are the biggest leak for Under 0.5 picks.

