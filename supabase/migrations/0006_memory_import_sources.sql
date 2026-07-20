
alter table public.memories drop constraint if exists memories_source_check;
alter table public.memories add constraint memories_source_check
  check (source in ('manual', 'chat', 'coding', 'agent', 'file', 'github', 'web'));
