
Implement the first manual-training step inside the admin training flow: show all games playing today so you can choose the slate before applying manual bot guidance.

## What exists now

- The project already has an admin training area through `AIGenerativeProgressDashboard` in the Admin page.
- There is an existing proven game-selection pattern in `src/components/scout/ScoutGameSelector.tsx` that reads today’s games from `unified_props` using:
  - `sport = basketball_nba`
  - `event_id`
  - `game_description`
  - `commence_time`
- The backend already stores persistent operator rules in `bot_owner_rules`, which is the right place for later manual training instructions.

## Current “today” game feed seen in data

Based on the current live props table, today currently includes these games:
- Dallas Stars @ Minnesota Wild
- Phoenix Suns @ Oklahoma City Thunder
- Anaheim Ducks @ Edmonton Oilers

Only one of those is NBA, so the first step should focus on filtering to the target sport and showing only valid game options for the bot you want to train.

## What will be built

### 1. Add a “Manual Training — Step 1: Today’s Games” panel
Place a new section in the admin training area that:
- fetches today’s playable games
- shows game cards in time order
- includes:
  - matchup
  - start time
  - sport
  - available book count
  - prop row count
- lets you select one game as the active training target

Likely file:
- `src/components/admin/AIGenerativeProgressDashboard.tsx`

### 2. Create a dedicated hook for today’s training games
Add a hook that centralizes the logic for:
- Eastern-time day bounds
- target sport filtering
- unique game extraction from `unified_props`
- sorting by `commence_time`
- loading/error states
- selected game state

Likely file:
- new `src/hooks/useManualTrainingGames.ts`

This should follow the same date/game extraction pattern already used in `ScoutGameSelector`, but shaped for the admin training workflow.

### 3. Filter to the correct sport instead of showing mixed slates
The current raw data includes NBA and NHL in the same day window. For this first training step:
- default to `basketball_nba`
- optionally allow a sport selector later if you want multi-sport manual training
- only show games relevant to the bot engine being trained

This avoids confusing you with unrelated games.

### 4. Show quick “book scan health” for each game
Each game card should surface whether the data is usable before you train it:
- bookmakers present
- number of active props
- earliest/latest line update
- whether FanDuel rows exist
- whether data looks stale

This keeps Step 1 useful operationally, not just a plain game list.

### 5. Store the selected game locally in the admin training flow
When you click a game:
- mark it as the active game
- keep it in component/hook state for now
- use that selected `event_id` and matchup as the input to the next manual-training step

No database write is needed yet for Step 1.

### 6. Prepare the contract for Step 2 manual bot training
Once a game is selected, expose a stable selected-game object that the next step can use for:
- player list for that game
- current book lines
- manual notes/instructions
- later saving tailored operator rules into `bot_owner_rules`

## UI behavior

Top of the section:
- “Manual Training”
- subtitle: “Step 1 — Choose today’s game”

Inside the panel:
- refresh button
- optional sport filter
- list/grid of today’s games
- selected state highlight
- empty state if no valid games are found

Card content example:
- Phoenix Suns @ Oklahoma City Thunder
- 9:40 PM ET
- NBA
- 3 books
- 353 prop rows
- Fresh / Stale status

## Technical details

- Reuse the `unified_props` source because it already drives live slate/game discovery.
- Group by `event_id` when available; fall back carefully if needed.
- Use Eastern-time date bounds consistently.
- Prefer a hook-based client query for this step rather than a new backend function, since this is lightweight and already follows an existing project pattern.
- Do not write training rules yet; Step 1 is selection only.
- Keep later persistence targeted to `bot_owner_rules`, since that is the project’s established operator override store.

## Expected outcome

After this change, you’ll be able to open the admin training area, see all valid games playing today for the target bot, and select one as the starting point for manual training. Once that is in place, the next step can focus on the selected game’s players, lines, and tailored instructions.
