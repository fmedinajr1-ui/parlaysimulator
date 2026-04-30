
create table if not exists public.court_edge_l3_cache (
  player_slug text primary key,
  player_name text not null,
  totals integer[] not null default '{}',
  raw_scores jsonb not null default '[]'::jsonb,
  fetched_at timestamptz not null default now()
);

create table if not exists public.court_edge_weather_cache (
  city text primary key,
  temp_f numeric,
  humidity numeric,
  wind_mph numeric,
  fetched_at timestamptz not null default now()
);

create table if not exists public.court_edge_runs (
  id uuid primary key default gen_random_uuid(),
  ran_at timestamptz not null default now(),
  source text not null default 'manual',
  log jsonb not null default '[]'::jsonb,
  picks_count integer not null default 0,
  errors jsonb not null default '[]'::jsonb,
  duration_ms integer,
  telegram_sent boolean not null default false
);

create index if not exists court_edge_runs_ran_at_idx on public.court_edge_runs (ran_at desc);

create table if not exists public.court_edge_picks (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references public.court_edge_runs(id) on delete cascade,
  source text not null,
  matchup text,
  player text,
  opponent text,
  market text not null,
  line numeric not null,
  projection numeric not null,
  edge numeric not null,
  edge_pct numeric not null,
  verdict text not null,
  formula jsonb not null default '{}'::jsonb,
  tournament text,
  surface text,
  sets_format text,
  indoor boolean default false,
  weather jsonb,
  commence_at timestamptz,
  graded boolean not null default false,
  result text,
  created_at timestamptz not null default now()
);

create index if not exists court_edge_picks_run_idx on public.court_edge_picks (run_id);
create index if not exists court_edge_picks_verdict_idx on public.court_edge_picks (verdict);
create index if not exists court_edge_picks_commence_idx on public.court_edge_picks (commence_at);

alter table public.court_edge_l3_cache enable row level security;
alter table public.court_edge_weather_cache enable row level security;
alter table public.court_edge_runs enable row level security;
alter table public.court_edge_picks enable row level security;
