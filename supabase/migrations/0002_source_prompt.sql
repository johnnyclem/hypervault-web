
alter table public.artifacts
  add column if not exists source_prompt text;
