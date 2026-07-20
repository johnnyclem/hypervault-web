
alter table public.profiles
  add column if not exists digestion_enabled boolean not null default false;

create table if not exists public.digest_runs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  source_memory_id uuid not null,
  branch_id uuid not null references public.memory_branches (id) on delete cascade,
  source_title text not null default '',
  strategy text not null default 'none',
  segment_count integer not null default 0,
  status text not null default 'pending' check (status in ('pending', 'applied', 'rejected')),
  created_at timestamptz not null default now(),
  reviewed_at timestamptz
);

create index if not exists digest_runs_user_idx on public.digest_runs (user_id, created_at desc);
create index if not exists digest_runs_open_idx on public.digest_runs (user_id) where status = 'pending';

create unique index if not exists digest_runs_one_pending_per_source_idx
  on public.digest_runs (user_id, source_memory_id) where status = 'pending';

create table if not exists public.digest_segments (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references public.digest_runs (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  ordinal integer not null,
  new_memory_id uuid not null,
  title text not null default '',
  content text not null default '',
  summary text not null default '',
  tags text[] not null default '{}',
  reason text not null default '',
  created_at timestamptz not null default now(),
  unique (run_id, ordinal)
);

create index if not exists digest_segments_run_idx on public.digest_segments (run_id, ordinal);
create index if not exists digest_segments_user_idx on public.digest_segments (user_id);

alter table public.digest_runs enable row level security;
alter table public.digest_segments enable row level security;

drop policy if exists "digest_runs_select_own" on public.digest_runs;
create policy "digest_runs_select_own" on public.digest_runs
  for select using (auth.uid() = user_id);
drop policy if exists "digest_runs_insert_own" on public.digest_runs;
create policy "digest_runs_insert_own" on public.digest_runs
  for insert with check (auth.uid() = user_id);
drop policy if exists "digest_runs_update_own" on public.digest_runs;
create policy "digest_runs_update_own" on public.digest_runs
  for update using (auth.uid() = user_id);
drop policy if exists "digest_runs_delete_own" on public.digest_runs;
create policy "digest_runs_delete_own" on public.digest_runs
  for delete using (auth.uid() = user_id);

drop policy if exists "digest_segments_select_own" on public.digest_segments;
create policy "digest_segments_select_own" on public.digest_segments
  for select using (auth.uid() = user_id);
drop policy if exists "digest_segments_insert_own" on public.digest_segments;
create policy "digest_segments_insert_own" on public.digest_segments
  for insert with check (auth.uid() = user_id);
drop policy if exists "digest_segments_update_own" on public.digest_segments;
create policy "digest_segments_update_own" on public.digest_segments
  for update using (auth.uid() = user_id);
drop policy if exists "digest_segments_delete_own" on public.digest_segments;
create policy "digest_segments_delete_own" on public.digest_segments
  for delete using (auth.uid() = user_id);

notify pgrst, 'reload schema';
