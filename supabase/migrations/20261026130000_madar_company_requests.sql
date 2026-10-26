-- Companies created by customers start as pending until the developer approves them.
alter table public.companies drop constraint if exists companies_status_check;
alter table public.companies
  add constraint companies_status_check check (status in ('active', 'suspended', 'pending'));
