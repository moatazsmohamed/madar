-- Madar: daily work cycle inside every month.
-- Tasks belong to a day (company timezone). Each day closes automatically at
-- midnight, or early by the company admin, and then everything inside it stays
-- readable while unfinished work is archived as late.

-- ---------------------------------------------------------------- day column

alter table public.tasks add column day date;

update public.tasks t
set day = greatest(
  m.period,
  least(
    coalesce(t.due_date, (t.created_at at time zone coalesce(c.timezone, 'Africa/Cairo'))::date),
    (m.period + interval '1 month - 1 day')::date
  )
)
from public.company_months m
join public.companies c on c.id = m.company_id
where m.id = t.month_id;

alter table public.tasks alter column day set not null;
create index tasks_company_day_idx on public.tasks (company_id, day);
create index tasks_month_day_idx on public.tasks (month_id, day);

-- ---------------------------------------------------------------- days table

create table public.company_days (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id) on delete cascade,
  month_id uuid not null references public.company_months (id) on delete cascade,
  day date not null,
  status text not null default 'open' check (status in ('open', 'closed')),
  closed_at timestamptz,
  closed_by uuid references public.profiles (id) on delete set null,
  close_mode text check (close_mode in ('auto', 'manual', 'month')),
  created_at timestamptz not null default now(),
  constraint company_days_company_day_key unique (company_id, day),
  constraint company_days_closed_check check ((status = 'closed') = (closed_at is not null))
);
create index company_days_company_idx on public.company_days (company_id, day desc);
create index company_days_month_idx on public.company_days (month_id, day);

-- Existing tasks get one row per day they touch; past days arrive archived.
insert into public.company_days (company_id, month_id, day, status, closed_at, close_mode)
select
  s.company_id,
  s.month_id,
  s.day,
  case when s.day < (now() at time zone coalesce(c.timezone, 'Africa/Cairo'))::date then 'closed' else 'open' end,
  case when s.day < (now() at time zone coalesce(c.timezone, 'Africa/Cairo'))::date then now() else null end,
  case when s.day < (now() at time zone coalesce(c.timezone, 'Africa/Cairo'))::date then 'auto' else null end
from (
  select distinct company_id, month_id, day from public.tasks
) s
join public.companies c on c.id = s.company_id
on conflict (company_id, day) do nothing;

-- ---------------------------------------------------------------- RPCs

-- Opens today's day (and the month with it), auto-closes every past open day.
-- Returns null when the current month was closed early.
create or replace function public.ensure_day() returns public.company_days
language plpgsql security definer set search_path = ''
as $$
declare
  v_company uuid := public.my_company();
  v_tz text;
  v_today date;
  v_month public.company_months;
  v_row public.company_days;
  r record;
begin
  if v_company is null then
    return null;
  end if;
  perform pg_advisory_xact_lock(hashtext('madar_month_' || v_company::text));
  select coalesce(timezone, 'Africa/Cairo') into v_tz from public.companies where id = v_company;
  v_today := (now() at time zone v_tz)::date;

  for r in
    select * from public.company_days
    where company_id = v_company and status = 'open' and day < v_today
  loop
    update public.time_sessions set ended_at = now()
    where ended_at is null and task_id in (
      select id from public.tasks where company_id = v_company and day = r.day
    );
    update public.company_days
    set status = 'closed', closed_at = now(), close_mode = 'auto'
    where id = r.id;
  end loop;

  v_month := public.ensure_month();
  if v_month.id is null then
    return null;
  end if;

  insert into public.company_days (company_id, month_id, day)
  values (v_company, v_month.id, v_today)
  on conflict (company_id, day) do nothing;

  select * into v_row from public.company_days where company_id = v_company and day = v_today;
  return v_row;
end $$;

-- Early close of one day, company admin only. Past or today, never the future.
create or replace function public.close_day(p_day date) returns public.company_days
language plpgsql security definer set search_path = ''
as $$
declare
  v_company uuid := public.my_company();
  v_tz text;
  v_today date;
  v_month public.company_months;
  v_row public.company_days;
begin
  if v_company is null or public.my_role() is distinct from 'admin' then
    raise exception 'إغلاق اليوم من صلاحيات مدير الشركة' using errcode = '42501';
  end if;
  perform pg_advisory_xact_lock(hashtext('madar_month_' || v_company::text));
  select coalesce(timezone, 'Africa/Cairo') into v_tz from public.companies where id = v_company;
  v_today := (now() at time zone v_tz)::date;
  if p_day > v_today then
    raise exception 'لا يمكن إغلاق يوم مستقبلي' using errcode = '23514';
  end if;

  select * into v_month from public.company_months
  where company_id = v_company
    and period = date_trunc('month', p_day::timestamp)::date
  for update;
  if v_month.id is null then
    raise exception 'لا يوجد شهر لهذا اليوم' using errcode = '23503';
  end if;
  if v_month.status <> 'open' then
    raise exception 'هذا الشهر مغلق ومؤرشف' using errcode = '23514';
  end if;

  insert into public.company_days (company_id, month_id, day)
  values (v_company, v_month.id, p_day)
  on conflict (company_id, day) do nothing;

  select * into v_row from public.company_days
  where company_id = v_company and day = p_day
  for update;
  if v_row.status = 'closed' then
    raise exception 'هذا اليوم مغلق بالفعل' using errcode = '23514';
  end if;

  update public.time_sessions set ended_at = now()
  where ended_at is null and task_id in (
    select id from public.tasks where company_id = v_company and day = p_day
  );

  update public.company_days
  set status = 'closed', closed_at = now(), closed_by = auth.uid(), close_mode = 'manual'
  where id = v_row.id
  returning * into v_row;
  return v_row;
end $$;

revoke execute on function public.ensure_day() from public, anon;
revoke execute on function public.close_day(date) from public, anon;
grant execute on function public.ensure_day() to authenticated;
grant execute on function public.close_day(date) to authenticated;

alter table public.company_days enable row level security;
revoke all on public.company_days from anon, authenticated;
grant select on public.company_days to authenticated;
create policy days_select on public.company_days for select to authenticated
  using (public.is_active_member() and company_id = public.my_company());

-- Closing a month also closes all of its days.
create or replace function public.close_month(p_month uuid) returns public.company_months
language plpgsql security definer set search_path = ''
as $$
declare
  v_company uuid := public.my_company();
  v_row public.company_months;
begin
  if v_company is null or public.my_role() is distinct from 'admin' then
    raise exception 'إغلاق الشهر من صلاحيات مدير الشركة' using errcode = '42501';
  end if;
  perform pg_advisory_xact_lock(hashtext('madar_month_' || v_company::text));
  select * into v_row from public.company_months
  where id = p_month and company_id = v_company
  for update;
  if v_row.id is null then
    raise exception 'الشهر غير موجود' using errcode = '23503';
  end if;
  if v_row.status <> 'open' then
    raise exception 'هذا الشهر مغلق بالفعل' using errcode = '23514';
  end if;

  update public.time_sessions set ended_at = now()
  where ended_at is null and task_id in (select id from public.tasks where month_id = p_month);

  update public.company_days
  set status = 'closed', closed_at = now(), closed_by = auth.uid(), close_mode = 'month'
  where month_id = p_month and status = 'open';

  update public.company_months
  set status = 'closed', closed_at = now(), closed_by = auth.uid(), summary = public.month_summary(p_month)
  where id = p_month
  returning * into v_row;
  return v_row;
end $$;

revoke execute on function public.close_month(uuid) from public, anon;
grant execute on function public.close_month(uuid) to authenticated;

-- Months that roll over automatically close their days too.
create or replace function public.ensure_month() returns public.company_months
language plpgsql security definer set search_path = ''
as $$
declare
  v_company uuid := public.my_company();
  v_tz text;
  v_period date;
  v_row public.company_months;
  r record;
begin
  if v_company is null then
    return null;
  end if;
  perform pg_advisory_xact_lock(hashtext('madar_month_' || v_company::text));
  select coalesce(timezone, 'Africa/Cairo') into v_tz from public.companies where id = v_company;
  v_period := date_trunc('month', (now() at time zone v_tz))::date;

  for r in
    select * from public.company_months
    where company_id = v_company and status = 'open' and period < v_period
  loop
    update public.time_sessions set ended_at = now()
    where ended_at is null and task_id in (select id from public.tasks where month_id = r.id);
    update public.company_days
    set status = 'closed', closed_at = now(), close_mode = 'auto'
    where month_id = r.id and status = 'open';
    update public.company_months
    set status = 'closed', closed_at = now(), summary = public.month_summary(r.id)
    where id = r.id;
  end loop;

  select * into v_row from public.company_months
  where company_id = v_company and status = 'open'
  order by period desc limit 1;
  if v_row.id is not null then
    return v_row;
  end if;

  insert into public.company_months (company_id, period) values (v_company, v_period)
  on conflict (company_id, period) do nothing;
  select * into v_row from public.company_months
  where company_id = v_company and period = v_period and status = 'open';
  return v_row;
end $$;

revoke execute on function public.ensure_month() from public, anon;
grant execute on function public.ensure_month() to authenticated;

-- ---------------------------------------------------------------- day locks

-- Child records (assignees, subtasks, comments, files, time) freeze with the day.
create or replace function public.guard_month_lock() returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  v_task uuid;
  v_month text;
  v_day text;
begin
  if tg_op = 'DELETE' then
    v_task := old.task_id;
  else
    v_task := new.task_id;
  end if;
  select m.status, d.status into v_month, v_day
  from public.tasks t
  join public.company_months m on m.id = t.month_id
  left join public.company_days d on d.company_id = t.company_id and d.day = t.day
  where t.id = v_task;
  if v_month = 'closed' then
    raise exception 'هذا الشهر مغلق ومؤرشف، لا يمكن تعديل بياناته' using errcode = '42501';
  end if;
  if v_day = 'closed' then
    raise exception 'هذا اليوم مغلق ومؤرشف، لا يمكن تعديل بياناته' using errcode = '42501';
  end if;
  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end $$;
revoke execute on function public.guard_month_lock() from public, anon, authenticated;

-- ---------------------------------------------------------------- task workflow

create or replace function public.tasks_before_write() returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_role public.app_role;
  v_dept uuid;
  v_company uuid := public.my_company();
  v_month public.company_months;
  v_proj_dept uuid;
  v_proj_company uuid;
  v_self_owned boolean;
  v_old_day_closed boolean;
begin
  if v_uid is not null then
    select role, department_id into v_role, v_dept
    from public.profiles where id = v_uid and status = 'active';
  end if;

  if tg_op = 'INSERT' then
    if v_uid is not null then
      if v_role is distinct from 'admin' then
        raise exception 'إضافة المهام من صلاحيات مدير الشركة فقط' using errcode = '42501';
      end if;
      new.created_by := v_uid;
      new.company_id := v_company;
      if new.company_id is null then
        raise exception 'لا يمكن إنشاء مهمة بدون شركة' using errcode = '42501';
      end if;
      perform pg_advisory_xact_lock(hashtext('madar_month_' || new.company_id::text));
      if new.project_id is not null then
        select department_id, company_id into v_proj_dept, v_proj_company
        from public.projects where id = new.project_id;
        if v_proj_company is distinct from new.company_id then
          raise exception 'المشروع لا يتبع شركتك' using errcode = '42501';
        end if;
        if new.department_id is null then
          new.department_id := v_proj_dept;
        end if;
      end if;
      if new.department_id is not null and not exists (
        select 1 from public.departments d
        where d.id = new.department_id and d.company_id = new.company_id
      ) then
        raise exception 'القسم لا يتبع شركتك' using errcode = '42501';
      end if;
      if new.month_id is null then
        v_month := public.ensure_month();
        if v_month.id is null then
          raise exception 'الشهر الحالي مغلق. يُفتح شهر جديد تلقائيًا مع بداية الشهر التالي' using errcode = '23514';
        end if;
        new.month_id := v_month.id;
      else
        select * into v_month from public.company_months where id = new.month_id;
        if v_month.id is null or v_month.company_id is distinct from new.company_id then
          raise exception 'الشهر لا يتبع شركتك' using errcode = '42501';
        end if;
        if v_month.status <> 'open' then
          raise exception 'لا يمكن إضافة مهام لشهر مغلق' using errcode = '42501';
        end if;
      end if;
    elsif new.company_id is null then
      raise exception 'لا يمكن إنشاء مهمة بدون شركة' using errcode = '42501';
    end if;

    if new.day is null then
      new.day := (now() at time zone coalesce(
        (select timezone from public.companies where id = new.company_id), 'Africa/Cairo'))::date;
    end if;
    select * into v_month from public.company_months where id = new.month_id;
    if new.day < v_month.period or new.day >= (v_month.period + interval '1 month')::date then
      raise exception 'يوم التنفيذ يجب أن يكون داخل الشهر' using errcode = '23514';
    end if;
    if exists (
      select 1 from public.company_days d
      where d.company_id = new.company_id and d.day = new.day and d.status = 'closed'
    ) then
      raise exception 'هذا اليوم مغلق ومؤرشف، اختر يومًا آخر' using errcode = '42501';
    end if;
    insert into public.company_days (company_id, month_id, day)
    values (new.company_id, new.month_id, new.day)
    on conflict (company_id, day) do nothing;

    if new.status = 'review' then new.submitted_at := now(); end if;
    if new.status = 'done' then new.completed_at := now(); end if;
    new.created_at := now();
    new.updated_at := now();
    return new;
  end if;

  new.created_by := old.created_by;
  new.created_at := old.created_at;
  new.company_id := old.company_id;
  new.month_id := old.month_id;

  select * into v_month from public.company_months where id = old.month_id;
  if v_month.status = 'closed' then
    raise exception 'هذا الشهر مغلق ومؤرشف، لا يمكن تعديل بياناته' using errcode = '42501';
  end if;

  select exists (
    select 1 from public.company_days d
    where d.company_id = old.company_id and d.day = old.day and d.status = 'closed'
  ) into v_old_day_closed;

  if new.day is distinct from old.day then
    if v_uid is not null and v_role is distinct from 'admin' then
      raise exception 'نقل المهمة ليوم آخر من صلاحيات مدير الشركة' using errcode = '42501';
    end if;
    if new.day < v_month.period or new.day >= (v_month.period + interval '1 month')::date then
      raise exception 'يوم التنفيذ يجب أن يكون داخل الشهر' using errcode = '23514';
    end if;
    if exists (
      select 1 from public.company_days d
      where d.company_id = old.company_id and d.day = new.day and d.status = 'closed'
    ) then
      raise exception 'هذا اليوم مغلق ومؤرشف، اختر يومًا آخر' using errcode = '42501';
    end if;
    insert into public.company_days (company_id, month_id, day)
    values (old.company_id, old.month_id, new.day)
    on conflict (company_id, day) do nothing;
  else
    new.day := old.day;
    if v_old_day_closed then
      -- A closed day keeps only the reviewer's decision on tasks waiting for review.
      if not (
        old.status = 'review' and new.status in ('done', 'in_progress')
        and v_uid is not null and public.can_review_task(old.id)
        and row(new.title, new.description, new.project_id, new.department_id, new.priority,
                new.start_date, new.due_date, new.estimate_minutes, new.reviewer_id, new.day)
            is not distinct from
            row(old.title, old.description, old.project_id, old.department_id, old.priority,
                old.start_date, old.due_date, old.estimate_minutes, old.reviewer_id, old.day)
      ) then
        raise exception 'هذا اليوم مغلق ومؤرشف، لا يمكن تعديل بياناته' using errcode = '42501';
      end if;
    end if;
  end if;

  if v_uid is not null then
    if v_role = 'admin' then
      null;
    elsif v_role = 'manager' and public.can_manage_task(old.id) then
      if new.department_id is distinct from old.department_id
         and (v_dept is null or new.department_id is distinct from v_dept) then
        raise exception 'لا يمكنك نقل المهمة إلى قسم آخر' using errcode = '42501';
      end if;
    elsif v_role = 'supervisor' and v_dept is not null and old.department_id = v_dept then
      if old.status <> 'review' then
        raise exception 'يتابع المشرف جودة المهام في مرحلة المراجعة فقط' using errcode = '42501';
      end if;
      if row(new.title, new.description, new.project_id, new.department_id, new.priority,
             new.start_date, new.due_date, new.estimate_minutes, new.reviewer_id)
         is distinct from
         row(old.title, old.description, old.project_id, old.department_id, old.priority,
             old.start_date, old.due_date, old.estimate_minutes, old.reviewer_id) then
        raise exception 'يعتمد المشرف المهمة أو يعيدها دون تعديل تفاصيلها' using errcode = '42501';
      end if;
      if new.status is not distinct from old.status or new.status not in ('done', 'in_progress') then
        raise exception 'اختر اعتماد المهمة أو إعادتها للتنفيذ' using errcode = '42501';
      end if;
    elsif v_role = 'employee' and public.is_task_assignee(old.id) then
      if row(new.title, new.description, new.project_id, new.department_id, new.priority,
             new.start_date, new.due_date, new.estimate_minutes, new.reviewer_id)
         is distinct from
         row(old.title, old.description, old.project_id, old.department_id, old.priority,
             old.start_date, old.due_date, old.estimate_minutes, old.reviewer_id) then
        raise exception 'يمكنك تغيير حالة المهمة فقط' using errcode = '42501';
      end if;
      v_self_owned := old.created_by = v_uid and old.reviewer_id is null;
      if new.status is distinct from old.status then
        if new.status = 'done' and not v_self_owned then
          raise exception 'المهمة تحتاج اعتماد المراجع قبل إغلاقها — أرسلها للمراجعة' using errcode = '42501';
        end if;
        if old.status = 'done' and not v_self_owned then
          raise exception 'لا يمكن إعادة فتح مهمة معتمدة' using errcode = '42501';
        end if;
      end if;
      new.review_note := old.review_note;
    else
      raise exception 'ليست لديك صلاحية تعديل هذه المهمة' using errcode = '42501';
    end if;
  end if;

  if new.status is distinct from old.status then
    if new.status = 'review' then
      new.submitted_at := now();
    end if;
    if new.status = 'done' then
      new.completed_at := now();
    else
      new.completed_at := null;
    end if;
  else
    new.completed_at := old.completed_at;
    new.submitted_at := old.submitted_at;
  end if;
  new.updated_at := now();
  return new;
end $$;

-- ---------------------------------------------------------------- timers

create or replace function public.start_timer(p_task uuid) returns public.time_sessions
language plpgsql security definer set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_role public.app_role := public.my_role();
  v_row public.time_sessions;
  v_status public.task_status;
  v_month text;
  v_day text;
begin
  if v_uid is null or v_role is null then
    raise exception 'سجّل الدخول بحساب مفعّل أولًا' using errcode = '42501';
  end if;
  if v_role = 'viewer' then
    raise exception 'حساب المشاهدة لا يسجّل وقت عمل' using errcode = '42501';
  end if;
  if not (public.is_task_assignee(p_task) or public.can_manage_task(p_task)) then
    raise exception 'يمكنك تسجيل الوقت على المهام المسندة إليك فقط' using errcode = '42501';
  end if;
  select t.status, m.status, d.status into v_status, v_month, v_day
  from public.tasks t
  join public.company_months m on m.id = t.month_id
  left join public.company_days d on d.company_id = t.company_id and d.day = t.day
  where t.id = p_task;
  if v_month = 'closed' then
    raise exception 'هذا الشهر مغلق ومؤرشف، لا يمكن تسجيل وقت جديد' using errcode = '42501';
  end if;
  if v_day = 'closed' then
    raise exception 'هذا اليوم مغلق ومؤرشف، لا يمكن تسجيل وقت جديد' using errcode = '42501';
  end if;
  if v_status = 'done' then
    raise exception 'لا يمكن تسجيل وقت على مهمة معتمدة' using errcode = '23514';
  end if;

  perform pg_advisory_xact_lock(hashtext('madar_timer_' || v_uid::text));
  update public.time_sessions set ended_at = now()
  where user_id = v_uid and ended_at is null;

  insert into public.time_sessions (task_id, user_id, started_at)
  values (p_task, v_uid, now())
  returning * into v_row;

  if v_status = 'todo' then
    update public.tasks set status = 'in_progress' where id = p_task;
  end if;
  return v_row;
end $$;

create or replace function public.add_time_entry(
  p_task uuid, p_started timestamptz, p_ended timestamptz, p_note text default null
) returns public.time_sessions
language plpgsql security definer set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_role public.app_role := public.my_role();
  v_row public.time_sessions;
  v_month text;
  v_day text;
begin
  if v_uid is null or v_role is null or v_role = 'viewer' then
    raise exception 'غير مصرح بتسجيل وقت' using errcode = '42501';
  end if;
  if not (public.is_task_assignee(p_task) or public.can_manage_task(p_task)) then
    raise exception 'يمكنك تسجيل الوقت على المهام المسندة إليك فقط' using errcode = '42501';
  end if;
  select m.status, d.status into v_month, v_day
  from public.tasks t
  join public.company_months m on m.id = t.month_id
  left join public.company_days d on d.company_id = t.company_id and d.day = t.day
  where t.id = p_task;
  if v_month = 'closed' then
    raise exception 'هذا الشهر مغلق ومؤرشف، لا يمكن تسجيل وقت جديد' using errcode = '42501';
  end if;
  if v_day = 'closed' then
    raise exception 'هذا اليوم مغلق ومؤرشف، لا يمكن تسجيل وقت جديد' using errcode = '42501';
  end if;
  if p_ended <= p_started then
    raise exception 'وقت الانتهاء يجب أن يكون بعد وقت البدء' using errcode = '23514';
  end if;
  if p_ended > now() + interval '5 minutes' then
    raise exception 'لا يمكن تسجيل وقت في المستقبل' using errcode = '23514';
  end if;
  if p_ended - p_started > interval '16 hours' then
    raise exception 'الجلسة الواحدة لا تتجاوز 16 ساعة' using errcode = '23514';
  end if;
  insert into public.time_sessions (task_id, user_id, started_at, ended_at, note, is_manual)
  values (p_task, v_uid, p_started, p_ended, nullif(trim(p_note), ''), true)
  returning * into v_row;
  return v_row;
end $$;

revoke execute on function public.start_timer(uuid) from public, anon;
revoke execute on function public.add_time_entry(uuid, timestamptz, timestamptz, text) from public, anon;
grant execute on function public.start_timer(uuid) to authenticated;
grant execute on function public.add_time_entry(uuid, timestamptz, timestamptz, text) to authenticated;
