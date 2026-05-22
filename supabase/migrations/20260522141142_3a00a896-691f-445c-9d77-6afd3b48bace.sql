CREATE TABLE IF NOT EXISTS public.strategy_pnl_rolling (
  strategy_name        text NOT NULL,
  window_days          int  NOT NULL,
  n                    int  NOT NULL DEFAULT 0,
  wins                 int  NOT NULL DEFAULT 0,
  losses               int  NOT NULL DEFAULT 0,
  voids                int  NOT NULL DEFAULT 0,
  hit_rate             numeric(6,4) NOT NULL DEFAULT 0,
  p_smoothed           numeric(6,4) NOT NULL DEFAULT 0,
  avg_decimal_odds     numeric(10,4) NOT NULL DEFAULT 0,
  avg_leg_count        numeric(6,2) NOT NULL DEFAULT 0,
  rolling_ev_per_unit  numeric(8,4) NOT NULL DEFAULT 0,
  rolling_roi          numeric(8,4) NOT NULL DEFAULT 0,
  breakeven_min_decimal numeric(10,4) NOT NULL DEFAULT 0,
  updated_at           timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (strategy_name, window_days)
);

CREATE INDEX IF NOT EXISTS strategy_pnl_rolling_updated_idx
  ON public.strategy_pnl_rolling (updated_at DESC);

ALTER TABLE public.strategy_pnl_rolling ENABLE ROW LEVEL SECURITY;

CREATE POLICY "strategy_pnl_rolling_anon_deny"
  ON public.strategy_pnl_rolling FOR SELECT TO anon USING (false);

CREATE POLICY "strategy_pnl_rolling_authed_read"
  ON public.strategy_pnl_rolling FOR SELECT TO authenticated USING (true);