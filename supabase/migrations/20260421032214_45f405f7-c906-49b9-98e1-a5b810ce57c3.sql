create table public.bot_pick_actions (
  id uuid primary key default gen_random_uuid(),
  chat_id bigint not null,
  pick_id text,
  parlay_id text,
  player_name text,
  action text not null check (action in ('run','fade','scan','mute_30m')),
  created_at timestamptz not null default now()
);
create index idx_bot_pick_actions_chat_pick on public.bot_pick_actions (chat_id, pick_id);
create index idx_bot_pick_actions_pick_action on public.bot_pick_actions (pick_id, action);
create index idx_bot_pick_actions_mute_lookup on public.bot_pick_actions (chat_id, action, created_at) where action = 'mute_30m';
alter table public.bot_pick_actions enable row level security;
create policy "service role full access bot_pick_actions" on public.bot_pick_actions
  for all using (auth.role() = 'service_role') with check (auth.role() = 'service_role');