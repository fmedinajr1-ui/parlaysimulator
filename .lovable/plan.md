

## Plan: Align Accuracy-Flip Parlay Generator with Alert Kill/Flip Rules

### Problem
The `fanduel-prediction-alerts` function has strict kill gates and auto-flip rules for player props, but `generate-accuracy-flip-parlays` uses a softer "TRAP_SIGNAL_TYPES" approach that doesn't fully match. The parlay generator still considers killed signals as valid legs.

### What's Missing in the Parlay Generator

| Rule | Alerts Function | Parlay Generator |
|------|----------------|-----------------|
| Kill `velocity_spike` on spreads/totals | ✅ | ❌ Missing |
| Kill `velocity_spike` + `live_velocity_spike` on ALL player props | ✅ | ❌ Only treats as "trap flip" |
| Kill `line_about_to_move` + `live_line_about_to_move` on ALL player props | ✅ | ❌ Only treats as "trap flip" |
| Auto-flip `cascade` player prop OVERs to UNDER | ✅ | ⚠️ Partially (via trap logic) |

### Changes to `generate-accuracy-flip-parlays/index.ts`

1. **Add the same constants and helper functions** from the alerts function:
   - `KILLED_VELOCITY_MARKETS` set (spreads, totals)
   - `PLAYER_PROP_TYPES` set (all player prop types)
   - `isPlayerPropType()` function
   - `isKilledSignal()` function (exact same logic)

2. **Apply kill gate when classifying picks** — before a pick enters either `bestLegs` or `flipLegs`, check `isKilledSignal()`. If killed, skip entirely (don't use as any leg).

3. **Apply cascade auto-flip** — if signal is `cascade`, prop is a player prop, and prediction is OVER, auto-flip to UNDER and route to flip bucket.

4. **Remove the loose `TRAP_SIGNAL_TYPES` approach** — replace with the exact same gating logic the alerts function uses so both systems are identical.

5. **Update tracking insert** to include a `kill_gate_applied` or `trap_flag` field reflecting what rule was triggered.

### Technical Detail

The core change replaces the current block at lines 179-273 with:
- First: skip any pick where `isKilledSignal(signal_type, prop_type)` returns true
- Then: for cascade + player prop + OVER → auto-flip to UNDER and put in flip bucket
- Then: normal best/flip classification as before

This ensures no "toxic" signal ever appears in a parlay leg, matching the alerts pipeline exactly.

