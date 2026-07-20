
alter table public.artifacts
  add column if not exists mutable boolean not null default false;

create table if not exists public.artifact_versions (
  id uuid primary key default gen_random_uuid(),
  artifact_id uuid not null references public.artifacts (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  parent_version_id uuid references public.artifact_versions (id) on delete set null,
  title text not null default 'Untitled',
  content text not null,
  original_content text,
  content_hash text not null,
  message text not null default '',
  author_kind text not null default 'user' check (author_kind in ('user', 'agent', 'system')),
  author_key_id uuid references public.api_keys (id) on delete set null,
  is_jsx boolean not null default false,
  created_at timestamptz not null default now()
);

create index if not exists artifact_versions_artifact_idx
  on public.artifact_versions (artifact_id, created_at desc);

alter table public.artifact_versions enable row level security;

create policy "artifact_versions_select_own" on public.artifact_versions
  for select using ((select auth.uid()) = user_id);
create policy "artifact_versions_insert_own" on public.artifact_versions
  for insert with check ((select auth.uid()) = user_id);

notify pgrst, 'reload schema';
