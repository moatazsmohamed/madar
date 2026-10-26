-- Madar: monthly work periods and tighter role scopes.
-- Every task belongs to a company month. A month closes automatically when the
-- calendar moves on (or early, by the company admin) and then becomes read-only
-- while all of its tasks, time, comments and files stay saved.

-- ---------------------------------------------------------------- months
create table public.company_months (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id) on delete cascade,
  period date not null,
  status text not null default 'open' check (status in ('open', 'closed')),
  opened_at timestamptz not null default now(),
  closed_at timestamptz,
  closed_by uuid references public.profiles (id) on delete set null,
  summary jsonb,
  constraint company_months_period_first_day check (period = date_trunc('month', period::timestamp)::date),
  constraint company_months_company_period_key unique (company_id, period),
  constraint company_months_closed_check check ((status = 'closed') = (closed_at is not null))
);
create index company_months_company_idx on public.company_months (company_id, period desc);

alter table public.tasks add column month_id uuid references public.company_months (id) on delete restrict;
create index tasks_month_idx on public.tasks (month_id);

-- Existing tasks join the month they were created in; past months are archived.
insert into public.company_months (company_id, period, status, closed_at)
select distinct
  t.company_id,
  date_trunc('month', (t.created_at at time zone coalesce(c.timezone, 'Africa/Cairo')))::date,
  case
    when date_trunc('month', (t.created_at at time zone coalesce(c.timezone, 'Africa/Cairo')))::date
      < date_trunc('month', (now() at time zone coalesce(c.timezone, 'Africa/Cairo')))::date
      then 'closed'
    else 'open'
  end,
  case
    when date_trunc('month', (t.created_at at time zone coalesce(c.timezone, 'Africa/Cairo')))::date
      < date_trunc('month', (now() at time zone coalesce(c.timezone, 'Africa/Cairo')))::date
      then now()
    else null
  end
from public.tasks t
join public.companies c on c.id = t.company_id
on conflict (company_id, period) do nothing;

update public.tasks t
set month_id = m.id
from public.company_months m
join public.companies c on c.id = m.company_id
where m.company_id = t.company_id
  and m.period = date_trunc('month', (t.created_at at time zone coalesce(c.timezone, 'Africa/Cairo')))::date;

alter table public.tasks alter column month_id set not null;

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

update public.company_months m
set summary = public.month_summary(m.id)
where m.status = 'closed' and m.summary is null;

-- Opens the month of the caller's company, closing any earlier open month first.
-- Returns null when the current month was already closed early.
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

-- Early close, company admin only. The archived month stays readable forever.
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

  update public.company_months
  set status = 'closed', closed_at = now(), closed_by = auth.uid(), summary = public.month_summary(p_month)
  where id = p_month
  returning * into v_row;
  return v_row;
end $$;

revoke execute on function public.ensure_month() from public, anon;
revoke execute on function public.close_month(uuid) from public, anon;
revoke execute on function public.month_summary(uuid) from public, anon, authenticated;
grant execute on function public.month_summary(uuid) to service_role;
grant execute on function public.ensure_month() to authenticated;
grant execute on function public.close_month(uuid) to authenticated;

alter table public.company_months enable row level security;
create policy months_select on public.company_months for select to authenticated
  using (public.is_active_member() and company_id = public.my_company());

-- ---------------------------------------------------------------- scope helpers
create or replace function public.can_view_profile(p_profile uuid) returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1
    from public.profiles me
    join public.profiles p on p.id = p_profile and p.company_id = me.company_id
    where me.id = auth.uid() and me.status = 'active'
      and (
        me.role = 'admin'
        or p.id = me.id
        or (me.role in ('manager', 'supervisor', 'viewer') and me.department_id is not null
            and p.department_id = me.department_id)
        or exists (
          select 1 from public.task_assignees a
          join public.task_assignees b on b.task_id = a.task_id
          where a.user_id = me.id and b.user_id = p.id
        )
        or exists (
          select 1 from public.tasks t
          join public.task_assignees a on a.task_id = t.id
          where a.user_id = me.id and (t.created_by = p.id or t.reviewer_id = p.id)
        )
      )
  )
$$;

create or replace function public.can_view_task(p_task uuid) returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1
    from public.tasks t
    join public.profiles me on me.id = auth.uid() and me.status = 'active'
    where t.id = p_task
      and t.company_id = me.company_id
      and (
        me.role = 'admin'
        or (me.role in ('manager', 'supervisor', 'viewer') and me.department_id is not null
            and t.department_id = me.department_id)
        or (me.role = 'employee' and exists (
          select 1 from public.task_assignees a where a.task_id = t.id and a.user_id = me.id
        ))
      )
  )
$$;

create or replace function public.can_manage_task(p_task uuid) returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1
    from public.tasks t
    join public.profiles me on me.id = auth.uid() and me.status = 'active'
    where t.id = p_task
      and t.company_id = me.company_id
      and (
        me.role = 'admin'
        or (me.role = 'manager' and me.department_id is not null and t.department_id = me.department_id)
      )
  )
$$;

create or replace function public.can_review_task(p_task uuid) returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1
    from public.tasks t
    join public.profiles me on me.id = auth.uid() and me.status = 'active'
    where t.id = p_task
      and t.company_id = me.company_id
      and (
        me.role = 'admin'
        or (me.role in ('manager', 'supervisor') and me.department_id is not null
            and t.department_id = me.department_id)
      )
  )
$$;

create or replace function public.can_work_on_task(p_task uuid) returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1
    from public.tasks t
    join public.profiles me on me.id = auth.uid() and me.status = 'active' and me.role <> 'viewer'
    where t.id = p_task
      and t.company_id = me.company_id
      and (
        me.role = 'admin'
        or (me.role = 'manager' and me.department_id is not null and t.department_id = me.department_id)
        or exists (select 1 from public.task_assignees a where a.task_id = t.id and a.user_id = me.id)
      )
  )
$$;

revoke execute on function public.can_view_profile(uuid) from public, anon;
revoke execute on function public.can_view_task(uuid) from public, anon;
revoke execute on function public.can_manage_task(uuid) from public, anon;
revoke execute on function public.can_review_task(uuid) from public, anon;
revoke execute on function public.can_work_on_task(uuid) from public, anon;
grant execute on function public.can_view_profile(uuid) to authenticated;
grant execute on function public.can_view_task(uuid) to authenticated;
grant execute on function public.can_manage_task(uuid) to authenticated;
grant execute on function public.can_review_task(uuid) to authenticated;
grant execute on function public.can_work_on_task(uuid) to authenticated;

-- ---------------------------------------------------------------- signup hardening
-- Role and status never come from public signup metadata; only invitations and the
-- developer bootstrap decide them. The admin-users function promotes its own users.
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  v_meta jsonb := coalesce(new.raw_user_meta_data, '{}'::jsonb);
  v_inv public.invitations;
  v_admin record;
  v_name text := nullif(trim(coalesce(v_meta ->> 'full_name', '')), '');
  v_company uuid := nullif(v_meta ->> 'company_id', '')::uuid;
begin
  perform pg_advisory_xact_lock(hashtext('madar_new_user'));

  -- The very first account owns the platform.
  if not exists (select 1 from public.profiles where role = 'developer') then
    insert into public.profiles (id, email, full_name, role, status)
    values (new.id, lower(new.email), coalesce(v_name, split_part(new.email, '@', 1)), 'developer', 'active');
    return new;
  end if;

  select * into v_inv from public.invitations
  where email = lower(new.email) and accepted_at is null
    and (v_company is null or company_id = v_company)
  order by created_at
  limit 1;

  if v_inv.id is not null then
    insert into public.profiles (id, email, full_name, role, status, company_id, department_id, job_title)
    values (
      new.id, lower(new.email),
      coalesce(nullif(trim(coalesce(v_inv.full_name, '')), ''), v_name, split_part(new.email, '@', 1)),
      v_inv.role, 'active', v_inv.company_id, v_inv.department_id, v_inv.job_title
    );
    update public.invitations set accepted_at = now() where id = v_inv.id;
    return new;
  end if;

  if v_company is null then
    raise exception 'لا يمكن إنشاء الحساب قبل تحديد الشركة' using errcode = '23514';
  end if;

  insert into public.profiles (id, email, full_name, role, status, company_id)
  values (new.id, lower(new.email), coalesce(v_name, split_part(new.email, '@', 1)), 'employee', 'pending', v_company);

  for v_admin in select id from public.profiles where role = 'admin' and status = 'active' and company_id = v_company loop
    insert into public.notifications (user_id, kind, title, body)
    values (v_admin.id, 'member_pending', 'طلب انضمام جديد',
            coalesce(v_name, lower(new.email)) || ' ينتظر الموافقة على حسابه');
  end loop;
  return new;
end $$;

create or replace function public.invitations_before_write() returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    new.company_id := coalesce(new.company_id, public.my_company());
    if new.company_id is null then
      raise exception 'لا يمكن إنشاء تصريح بدون شركة' using errcode = '42501';
    end if;
  else
    new.company_id := old.company_id;
  end if;
  if new.role = 'developer' and auth.uid() is not null and not public.is_developer() then
    raise exception 'لا يمكن منح حساب المطور' using errcode = '42501';
  end if;
  return new;
end $$;

-- Admins may run their company but never turn an account into a platform developer.
create or replace function public.profiles_before_update() returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_role public.app_role;
  v_dept uuid;
  v_company uuid;
begin
  new.updated_at := now();
  new.id := old.id;
  new.email := old.email;
  new.created_at := old.created_at;
  new.company_id := old.company_id;
  if v_uid is null then
    return new;
  end if;

  select role, department_id, company_id into v_role, v_dept, v_company
  from public.profiles where id = v_uid and status = 'active';

  if new.role = 'developer' and v_role is distinct from 'developer' then
    raise exception 'لا يمكن منح حساب المطور' using errcode = '42501';
  end if;
  if old.role = 'developer' and v_role is distinct from 'developer' then
    raise exception 'لا يمكن تعديل حساب المطور' using errcode = '42501';
  end if;

  if v_role = 'developer' then
    if old.id = v_uid and (new.role is distinct from old.role or new.status is distinct from old.status) then
      raise exception 'لا يمكنك تغيير دور حساب المطور' using errcode = '42501';
    end if;
    return new;
  end if;

  if v_role = 'admin' and old.company_id = v_company then
    if (new.role <> 'admin' or new.status <> 'active') and old.role = 'admin' and old.status = 'active'
       and not exists (
         select 1 from public.profiles
         where role = 'admin' and status = 'active' and company_id = old.company_id and id <> old.id
       ) then
      raise exception 'لا يمكن إزالة صلاحية آخر مدير نظام' using errcode = '42501';
    end if;
    if old.status = 'pending' and new.status = 'active' then
      insert into public.notifications (user_id, kind, title, body, actor_id)
      values (old.id, 'member_approved', 'تم تفعيل حسابك', 'مرحبًا بك في مساحة العمل', v_uid);
    end if;
    return new;
  end if;

  if old.id = v_uid then
    if new.role is distinct from old.role or new.status is distinct from old.status
       or new.department_id is distinct from old.department_id then
      raise exception 'لا يمكنك تغيير الدور أو القسم أو حالة الحساب' using errcode = '42501';
    end if;
    return new;
  end if;

  if v_role = 'manager' and v_dept is not null and old.department_id = v_dept and old.company_id = v_company then
    if new.role is distinct from old.role or new.status is distinct from old.status
       or new.department_id is distinct from old.department_id then
      raise exception 'تغيير الدور أو القسم أو الحالة من صلاحيات مدير النظام' using errcode = '42501';
    end if;
    return new;
  end if;

  raise exception 'غير مصرح لك بتعديل هذا الحساب' using errcode = '42501';
end $$;

-- ---------------------------------------------------------------- month locks
create or replace function public.guard_month_lock() returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  v_task uuid;
  v_status text;
begin
  if tg_op = 'DELETE' then
    v_task := old.task_id;
  else
    v_task := new.task_id;
  end if;
  select m.status into v_status
  from public.tasks t join public.company_months m on m.id = t.month_id
  where t.id = v_task;
  if v_status = 'closed' then
    raise exception 'هذا الشهر مغلق ومؤرشف، لا يمكن تعديل بياناته' using errcode = '42501';
  end if;
  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end $$;
revoke execute on function public.guard_month_lock() from public, anon, authenticated;

create trigger task_assignees_month_lock before insert or delete on public.task_assignees
  for each row execute function public.guard_month_lock();
create trigger subtasks_month_lock before insert or update or delete on public.subtasks
  for each row execute function public.guard_month_lock();
create trigger comments_month_lock before insert or update or delete on public.comments
  for each row execute function public.guard_month_lock();
create trigger attachments_month_lock before insert or delete on public.attachments
  for each row execute function public.guard_month_lock();
create trigger time_sessions_month_lock before insert or delete on public.time_sessions
  for each row execute function public.guard_month_lock();

-- Archived months also reject deleting their tasks outright.
create or replace function public.guard_task_month_lock() returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  v_status text;
begin
  select m.status into v_status from public.company_months m where m.id = old.month_id;
  if v_status = 'closed' then
    raise exception 'هذا الشهر مغلق ومؤرشف، لا يمكن حذف مهامه' using errcode = '42501';
  end if;
  return old;
end $$;
revoke execute on function public.guard_task_month_lock() from public, anon, authenticated;
create trigger tasks_month_delete before delete on public.tasks
  for each row execute function public.guard_task_month_lock();

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
  v_month_status text;
  v_proj_dept uuid;
  v_proj_company uuid;
  v_self_owned boolean;
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

  select m.status into v_month_status
  from public.company_months m where m.id = old.month_id;
  if v_month_status = 'closed' then
    raise exception 'هذا الشهر مغلق ومؤرشف، لا يمكن تعديل بياناته' using errcode = '42501';
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

-- ---------------------------------------------------------------- policies
drop policy if exists departments_select on public.departments;
drop policy if exists departments_update on public.departments;
create policy departments_select on public.departments for select to authenticated
  using (
    public.is_active_member() and company_id = public.my_company()
    and (public.is_admin() or id = public.my_department())
  );
create policy departments_update on public.departments for update to authenticated
  using (
    company_id = public.my_company()
    and (public.is_admin() or (public.my_role() = 'manager' and id = public.my_department()))
  )
  with check (
    company_id = public.my_company()
    and (public.is_admin() or (public.my_role() = 'manager' and id = public.my_department()))
  );

drop policy if exists profiles_select on public.profiles;
create policy profiles_select on public.profiles for select to authenticated
  using (
    id = (select auth.uid())
    or public.is_developer()
    or (
      public.is_active_member()
      and company_id = public.my_company()
      and public.can_view_profile(id)
    )
  );

drop policy if exists projects_select on public.projects;
drop policy if exists projects_update on public.projects;
create policy projects_select on public.projects for select to authenticated
  using (
    public.is_active_member()
    and company_id = public.my_company()
    and (
      public.is_admin()
      or (public.my_role() in ('manager', 'supervisor', 'viewer') and department_id is not null
          and department_id = public.my_department())
      or (
        public.my_role() in ('employee', 'viewer')
        and exists (
          select 1 from public.tasks t
          join public.task_assignees a on a.task_id = t.id
          where t.project_id = projects.id and a.user_id = (select auth.uid())
        )
      )
    )
  );
create policy projects_update on public.projects for update to authenticated
  using (
    company_id = public.my_company()
    and (
      public.is_admin()
      or (public.my_role() = 'manager' and department_id is not distinct from public.my_department())
    )
  )
  with check (
    public.my_role() in ('admin', 'manager')
    and company_id = public.my_company()
  );

drop policy if exists tasks_select on public.tasks;
drop policy if exists tasks_insert on public.tasks;
drop policy if exists tasks_update on public.tasks;
drop policy if exists tasks_delete on public.tasks;
create policy tasks_select on public.tasks for select to authenticated
  using (
    public.is_active_member()
    and company_id = public.my_company()
    and (
      public.my_role() = 'admin'
      or (public.my_role() in ('manager', 'supervisor', 'viewer') and department_id is not null
          and department_id = public.my_department())
      or (public.my_role() = 'employee' and public.is_task_assignee(id))
    )
  );
create policy tasks_insert on public.tasks for insert to authenticated
  with check (public.my_role() = 'admin' and company_id = public.my_company());
create policy tasks_update on public.tasks for update to authenticated
  using (
    public.can_work_on_task(id) or public.can_manage_task(id) or public.can_review_task(id)
  )
  with check (public.is_active_member() and company_id = public.my_company());
create policy tasks_delete on public.tasks for delete to authenticated
  using (public.can_manage_task(id));

drop policy if exists assignees_insert on public.task_assignees;
drop policy if exists assignees_delete on public.task_assignees;
create policy assignees_insert on public.task_assignees for insert to authenticated
  with check (
    public.can_manage_task(task_id)
    and exists (
      select 1 from public.profiles p
      where p.id = user_id and p.company_id = public.my_company() and p.status = 'active'
        and (
          public.my_role() = 'admin'
          or p.department_id = public.my_department()
        )
    )
  );
create policy assignees_delete on public.task_assignees for delete to authenticated
  using (public.can_manage_task(task_id));

drop policy if exists activities_select on public.activities;
create policy activities_select on public.activities for select to authenticated
  using (
    (task_id is not null and public.can_view_task(task_id))
    or (task_id is null and (public.is_admin() or public.my_role() = 'manager'))
  );

-- ---------------------------------------------------------------- timer rules
create or replace function public.start_timer(p_task uuid) returns public.time_sessions
language plpgsql security definer set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_role public.app_role := public.my_role();
  v_row public.time_sessions;
  v_status public.task_status;
  v_month text;
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
  select status, m.status into v_status, v_month
  from public.tasks t join public.company_months m on m.id = t.month_id
  where t.id = p_task;
  if v_month = 'closed' then
    raise exception 'هذا الشهر مغلق ومؤرشف، لا يمكن تسجيل وقت جديد' using errcode = '42501';
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
begin
  if v_uid is null or v_role is null or v_role = 'viewer' then
    raise exception 'غير مصرح بتسجيل وقت' using errcode = '42501';
  end if;
  if not (public.is_task_assignee(p_task) or public.can_manage_task(p_task)) then
    raise exception 'يمكنك تسجيل الوقت على المهام المسندة إليك فقط' using errcode = '42501';
  end if;
  select m.status into v_month
  from public.tasks t join public.company_months m on m.id = t.month_id
  where t.id = p_task;
  if v_month = 'closed' then
    raise exception 'هذا الشهر مغلق ومؤرشف، لا يمكن تسجيل وقت جديد' using errcode = '42501';
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
