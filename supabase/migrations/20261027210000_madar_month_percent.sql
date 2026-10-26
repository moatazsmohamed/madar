-- Adds the stored completion percentage to every month summary.
-- Percent = done ÷ every task in the month, rounded once, so the archived
-- figure cannot drift from the live progress card.

create or replace function public.month_summary(p_month uuid) returns jsonb
language sql stable security definer set search_path = ''
as $$
  select jsonb_build_object(
    'tasks', (select count(*)::int from public.tasks where month_id = p_month),
    'done', (select count(*)::int from public.tasks where month_id = p_month and status = 'done'),
    'review', (select count(*)::int from public.tasks where month_id = p_month and status = 'review'),
    'open', (select count(*)::int from public.tasks where month_id = p_month and status <> 'done'),
    'overdue', (
      select count(*)::int from public.tasks
      where month_id = p_month and status <> 'done' and due_date is not null
        and due_date < (now() at time zone coalesce(
          (select c.timezone from public.company_months m join public.companies c on c.id = m.company_id where m.id = p_month),
          'Africa/Cairo'))::date
    ),
    'percent', (
      select case
        when count(*) = 0 then 0
        else round(100.0 * count(*) filter (where status = 'done') / count(*))::int
      end
      from public.tasks where month_id = p_month
    ),
    'minutes', (
      select coalesce(sum(extract(epoch from (coalesce(ts.ended_at, now()) - ts.started_at))) / 60, 0)::int
      from public.time_sessions ts join public.tasks t on t.id = ts.task_id
      where t.month_id = p_month
    ),
    'employees', (
      select count(distinct a.user_id)::int
      from public.task_assignees a join public.tasks t on t.id = a.task_id
      where t.month_id = p_month
    ),
    'departments', (
      select count(distinct t.department_id)::int
      from public.tasks t where t.month_id = p_month and t.department_id is not null
    )
  )
$$;

update public.company_months
set summary = public.month_summary(id)
where status = 'closed';
