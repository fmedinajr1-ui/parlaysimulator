
-- live_events
create table public.live_events (
  id uuid primary key default gen_random_uuid(),
  sport text not null,
  game_id text not null,
  event_time timestamptz not null,
  event_type text not null,
  player_name text,
  team text,
  raw_data jsonb,
  created_at timestamptz not null default now()
);
create index idx_live_events_game_time on public.live_events (game_id, event_time desc);
create index idx_live_events_type_created on public.live_events (event_type, created_at desc);

-- market_snapshot
create table public.market_snapshot (
  id uuid primary key default gen_random_uuid(),
  sportsbook text not null,
  game_id text not null,
  market_type text not null,
  player_name text,
  line numeric,
  odds numeric,
  captured_at timestamptz not null default now()
);
create index idx_market_snapshot_game_market_time on public.market_snapshot (game_id, market_type, captured_at desc);
create index idx_market_snapshot_game_player_market_time on public.market_snapshot (game_id, player_name, market_type, captured_at desc);

-- lag_edges
create table public.lag_edges (
  id uuid primary key default gen_random_uuid(),
  game_id text not null,
  player_name text,
  edge_type text not null,
  market_delay_seconds numeric,
  excess_lag_seconds numeric,
  event_impact numeric,
  confidence numeric,
  expected_move numeric,
  model_edge numeric,
  stake_units numeric,
  status text not null default 'active',
  expires_at timestamptz,
  fired_at timestamptz,
  closing_line numeric,
  actual_move numeric,
  outcome text,
  source_event_id uuid references public.live_events(id) on delete set null,
  source_snapshot_id uuid references public.market_snapshot(id) on delete set null,
  created_at timestamptz not null default now()
);
create index idx_lag_edges_active_expires on public.lag_edges (status, expires_at) where status = 'active';
create index idx_lag_edges_game_created on public.lag_edges (game_id, created_at desc);
create unique index uniq_lag_edges_event_type on public.lag_edges (source_event_id, edge_type);

-- market_baselines
create table public.market_baselines (
  market_type text primary key,
  baseline_lag_seconds numeric not null,
  updated_at timestamptz not null default now()
);
insert into public.market_baselines (market_type, baseline_lag_seconds) values
  ('player_ast', 4),
  ('player_pra', 6),
  ('player_pts', 5),
  ('player_reb', 5),
  ('live_spread', 2),
  ('live_total', 3),
  ('team_score', 1)
on conflict (market_type) do nothing;

-- RLS
alter table public.live_events enable row level security;
alter table public.market_snapshot enable row level security;
alter table public.lag_edges enable row level security;
alter table public.market_baselines enable row level security;

create policy "admins read live_events" on public.live_events
  for select to authenticated using (public.has_role(auth.uid(), 'admin'));
create policy "admins read market_snapshot" on public.market_snapshot
  for select to authenticated using (public.has_role(auth.uid(), 'admin'));
create policy "admins read lag_edges" on public.lag_edges
  for select to authenticated using (public.has_role(auth.uid(), 'admin'));
create policy "admins read market_baselines" on public.market_baselines
  for select to authenticated using (public.has_role(auth.uid(), 'admin'));

-- realtime for lag_edges (admin UI subscription)
alter publication supabase_realtime add table public.lag_edges;
