

## Fix: Redeploy and Invoke Bidirectional Scanner

### Root Cause
The bidirectional scanner and broadcast functions have **zero logs today** despite being scheduled at 1:30 PM ET (17:30 UTC). The `game_bets` table contains **11 NBA games** for today's window -- data is not the issue. The functions likely need redeployment after recent edge function changes disrupted them.

### Steps

1. **Redeploy both functions**: `bot-matchup-defense-scanner` and `nba-matchup-daily-broadcast`
2. **Invoke `nba-matchup-daily-broadcast`** manually -- this function already calls the scanner internally (Step 1 in the broadcast code), then formats and sends results via Telegram
3. **Verify logs** after invocation to confirm all 11 games were scanned and matchup findings were persisted to `bot_research_findings`

### Expected Output
- Scanner processes 11 NBA games against 30 team defense profiles
- Generates Elite/Prime/Favorable/Avoid/Bench-Under recommendations
- Broadcasts full matchup report via Telegram
- Persists findings to `bot_research_findings` for downstream parlay engines

### Files Involved
No code changes needed -- just redeployment and manual invocation of existing functions.

