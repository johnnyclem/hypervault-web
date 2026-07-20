
create extension if not exists pgcrypto with schema extensions;

alter table public.artifacts
  add column if not exists content_hash text;

update public.artifacts
  set content_hash = encode(extensions.digest(coalesce(original_content, content), 'sha256'), 'hex')
  where content_hash is null;

create index if not exists artifacts_user_content_hash_idx
  on public.artifacts (user_id, content_hash);
