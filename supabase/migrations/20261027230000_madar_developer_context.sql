-- Madar: the developer account can enter any company and act with the full
-- power of that company's admin. The developer keeps a single platform account;
-- an "active company" pointer makes the existing helpers resolve to that company
-- (and to an admin role) for as long as the developer stays inside it.

-- ---------------------------------------------------------------- context table

create table public.developer_active_companies (
  user_id uuid primary key references public.profiles (id) on delete cascade,
  company_id uuid not null references public.companies (id) on delete cascade,
  entered_at timestamptz not null default now()
);

alter table public.developer_active_companies enable row level security;

create policy developer_active_companies_select on public.developer_active_companies
  for select to authenticated
  using (user_id = (select auth.uid()) and public.is_developer());

revoke insert, update, delete on public.developer_active_companies from anon, authenticated;
grant select on public.developer_active_companies to authenticated;

-- The company a developer is currently working inside; null otherwise.
create or replace function public.developer_company() returns uuid
language sql stable security definer set search_path = ''
as $$
  select d.company_id
  from public.developer_active_companies d
  join public.profiles p on p.id = d.user_id and p.status = 'active' and p.role = 'developer'
  where d.user_id = auth.uid()
$$;

revoke execute on function public.developer_company() from public, anon;
grant execute on function public.developer_company() to authenticated;

-- ---------------------------------------------------------------- helpers

-- A developer inside a company resolves to that company; everyone else keeps
-- their own membership company.
create or replace function public.my_company() returns uuid
language sql stable security definer set search_path = ''
as $$
  select coalesce(p.company_id, public.developer_company())
  from public.profiles p
  where p.id = auth.uid() and p.status = 'active'
$$;

-- Inside a company the developer is treated as its admin. Everywhere else the
-- platform role stays untouched.
create or replace function public.my_role() returns public.app_role
language sql stable security definer set search_path = ''
as $$
  select case
    when p.role = 'developer' and public.developer_company() is not null then 'admin'::public.app_role
    else p.role
  end
  from public.profiles p
  where p.id = auth.uid() and p.status = 'active'
$$;

create or replace function public.is_active_member() returns boolean
language sql stable security definer set search_path = ''
as $$ select coalesce(public.my_company() is not null, false) $$;

create or replace function public.is_admin() returns boolean
language sql stable security definer set search_path = ''
as $$ select coalesce(public.my_role() = 'admin', false) $$;

-- ---------------------------------------------------------------- enter / exit

create or replace function public.developer_enter_company(p_company uuid) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_company public.companies;
begin
  if not public.is_developer() then
    raise exception 'الدخول إلى الشركات من صلاحيات حساب المطور' using errcode = '42501';
  end if;
  select * into v_company from public.companies where id = p_company;
  if v_company.id is null then
    raise exception 'الشركة غير موجودة' using errcode = '23503';
  end if;
  insert into public.developer_active_companies (user_id, company_id, entered_at)
  values (auth.uid(), p_company, now())
  on conflict (user_id) do update
    set company_id = excluded.company_id, entered_at = now();
  return jsonb_build_object(
    'company_id', v_company.id,
    'name', v_company.name,
    'timezone', v_company.timezone,
    'status', v_company.status
  );
end $$;

create or replace function public.developer_exit_company() returns void
language plpgsql security definer set search_path = ''
as $$
begin
  if not public.is_developer() then
    raise exception 'الخروج من الشركة من صلاحيات حساب المطور' using errcode = '42501';
  end if;
  delete from public.developer_active_companies where user_id = auth.uid();
end $$;

revoke execute on function public.developer_enter_company(uuid) from public, anon;
revoke execute on function public.developer_exit_company() from public, anon;
grant execute on function public.developer_enter_company(uuid) to authenticated;
grant execute on function public.developer_exit_company() to authenticated;

-- Admins of every company, for the developer companies screen. RLS on profiles
-- stays scoped to the active company, so this definer view supplies the list.
create or replace function public.developer_company_admins()
returns table (id uuid, company_id uuid, full_name text, email text)
language sql stable security definer set search_path = ''
as $$
  select p.id, p.company_id, p.full_name, p.email
  from public.profiles p
  where p.role = 'admin' and p.company_id is not null
    and public.is_developer()
$$;

revoke execute on function public.developer_company_admins() from public, anon;
grant execute on function public.developer_company_admins() to authenticated;

-- ---------------------------------------------------------------- profiles policy

-- A developer outside any company sees every account (companies screen); once
-- inside a company the normal company scope applies, so team and assignee lists
-- never mix tenants.
drop policy if exists profiles_select on public.profiles;
create policy profiles_select on public.profiles for select to authenticated
  using (
    id = (select auth.uid())
    or (public.is_developer() and public.developer_company() is null)
    or (
      public.is_active_member()
      and company_id = public.my_company()
      and public.can_view_profile(id)
    )
  );

-- ---------------------------------------------------------------- scope helpers

create or replace function public.can_view_profile(p_profile uuid) returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1
    from public.profiles p
    where p.id = p_profile
      and public.is_active_member()
      and p.company_id = public.my_company()
      and (
        public.is_admin()
        or p.id = auth.uid()
        or (public.my_role() in ('manager', 'supervisor', 'viewer') and public.my_department() is not null
            and p.department_id = public.my_department())
        or (public.my_role() in ('manager', 'supervisor', 'viewer')
            and public.my_department_supervises_all())
        or exists (
          select 1 from public.task_assignees a
          join public.task_assignees b on b.task_id = a.task_id
          where a.user_id = auth.uid() and b.user_id = p.id
        )
        or exists (
          select 1 from public.tasks t
          join public.task_assignees a on a.task_id = t.id
          where a.user_id = auth.uid() and (t.created_by = p.id or t.reviewer_id = p.id)
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
    where t.id = p_task
      and public.is_active_member()
      and t.company_id = public.my_company()
      and (
        public.my_role() = 'admin'
        or (public.my_role() in ('manager', 'supervisor', 'viewer') and public.my_department() is not null
            and t.department_id = public.my_department())
        or (public.my_role() in ('manager', 'supervisor', 'viewer')
            and public.my_department_supervises_all())
        or (public.my_role() = 'employee' and exists (
          select 1 from public.task_assignees a where a.task_id = t.id and a.user_id = auth.uid()
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
    where t.id = p_task
      and public.is_active_member()
      and t.company_id = public.my_company()
      and (
        public.is_admin()
        or (public.my_role() = 'manager' and (
          (public.my_department() is not null and t.department_id = public.my_department())
          or public.my_department_supervises_all()
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
    where t.id = p_task
      and public.is_active_member()
      and t.company_id = public.my_company()
      and (
        public.is_admin()
        or (public.my_role() in ('manager', 'supervisor') and (
          (public.my_department() is not null and t.department_id = public.my_department())
          or public.my_department_supervises_all()
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
    where t.id = p_task
      and public.is_active_member()
      and public.my_role() <> 'viewer'
      and t.company_id = public.my_company()
      and (
        public.is_admin()
        or (public.my_role() = 'manager' and (
          (public.my_department() is not null and t.department_id = public.my_department())
          or public.my_department_supervises_all()
        ))
        or exists (select 1 from public.task_assignees a where a.task_id = t.id and a.user_id = auth.uid())
      )
  )
$$;

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
    v_role := public.my_role();
    v_dept := public.my_department();
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

-- ---------------------------------------------------------------- admin messages

create or replace function public.send_member_message(p_user uuid, p_kind text, p_body text)
returns uuid
language plpgsql security definer set search_path = ''
as $$
declare
  me uuid := auth.uid();
  target_company uuid;
  message_id uuid;
begin
  if not public.is_admin() then
    raise exception 'مدير الشركة فقط يمكنه إرسال الرسائل' using errcode = '42501';
  end if;

  if p_kind not in ('message', 'warning') then
    raise exception 'نوع الرسالة غير معروف' using errcode = '22023';
  end if;

  if p_body is null or btrim(p_body) = '' then
    raise exception 'نص الرسالة مطلوب' using errcode = '22023';
  end if;

  if char_length(p_body) > 2000 then
    raise exception 'الرسالة أطول من 2000 حرف' using errcode = '22001';
  end if;

  select p.company_id into target_company
  from public.profiles p
  where p.id = p_user;

  if target_company is null or target_company <> public.my_company() then
    raise exception 'العضو ليس داخل شركتك' using errcode = '42501';
  end if;

  insert into public.notifications (user_id, kind, title, body, actor_id)
  values (
    p_user,
    p_kind,
    case p_kind when 'warning' then 'تحذير من مدير الشركة' else 'رسالة من مدير الشركة' end,
    btrim(p_body),
    me
  )
  returning id into message_id;

  return message_id;
end
$$;
