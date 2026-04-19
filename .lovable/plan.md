
Simple data-insert task. Let me check the existing topics structure briefly to match the schema, then plan the refill.

Schema from earlier context: `blog_topics_queue` has `title_seed`, `category`, `target_keyword`, `priority`, `used_at`. Categories in use: Strategy, AI Picks, Prop Analysis, NBA, MLB, Tennis, MMA.

Plan is straightforward — no decisions needed.

# Refill Blog Topics Queue (+100 Fresh Angles)

## What I'll do
Insert 100 new rows into `blog_topics_queue` covering the guardrail topics (winning, AI, stats, rigged/cheating, player updates, injuries, team rankings, L10, MVP) across all active categories.

## Distribution
- **Strategy** (20): bankroll, line shopping, parlay math, hedging, CLV, fade-the-public, etc.
- **AI Picks** (20): how the bot reads markets, AI vs sharps, model edges, signal types, transparency
- **Prop Analysis** (15): L10 deep dives, prop correlation, SGP traps, alt lines, juice analysis
- **NBA** (15): MVP race angles, injury impact, pace/usage shifts, team rankings, playoff prep
- **MLB** (10): pitcher matchups, RBI/HR models, weather, bullpen fatigue, totals
- **Tennis** (8): WTA vs ATP edges, surface splits, grand slam angles
- **MMA** (7): UFC card breakdowns, fight IQ, prop spots
- **Rigged/Cheating angle** (5): line manipulation, sportsbook limits, what AI exposes — woven across categories with priority boost

## Priority logic
- Rigged/cheating + MVP race + AI explainer topics get `priority=10` (run first)
- Evergreen strategy = priority 5
- Sport-specific = priority 3

## Files touched
- DB only — single insert via insert tool into `blog_topics_queue`
- No code changes, no edge function changes

## Result
- Queue grows from 157 → 257 unused topics
- At 15/day generation = **17+ days of fresh runway** added on top of what's there (~27 days total)
