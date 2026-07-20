
create table if not exists public.mcp_dead_endpoints (
  url text primary key,
  http_status int,
  reason text,
  checked_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

alter table public.mcp_dead_endpoints enable row level security;
