DROP INDEX IF EXISTS public.uq_wnba_odds_snap;

UPDATE public.wnba_historical_odds_snapshots SET player_name = '' WHERE player_name IS NULL;
UPDATE public.wnba_historical_odds_snapshots SET line = -999999 WHERE line IS NULL;

ALTER TABLE public.wnba_historical_odds_snapshots
  ALTER COLUMN player_name SET NOT NULL,
  ALTER COLUMN player_name SET DEFAULT '',
  ALTER COLUMN line SET NOT NULL,
  ALTER COLUMN line SET DEFAULT -999999;

ALTER TABLE public.wnba_historical_odds_snapshots
  ADD CONSTRAINT uq_wnba_odds_snap UNIQUE (event_id, market, player_name, line, side, snapshot_tag);