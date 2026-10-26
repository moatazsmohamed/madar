-- Madar: general supervision department and last-day month close.
-- One department per company may be flagged as general supervision: its managers
-- and supervisors oversee tasks, reviews, people and projects across every
-- department. Months may only be closed manually on their last calendar day;
-- otherwise the monthly rollover closes them automatically.

-- ---------------------------------------------------------------- flag

alter table public.departments add column supervises_all boolean not null default false;
create unique index departments_one_general_supervisor
  on public.departments (company_id) where supervises_all;

create or replace function public.department_supervises_all(p_department uuid) returns boolean
language sql stable security definer set search_path = ''
as $$
  select coalesce((select d.supervises_all from public.departments d where d.id = p_department), false)
$$;

create or replace function public.my_department_supervises_all() returns boolean
language sql stable security definer set search_path = ''
as $$
  select coalesce((
    select d.supervises_all
    from public.profiles p
    join public.departments d on d.id = p.department_id
    where p.id = auth.uid() and p.status = 'active'
  ), false)
$$;

revoke execute on function public.department_supervises_all(uuid) from public, anon;
revoke execute on function public.my_department_supervises_all() from public, anon;
grant execute on function public.department_supervises_all(uuid) to authenticated;
grant execute on function public.my_department_supervises_all() to authenticated;

-- Only the company admin decides which department supervises the whole company.
create or replace function public.departments_before_write() returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  v_company uuid := public.my_company();
begin
  if tg_op = 'INSERT' then
    new.company_id := coalesce(new.company_id, v_company);
    if new.company_id is null then
      raise exception 'لا يمكن إنشاء قسم بدون شركة' using errcode = '42501';
    end if;
    if auth.uid() is not null and new.company_id is distinct from v_company then
      raise exception 'لا يمكنك إنشاء أقسام في شركة أخرى' using errcode = '42501';
    end if;
    if new.supervises_all and auth.uid() is not null and not public.is_admin() then
      raise exception 'تحديد الإشراف العام من صلاحيات مدير الشركة' using errcode = '42501';
    end if;
  else
    new.company_id := old.company_id;
    if new.supervises_all is distinct from old.supervises_all
       and auth.uid() is not null and not public.is_admin() then
      raise exception 'تحديد الإشراف العام من صلاحيات مدير الشركة' using errcode = '42501';
    end if;
  end if;

  if new.manager_id is not null and not exists (
    select 1 from public.profiles p where p.id = new.manager_id and p.company_id = new.company_id
  ) then
    raise exception 'هذا المستخدم لا يتبع الشركة نفسها' using errcode = '42501';
  end if;
  return new;
end $$;

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
        or (me.role in ('manager', 'supervisor', 'viewer')
            and public.department_supervises_all(me.department_id))
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
        or (me.role in ('manager', 'supervisor', 'viewer')
            and public.department_supervises_all(me.department_id))
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
        or (me.role = 'manager' and (
          (me.department_id is not null and t.department_id = me.department_id)
          or public.department_supervises_all(me.department_id)
        ))
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
        or (me.role in ('manager', 'supervisor') and (
          (me.department_id is not null and t.department_id = me.department_id)
          or public.department_supervises_all(me.department_id)
        ))
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
        or (me.role = 'manager' and (
          (me.department_id is not null and t.department_id = me.department_id)
          or public.department_supervises_all(me.department_id)
        ))
        or exists (select 1 from public.task_assignees a where a.task_id = t.id and a.user_id = me.id)
      )
  )
$$;

-- ---------------------------------------------------------------- policies

drop policy if exists departments_select on public.departments;
create policy departments_select on public.departments for select to authenticated
  using (
    public.is_active_member() and company_id = public.my_company()
    and (public.is_admin() or id = public.my_department() or public.my_department_supervises_all())
  );

drop policy if exists projects_select on public.projects;
drop policy if exists projects_update on public.projects;
drop policy if exists projects_delete on public.projects;
create policy projects_select on public.projects for select to authenticated
  using (
    public.is_active_member()
    and company_id = public.my_company()
    and (
      public.is_admin()
      or (public.my_role() in ('manager', 'supervisor', 'viewer') and (
        (department_id is not null and department_id = public.my_department())
        or public.my_department_supervises_all()
      ))
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
      or (public.my_role() = 'manager' and (
        department_id is not distinct from public.my_department()
        or public.my_department_supervises_all()
      ))
    )
  )
  with check (
    public.my_role() in ('admin', 'manager')
    and company_id = public.my_company()
  );
create policy projects_delete on public.projects for delete to authenticated
  using (
    company_id = public.my_company()
    and (
      public.is_admin()
      or (public.my_role() = 'manager' and (
        department_id is not distinct from public.my_department()
        or public.my_department_supervises_all()
      ))
    )
  );

drop policy if exists tasks_select on public.tasks;
create policy tasks_select on public.tasks for select to authenticated
  using (
    public.is_active_member()
    and company_id = public.my_company()
    and (
      public.my_role() = 'admin'
      or (public.my_role() in ('manager', 'supervisor', 'viewer') and (
        (department_id is not null and department_id = public.my_department())
        or public.my_department_supervises_all()
      ))
      or (public.my_role() = 'employee' and public.is_task_assignee(id))
    )
  );

drop policy if exists assignees_insert on public.task_assignees;
create policy assignees_insert on public.task_assignees for insert to authenticated
  with check (
    public.can_manage_task(task_id)
    and exists (
      select 1 from public.profiles p
      where p.id = user_id and p.company_id = public.my_company() and p.status = 'active'
        and (
          public.my_role() = 'admin'
          or p.department_id = public.my_department()
          or public.my_department_supervises_all()
        )
    )
  );

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
  v_supervises_all boolean := false;
begin
  if v_uid is not null then
    select role, department_id into v_role, v_dept
    from public.profiles where id = v_uid and status = 'active';
    if v_role in ('manager', 'supervisor') then
      v_supervises_all := public.department_supervises_all(v_dept);
    end if;
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
         and not v_supervises_all
         and (v_dept is null or new.department_id is distinct from v_dept) then
        raise exception 'لا يمكنك نقل المهمة إلى قسم آخر' using errcode = '42501';
      end if;
    elsif v_role = 'supervisor' and v_dept is not null
          and (old.department_id = v_dept or v_supervises_all) then
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

-- ---------------------------------------------------------------- month close

-- Manual close only on the last calendar day of the month (company timezone).
create or replace function public.close_month(p_month uuid) returns public.company_months
language plpgsql security definer set search_path = ''
as $$
declare
  v_company uuid := public.my_company();
  v_tz text;
  v_today date;
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

  select coalesce(timezone, 'Africa/Cairo') into v_tz from public.companies where id = v_company;
  v_today := (now() at time zone coalesce(v_tz, 'Africa/Cairo'))::date;
  if v_today <> (v_row.period + interval '1 month - 1 day')::date then
    raise exception 'لا يمكن إغلاق الشهر قبل آخر يوم منه؛ يُغلق تلقائيًا في نهايته' using errcode = '23514';
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
