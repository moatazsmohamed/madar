-- Madar: a day that is already over can never receive new work, even when its
-- company_days row does not exist yet. tasks_before_write only checks rows, so
-- this trigger closes the gap for inserts and for moving tasks between days.

create or replace function public.tasks_guard_day_past() returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  v_tz text;
  v_today date;
begin
  if tg_op = 'UPDATE' and new.day is not distinct from old.day then
    return new;
  end if;
  if new.day is null or new.company_id is null then
    return new;
  end if;
  select coalesce(timezone, 'Africa/Cairo') into v_tz from public.companies where id = new.company_id;
  v_today := (now() at time zone coalesce(v_tz, 'Africa/Cairo'))::date;
  if new.day < v_today then
    raise exception 'هذا اليوم مغلق ومؤرشف، اختر يومًا آخر' using errcode = '42501';
  end if;
  return new;
end $$;

revoke execute on function public.tasks_guard_day_past() from public, anon, authenticated;

drop trigger if exists tasks_guard_day_past on public.tasks;
-- Fires after tasks_before_write, which fills company_id and defaults day.
create trigger tasks_guard_day_past
before insert or update of day on public.tasks
for each row execute function public.tasks_guard_day_past();
