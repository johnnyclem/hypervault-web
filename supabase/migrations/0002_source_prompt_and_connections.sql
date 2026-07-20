
alter table public.artifacts
  add column if not exists source_prompt text;

create table if not exists public.connections (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  a_id uuid not null references public.artifacts (id) on delete cascade,
  b_id uuid not null references public.artifacts (id) on delete cascade,
  kind text not null default 'manual' check (kind in ('manual', 'auto')),
  created_at timestamptz not null default now(),
  unique (a_id, b_id)
);

create index if not exists connections_user_idx on public.connections (user_id);

alter table public.connections enable row level security;

create policy "connections_select_own" on public.connections
  for select using (auth.uid() = user_id);
create policy "connections_delete_own" on public.connections
  for delete using (auth.uid() = user_id);
