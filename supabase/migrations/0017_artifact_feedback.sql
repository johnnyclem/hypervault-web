
alter table public.artifacts
  add column if not exists feedback smallint
  check (feedback in (-1, 1));
