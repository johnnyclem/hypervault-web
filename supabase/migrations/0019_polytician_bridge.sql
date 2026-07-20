
create table if not exists public.polytician_concepts (
  user_id uuid not null references public.profiles (id) on delete cascade,
  memory_id uuid not null,
  concept_id text not null,
  namespace text not null default 'default',
  version integer not null default 1,
  thoughtform jsonb,
  updated_at_ms bigint not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, concept_id)
);
create index if not exists polytician_concepts_memory_idx
  on public.polytician_concepts (user_id, memory_id);

alter table public.polytician_concepts enable row level security;

drop policy if exists "polytician_concepts_select_own" on public.polytician_concepts;
create policy "polytician_concepts_select_own" on public.polytician_concepts
  for select using (auth.uid() = user_id);
drop policy if exists "polytician_concepts_insert_own" on public.polytician_concepts;
create policy "polytician_concepts_insert_own" on public.polytician_concepts
  for insert with check (auth.uid() = user_id);
drop policy if exists "polytician_concepts_update_own" on public.polytician_concepts;
create policy "polytician_concepts_update_own" on public.polytician_concepts
  for update using (auth.uid() = user_id);
drop policy if exists "polytician_concepts_delete_own" on public.polytician_concepts;
create policy "polytician_concepts_delete_own" on public.polytician_concepts
  for delete using (auth.uid() = user_id);

notify pgrst, 'reload schema';
