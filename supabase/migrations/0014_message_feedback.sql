
alter table public.messages
  add column if not exists feedback smallint
  check (feedback in (-1, 1));

create index if not exists messages_user_feedback_idx
  on public.messages (user_id, created_at desc)
  where feedback is not null;

drop policy if exists "messages_update_own" on public.messages;
create policy "messages_update_own" on public.messages
  for update using (auth.uid() = user_id);
