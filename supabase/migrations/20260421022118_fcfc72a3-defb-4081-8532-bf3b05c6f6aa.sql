alter table public.tiktok_post_queue add column if not exists ab_group_id uuid;

alter table public.tiktok_posts
  add column if not exists ab_group_id uuid,
  add column if not exists completion_rate numeric,
  add column if not exists viral_score numeric,
  add column if not exists metrics_synced_at timestamptz;

alter table public.tiktok_accounts
  add column if not exists wins int not null default 0,
  add column if not exists losses int not null default 0;

create index if not exists tiktok_posts_ab_group_idx
  on public.tiktok_posts (ab_group_id)
  where ab_group_id is not null;

create index if not exists tiktok_post_queue_ab_group_idx
  on public.tiktok_post_queue (ab_group_id)
  where ab_group_id is not null;