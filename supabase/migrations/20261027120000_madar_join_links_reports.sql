-- Madar: per-company join links and developer-wide company reporting.
-- Every company carries a short shareable code used by /join/<code>; the developer
-- account reads aggregate stats for all companies and can suspend or reissue links.

-- ---------------------------------------------------------------- join codes
alter table public.companies add column join_code text;

update public.companies
set join_code = lower(substr(replace(gen_random_uuid()::text, '-', ''), 1, 10))
where join_code is null;

alter table public.companies
  alter column join_code set default lower(substr(replace(gen_random_uuid()::text, '-', ''), 1, 10));
alter table public.companies alter column join_code set not null;
alter table public.companies add constraint companies_join_code_key unique (join_code);
alter table public.companies add constraint companies_join_code_check
  check (join_code ~ '^[a-z0-9]{6,32}$');

-- ---------------------------------------------------------------- public lookup
-- Only the display fields needed by the invite screen; the code itself is the secret.
create or replace function public.company_join_info(p_code text)
returns jsonb
language sql stable security definer set search_path = ''
as $$
  select jsonb_build_object(
    'name', c.name,
    'timezone', c.timezone,
    'status', c.status
  )
  from public.companies c
  where c.join_code = lower(trim(coalesce(p_code, '')))
$$;

-- ---------------------------------------------------------------- developer controls
create or replace function public.developer_company_stats()
returns table (
  company_id uuid,
  name text,
  status text,
  join_code text,
  timezone text,
  members bigint,
  active_members bigint,
  departments bigint,
  open_tasks bigint,
  review_tasks bigint,
  done_tasks bigint,
  overdue_tasks bigint,
  minutes bigint,
  last_activity timestamptz
)
language plpgsql stable security definer set search_path = ''
as $$
begin
  if not public.is_developer() then
    raise exception 'هذه البيانات من صلاحيات حساب المطور' using errcode = '42501';
  end if;

  return query
  select
    c.id,
    c.name,
    c.status,
    c.join_code,
    c.timezone,
    (select count(*) from public.profiles p where p.company_id = c.id),
    (select count(*) from public.profiles p where p.company_id = c.id and p.status = 'active'),
    (select count(*) from public.departments d where d.company_id = c.id),
    (select count(*) from public.tasks t where t.company_id = c.id and t.status <> 'done'),
    (select count(*) from public.tasks t where t.company_id = c.id and t.status = 'review'),
    (select count(*) from public.tasks t where t.company_id = c.id and t.status = 'done'),
    (select count(*) from public.tasks t
      where t.company_id = c.id and t.status <> 'done' and t.due_date is not null and t.due_date < current_date),
    (select coalesce(sum(greatest(0, extract(epoch from (coalesce(ts.ended_at, now()) - ts.started_at)) / 60)), 0)::bigint
       from public.time_sessions ts
       join public.tasks t on t.id = ts.task_id
      where t.company_id = c.id),
    (select max(a.created_at)
       from public.activities a
       join public.profiles p on p.id = a.actor_id
      where p.company_id = c.id)
  from public.companies c
  order by c.created_at desc;
end $$;

create or replace function public.set_company_status(p_company uuid, p_status text)
returns void
language plpgsql security definer set search_path = ''
as $$
begin
  if not public.is_developer() then
    raise exception 'غير مصرح لك بتغيير حالة الشركات' using errcode = '42501';
  end if;
  if p_status not in ('active', 'suspended') then
    raise exception 'حالة شركة غير صالحة' using errcode = '22023';
  end if;
  update public.companies set status = p_status where id = p_company;
  if not found then
    raise exception 'الشركة غير موجودة' using errcode = 'P0002';
  end if;
end $$;

create or replace function public.regenerate_join_code(p_company uuid)
returns text
language plpgsql security definer set search_path = ''
as $$
declare
  v_code text;
begin
  if not public.is_developer() then
    raise exception 'إعادة توليد كود الدعوة من صلاحيات حساب المطور' using errcode = '42501';
  end if;
  v_code := lower(substr(replace(gen_random_uuid()::text, '-', ''), 1, 10));
  update public.companies set join_code = v_code where id = p_company;
  if not found then
    raise exception 'الشركة غير موجودة' using errcode = 'P0002';
  end if;
  return v_code;
end $$;

-- ---------------------------------------------------------------- grants
revoke execute on function public.company_join_info(text) from public;
grant execute on function public.company_join_info(text) to anon, authenticated;

revoke execute on function public.developer_company_stats() from public, anon;
grant execute on function public.developer_company_stats() to authenticated;

revoke execute on function public.set_company_status(uuid, text) from public, anon;
grant execute on function public.set_company_status(uuid, text) to authenticated;

revoke execute on function public.regenerate_join_code(uuid) from public, anon;
grant execute on function public.regenerate_join_code(uuid) to authenticated;
