
create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  email text,
  display_name text,
  plan text not null default 'free' check (plan in ('free', 'pro')),
  vanity_subdomain text unique,
  created_at timestamptz not null default now()
);

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.profiles (id, email, display_name)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data ->> 'full_name', split_part(new.email, '@', 1))
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

create table if not exists public.artifacts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  slug text not null unique,
  title text not null default 'Untitled',
  type text not null default 'html',
  tags text[] not null default '{}',
  connect_to text[] not null default '{}',
  content text not null,
  original_content text,
  is_pwa boolean not null default false,
  is_jsx boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists artifacts_user_created_idx on public.artifacts (user_id, created_at desc);

create table if not exists public.domain_claims (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  subdomain text not null,
  base_domain text not null default 'vault.cool',
  claimed_at timestamptz not null default now(),
  unique (subdomain, base_domain)
);

create table if not exists public.api_keys (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  key_hash text not null unique,
  key_prefix text not null,
  name text not null default 'default',
  created_at timestamptz not null default now(),
  last_used_at timestamptz,
  revoked boolean not null default false
);

alter table public.profiles enable row level security;
alter table public.artifacts enable row level security;
alter table public.domain_claims enable row level security;
alter table public.api_keys enable row level security;

create policy "profiles_select_own" on public.profiles
  for select using (auth.uid() = id);
create policy "profiles_update_own" on public.profiles
  for update using (auth.uid() = id);

create policy "artifacts_select_public" on public.artifacts
  for select using (true);
create policy "artifacts_insert_own" on public.artifacts
  for insert with check (auth.uid() = user_id);
create policy "artifacts_update_own" on public.artifacts
  for update using (auth.uid() = user_id);
create policy "artifacts_delete_own" on public.artifacts
  for delete using (auth.uid() = user_id);

create policy "domain_claims_select_public" on public.domain_claims
  for select using (true);
create policy "domain_claims_insert_own" on public.domain_claims
  for insert with check (auth.uid() = user_id);
create policy "domain_claims_delete_own" on public.domain_claims
  for delete using (auth.uid() = user_id);

create policy "api_keys_select_own" on public.api_keys
  for select using (auth.uid() = user_id);
create policy "api_keys_update_own" on public.api_keys
  for update using (auth.uid() = user_id);
