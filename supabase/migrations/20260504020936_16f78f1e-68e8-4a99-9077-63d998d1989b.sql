
-- ===== Live AI tables =====
create table if not exists public.live_ai_conversations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  title text,
  mode text not null default 'smart' check (mode in ('aggressive','smart','safe')),
  live_mode boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.live_ai_conversations enable row level security;
create policy "own conv select" on public.live_ai_conversations for select using (auth.uid() = user_id);
create policy "own conv insert" on public.live_ai_conversations for insert with check (auth.uid() = user_id);
create policy "own conv update" on public.live_ai_conversations for update using (auth.uid() = user_id);
create policy "own conv delete" on public.live_ai_conversations for delete using (auth.uid() = user_id);

create table if not exists public.live_ai_messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.live_ai_conversations(id) on delete cascade,
  user_id uuid not null,
  role text not null check (role in ('user','assistant','tool','system')),
  content text,
  tool_calls jsonb,
  tool_name text,
  tool_result jsonb,
  audio_url text,
  avatar_video_url text,
  created_at timestamptz not null default now()
);
alter table public.live_ai_messages enable row level security;
create policy "own msg select" on public.live_ai_messages for select using (auth.uid() = user_id);
create policy "own msg insert" on public.live_ai_messages for insert with check (auth.uid() = user_id);
create index if not exists live_ai_messages_conv_idx on public.live_ai_messages(conversation_id, created_at);

create table if not exists public.live_ai_generated_parlays (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  conversation_id uuid references public.live_ai_conversations(id) on delete set null,
  mode text not null,
  legs jsonb not null,
  combined_odds numeric,
  confidence numeric,
  whale_signal text,
  rationale text,
  status text not null default 'suggested' check (status in ('suggested','saved','sent','dismissed')),
  created_at timestamptz not null default now()
);
alter table public.live_ai_generated_parlays enable row level security;
create policy "own par select" on public.live_ai_generated_parlays for select using (auth.uid() = user_id);
create policy "own par insert" on public.live_ai_generated_parlays for insert with check (auth.uid() = user_id);
create policy "own par update" on public.live_ai_generated_parlays for update using (auth.uid() = user_id);

create table if not exists public.live_ai_user_prefs (
  user_id uuid primary key,
  default_mode text not null default 'smart',
  voice_id text not null default 'nPczCjzI2devNBz1zQrb',
  ny_accent boolean not null default true,
  push_enabled boolean not null default false,
  favorite_teams text[] not null default '{}',
  free_parlays_used_today int not null default 0,
  free_parlays_reset_date date not null default current_date,
  is_premium boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.live_ai_user_prefs enable row level security;
create policy "own pref select" on public.live_ai_user_prefs for select using (auth.uid() = user_id);
create policy "own pref insert" on public.live_ai_user_prefs for insert with check (auth.uid() = user_id);
create policy "own pref update" on public.live_ai_user_prefs for update using (auth.uid() = user_id);

create table if not exists public.live_ai_avatar_cache (
  id uuid primary key default gen_random_uuid(),
  text_hash text not null unique,
  text_preview text,
  voice_id text not null,
  audio_url text,
  avatar_video_url text not null,
  heygen_video_id text,
  duration_seconds numeric,
  created_at timestamptz not null default now(),
  hit_count int not null default 1
);
alter table public.live_ai_avatar_cache enable row level security;
create policy "cache read all auth" on public.live_ai_avatar_cache for select to authenticated using (true);
create index if not exists live_ai_avatar_cache_hash_idx on public.live_ai_avatar_cache(text_hash);

create table if not exists public.live_ai_alerts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  conversation_id uuid references public.live_ai_conversations(id) on delete set null,
  alert_type text not null,
  title text not null,
  body text not null,
  game_id text,
  player_name text,
  urgency text not null default 'normal' check (urgency in ('low','normal','high','take_it_now')),
  payload jsonb,
  acknowledged boolean not null default false,
  created_at timestamptz not null default now()
);
alter table public.live_ai_alerts enable row level security;
create policy "own alert select" on public.live_ai_alerts for select using (auth.uid() = user_id);
create policy "own alert update" on public.live_ai_alerts for update using (auth.uid() = user_id);
create index if not exists live_ai_alerts_user_idx on public.live_ai_alerts(user_id, created_at desc);

alter publication supabase_realtime add table public.live_ai_alerts;
alter publication supabase_realtime add table public.live_ai_messages;

-- updated_at triggers
create or replace function public.live_ai_touch_updated_at()
returns trigger language plpgsql set search_path = public as $$
begin new.updated_at = now(); return new; end; $$;

create trigger live_ai_conv_touch before update on public.live_ai_conversations
  for each row execute function public.live_ai_touch_updated_at();
create trigger live_ai_pref_touch before update on public.live_ai_user_prefs
  for each row execute function public.live_ai_touch_updated_at();

-- ===== Storage buckets =====
insert into storage.buckets (id, name, public) values ('dog-avatar-assets', 'dog-avatar-assets', true)
  on conflict (id) do nothing;
insert into storage.buckets (id, name, public) values ('live-ai-slips', 'live-ai-slips', false)
  on conflict (id) do nothing;
insert into storage.buckets (id, name, public) values ('live-ai-avatar-clips', 'live-ai-avatar-clips', true)
  on conflict (id) do nothing;

create policy "dog avatar public read" on storage.objects for select using (bucket_id = 'dog-avatar-assets');
create policy "avatar clips public read" on storage.objects for select using (bucket_id = 'live-ai-avatar-clips');
create policy "slips own read" on storage.objects for select
  using (bucket_id = 'live-ai-slips' and auth.uid()::text = (storage.foldername(name))[1]);
create policy "slips own insert" on storage.objects for insert
  with check (bucket_id = 'live-ai-slips' and auth.uid()::text = (storage.foldername(name))[1]);
create policy "slips own delete" on storage.objects for delete
  using (bucket_id = 'live-ai-slips' and auth.uid()::text = (storage.foldername(name))[1]);
