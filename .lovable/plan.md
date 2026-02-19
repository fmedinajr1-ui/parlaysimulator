

## Simplify Customer Scout View -- No Game Selector, No Admin UI

### What Changes

**For customers**, the Scout page becomes a simple, locked-down view:
- No game selector (admin controls which game is active)
- No header (title, description, Beta badge)
- No "How It Works" card
- No sidebar navigation links (Bot, Analysis)
- Sweet Spot Props filters out fake lines (e.g. 0.5 for 3PT)

Customers land on the page and immediately see the stream placeholder plus props/hedge panels for whichever game the admin has set as "active."

### How Admin Controls the Active Game

A new database table `scout_active_game` stores which game is currently being streamed to customers. The admin selects a game normally; a "Set Live for Customers" button saves that game's context. The customer view reads from this table instead of showing a game picker.

### Technical Details

**1. New database table: `scout_active_game`**

```sql
CREATE TABLE public.scout_active_game (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id text NOT NULL,
  home_team text NOT NULL,
  away_team text NOT NULL,
  game_description text,
  commence_time timestamptz,
  set_by uuid REFERENCES auth.users(id),
  updated_at timestamptz DEFAULT now()
);

-- Only one row ever exists (upsert pattern)
-- RLS: anyone can read, only admins can write
ALTER TABLE public.scout_active_game ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can read active game"
  ON public.scout_active_game FOR SELECT
  USING (true);

CREATE POLICY "Admins can manage active game"
  ON public.scout_active_game FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM public.user_roles
      WHERE user_id = auth.uid() AND role = 'admin'
    )
  );
```

**2. `src/pages/Scout.tsx`**

- When `isCustomer` is true:
  - Hide the header section (title, description, Beta badge)
  - Hide `ScoutGameSelector` entirely
  - Hide the "How It Works" card
  - Instead, fetch the active game from `scout_active_game` and auto-set it as `selectedGame`
  - Show `CustomerScoutView` immediately (or a "No game live" message if no active game)
- When admin (`!isCustomer`):
  - Add a "Set Live for Customers" button next to the game selector that upserts to `scout_active_game`

**3. `src/components/layout/DesktopSidebar.tsx`**

- Detect when on `/scout?test_customer=true`
- Hide the main nav items (Bot, Analysis) so the customer sees a clean, single-purpose layout

**4. `src/components/scout/ScoutSweetSpotProps.tsx`**

- Filter out picks with `recommended_line < 1.5` (removes fake 0.5 lines for 3PT and similar)
- Only display props with realistic sportsbook lines

**5. `src/components/scout/CustomerScoutView.tsx`**

- No structural changes -- it already only shows stream + props + hedge panels
- The game context will now come from the admin-set active game instead of user selection

### User Flow

```text
Admin Flow:
  Select game in Scout -> Click "Set Live" -> Game saved to DB
  
Customer Flow:
  Visit /scout -> Active game auto-loaded from DB -> See stream + props + hedges
  (No selector, no header, no admin controls visible)
```

