create table if not exists public.research_player_teams (
  player_name text primary key,
  team text not null,
  team_abbr text,
  position text,
  espn_id text,
  updated_at timestamptz not null default now()
);
alter table public.research_player_teams enable row level security;
create policy "public read player teams" on public.research_player_teams for select using (true);
grant select on public.research_player_teams to anon, authenticated;
grant all on public.research_player_teams to service_role;