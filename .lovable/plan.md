

## Apply Both Fixes: Defense-Driven Icons + Defense-Adjusted Line Display

### Overview

Two changes to `supabase/functions/telegram-webhook/index.ts`, both in the `formatLegDisplay` function (lines 865-893).

---

### Fix 1: Defense-Rank-Driven Status Emoji

**Current logic** (lines 866-870): Icons based only on composite score and hit rate.

**New logic**: Defense rank takes priority when available:

| Defense Rank | Icon | Meaning |
|---|---|---|
| 1-10 | ⚠️ | Elite defense, tough matchup |
| 11-24 or null | Falls through to score/hitRate thresholds | Mid-range or unknown |
| 25-30 | 🔥 | Weak defense, easy matchup |

Whale override (🐋) still takes final priority.

### Fix 2: Show Defense-Adjusted Projection

Add the `defense_adjusted_avg` (stored as `projected_value` on each leg) to the compact reasoning line. When a defense adjustment exists and differs from the raw line, display it as:

```
🎯85 | 💎75% | 📊Proj 23.5 | vs LAL (#3 DEF) ⚠️
```

The `📊Proj X.X` part only appears when `leg.projected_value` exists and differs meaningfully from the book line, giving users immediate visibility into the defense-adjusted expectation.

### Technical Details

**File**: `supabase/functions/telegram-webhook/index.ts`

**Lines 865-882** replaced with:

```typescript
// Extract defense-adjusted projection
const projValue = leg.projected_value || null;

// Status emoji — defense rank takes priority
let statusEmoji = '';
if (defRank !== null && defRank <= 10) {
  statusEmoji = '⚠️'; // Elite defense
} else if (defRank !== null && defRank >= 25) {
  statusEmoji = '🔥'; // Weak defense
} else if (score >= 80) {
  statusEmoji = '🔥';
} else if (score >= 60 && hitRate >= 70) {
  statusEmoji = '✨';
} else if (hitRate < 50 || score < 40) {
  statusEmoji = '⚠️';
}
if (source.includes('whale')) statusEmoji = '🐋';

// Compact icon line
const compactParts: string[] = [];
if (score) compactParts.push(`🎯${score}`);
if (hitRate) compactParts.push(`💎${hitRate}%`);
if (projValue && line && Math.abs(projValue - Number(line)) >= 0.3) {
  compactParts.push(`📊Proj ${projValue}`);
}
if (opponent) {
  const defStr = defRank ? ` (#${defRank} DEF)` : '';
  compactParts.push(`vs ${opponent}${defStr}`);
} else if (defRank) {
  compactParts.push(`#${defRank} DEF`);
}
if (statusEmoji) compactParts.push(statusEmoji);
```

### Example Output

Before:
```
🏀 Take Wembanyama OVER 24.5 PTS (-110)
  🎯45 | 💎75% | vs LAL (#3 DEF) | ⚠️
```

After:
```
🏀 Take Wembanyama OVER 24.5 PTS (-110)
  🎯45 | 💎75% | 📊Proj 23.1 | vs LAL (#3 DEF) | ⚠️
```

The ⚠️ is now driven by the #3 DEF rank (not the low composite score), and the projected value of 23.1 shows the defense-adjusted expectation is below the 24.5 book line.

### Impact

- Single file changed, ~15 lines modified
- Defense rank drives the icon when available; falls back to existing score logic otherwise
- Defense-adjusted projection shown only when meaningfully different from book line
- No database or other function changes needed
