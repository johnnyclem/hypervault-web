
alter table public.conversations
  add column if not exists visibility text not null default 'private';
alter table public.conversations
  add column if not exists share_slug text;
alter table public.conversations
  add column if not exists memory_id uuid;

do $$ begin
  alter table public.conversations
    add constraint conversations_visibility_check
    check (visibility in ('private', 'shared', 'public'));
exception
  when duplicate_object then null;
end $$;

create unique index if not exists conversations_share_slug_idx
  on public.conversations (share_slug)
  where share_slug is not null;

create policy "conversations_select_public" on public.conversations
  for select using (visibility = 'public');
create policy "messages_select_public" on public.messages
  for select using (
    exists (
      select 1 from public.conversations c
      where c.id = conversation_id and c.visibility = 'public'
    )
  );
