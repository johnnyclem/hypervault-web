
alter table public.profiles
  add column if not exists chat_smart_context boolean not null default true;

alter table public.profiles
  add column if not exists chat_deep_memory boolean not null default true;

notify pgrst, 'reload schema';
