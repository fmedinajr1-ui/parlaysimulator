

# Telegram Message Formatting Overhaul

## What this changes

Right now your Telegram alerts are data-heavy walls of numbers — lines, percentages, signal types, composite scores. They read like database logs, not betting advice. This plan rewrites the messaging across all three alert sources to be conversational, scannable, and actionable — like a sharp friend texting you a play.

## Scope — 3 files, 3 types of messages

### 1. `fanduel-prediction-alerts` — Signal alerts (lines 770-916)

**Current format:**
```
⚡ VELOCITY SPIKE — NBA
LeBron James PLAYER_POINTS
📊 FanDuel: O 25.5 (-110) / U 25.5 (-110)
Line RISING: 24.5 → 25.5
Speed: 4.2/hr over 15min
⏱ ~8min window remaining
📊 Confidence: 78%
✅ Action: OVER 25.5 -110
💡 Line rising = sharp money on over
```

**New format — conversational, explains WHY:**
```
⚡ VELOCITY SPIKE — NBA

🏀 LeBron James — Points
📍 25.5 (was 24.5) — moved fast

🧠 Why this matters:
Sharp money is pushing this OVER hard — line
jumped a full point in 15 min. Books are
adjusting because they're exposed.

📊 L10 avg 27.3 | Clears line 70% of games
⏱ ~8 min before line locks

✅ Play: OVER 25.5 (-110)
```

Key changes:
- Replace "PLAYER_POINTS" with readable "Points"
- Add a "Why this matters" section explaining the signal in plain English
- Show L10 context inline so you know if the player actually hits this
- Remove composite scores and signal type jargon from user-facing text
- Different "Why" copy per signal type (velocity = sharp money, cascade = sustained institutional, take_it_now = snapback value, trap = manipulation)

### 2. `generate-rbi-parlays` — RBI parlay picks (lines 153-181)

**Current format:**
```
⚾ RBI Parlay Picks

⚾ 2-Leg RBI Lock
  1. Aaron Judge — 🔴 OVER 0.5 RBI
     📊 Signal: price_drift (68% acc) | Score: 83
  2. Mookie Betts — 🟢 UNDER 0.5 RBI
     📊 Signal: cascade (73% acc) | Score: 79

📈 Signal Accuracy (60%+ only):
  price_drift: 68% (32/47)
  cascade: 73% (22/30)
```

**New format — tells a story per leg:**
```
⚾ 2-Leg RBI Lock

1️⃣ Aaron Judge — OVER 0.5 RBI
   💪 Judge has driven in a run in 7 of his
   last 10 games. Line is drifting his way —
   books see it too.
   📊 68% signal accuracy | L10: 7/10 RBI games

2️⃣ Mookie Betts — UNDER 0.5 RBI
   🧊 Betts has been quiet at the plate — 0 RBI
   in 8 of his last 10. Facing a K-heavy pitcher
   makes this even safer.
   📊 73% signal accuracy | L10: 2/10 RBI games

━━━━━━━━━━━━━━━
🎯 Combined edge: Both legs backed by 60%+
   proven signal types
```

Key changes:
- Each leg gets a 1-2 sentence narrative explaining WHY (using L10 data and metadata already available)
- Remove "Score: 83" composite — meaningless to the reader
- Replace "🔴 OVER" / "🟢 UNDER" with contextual emoji (💪 for over, 🧊 for under)
- Add a summary footer instead of raw accuracy tables

### 3. `bot-send-telegram` formatters — Settlement, Sweet Spots, Accuracy Report

**Settlement (`formatSettlement`):**
- Add a one-line narrative verdict: "Solid day — rebs and assists carried us, points busted 3 tickets"
- Change "P/L: +$47 (simulation)" to just the result with context
- Make "Top Busters" more useful: "💔 Steph Curry O6.5 3PT missed in 3 parlays — cold shooting night"

**Sweet Spots (`formatSweetSpotsBroadcast`):**
- Add a one-liner per pick explaining the edge: "Averaging 8.2 over L10 against a 6.5 line"
- Group header should say what the category strength is: "🏀 Points — 67% hit rate this week"

**Accuracy Report (`accuracy-report/index.ts`):**
- Replace raw signal_type names with readable labels
- Add a plain-English top-line: "System is running hot — 64% overall, rebounds carrying the book"
- Replace `n=47` with "47 picks"

### 4. Signal type display names (shared utility)

Create a `SIGNAL_LABELS` map used across all files:
```
velocity_spike → "Sharp Money Spike"
cascade → "Sustained Line Move"  
line_about_to_move → "Early Line Signal"
take_it_now → "Snapback Value Play"
trap_warning → "Trap Alert"
price_drift → "Steady Drift"
```

## Implementation details

- **Files modified:** `fanduel-prediction-alerts/index.ts`, `generate-rbi-parlays/index.ts`, `bot-send-telegram/index.ts`, `accuracy-report/index.ts`
- **No schema changes** — all data needed (L10, metadata, signal type) is already available at formatting time
- **Narrative generation** uses template strings with conditionals — no AI calls, just smart copy based on the data fields already present (l10_hit_rate, signal_type, line movement direction, pitcher stats in metadata)
- **RBI-specific narratives** pull from `metadata.l10_hit_rate`, `metadata.opposing_pitcher`, and the over/under direction to build contextual sentences

## What stays the same
- All data fields, records, and database writes are untouched
- Signal classification, gating, and accuracy logic unchanged
- Telegram send mechanics (pagination, chunking, parse_mode) unchanged
- Admin-only routing and customer broadcast logic unchanged

