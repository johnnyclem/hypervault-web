
create extension if not exists vector;

alter table public.memories add column if not exists embedding vector(1536);
alter table public.memories add column if not exists embedding_model text;

create index if not exists memories_embedding_idx
  on public.memories using hnsw (embedding vector_cosine_ops);

create or replace function public.mind_semantic_recall(
  p_user uuid,
  p_embedding vector(1536),
  p_model text,
  p_limit int default 50
) returns table (id uuid, distance real)
language sql
stable
security invoker
set search_path = public, extensions
as $$
  select m.id, (m.embedding <=> p_embedding)::real as distance
  from public.memories m
  where m.user_id = p_user
    and m.embedding is not null
    and m.embedding_model = p_model
  order by m.embedding <=> p_embedding
  limit p_limit;
$$;
