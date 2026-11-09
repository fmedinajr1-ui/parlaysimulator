# Minutes model rollout

# Bot synchronization and midnight update
- [x] Synchronize research and Oversight records and refresh signals; scheduled snapshots and targets use shared deterministic desk math and verified immutable shelf rows.
- [x] Move the single daily update to midnight Eastern with daylight-saving handling; run November 9 catch-up (108 lines, 9 pregame skeptical records, 3 matching simulated bot targets). AI Top Plays remains paused for insufficient credits.
- [x] Test shared-record rules and private desk results (123 focused tests passed; unlocked phone/desktop research and shared refresh verified).

- [x] Save pregame minutes forecasts and grade them in the existing daily update.
- [x] Gate v6 on three completed slates averaging no more than two minutes of absolute error.
- [x] Prepare dampened v6 and same-slate side-by-side v5 picks/results without changing historical records.
- [x] Validate rules, private access, and mobile presentation.
- [x] Automate pregame forecasts and same-slate v5/v6 logging so v6 activates when the three-slate accuracy gate passes.
- [x] Verify paired mobile comparison in locked and activated states.
- [ ] Activate v6 after three completed slates average ≤2 minutes of error (blocked by future results; first completed slate averaged 4.68 minutes).

# Rest awareness

- [x] Add one tested days-rest calculation and conservative projection adjustment.
- [x] Show rest badges on picks, projections, game coverage, season leaders and research.
- [x] Verify rest is not counted twice in the v6 minutes model and check mobile layout.

# Submitted result learning
- [x] Record the three unique November 6–7 screenshot entries once, including pregame L5/L10 snapshots and actual results.
- [x] Verify the saved records against the screenshots and summarize lessons without changing the projection model yet.

# Bot desk
- [x] Reorganize the private desk into simple Picks, Games, Research and Results views.
- [x] Add button-driven review and separate skeptical picks using the existing disagreement rules.
- [x] Preserve projections and historical records; verify review and slip interactions on phone and desktop.
- [x] Add a deterministic skeptical-pick strategy with risk-sized simulated stakes and a separately graded bot profit record.

# Mobile return stability
- [x] Preserve desk view, research filters and expanded details after a phone discards the page.
- [x] Prevent competing desk route restoration and verify background/return behavior (17 tests; unlocked phone leave/return and recreated-page checks).

# Expanded v6 trial
- [x] Add shot attempts, opponent assists/rebounds allowed and plus-minus to projection cards.
- [x] Version and test the expanded v6 shadow model without changing v5 or the minutes accuracy gate (74 tests passed).
- [x] Refresh 1,258 box scores and run minutes-only trial; no games remain pregame, so no new prospective snapshots were created. Phone cards and paired preview verified.

# Skeptical shelf accuracy
- [x] Add a button-driven win-chance/L10 calibration experiment with baseline comparisons, confidence-cutoff accuracy and explicit in-sample limits; 14 new tests, all 26 research/calibration tests passed, and private phone flow verified across 46 decided retrospective props. A 50/50 blend reduced Brier 0.294→0.282 but cutoff accuracy fell 41.9%→37.0%; no live weights changed.
- [x] Add a button-driven accuracy research bot comparing wins/losses, warning groups and probability reliability, with evidence-only explanations and calibration proposals that never change picks automatically; 12 new tests and private phone/desktop flow verified across all 46 decided props and 19 wins.
- [x] Capture all 47 current November 8 skeptical shelf plays as explicitly retrospective records, check seven ESPN final box scores, and display separately from pregame accuracy (19 won, 27 lost, 1 unverified; 41.3%).
- [ ] Resolve Norman Powell Under 2.5 assists: no matching athlete entry in any November 8 final ESPN box score, so result remains unverified rather than inferred void.
- [x] Save every pregame skeptical shelf play when the desk opens with original win chance, server-verified actual last-10 hit record, line and warnings; keep separate from bot targets.
- [x] Grade the complete shelf in the daily update and show its saved accuracy and individual results.
- [x] Verify snapshot protection and accuracy rules (32 tests); private phone/desktop flow submits all 47 plays, safely rejects after-tip snapshots, displays empty records, and has no overflow or runtime errors.
- [x] Verify successful prospective snapshots on November 9: all 9 saved before tip, and all 3 bot targets match their saved shelf probability and line.
- [ ] Verify November 9 prospective results after final box scores arrive (blocked by future games).
