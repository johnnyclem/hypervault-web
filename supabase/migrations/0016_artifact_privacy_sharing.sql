
alter table public.artifacts
  add column if not exists visibility text not null default 'public'
    check (visibility in ('public', 'private'));

alter table public.artifacts alter column visibility set default 'private';

create table if not exists public.artifact_shares (
  id uuid primary key default gen_random_uuid(),
  artifact_id uuid not null references public.artifacts (id) on delete cascade,
  owner_id uuid not null references public.profiles (id) on delete cascade,
  shared_with_id uuid not null references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (artifact_id, shared_with_id),
  check (owner_id <> shared_with_id)
);

create index if not exists artifact_shares_shared_with_idx
  on public.artifact_shares (shared_with_id, created_at desc);
create index if not exists artifact_shares_artifact_idx
  on public.artifact_shares (artifact_id);

alter table public.artifact_shares enable row level security;

create policy "artifact_shares_select_party" on public.artifact_shares
  for select to authenticated
  using ((select auth.uid()) = owner_id or (select auth.uid()) = shared_with_id);
create policy "artifact_shares_delete_party" on public.artifact_shares
  for delete to authenticated
  using ((select auth.uid()) = owner_id or (select auth.uid()) = shared_with_id);

drop policy if exists "artifacts_select_public" on public.artifacts;
create policy "artifacts_select_visible" on public.artifacts
  for select using (
    visibility = 'public'
    or (select auth.uid()) = user_id
    or exists (
      select 1 from public.artifact_shares s
      where s.artifact_id = artifacts.id
        and s.shared_with_id = (select auth.uid())
    )
  );
