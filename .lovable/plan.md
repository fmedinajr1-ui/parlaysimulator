

## Plan: Build Parlay Tickets from 13 Locked Legs

### All 13 Locked Legs

**Original 8:**
1. Ryan Rollins O 12.5 PTS (-108)
2. Kevin Porter Jr. O 14.5 PTS (-126)
3. Giannis Antetokounmpo O 4.5 AST (-114)
4. Jaylen Wells O 12.5 PTS (-107)
5. Deni Avdija U 19.5 PTS (-103)
6. Ace Bailey O 4.5 REB (-156)
7. Nickeil Alexander-Walker O 2.5 3PM (-151)
8. Bobby Portis O 1.5 3PM (-101)

**New 5 (from engine consensus):**
9. Isaiah Joe O 2.5 3PM (43.6% edge, 100% L10)
10. Jared McCain O 1.5 3PM (37.6% edge, 90% L10)
11. Baylor Scheierman O 4.5 REB (36.0% edge, 90% L10)
12. OG Anunoby O 1.5 3PM (50.4% edge, 89% L10)
13. Isaiah Hartenstein O 3.5 AST (41.3% edge, 89% L10)

### What I'll Do

1. **Verify live odds** for the 5 new picks via `unified_props` query
2. **Build 3 parlay tickets** from the 13-leg pool using role-based stacking:
   - **Standard (3-leg)** — Safest picks, highest L10 hit rates
   - **Mid-Tier (5-leg)** — Balanced edge + hit rate mix
   - **High Roller (8-leg)** — Full send with best composite scores
3. **Calculate combined odds, win probability, and EV** for each ticket
4. **Save all tickets** to `parlay_history` via the Parlay Builder context

No code changes required — this uses existing edge functions and database queries.

