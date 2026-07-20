
create table if not exists public.mcp_servers (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  name text not null,
  url text not null,
  auth_headers_cipher text,
  enabled boolean not null default true,
  disabled_tools jsonb not null default '[]'::jsonb,
  tools_cache jsonb not null default '[]'::jsonb,
  introspected_at timestamptz,
  registry_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists mcp_servers_user_url_idx
  on public.mcp_servers (user_id, url);
create index if not exists mcp_servers_user_idx
  on public.mcp_servers (user_id, created_at desc);

create table if not exists public.toolkits (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  artifact jsonb not null,
  header text not null default '',
  embedder jsonb not null,
  endpoints jsonb not null,
  stats jsonb not null default '{}'::jsonb,
  compiled_at timestamptz not null default now(),
  is_active boolean not null default true
);

create index if not exists toolkits_user_idx
  on public.toolkits (user_id, compiled_at desc);
create unique index if not exists toolkits_one_active_idx
  on public.toolkits (user_id) where is_active;

alter table public.conversations
  add column if not exists toolkit_id uuid references public.toolkits (id) on delete set null;

alter table public.mcp_servers enable row level security;
alter table public.toolkits enable row level security;

create policy "mcp_servers_select_own" on public.mcp_servers
  for select using (auth.uid() = user_id);
create policy "mcp_servers_delete_own" on public.mcp_servers
  for delete using (auth.uid() = user_id);
create policy "toolkits_select_own" on public.toolkits
  for select using (auth.uid() = user_id);
create policy "toolkits_delete_own" on public.toolkits
  for delete using (auth.uid() = user_id);
