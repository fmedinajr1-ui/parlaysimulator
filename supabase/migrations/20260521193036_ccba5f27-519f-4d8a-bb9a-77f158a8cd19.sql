create table if not exists public.cross_sport_sweet_spots (
  id uuid primary key default gen_random_uuid(),
  analysis_date date not null,
  sport text not null,
  market_type text not null check (market_type in ('player','moneyline','spread','total')),
  event_id text,
  game_description text,
  commence_time timestamptz,
  team text,
  opponent text,
  player_name text,
  prop_type text not null,
  recommended_side text not null,
  recommended_line numeric,
  price numeric,
  implied_prob numeric,
  model_confidence numeric not null,
  safety_score numeric not null,
  tier text not null check (tier in ('lock','strong','lean')),
  l10_hit_rate numeric,
  l10_avg numeric,
  l10_min numeric,
  l10_max numeric,
  l10_median numeric,
  games_played integer,
  research_boost numeric default 0,
  research_notes text,
  bookmaker text,
  is_active boolean default true,
  created_at timestamptz default now()
);

create index if not exists idx_css_active on public.cross_sport_sweet_spots(analysis_date, is_active, tier);
create index if not exists idx_css_sport on public.cross_sport_sweet_spots(analysis_date, sport);
create index if not exists idx_css_event on public.cross_sport_sweet_spots(event_id);

alter table public.cross_sport_sweet_spots enable row level security;

create policy "css read all" on public.cross_sport_sweet_spots for select using (true);
create policy "css service insert" on public.cross_sport_sweet_spots for insert with check (true);
create policy "css service update" on public.cross_sport_sweet_spots for update using (true);