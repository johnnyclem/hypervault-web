
alter table public.profiles
  add column if not exists chat_polytician boolean not null default true;

notify pgrst, 'reload schema';
