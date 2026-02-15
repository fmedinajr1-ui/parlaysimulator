
# Fix Voided Parlays: Root Cause and Prevention

## ✅ IMPLEMENTED

### Part 1: Settlement routing expansion (bot-settle-and-learn)
- Added `settleNcaaBaseballViaESPN` — 3-day search window, fuzzy matching, ESPN college baseball scoreboard
- Added `settleNhlViaESPN` — same pattern for NHL via ESPN NHL scoreboard  
- Updated `settleTeamLeg` routing: baseball_ncaa → ESPN Baseball, ncaab → ESPN NCAAB, nhl → ESPN NHL, tennis → Odds API, fallback → NBA player logs

### Part 2: Quality gates tightened (bot-generate-daily-parlays)
- NCAAB: block if EITHER team is outside Top 200 KenPom (was: only if BOTH outside)
- NCAA Baseball: block if either team is missing from `ncaa_baseball_team_stats`
- Both functions deployed successfully

### Expected Impact
- Eliminates 100% of baseball voids (now has dedicated ESPN settlement)
- Eliminates NHL settlement gaps (now has dedicated ESPN settlement)
- Reduces NCAAB voids by filtering obscure teams at generation time
