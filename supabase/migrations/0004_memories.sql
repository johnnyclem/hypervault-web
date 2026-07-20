
create or replace function public.immutable_join(text[], text)
returns text
language sql immutable parallel safe
set search_path = ''
return array_to_string($1, $2);

create table if not exists public.memories (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  title text not null default 'Untitled memory',
  content text not null,
  summary text not null default '',
  tags text[] not null default '{}',
  source text not null default 'manual' check (source in ('manual', 'chat', 'coding', 'agent')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  search tsvector generated always as (
    setweight(to_tsvector('english', coalesce(title, '')), 'A') ||
    setweight(to_tsvector('english', coalesce(summary, '')), 'B') ||
    setweight(to_tsvector('english', coalesce(public.immutable_join(tags, ' '), '')), 'B') ||
    setweight(to_tsvector('english', coalesce(content, '')), 'C')
  ) stored
);

create index if not exists memories_user_created_idx on public.memories (user_id, created_at desc);
create index if not exists memories_search_idx on public.memories using gin (search);
create index if not exists memories_tags_idx on public.memories using gin (tags);

create table if not exists public.memory_links (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  a_id uuid not null references public.memories (id) on delete cascade,
  b_id uuid not null references public.memories (id) on delete cascade,
  kind text not null default 'auto' check (kind in ('manual', 'auto')),
  created_at timestamptz not null default now(),
  unique (a_id, b_id),
  check (a_id < b_id)
);

create index if not exists memory_links_user_idx on public.memory_links (user_id);
create index if not exists memory_links_a_idx on public.memory_links (a_id);
create index if not exists memory_links_b_idx on public.memory_links (b_id);

alter table public.memories enable row level security;
alter table public.memory_links enable row level security;

create policy "memories_select_own" on public.memories
  for select using (auth.uid() = user_id);
create policy "memories_insert_own" on public.memories
  for insert with check (auth.uid() = user_id);
create policy "memories_update_own" on public.memories
  for update using (auth.uid() = user_id);
create policy "memories_delete_own" on public.memories
  for delete using (auth.uid() = user_id);

create policy "memory_links_select_own" on public.memory_links
  for select using (auth.uid() = user_id);
create policy "memory_links_insert_own" on public.memory_links
  for insert with check (auth.uid() = user_id);
create policy "memory_links_delete_own" on public.memory_links
  for delete using (auth.uid() = user_id);
