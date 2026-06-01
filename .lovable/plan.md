# +1500 Lottery Parlay Run

Goal: on demand, build 3–5 parlays each priced **≥ +1500** across every active sport in `unified_props` (today + next 48h pregame), use Perplexity `sonar-deep-research` as the intel layer, score them with the existing engine, and drop the winner to your admin Telegram.

Current odds pool (live check just now): MLB (3,021 player + 14 ML/SP/TOT), WNBA (6/6/6 team markets), NHL (1/1/1). Cross-sport-parlay-generator + parlay-engine-v2 already cover MLB/NHL/NBA/WNBA/NCAAB/NCAAF/tennis/MMA/soccer/golf when those sports have rows.

## What gets built

A new edge function: `lottery-1500-builder`.

```text
                ┌─ run-now button / curl ─┐
                ▼                         │
   ┌───────────────────────────────┐      │
   │ lottery-1500-builder          │      │
   │  1. snapshot active sports    │      │
   │  2. deep-research per sport   │──────┼─► perplexity sonar-deep-research
   │  3. build candidate pool      │      │
   │  4. compose 5 parlays @+1500  │      │
   │  5. score & rank → winner     │      │
   │  6. write bot_daily_parlays   │      │
   │  7. bot-send-telegram admin   │──────┴─► you only
   └───────────────────────────────┘
```

## Steps

1. **Active sport snapshot**
   - Query `unified_props` for `is_active=true AND commence_time BETWEEN now()+15m AND now()+48h`.
   - Group by `sport`; keep any sport with ≥3 legs of real lines (`has_real_line`).
   - Apply existing pregame gate (no live/finished games) and the `unmapped_prop` / `weak_over_hit_rate` blacklists from `cross-sport-sweet-spots`.

2. **Deep research (Perplexity `sonar-deep-research`)**
   - One call per active sport, sport-tailored prompt (extend `SPORT_PROMPTS` in `cross-sport-parlay-research`).
   - 75s timeout per call, run sequentially (deep-research is slow).
   - Store under `bot_research_findings` with category `lottery_<sport>`.
   - Translate findings to a `research_boost` map: player+team → −0.10..+0.10, same shape the existing engine already consumes.

3. **Candidate pool**
   - Reuse `cross-sport-sweet-spots` scoring (`safety = 0.45·l10_hit + 0.20·floor + 0.15·median + 0.10·line_edge + 0.10·research_boost`).
   - Keep team legs (ML/spread/total) with existing −250 floor, drop spreads |line|≥9.5, drop all-zero Unders, drop `not_starter` pitchers.
   - Tag each candidate with `decimal_odds`, `safety`, `tier`, `boost`, `sport`, `game_id`.

4. **Build 5 competing parlays at ≥ +1500**
   - Target combined American odds **≥ +1500** (decimal ≥ 16.0).
   - Variants generated in parallel:
     - **V1 Chalk-Stack** — only legs priced ≤ −200; add legs until product ≥ 16.0 (your "all −400" idea — typically 5–7 legs).
     - **V2 Balanced** — mix of −150 to +120 legs, 4–5 legs, highest mean safety.
     - **V3 Player-Primary** — ≥80% player props, ≥2 distinct games, no >1 prop per player.
     - **V4 Research-Boosted** — must include ≥2 legs with `research_boost ≥ +0.05`.
     - **V5 Lottery-Stretch** — 3 legs, allow +100..+400 dogs, must still land ≥ +1500.
   - All variants enforce existing guardrails: ≥2 distinct games, same-game concentration cap 0.75, no opposing team-market legs, no duplicate player.

5. **Rank & crown the winner**
   - Score = `0.50·mean_safety + 0.25·min_leg_safety + 0.15·payout_decimal_scaled + 0.10·research_density`.
   - Persist all 5 into `bot_daily_parlays` (strategy `lottery_1500_v{1..5}`), mark the top one `is_winner=true`.

6. **Deliver to Telegram (admin only)**
   - Call `bot-send-telegram` with `admin_only: true`, type `lottery_1500`.
   - Message format: header → 5 parlay cards with legs + odds + safety + 1-line "why" → bold "🏆 WINNER" block at top with the chosen ticket + bankroll note.

7. **Run mechanics**
   - On-demand only (no cron). Trigger via:
     `supabase--curl_edge_functions path=/lottery-1500-builder method=POST` (admin JWT).
   - Long-running (~5–10 min from deep-research). Function streams progress logs; returns final JSON summary.

## Technical notes

- Reuses existing libraries: `_shared/parlay-engine-v2/*`, `cross-sport-sweet-spots` candidate prep, `bot-send-telegram` admin path.
- New code in `supabase/functions/lottery-1500-builder/index.ts` only; no schema changes (writes to existing `bot_daily_parlays` + `bot_research_findings`).
- Secrets used: `PERPLEXITY_API_KEY`, `LOVABLE_API_KEY`, `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID` (all already configured).
- Adds 5 unit tests in `lottery-1500-builder/index_test.ts` per project policy (price math ≥+1500, distinct-games rule, duplicate-player block, research-boost variant requirement, admin-only Telegram path).
- Settlement: existing `cross-sport-parlay-settler` already grades any `bot_daily_parlays` rows by sport+player+date — `lottery_1500_*` strategies are picked up automatically, no new settler.

## Out of scope

- No broadcast to all_access tier (admin-only per your choice).
- No new cron — manual trigger only for now.
- No UI page (results land in DB + Telegram; we can add a `/admin/lottery` panel later if you want).
