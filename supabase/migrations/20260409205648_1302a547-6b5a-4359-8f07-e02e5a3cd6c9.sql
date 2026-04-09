-- 1. Add is_force_blocked to bot_category_weights for DB-driven kill gates
ALTER TABLE public.bot_category_weights 
  ADD COLUMN IF NOT EXISTS is_force_blocked boolean NOT NULL DEFAULT false;

-- 2. Add contrarian_flip_applied to fanduel_prediction_alerts
ALTER TABLE public.fanduel_prediction_alerts 
  ADD COLUMN IF NOT EXISTS contrarian_flip_applied boolean DEFAULT false;

-- 3. Seed existing force-blocked categories
UPDATE public.bot_category_weights 
  SET is_force_blocked = true, is_blocked = true, block_reason = 'force-blocked: historically unprofitable'
  WHERE (category = 'ML_FAVORITE' AND side = 'home')
     OR (category = 'ML_FAVORITE' AND side = 'away');