
create table if not exists public.conversations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  title text not null default 'Untitled conversation',
  source_platform text not null default 'hypervault',
  external_id text,
  model text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists conversations_user_updated_idx
  on public.conversations (user_id, updated_at desc);
create unique index if not exists conversations_external_idx
  on public.conversations (user_id, source_platform, external_id)
  where external_id is not null;

create table if not exists public.messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.conversations (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  role text not null check (role in ('system', 'user', 'assistant', 'tool')),
  content text not null default '',
  attachments jsonb not null default '[]',
  model text,
  position integer not null default 0,
  created_at timestamptz not null default now()
);

create index if not exists messages_conversation_position_idx
  on public.messages (conversation_id, position);

create table if not exists public.llm_backends (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  name text not null,
  provider text not null check (provider in (
    'openai', 'anthropic', 'xai', 'gemini', 'mistral', 'ollama', 'lmstudio', 'custom'
  )),
  base_url text,
  default_model text,
  api_key_cipher text,
  key_hint text,
  created_at timestamptz not null default now(),
  last_used_at timestamptz
);

create index if not exists llm_backends_user_idx on public.llm_backends (user_id, created_at desc);

alter table public.conversations enable row level security;
alter table public.messages enable row level security;
alter table public.llm_backends enable row level security;

create policy "conversations_select_own" on public.conversations
  for select using (auth.uid() = user_id);
create policy "conversations_insert_own" on public.conversations
  for insert with check (auth.uid() = user_id);
create policy "conversations_update_own" on public.conversations
  for update using (auth.uid() = user_id);
create policy "conversations_delete_own" on public.conversations
  for delete using (auth.uid() = user_id);

create policy "messages_select_own" on public.messages
  for select using (auth.uid() = user_id);
create policy "messages_insert_own" on public.messages
  for insert with check (auth.uid() = user_id);
create policy "messages_delete_own" on public.messages
  for delete using (auth.uid() = user_id);

create policy "llm_backends_select_own" on public.llm_backends
  for select using (auth.uid() = user_id);
create policy "llm_backends_delete_own" on public.llm_backends
  for delete using (auth.uid() = user_id);
