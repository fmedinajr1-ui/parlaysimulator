-- Add normalized_name column for reliable ESPN matching
ALTER TABLE bdl_player_cache 
ADD COLUMN IF NOT EXISTS normalized_name TEXT;

-- Create index for fast lookups
CREATE INDEX IF NOT EXISTS idx_bdl_player_cache_normalized_name 
ON bdl_player_cache(normalized_name);

-- Pre-populate normalized_name for existing players
UPDATE bdl_player_cache
SET normalized_name = LOWER(
  TRIM(
    REGEXP_REPLACE(
      REGEXP_REPLACE(
        REGEXP_REPLACE(
          REGEXP_REPLACE(
            TRANSLATE(player_name, 'ŞşĞğİıÖöÜüÇçéèêëàâäùûüôîïœæ''`', 'SsGgIiOoUuCceeeeaaauuuoiioea'),
            '\.', '', 'g'
          ),
          '\s+(Jr\.?|Sr\.?|III|II|IV|V)$', '', 'i'
        ),
        '[''`]', '', 'g'
      ),
      '\s+', ' ', 'g'
    )
  )
)
WHERE normalized_name IS NULL;