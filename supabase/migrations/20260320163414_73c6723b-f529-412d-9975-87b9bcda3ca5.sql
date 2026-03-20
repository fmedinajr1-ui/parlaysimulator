ALTER TABLE hedge_telegram_tracker 
  ADD COLUMN IF NOT EXISTS actual_value numeric,
  ADD COLUMN IF NOT EXISTS outcome text,
  ADD COLUMN IF NOT EXISTS hedge_was_correct boolean,
  ADD COLUMN IF NOT EXISTS live_book_line numeric,
  ADD COLUMN IF NOT EXISTS line_source text DEFAULT 'sweet_spot';