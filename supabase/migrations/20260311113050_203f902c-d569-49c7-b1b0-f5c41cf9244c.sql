
-- Merge split prop type variants in bot_player_performance
-- Canonical mapping: threes/3pm/three_pointers → player_threes, points/pts → player_points, etc.

-- Step 1: For each canonical prop type, merge non-canonical rows into the canonical row
-- We'll handle this by: for each player+side combo, if both 'threes' and 'player_threes' exist,
-- add the threes stats into player_threes, then delete the threes row.

DO $$
DECLARE
  variant RECORD;
  canonical_row RECORD;
BEGIN
  -- Define mappings: old_name → canonical_name
  FOR variant IN
    SELECT unnest(ARRAY['threes','3pm','three_pointers']) AS old_name, 'player_threes' AS canonical
    UNION ALL
    SELECT unnest(ARRAY['points','pts']) AS old_name, 'player_points' AS canonical
    UNION ALL
    SELECT unnest(ARRAY['rebounds','reb']) AS old_name, 'player_rebounds' AS canonical
    UNION ALL
    SELECT unnest(ARRAY['assists','ast']) AS old_name, 'player_assists' AS canonical
    UNION ALL
    SELECT unnest(ARRAY['blocks','blk']) AS old_name, 'player_blocks' AS canonical
    UNION ALL
    SELECT unnest(ARRAY['steals','stl']) AS old_name, 'player_steals' AS canonical
    UNION ALL
    SELECT unnest(ARRAY['turnovers']) AS old_name, 'player_turnovers' AS canonical
  LOOP
    -- For rows where canonical already exists: merge stats
    UPDATE bot_player_performance canonical_p
    SET
      legs_played = canonical_p.legs_played + old_p.legs_played,
      legs_won = canonical_p.legs_won + old_p.legs_won,
      hit_rate = CASE 
        WHEN (canonical_p.legs_played + old_p.legs_played) > 0 
        THEN (canonical_p.legs_won + old_p.legs_won)::numeric / (canonical_p.legs_played + old_p.legs_played) * 100
        ELSE 0 
      END,
      streak = CASE WHEN old_p.last_updated > canonical_p.last_updated THEN old_p.streak ELSE canonical_p.streak END,
      last_updated = GREATEST(canonical_p.last_updated, old_p.last_updated)
    FROM bot_player_performance old_p
    WHERE old_p.prop_type = variant.old_name
      AND canonical_p.prop_type = variant.canonical
      AND old_p.player_name = canonical_p.player_name
      AND old_p.side = canonical_p.side;

    -- Delete the old variant rows that were merged
    DELETE FROM bot_player_performance old_p
    USING bot_player_performance canonical_p
    WHERE old_p.prop_type = variant.old_name
      AND canonical_p.prop_type = variant.canonical
      AND old_p.player_name = canonical_p.player_name
      AND old_p.side = canonical_p.side;

    -- For remaining old rows (no canonical counterpart): just rename
    UPDATE bot_player_performance
    SET prop_type = variant.canonical
    WHERE prop_type = variant.old_name;
  END LOOP;
END $$;
