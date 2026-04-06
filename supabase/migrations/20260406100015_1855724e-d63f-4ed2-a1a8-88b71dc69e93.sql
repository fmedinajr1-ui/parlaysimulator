
-- 1. bot_owner_rules: Central rules registry
CREATE TABLE public.bot_owner_rules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  rule_key text UNIQUE NOT NULL,
  rule_description text NOT NULL,
  rule_logic jsonb NOT NULL,
  applies_to text[] NOT NULL,
  enforcement text DEFAULT 'hard_block',
  is_active boolean DEFAULT true,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

ALTER TABLE public.bot_owner_rules ENABLE ROW LEVEL SECURITY;

-- 2. bot_daily_schedule: All-day scanning windows
CREATE TABLE public.bot_daily_schedule (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  window_name text UNIQUE NOT NULL,
  window_start_et text NOT NULL,
  window_end_et text NOT NULL,
  actions text[] NOT NULL,
  description text,
  is_active boolean DEFAULT true,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE public.bot_daily_schedule ENABLE ROW LEVEL SECURITY;

-- 3. bot_audit_log: Self-audit violation tracking
CREATE TABLE public.bot_audit_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  audit_time timestamptz DEFAULT now(),
  rule_key text NOT NULL,
  violation_description text NOT NULL,
  action_taken text NOT NULL DEFAULT 'blocked',
  affected_record_id text,
  affected_table text,
  metadata jsonb,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE public.bot_audit_log ENABLE ROW LEVEL SECURITY;

-- 4. bot_schedule_runs: Track which windows ran today
CREATE TABLE public.bot_schedule_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_date text NOT NULL,
  window_name text NOT NULL,
  started_at timestamptz DEFAULT now(),
  completed_at timestamptz,
  status text DEFAULT 'running',
  results jsonb,
  actions_executed text[],
  audit_summary jsonb,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE public.bot_schedule_runs ENABLE ROW LEVEL SECURITY;
