

# Lower Execution Tier L10 Hit Rate Gate: 70% → 65%

## Problem
The execution tier enforces an 80% L10 hit rate gate (70% on thin pools), which blocks too many picks on thin slates, resulting in 0 execution parlays.

## Changes

### File: `supabase/functions/bot-generate-daily-parlays/index.ts`

**Location 1 — Main execution gate (line 8024)**
```
const execL10Gate = isLightSlateMode ? 85 : (isThinPool ? 70 : 80);
```
Change to:
```
const execL10Gate = isLightSlateMode ? 75 : (isThinPool ? 65 : 70);
```
This lowers the normal gate from 80→70, thin pool from 70→65, and light slate from 85→75.

**Location 2 — Cluster builder gate (line 10182)**
```
if (clusterL10HrPct < 80) {
```
Change to:
```
if (clusterL10HrPct < 70) {
```
Align the env-cluster builder with the lowered main gate.

**Location 3 — Floor lock gate (line 7632)**
```
if (l10HrPct < 80) return false;
```
Change to:
```
if (l10HrPct < 70) return false;
```
Align the floor lock strategy with the new threshold.

**Location 4 — Update comment (line 3430)**
Update the comment referencing "80% L10 hit rate gate" to reflect the new 70% threshold.

Then redeploy `bot-generate-daily-parlays`.

