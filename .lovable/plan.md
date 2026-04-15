

# Fix: Extract Individual Players from Team Cascades

## Problem
All 43 cascade signals today are **TEAM CASCADE** entries like:
`TEAM CASCADE (Kyle Tucker, Luis Robert Jr., Brett Baty, Shohei Ohtani, ...)`

The function skips all of these, leaving only 2 price_drift picks. There are **no individual-player cascade records** being created by the upstream engine.

## Fix
Update `straight-bet-slate/index.ts` to **parse individual player names out of TEAM CASCADE entries** and create a separate bet for each player.

### Logic
```text
"TEAM CASCADE (Kyle Tucker, Luis Robert Jr., Bo Bichette)"
  → 3 individual bets:
    - Kyle Tucker Under 0.5 RBI @ 2% stake (cascade tier)
    - Luis Robert Jr. Under 0.5 RBI @ 2% stake
    - Bo Bichette Under 0.5 RBI @ 2% stake
```

### Steps
1. **Parse team cascades** — regex extract names between parentheses, split by comma
2. **Deduplicate** — same player can appear in multiple team cascade entries; only bet once
3. **Apply cascade stake tier** (2%) to each extracted player
4. **Keep existing individual alert logic** unchanged for price_drift / velocity_spike
5. **Clean up today's 2 existing bets**, re-run to get the full slate
6. **Re-send to Telegram** with the complete 40+ bet slate

### File
- `supabase/functions/straight-bet-slate/index.ts`

