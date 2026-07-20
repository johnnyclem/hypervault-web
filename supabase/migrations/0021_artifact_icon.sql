
alter table public.artifacts
  add column if not exists icon text;

notify pgrst, 'reload schema';
