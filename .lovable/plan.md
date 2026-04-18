

The user wants me to send/list every file related to the Telegram pipeline so they can review the whole system working cohesively. This is a discovery/listing task. Let me map out the full Telegram pipeline files.

From context I know there are many functions touching Telegram. Let me organize by role:

**Core sender:**
- `bot-send-telegram` — central dispatcher (has chunking, formatters, admin-only routing)

**Receivers / polling:**
- Telegram poll function (if exists)
- Webhook handlers

**Broadcasters (call bot-send-telegram):**
- `broadcast-sweet-spots`
- `telegram-audit-report`
- `morning-prep-pipeline` (orchestrator that triggers downstream)
- `morning-data-refresh`
- All the v2 generators just built (rbi, sb, cross-sport, nba bench)
- Cascade parlay generator
- Hedge alerts
- Pipeline monitoring
- NBA matchup daily broadcast
- Settlement orchestrator results
- Various analyzers that send their own digests

I should present a plan that lists every file and offers to either:
1. Concatenate them into a single review document at /mnt/documents/
2. Just list paths grouped by role
3. Print contents inline grouped

The cleanest deliverable is option 1 — a single markdown file with each file's contents grouped by pipeline stage. That's a build/exec task so I need a plan first.

Plan:

1. Discover all Telegram-related files (search for `bot-send-telegram`, `sendMessage`, `parse_mode`, telegram references)
2. Group into stages: Sender → Broadcasters → Generators → Settlers/Audit → Polling/Receivers → UI controls
3. Bundle everything into `/mnt/documents/telegram-pipeline-review.md` with each file's path + contents
4. Also produce a one-page architecture map (which file calls which) at the top

Keep it tight.

# Bundle Full Telegram Pipeline for Review

## Goal
Produce one downloadable file containing every piece of the Telegram pipeline so you can audit how it fits together.

## Steps

1. **Discover** every file that touches Telegram (sender, broadcasters, generators that call `bot-send-telegram`, polling/receiver, UI toggles, settings tables).

2. **Group** by pipeline stage:
   - **Central sender**: `bot-send-telegram` (dispatcher, formatters, chunking, admin-only routing)
   - **Receivers**: telegram polling function, webhook handlers, manual import handler
   - **Broadcasters** (orchestrator-triggered digests): `broadcast-sweet-spots`, `telegram-audit-report`, `morning-prep-pipeline`, `morning-data-refresh`, pipeline monitoring alerts
   - **Generators that send their own slate** (the v2 stack): `generate-rbi-parlays-v2`, `generate-sb-over-parlays`, `generate-cross-sport-parlays-v2`, `nba-bench-under-generator-v2`, `mlb-cascade-parlay-generator`
   - **Settlement & alerts**: settlement-orchestrator notify, hedge tracker push, fanduel-prediction-alerts dispatch
   - **UI / config**: notification settings page, authorized accounts table, bot_owner_rules

3. **Bundle** into `/mnt/documents/telegram-pipeline-review.md`:
   - Top section: architecture map (ASCII diagram showing call flow)
   - For each file: path header + full source
   - Sections separated by `---`

4. **Architecture map** at top will look like:
   ```
   ┌─────────────────────────────┐
   │  bot-send-telegram          │ ← single dispatcher (chunking, admin gate)
   └────────────▲────────────────┘
                │
   ┌────────────┴────────────────────────────────┐
   │ Broadcasters         Generators (self-send) │
   │ - broadcast-sweet    - generate-rbi-v2      │
   │ - telegram-audit     - generate-sb-over     │
   │ - morning-prep       - generate-cross-v2    │
   │ - morning-data       - nba-bench-under-v2   │
   │ - pipeline-monitor   - mlb-cascade-parlay   │
   └────────────▲────────────────────────────────┘
                │ inbound
   ┌────────────┴────────────────┐
   │ telegram-poll (getUpdates)  │ → telegram_messages table
   └─────────────────────────────┘
   ```

5. **Deliver** via `<lov-artifact>` tag so you can download and review offline.

## Output
- `/mnt/documents/telegram-pipeline-review.md` (single file, all source bundled, ~500-1500KB depending on file sizes)
- In-chat summary listing each file path included + a 1-line "what it does"

## What I will NOT do
- Won't make code changes
- Won't fix the bugs from the prior sweet-spot audit (waiting on your 1/2/3 reply for that)
- Won't include unrelated edge functions even if they import supabase

