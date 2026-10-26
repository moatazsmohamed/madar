-- Madar: the company admin can take the current month back to work after it was
-- closed by mistake. Older months stay archived forever, and days that were
-- closed on their own (auto/manual) stay closed.

create or replace function public.reopen_month(p_month uuid) returns public.company_months
language plpgsql security definer set search_path = ''
as $$
declare
  v_company uuid := public.my_company();
  v_tz text;
  v_period date;
  v_today date;
  v_row public.company_months;
begin
  if v_company is null or public.my_role() is distinct from 'admin' then
    raise exception 'إعادة فتح الشهر من صلاحيات مدير الشركة' using errcode = '42501';
  end if;
  perform pg_advisory_xact_lock(hashtext('madar_month_' || v_company::text));
  select * into v_row from public.company_months
  where id = p_month and company_id = v_company
  for update;
  if v_row.id is null then
    raise exception 'الشهر غير موجود' using errcode = '23503';
  end if;
  if v_row.status <> 'closed' then
    raise exception 'هذا الشهر مفتوح بالفعل' using errcode = '23514';
  end if;

  select coalesce(timezone, 'Africa/Cairo') into v_tz from public.companies where id = v_company;
  v_today := (now() at time zone coalesce(v_tz, 'Africa/Cairo'))::date;
  v_period := date_trunc('month', v_today::timestamp)::date;
  if v_row.period <> v_period then
    raise exception 'يمكن إعادة فتح شهر الشركة الحالي فقط؛ الأشهر السابقة تبقى مؤرشفة' using errcode = '23514';
  end if;

  update public.company_days
  set status = 'open', closed_at = null, closed_by = null, close_mode = null
  where month_id = p_month and status = 'closed' and close_mode = 'month';

  update public.company_months
  set status = 'open', closed_at = null, closed_by = null, summary = null
  where id = p_month
  returning * into v_row;
  return v_row;
end $$;

revoke execute on function public.reopen_month(uuid) from public, anon;
grant execute on function public.reopen_month(uuid) to authenticated;
