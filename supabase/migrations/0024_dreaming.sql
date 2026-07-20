
alter table public.profiles
  add column if not exists dreaming_enabled boolean not null default false;

alter table public.profiles
  add column if not exists dreaming_last_run_at timestamptz;

create index if not exists profiles_dreaming_enabled_idx
  on public.profiles (id) where dreaming_enabled;

create table if not exists public.dream_runs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  status text not null default 'pending' check (status in ('pending', 'reviewed')),
  created_at timestamptz not null default now(),
  reviewed_at timestamptz
);

create index if not exists dream_runs_user_idx on public.dream_runs (user_id, created_at desc);
create index if not exists dream_runs_open_idx on public.dream_runs (user_id) where status = 'pending';

create table if not exists public.dream_connections (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  run_id uuid not null references public.dream_runs (id) on delete cascade,
  edge_type text not null check (edge_type in ('artifact_artifact', 'memory_memory', 'memory_artifact')),
  a_id uuid not null,
  b_id uuid not null,
  score real not null default 0,
  reason text not null default '',
  status text not null default 'pending' check (status in ('pending', 'accepted', 'rejected')),
  created_at timestamptz not null default now(),
  decided_at timestamptz,
  unique (user_id, edge_type, a_id, b_id)
);

create index if not exists dream_connections_run_idx on public.dream_connections (run_id);
create index if not exists dream_connections_user_idx on public.dream_connections (user_id);
create index if not exists dream_connections_pending_idx on public.dream_connections (user_id) where status = 'pending';

alter table public.dream_runs enable row level security;
alter table public.dream_connections enable row level security;

drop policy if exists "dream_runs_select_own" on public.dream_runs;
create policy "dream_runs_select_own" on public.dream_runs
  for select using (auth.uid() = user_id);
drop policy if exists "dream_runs_insert_own" on public.dream_runs;
create policy "dream_runs_insert_own" on public.dream_runs
  for insert with check (auth.uid() = user_id);
drop policy if exists "dream_runs_update_own" on public.dream_runs;
create policy "dream_runs_update_own" on public.dream_runs
  for update using (auth.uid() = user_id);
drop policy if exists "dream_runs_delete_own" on public.dream_runs;
create policy "dream_runs_delete_own" on public.dream_runs
  for delete using (auth.uid() = user_id);

drop policy if exists "dream_connections_select_own" on public.dream_connections;
create policy "dream_connections_select_own" on public.dream_connections
  for select using (auth.uid() = user_id);
drop policy if exists "dream_connections_insert_own" on public.dream_connections;
create policy "dream_connections_insert_own" on public.dream_connections
  for insert with check (auth.uid() = user_id);
drop policy if exists "dream_connections_update_own" on public.dream_connections;
create policy "dream_connections_update_own" on public.dream_connections
  for update using (auth.uid() = user_id);
drop policy if exists "dream_connections_delete_own" on public.dream_connections;
create policy "dream_connections_delete_own" on public.dream_connections
  for delete using (auth.uid() = user_id);

notify pgrst, 'reload schema';
