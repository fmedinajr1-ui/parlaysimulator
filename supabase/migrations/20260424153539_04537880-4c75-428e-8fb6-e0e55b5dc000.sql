-- FanDuel Boost Fader tables

create table if not exists public.fanduel_boosts (
  id uuid primary key default gen_random_uuid(),
  boost_hash text unique not null,
  title text not null,
  category text,
  sport text,
  original_odds integer,
  boosted_odds integer not null,
  pays_text text,
  legs jsonb not null,
  raw_text text,
  source_url text,
  scraped_at timestamptz not null default now(),
  expires_at timestamptz
);

create index if not exists idx_fanduel_boosts_scraped_at on public.fanduel_boosts (scraped_at desc);
create index if not exists idx_fanduel_boosts_sport on public.fanduel_boosts (sport);

create table if not exists public.fanduel_boost_fades (
  id uuid primary key default gen_random_uuid(),
  boost_id uuid not null references public.fanduel_boosts(id) on delete cascade,
  fade_legs jsonb not null default '[]'::jsonb,
  skipped_legs jsonb not null default '[]'::jsonb,
  combined_american_odds integer,
  combined_fade_edge_pct numeric,
  verdict text not null check (verdict in ('fade','skip')),
  telegram_sent_at timestamptz,
  created_at timestamptz not null default now(),
  unique (boost_id)
);

create index if not exists idx_fanduel_boost_fades_unsent on public.fanduel_boost_fades (telegram_sent_at) where telegram_sent_at is null;

alter table public.fanduel_boosts enable row level security;
alter table public.fanduel_boost_fades enable row level security;

-- Admin-only read; writes via service role bypass RLS automatically.
create policy "admins read fanduel_boosts"
  on public.fanduel_boosts for select
  to authenticated
  using (public.has_role(auth.uid(), 'admin'));

create policy "admins read fanduel_boost_fades"
  on public.fanduel_boost_fades for select
  to authenticated
  using (public.has_role(auth.uid(), 'admin'));