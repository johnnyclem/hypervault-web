
create table if not exists public.github_stargazers (
  id uuid primary key default gen_random_uuid(),
  github_id bigint not null unique,
  github_login text not null,
  email text,
  avatar_url text,
  starred_at timestamptz not null default now(),
  unsubscribed boolean not null default false,
  invites_sent int not null default 0,
  last_invited_at timestamptz,
  last_invite_code_id uuid references public.invite_codes (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists github_stargazers_login_idx on public.github_stargazers (github_login);

alter table public.github_stargazers enable row level security;

create or replace function public.github_stargazers_touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists github_stargazers_set_updated_at on public.github_stargazers;
create trigger github_stargazers_set_updated_at
  before update on public.github_stargazers
  for each row execute function public.github_stargazers_touch_updated_at();
