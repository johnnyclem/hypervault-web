
create index if not exists domain_claims_user_idx on public.domain_claims (user_id);
create index if not exists domain_claims_lookup_idx on public.domain_claims (subdomain, base_domain);

insert into public.domain_claims (user_id, subdomain, base_domain)
select p.id, p.vanity_subdomain, 'vault.cool'
from public.profiles p
where p.vanity_subdomain is not null
  and not exists (
    select 1 from public.domain_claims c
    where c.user_id = p.id and c.subdomain = p.vanity_subdomain
  )
on conflict (subdomain, base_domain) do nothing;

create or replace function public.enforce_domain_claim_limit()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  if (select count(*) from public.domain_claims where user_id = new.user_id) >= 10 then
    raise exception 'Pro accounts can hold at most 10 subdomains.'
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

drop trigger if exists domain_claims_limit on public.domain_claims;
create trigger domain_claims_limit
  before insert on public.domain_claims
  for each row execute function public.enforce_domain_claim_limit();
