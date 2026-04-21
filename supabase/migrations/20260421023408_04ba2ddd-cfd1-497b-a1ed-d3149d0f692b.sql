create table if not exists public.telegram_bot_state (
  id int primary key check (id = 1),
  update_offset bigint not null default 0,
  pinned_header_message_id bigint,
  pinned_header_chat_id bigint,
  updated_at timestamptz not null default now()
);

insert into public.telegram_bot_state (id, update_offset)
  values (1, 0)
  on conflict (id) do nothing;

alter table public.telegram_bot_state enable row level security;

create policy "service role manages bot state"
  on public.telegram_bot_state
  for all
  using (auth.role() = 'service_role')
  with check (auth.role() = 'service_role');

create table if not exists public.telegram_alert_batch_buffer (
  id uuid primary key default gen_random_uuid(),
  chat_id bigint not null,
  signal_type text not null,
  payload jsonb not null,
  created_at timestamptz not null default now()
);

create index if not exists idx_telegram_alert_batch_buffer_chat_created
  on public.telegram_alert_batch_buffer (chat_id, created_at);

alter table public.telegram_alert_batch_buffer enable row level security;

create policy "service role manages buffer"
  on public.telegram_alert_batch_buffer
  for all
  using (auth.role() = 'service_role')
  with check (auth.role() = 'service_role');