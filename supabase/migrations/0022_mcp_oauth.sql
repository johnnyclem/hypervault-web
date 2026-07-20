
alter table public.mcp_servers
  add column if not exists oauth_grant_cipher text;

create table if not exists public.mcp_oauth_flows (
  state text primary key,
  user_id uuid not null references public.profiles (id) on delete cascade,
  server_id uuid references public.mcp_servers (id) on delete cascade,
  url text not null,
  name text,
  registry_id text,
  redirect_uri text not null,
  code_verifier text not null,
  authorization_endpoint text not null,
  token_endpoint text not null,
  resource text not null,
  scope text,
  client_cipher text not null,
  created_at timestamptz not null default now()
);

create index if not exists mcp_oauth_flows_user_idx
  on public.mcp_oauth_flows (user_id, created_at desc);

alter table public.mcp_oauth_flows enable row level security;

create policy "mcp_oauth_flows_select_own" on public.mcp_oauth_flows
  for select using (auth.uid() = user_id);
create policy "mcp_oauth_flows_delete_own" on public.mcp_oauth_flows
  for delete using (auth.uid() = user_id);
