
create table if not exists public.memory_branches (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  name text not null check (name ~ '^[a-z0-9][a-z0-9/_-]{0,62}$'),
  is_default boolean not null default false,
  created_from_commit_id uuid,
  head_commit_id uuid,
  created_at timestamptz not null default now(),
  unique (user_id, name)
);
create unique index if not exists memory_branches_default_idx
  on public.memory_branches (user_id) where is_default;

create table if not exists public.memory_commits (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  branch_id uuid not null references public.memory_branches (id) on delete cascade,
  parent_commit_id uuid references public.memory_commits (id),
  merge_parent_commit_id uuid references public.memory_commits (id),
  message text not null default '',
  author_kind text not null default 'user' check (author_kind in ('user', 'agent', 'system')),
  author_key_id uuid references public.api_keys (id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists memory_commits_branch_idx on public.memory_commits (branch_id, created_at desc);
create index if not exists memory_commits_user_idx on public.memory_commits (user_id, created_at desc);

create table if not exists public.memory_revisions (
  id uuid primary key default gen_random_uuid(),
  commit_id uuid not null references public.memory_commits (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  memory_id uuid not null,
  op text not null check (op in ('create', 'update', 'delete')),
  title text not null default '',
  content text not null default '',
  summary text not null default '',
  tags text[] not null default '{}',
  source text not null default 'manual',
  created_at timestamptz not null default now(),
  search tsvector generated always as (
    setweight(to_tsvector('english', coalesce(title, '')), 'A') ||
    setweight(to_tsvector('english', coalesce(summary, '')), 'B') ||
    setweight(to_tsvector('english', coalesce(public.immutable_join(tags, ' '), '')), 'B') ||
    setweight(to_tsvector('english', coalesce(content, '')), 'C')
  ) stored
);
create index if not exists memory_revisions_memory_idx on public.memory_revisions (memory_id, created_at desc);
create index if not exists memory_revisions_commit_idx on public.memory_revisions (commit_id);
create index if not exists memory_revisions_user_idx on public.memory_revisions (user_id);
create index if not exists memory_revisions_search_idx on public.memory_revisions using gin (search);

create table if not exists public.memory_heads (
  user_id uuid not null references public.profiles (id) on delete cascade,
  branch_id uuid not null references public.memory_branches (id) on delete cascade,
  memory_id uuid not null,
  revision_id uuid not null references public.memory_revisions (id),
  primary key (branch_id, memory_id)
);
create index if not exists memory_heads_user_idx on public.memory_heads (user_id);

create table if not exists public.memory_link_changes (
  id uuid primary key default gen_random_uuid(),
  commit_id uuid not null references public.memory_commits (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  a_id uuid not null,
  b_id uuid not null,
  op text not null check (op in ('add', 'remove')),
  kind text not null default 'auto' check (kind in ('manual', 'auto')),
  created_at timestamptz not null default now(),
  check (a_id < b_id)
);
create index if not exists memory_link_changes_commit_idx on public.memory_link_changes (commit_id);
create index if not exists memory_link_changes_user_idx on public.memory_link_changes (user_id);

alter table public.memory_links add column if not exists branch_id uuid references public.memory_branches (id) on delete cascade;
alter table public.memory_links drop constraint if exists memory_links_a_id_fkey;
alter table public.memory_links drop constraint if exists memory_links_b_id_fkey;
alter table public.memory_links drop constraint if exists memory_links_a_id_b_id_key;

insert into public.memory_branches (user_id, name, is_default)
select distinct m.user_id, 'main', true
from public.memories m
on conflict (user_id, name) do nothing;

insert into public.memory_commits (user_id, branch_id, message, author_kind)
select b.user_id, b.id, 'genesis — imported existing wiki', 'system'
from public.memory_branches b
where b.is_default
  and b.head_commit_id is null
  and exists (select 1 from public.memories m where m.user_id = b.user_id)
  and not exists (select 1 from public.memory_commits c where c.branch_id = b.id);

insert into public.memory_revisions (commit_id, user_id, memory_id, op, title, content, summary, tags, source, created_at)
select c.id, m.user_id, m.id, 'create', m.title, m.content, m.summary, m.tags, m.source, m.created_at
from public.memories m
join public.memory_branches b on b.user_id = m.user_id and b.is_default and b.head_commit_id is null
join public.memory_commits c on c.branch_id = b.id and c.message = 'genesis — imported existing wiki'
where not exists (
  select 1 from public.memory_heads h where h.branch_id = b.id and h.memory_id = m.id
);

insert into public.memory_heads (user_id, branch_id, memory_id, revision_id)
select r.user_id, c.branch_id, r.memory_id, r.id
from public.memory_revisions r
join public.memory_commits c on c.id = r.commit_id and c.message = 'genesis — imported existing wiki'
join public.memory_branches b on b.id = c.branch_id and b.head_commit_id is null
on conflict (branch_id, memory_id) do nothing;

update public.memory_links l
set branch_id = b.id
from public.memory_branches b
where l.branch_id is null and b.user_id = l.user_id and b.is_default;

insert into public.memory_link_changes (commit_id, user_id, a_id, b_id, op, kind)
select c.id, l.user_id, l.a_id, l.b_id, 'add', l.kind
from public.memory_links l
join public.memory_branches b on b.id = l.branch_id and b.is_default and b.head_commit_id is null
join public.memory_commits c on c.branch_id = b.id and c.message = 'genesis — imported existing wiki'
where not exists (
  select 1 from public.memory_link_changes x
  where x.commit_id = c.id and x.a_id = l.a_id and x.b_id = l.b_id
);

update public.memory_branches b
set head_commit_id = c.id
from public.memory_commits c
where c.branch_id = b.id and b.head_commit_id is null
  and c.message = 'genesis — imported existing wiki';

alter table public.memory_links alter column branch_id set not null;
create unique index if not exists memory_links_branch_pair_idx
  on public.memory_links (branch_id, a_id, b_id);

create or replace function public.mind_commit(
  p_user uuid,
  p_branch uuid,
  p_message text,
  p_author_kind text,
  p_author_key uuid,
  p_changes jsonb,
  p_link_changes jsonb,
  p_merge_parent uuid default null,
  p_expected_head uuid default null
) returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_branch public.memory_branches%rowtype;
  v_commit uuid;
  v_rev uuid;
  ch record;
  lc record;
begin
  select * into v_branch
  from public.memory_branches
  where id = p_branch and user_id = p_user
  for update;
  if not found then
    raise exception 'mind_commit: branch not found';
  end if;
  if p_expected_head is not null and v_branch.head_commit_id is distinct from p_expected_head then
    raise exception 'mind_commit: stale head — branch moved since you read it';
  end if;

  insert into public.memory_commits
    (user_id, branch_id, parent_commit_id, merge_parent_commit_id, message, author_kind, author_key_id)
  values
    (p_user, p_branch, v_branch.head_commit_id, p_merge_parent, coalesce(p_message, ''),
     coalesce(p_author_kind, 'user'), p_author_key)
  returning id into v_commit;

  for ch in
    select * from jsonb_to_recordset(coalesce(p_changes, '[]'::jsonb))
      as x(memory_id uuid, op text, title text, content text, summary text, tags text[], source text)
  loop
    insert into public.memory_revisions (commit_id, user_id, memory_id, op, title, content, summary, tags, source)
    values (v_commit, p_user, ch.memory_id, ch.op,
            coalesce(ch.title, ''), coalesce(ch.content, ''), coalesce(ch.summary, ''),
            coalesce(ch.tags, '{}'), coalesce(ch.source, 'manual'))
    returning id into v_rev;

    if ch.op = 'delete' then
      delete from public.memory_heads where branch_id = p_branch and memory_id = ch.memory_id;
      insert into public.memory_link_changes (commit_id, user_id, a_id, b_id, op, kind)
        select v_commit, p_user, l.a_id, l.b_id, 'remove', l.kind
        from public.memory_links l
        where l.branch_id = p_branch and (l.a_id = ch.memory_id or l.b_id = ch.memory_id);
      delete from public.memory_links
        where branch_id = p_branch and (a_id = ch.memory_id or b_id = ch.memory_id);
      if v_branch.is_default then
        delete from public.memories where id = ch.memory_id and user_id = p_user;
      end if;
    else
      insert into public.memory_heads (user_id, branch_id, memory_id, revision_id)
      values (p_user, p_branch, ch.memory_id, v_rev)
      on conflict (branch_id, memory_id) do update set revision_id = excluded.revision_id;
      if v_branch.is_default then
        insert into public.memories (id, user_id, title, content, summary, tags, source)
        values (ch.memory_id, p_user, coalesce(ch.title, ''), coalesce(ch.content, ''),
                coalesce(ch.summary, ''), coalesce(ch.tags, '{}'), coalesce(ch.source, 'manual'))
        on conflict (id) do update
          set title = excluded.title, content = excluded.content, summary = excluded.summary,
              tags = excluded.tags, source = excluded.source, updated_at = now();
      end if;
    end if;
  end loop;

  for lc in
    select * from jsonb_to_recordset(coalesce(p_link_changes, '[]'::jsonb))
      as x(a_id uuid, b_id uuid, op text, kind text)
  loop
    if lc.op = 'add' then
      insert into public.memory_links (user_id, branch_id, a_id, b_id, kind)
      values (p_user, p_branch, lc.a_id, lc.b_id, coalesce(lc.kind, 'auto'))
      on conflict (branch_id, a_id, b_id) do nothing;
    else
      delete from public.memory_links
      where branch_id = p_branch and a_id = lc.a_id and b_id = lc.b_id;
    end if;
    insert into public.memory_link_changes (commit_id, user_id, a_id, b_id, op, kind)
    values (v_commit, p_user, lc.a_id, lc.b_id, lc.op, coalesce(lc.kind, 'auto'));
  end loop;

  update public.memory_branches set head_commit_id = v_commit where id = p_branch;
  return v_commit;
end;
$$;

create or replace function public.mind_branch_state(
  p_user uuid,
  p_branch uuid,
  p_q text default null
) returns table (
  memory_id uuid,
  revision_id uuid,
  title text,
  content text,
  summary text,
  tags text[],
  source text,
  commit_id uuid,
  committed_at timestamptz
)
language sql
stable
security invoker
set search_path = ''
as $$
  select h.memory_id, r.id, r.title, r.content, r.summary, r.tags, r.source, r.commit_id, r.created_at
  from public.memory_heads h
  join public.memory_revisions r on r.id = h.revision_id
  where h.branch_id = p_branch
    and h.user_id = p_user
    and (p_q is null or r.search @@ websearch_to_tsquery('english', p_q));
$$;

create or replace function public.mind_state_at(
  p_user uuid,
  p_commit uuid
) returns table (
  memory_id uuid,
  revision_id uuid,
  title text,
  content text,
  summary text,
  tags text[],
  source text,
  commit_id uuid,
  committed_at timestamptz
)
language sql
stable
security invoker
set search_path = ''
as $$
  with recursive ancestry as (
    select c.id, c.parent_commit_id, 0 as depth
    from public.memory_commits c
    where c.id = p_commit and c.user_id = p_user
    union all
    select c.id, c.parent_commit_id, a.depth + 1
    from public.memory_commits c
    join ancestry a on c.id = a.parent_commit_id
    where a.depth < 100000
  ),
  nearest as (
    select distinct on (r.memory_id) r.*
    from public.memory_revisions r
    join ancestry a on a.id = r.commit_id
    order by r.memory_id, a.depth asc
  )
  select n.memory_id, n.id, n.title, n.content, n.summary, n.tags, n.source, n.commit_id, n.created_at
  from nearest n
  where n.op <> 'delete';
$$;

create or replace function public.mind_links_at(
  p_user uuid,
  p_commit uuid
) returns table (a_id uuid, b_id uuid, kind text)
language sql
stable
security invoker
set search_path = ''
as $$
  with recursive ancestry as (
    select c.id, c.parent_commit_id, 0 as depth
    from public.memory_commits c
    where c.id = p_commit and c.user_id = p_user
    union all
    select c.id, c.parent_commit_id, a.depth + 1
    from public.memory_commits c
    join ancestry a on c.id = a.parent_commit_id
    where a.depth < 100000
  ),
  nearest as (
    select distinct on (lc.a_id, lc.b_id) lc.a_id, lc.b_id, lc.op, lc.kind
    from public.memory_link_changes lc
    join ancestry a on a.id = lc.commit_id
    order by lc.a_id, lc.b_id, a.depth asc, lc.created_at desc, lc.id
  )
  select n.a_id, n.b_id, n.kind from nearest n where n.op = 'add';
$$;

alter table public.memory_branches enable row level security;
alter table public.memory_commits enable row level security;
alter table public.memory_revisions enable row level security;
alter table public.memory_heads enable row level security;
alter table public.memory_link_changes enable row level security;

drop policy if exists "memory_branches_select_own" on public.memory_branches;
create policy "memory_branches_select_own" on public.memory_branches
  for select using (auth.uid() = user_id);
drop policy if exists "memory_branches_insert_own" on public.memory_branches;
create policy "memory_branches_insert_own" on public.memory_branches
  for insert with check (auth.uid() = user_id);
drop policy if exists "memory_branches_update_own" on public.memory_branches;
create policy "memory_branches_update_own" on public.memory_branches
  for update using (auth.uid() = user_id);
drop policy if exists "memory_branches_delete_own" on public.memory_branches;
create policy "memory_branches_delete_own" on public.memory_branches
  for delete using (auth.uid() = user_id);

drop policy if exists "memory_commits_select_own" on public.memory_commits;
create policy "memory_commits_select_own" on public.memory_commits
  for select using (auth.uid() = user_id);
drop policy if exists "memory_commits_insert_own" on public.memory_commits;
create policy "memory_commits_insert_own" on public.memory_commits
  for insert with check (auth.uid() = user_id);
drop policy if exists "memory_commits_delete_own" on public.memory_commits;
create policy "memory_commits_delete_own" on public.memory_commits
  for delete using (auth.uid() = user_id);

drop policy if exists "memory_revisions_select_own" on public.memory_revisions;
create policy "memory_revisions_select_own" on public.memory_revisions
  for select using (auth.uid() = user_id);
drop policy if exists "memory_revisions_insert_own" on public.memory_revisions;
create policy "memory_revisions_insert_own" on public.memory_revisions
  for insert with check (auth.uid() = user_id);
drop policy if exists "memory_revisions_delete_own" on public.memory_revisions;
create policy "memory_revisions_delete_own" on public.memory_revisions
  for delete using (auth.uid() = user_id);

drop policy if exists "memory_heads_select_own" on public.memory_heads;
create policy "memory_heads_select_own" on public.memory_heads
  for select using (auth.uid() = user_id);
drop policy if exists "memory_heads_insert_own" on public.memory_heads;
create policy "memory_heads_insert_own" on public.memory_heads
  for insert with check (auth.uid() = user_id);
drop policy if exists "memory_heads_update_own" on public.memory_heads;
create policy "memory_heads_update_own" on public.memory_heads
  for update using (auth.uid() = user_id);
drop policy if exists "memory_heads_delete_own" on public.memory_heads;
create policy "memory_heads_delete_own" on public.memory_heads
  for delete using (auth.uid() = user_id);

drop policy if exists "memory_link_changes_select_own" on public.memory_link_changes;
create policy "memory_link_changes_select_own" on public.memory_link_changes
  for select using (auth.uid() = user_id);
drop policy if exists "memory_link_changes_insert_own" on public.memory_link_changes;
create policy "memory_link_changes_insert_own" on public.memory_link_changes
  for insert with check (auth.uid() = user_id);
drop policy if exists "memory_link_changes_delete_own" on public.memory_link_changes;
create policy "memory_link_changes_delete_own" on public.memory_link_changes
  for delete using (auth.uid() = user_id);
