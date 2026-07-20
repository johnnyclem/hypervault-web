
create table if not exists public.invite_codes (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  note text,
  max_uses int not null default 1 check (max_uses > 0),
  use_count int not null default 0,
  disabled boolean not null default false,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now()
);

create table if not exists public.account_access (
  user_id uuid primary key references auth.users (id) on delete cascade,
  source text not null default 'invite' check (source in ('invite', 'admin', 'legacy')),
  invite_code_id uuid references public.invite_codes (id) on delete set null,
  created_at timestamptz not null default now()
);

create table if not exists public.waitlist (
  user_id uuid primary key references auth.users (id) on delete cascade,
  email text,
  created_at timestamptz not null default now()
);

alter table public.invite_codes enable row level security;
alter table public.account_access enable row level security;
alter table public.waitlist enable row level security;


create policy "account_access_select_own" on public.account_access
  for select to authenticated using ((select auth.uid()) = user_id);

create policy "waitlist_select_own" on public.waitlist
  for select to authenticated using ((select auth.uid()) = user_id);
create policy "waitlist_insert_own" on public.waitlist
  for insert to authenticated with check ((select auth.uid()) = user_id);

create or replace function public.redeem_invite_code(p_code text)
returns text
language plpgsql
security definer set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_code public.invite_codes%rowtype;
begin
  if v_user is null then
    return 'not_authenticated';
  end if;
  if exists (select 1 from public.account_access where user_id = v_user) then
    return 'already_approved';
  end if;

  select * into v_code
  from public.invite_codes
  where upper(code) = upper(trim(p_code))
  for update;

  if not found then
    return 'invalid';
  end if;
  if v_code.disabled then
    return 'disabled';
  end if;
  if v_code.use_count >= v_code.max_uses then
    return 'exhausted';
  end if;

  update public.invite_codes set use_count = use_count + 1 where id = v_code.id;
  insert into public.account_access (user_id, source, invite_code_id)
  values (v_user, 'invite', v_code.id);
  delete from public.waitlist where user_id = v_user;
  return 'ok';
end;
$$;

revoke all on function public.redeem_invite_code(text) from public;
revoke all on function public.redeem_invite_code(text) from anon;
grant execute on function public.redeem_invite_code(text) to authenticated;

insert into public.account_access (user_id, source)
select id, 'legacy' from auth.users
on conflict (user_id) do nothing;
