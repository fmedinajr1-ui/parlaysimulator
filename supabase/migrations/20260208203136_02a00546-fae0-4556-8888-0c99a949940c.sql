-- Step 1: Add sport column to bot_category_weights
ALTER TABLE bot_category_weights 
ADD COLUMN IF NOT EXISTS sport TEXT DEFAULT 'basketball_nba';

-- Step 2: Drop all conflicting constraints
ALTER TABLE bot_category_weights 
DROP CONSTRAINT IF EXISTS bot_category_weights_category_key;

ALTER TABLE bot_category_weights 
DROP CONSTRAINT IF EXISTS bot_category_weights_category_side_key;

-- Step 3: Add the new sport-aware unique constraint
ALTER TABLE bot_category_weights 
DROP CONSTRAINT IF EXISTS bot_category_weights_category_side_sport_key;

ALTER TABLE bot_category_weights 
ADD CONSTRAINT bot_category_weights_category_side_sport_key 
UNIQUE(category, side, sport);

-- Step 4: Add index for sport queries
CREATE INDEX IF NOT EXISTS idx_category_weights_sport ON bot_category_weights(sport);