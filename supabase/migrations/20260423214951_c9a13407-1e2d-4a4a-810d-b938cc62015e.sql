create table if not exists public.telegram_bot_state (
  id int primary key check (id = 1),
  update_offset bigint not null default 0,
  updated_at timestamptz not null default now()
);

insert into public.telegram_bot_state (id, update_offset)
values (1, 0)
on conflict (id) do nothing;

alter table public.telegram_bot_state enable row level security;

-- No policies => no access for anon/authenticated. Only service_role bypasses RLS.