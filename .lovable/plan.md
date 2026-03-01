

## Mega Lottery V2: 3-Ticket System with Exotic Props and 10,000+ Jackpot

### Overview
Transform the mega lottery scanner into a true 3-ticket lottery system. One ticket must target 10,000+ combined odds using exotic high-odds markets (first basket, moneyline, Q1 ML). All tickets still run through the existing filter pipeline (defense rankings, hit rates, edge validation, correlation blocking) but with relaxed thresholds. L20 averages are incorporated alongside L10 for stability.

### 3 Ticket Structure

| Ticket | Legs | Min Per-Leg Odds | Target Total | Stake |
|--------|------|-----------------|--------------|-------|
| Standard Lottery | 2-4 | +100 | +500 to +2000 | $5 |
| High Roller | 3-6 | +200 | +2000 to +8000 | $3 |
| Mega Jackpot | 4-8 | +300 | +10,000 minimum | $1 |

### New Exotic Markets to Scrape
Add these markets to the per-event API call alongside existing player props:
- `player_first_basket` -- First Basket Scorer (+400 to +2500)
- `h2h` -- Full Game Moneyline underdog side (+150 to +600)
- `h2h_q1` -- 1st Quarter Moneyline underdog side (+130 to +300)
- `player_double_double` -- Double Double Yes (+200 to +800)
- `player_triple_double` -- Triple Double Yes (+500 to +5000)

### Filter Adjustments Per Tier

**Standard Lottery** (existing logic, allow 2 legs minimum):
- Same SAFE/BALANCED/GREAT_ODDS roles, same thresholds
- Min legs reduced from 3 to 2

**High Roller** (relaxed filters):
- Hit rate: 40%+ (down from 70%/60%/55%)
- Edge: 0%+ (no minimum, odds carry the value)
- Defense rank: 15+ for OVERs (still meaningful)
- L10 avg or L20 avg must clear the line by 1.1x
- Per-leg odds: +200 minimum

**Mega Jackpot** (lottery-grade filters, defense still matters):
- Hit rate: 30%+ (just needs a pulse of viability)
- Edge: no minimum
- Defense rank: 18+ for player props (weak defense = things are possible)
- L10 or L20 avg must be within 0.8x of the line (not impossible)
- Per-leg odds: +300 minimum
- Exotic props (first basket, triple double) skip L10/L20 checks since no game log data exists
- Team bets (ML, Q1 ML) use defense rank as primary filter -- only pick underdogs vs weak defenses

### Technical Changes

**File: `supabase/functions/nba-mega-parlay-scanner/index.ts`**

1. **Expand market scraping** (line 183): Add exotic markets to API call string. Parse team-based markets (h2h, h2h_q1) differently -- extract underdog side only. Parse Yes/No markets (first basket, double/triple double) -- extract Yes outcomes only. Tag each prop with `market_type`: 'player_prop', 'exotic_player', or 'team_bet'.

2. **Add L20 data** (lines 291-316): Query `mispriced_lines` for `player_avg_l20` alongside existing data. Build an `l20Map` and attach `l20Avg` to each scored prop. Use `l20Avg` as fallback when `l10Avg` is missing, and as a stability check in the mega jackpot tier.

3. **Replace single-parlay builder with 3-ticket builder** (lines 626-828):
   - **Ticket 1 (Standard)**: Keep existing 3-pass role-based logic (SAFE/BALANCED/GREAT_ODDS), allow 2-4 legs, $5 stake
   - **Ticket 2 (High Roller)**: New pass with relaxed thresholds (40% HR, +200 min odds, defense 15+), build 3-6 legs targeting +2000-+8000, $3 stake
   - **Ticket 3 (Mega Jackpot)**: New pass prioritizing exotic props and +300 min per-leg odds, defense rank 18+ required for player props, build 4-8 legs until combined odds reach 10,000+, $1 stake

4. **Correlation blocking for team bets**: Extend `hasCorrelatedProp` to block stacking h2h + h2h_q1 from the same game. First basket doesn't correlate with standard player props, so mixing is allowed.

5. **Save 3 separate entries to `bot_daily_parlays`** (lines 914-963): Each ticket saved as its own row with strategy_name 'mega_lottery_scanner' and a `ticket_tier` field in the legs metadata ('standard', 'high_roller', 'mega_jackpot'). Update dedup check to allow 3 entries.

6. **Telegram message**: Combined message showing all 3 tickets with legs, odds, and potential payouts at their respective stake sizes ($5, $3, $1).

### Key Design Decisions
- Defense ranking remains a core filter across all tiers -- higher rank (weaker defense) means things are more possible, especially for the mega jackpot
- L20 avg provides a larger sample for stability, used as fallback and secondary validation
- Exotic props (first basket, triple double) naturally produce +300 to +2500 per leg, making 10,000+ combined odds achievable with 4-8 legs
- Team bets only pick underdog sides (plus-money) to ensure high per-leg odds
- Same auto-dedup logic prevents reusing players across tickets

