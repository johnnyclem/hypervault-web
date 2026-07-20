
create table if not exists public.user_secrets (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  name text not null,
  value_cipher text not null,
  kind text not null default 'opaque',
  description text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  last_accessed_at timestamptz,
  unique (user_id, name),
  constraint user_secrets_kind_check check (kind in ('opaque', 'header', 'oauth_grant'))
);

create index if not exists user_secrets_user_idx
  on public.user_secrets (user_id, name);

alter table public.user_secrets enable row level security;

create policy "user_secrets_select_own" on public.user_secrets
  for select using (auth.uid() = user_id);
create policy "user_secrets_delete_own" on public.user_secrets
  for delete using (auth.uid() = user_id);

create table if not exists public.secret_grants (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  secret_id uuid not null references public.user_secrets (id) on delete cascade,
  api_key_id uuid not null references public.api_keys (id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (secret_id, api_key_id)
);

create index if not exists secret_grants_secret_idx
  on public.secret_grants (secret_id);
create index if not exists secret_grants_key_idx
  on public.secret_grants (api_key_id);

alter table public.secret_grants enable row level security;

create policy "secret_grants_select_own" on public.secret_grants
  for select using (auth.uid() = user_id);
create policy "secret_grants_delete_own" on public.secret_grants
  for delete using (auth.uid() = user_id);

alter table public.mcp_servers
  add column if not exists auth_headers_secret_id uuid
    references public.user_secrets (id) on delete set null,
  add column if not exists oauth_grant_secret_id uuid
    references public.user_secrets (id) on delete set null;
