
create table if not exists public.memory_artifact_links (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  memory_id uuid not null references public.memories (id) on delete cascade,
  artifact_id uuid not null references public.artifacts (id) on delete cascade,
  kind text not null default 'auto' check (kind in ('manual', 'auto')),
  created_at timestamptz not null default now(),
  unique (memory_id, artifact_id)
);

create index if not exists memory_artifact_links_user_idx on public.memory_artifact_links (user_id);
create index if not exists memory_artifact_links_memory_idx on public.memory_artifact_links (memory_id);
create index if not exists memory_artifact_links_artifact_idx on public.memory_artifact_links (artifact_id);

alter table public.memory_artifact_links enable row level security;

create policy "memory_artifact_links_select_own" on public.memory_artifact_links
  for select using (auth.uid() = user_id);
create policy "memory_artifact_links_insert_own" on public.memory_artifact_links
  for insert with check (auth.uid() = user_id);
create policy "memory_artifact_links_delete_own" on public.memory_artifact_links
  for delete using (auth.uid() = user_id);
