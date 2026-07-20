alter table public.domain_claims
  add column if not exists theme text
  check (theme is null or (length(theme) between 1 and 64 and theme ~ '^[a-z0-9-]+$'));

drop policy if exists "domain_claims_update_own" on public.domain_claims;
create policy "domain_claims_update_own" on public.domain_claims
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
