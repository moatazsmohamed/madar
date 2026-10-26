-- Madar: multi-tenant companies. A developer account owns the platform and creates
-- companies; every company keeps its own isolated departments, people, projects and tasks.

-- ---------------------------------------------------------------- companies
create table public.companies (
  id uuid primary key default gen_random_uuid(),
  name text not null unique check (length(trim(name)) > 0),
  timezone text not null default 'Africa/Cairo',
  status text not null default 'active' check (status in ('active', 'suspended')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.profiles add column company_id uuid references public.companies (id) on delete restrict;
alter table public.departments add column company_id uuid references public.companies (id) on delete cascade;
alter table public.projects add column company_id uuid references public.companies (id) on delete cascade;
alter table public.tasks add column company_id uuid references public.companies (id) on delete cascade;
alter table public.invitations add column company_id uuid references public.companies (id) on delete cascade;

-- Carry the legacy single-workspace rows (if any) into a company before enforcing isolation.
do $$
declare
  v_company uuid;
begin
  if exists (select 1 from public.profiles) then
    insert into public.companies (name, timezone)
    select nullif(trim(company_name), ''), timezone from public.company_settings where id = 1
    returning id into v_company;

    if v_company is null then
      insert into public.companies (name) values ('شركتي') returning id into v_company;
    end if;

    update public.profiles set company_id = v_company;
    update public.departments set company_id = v_company;
    update public.projects set company_id = v_company;
    update public.tasks set company_id = v_company;
    update public.invitations set company_id = v_company;
  end if;
end $$;

alter table public.departments alter column company_id set not null;
alter table public.projects alter column company_id set not null;
alter table public.tasks alter column company_id set not null;
alter table public.invitations alter column company_id set not null;

alter table public.profiles add constraint profiles_company_role_check
  check ((role = 'developer') = (company_id is null));

alter table public.departments drop constraint departments_name_key;
alter table public.departments add constraint departments_company_name_key unique (company_id, name);

alter table public.invitations drop constraint invitations_email_key;
alter table public.invitations add constraint invitations_company_email_key unique (company_id, email);

create index profiles_company_idx on public.profiles (company_id);
create index departments_company_idx on public.departments (company_id);
create index projects_company_idx on public.projects (company_id);
create index tasks_company_idx on public.tasks (company_id);
create index invitations_company_idx on public.invitations (company_id);

drop table public.company_settings;

-- ---------------------------------------------------------------- helpers
create or replace function public.my_company() returns uuid
language sql stable security definer set search_path = ''
as $$ select p.company_id from public.profiles p where p.id = auth.uid() and p.status = 'active' $$;

create or replace function public.is_developer() returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from public.profiles p
    where p.id = auth.uid() and p.status = 'active' and p.role = 'developer'
  )
$$;

create or replace function public.my_role() returns public.app_role
language sql stable security definer set search_path = ''
as $$ select p.role from public.profiles p where p.id = auth.uid() and p.status = 'active' $$;

create or replace function public.my_department() returns uuid
language sql stable security definer set search_path = ''
as $$ select p.department_id from public.profiles p where p.id = auth.uid() and p.status = 'active' $$;

create or replace function public.is_active_member() returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from public.profiles p
    where p.id = auth.uid() and p.status = 'active' and p.company_id is not null
  )
$$;

create or replace function public.is_admin() returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from public.profiles p
    where p.id = auth.uid() and p.status = 'active' and p.role = 'admin'
  )
$$;

create or replace function public.is_task_assignee(p_task uuid) returns boolean
language sql stable security definer set search_path = ''
as $$ select exists (select 1 from public.task_assignees a where a.task_id = p_task and a.user_id = auth.uid()) $$;

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
        me.role in ('admin', 'viewer')
        or t.created_by = me.id
        or t.reviewer_id = me.id
        or exists (select 1 from public.task_assignees a where a.task_id = t.id and a.user_id = me.id)
        or (me.role in ('manager', 'supervisor') and me.department_id is not null and t.department_id = me.department_id)
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
        or (
          me.role in ('manager', 'supervisor')
          and (
            (me.department_id is not null and t.department_id = me.department_id)
            or t.created_by = me.id
            or t.reviewer_id = me.id
          )
        )
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
        or t.created_by = me.id
        or t.reviewer_id = me.id
        or exists (select 1 from public.task_assignees a where a.task_id = t.id and a.user_id = me.id)
        or (me.role in ('manager', 'supervisor') and me.department_id is not null and t.department_id = me.department_id)
      )
  )
$$;

create or replace function public.workspace_status() returns jsonb
language sql stable security definer set search_path = ''
as $$
  select jsonb_build_object(
    'has_developer', exists (select 1 from public.profiles where role = 'developer' and status = 'active'),
    'companies', (select count(*) from public.companies)
  )
$$;

-- ---------------------------------------------------------------- new user provisioning
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  v_meta jsonb := coalesce(new.raw_user_meta_data, '{}'::jsonb);
  v_inv public.invitations;
  v_admin record;
  v_name text := nullif(trim(coalesce(v_meta ->> 'full_name', '')), '');
  v_company uuid := nullif(v_meta ->> 'company_id', '')::uuid;
  v_role public.app_role;
  v_status public.member_status;
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

  v_role := case
    when v_meta ->> 'role' in ('admin', 'manager', 'supervisor', 'employee', 'viewer')
      then (v_meta ->> 'role')::public.app_role
    else 'employee'
  end;
  v_status := case
    when v_meta ->> 'status' = 'active' then 'active'::public.member_status
    else 'pending'::public.member_status
  end;

  insert into public.profiles (id, email, full_name, role, status, company_id, department_id, job_title)
  values (
    new.id, lower(new.email), coalesce(v_name, split_part(new.email, '@', 1)),
    v_role, v_status, v_company,
    nullif(v_meta ->> 'department_id', '')::uuid, nullif(v_meta ->> 'job_title', '')
  );

  if v_status = 'pending' then
    for v_admin in select id from public.profiles where role = 'admin' and status = 'active' and company_id = v_company loop
      insert into public.notifications (user_id, kind, title, body)
      values (v_admin.id, 'member_pending', 'طلب انضمام جديد',
              coalesce(v_name, lower(new.email)) || ' ينتظر الموافقة على حسابه');
    end loop;
  end if;
  return new;
end $$;

-- ---------------------------------------------------------------- guards
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
  else
    new.company_id := old.company_id;
  end if;

  if new.manager_id is not null and not exists (
    select 1 from public.profiles p where p.id = new.manager_id and p.company_id = new.company_id
  ) then
    raise exception 'هذا المستخدم لا يتبع الشركة نفسها' using errcode = '42501';
  end if;
  return new;
end $$;

create trigger departments_guard before insert or update on public.departments
  for each row execute function public.departments_before_write();

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
  return new;
end $$;

create trigger invitations_guard before insert or update on public.invitations
  for each row execute function public.invitations_before_write();

create or replace function public.projects_before_write() returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  v_role public.app_role := public.my_role();
  v_dept uuid := public.my_department();
  v_company uuid := public.my_company();
begin
  if tg_op = 'INSERT' then
    new.created_by := auth.uid();
    new.company_id := coalesce(new.company_id, v_company);
    if new.company_id is null then
      raise exception 'لا يمكن إنشاء مشروع بدون شركة' using errcode = '42501';
    end if;
    if v_role = 'manager' then
      new.department_id := coalesce(new.department_id, v_dept);
    end if;
  else
    new.created_by := old.created_by;
    new.company_id := old.company_id;
  end if;

  if new.department_id is not null and not exists (
    select 1 from public.departments d where d.id = new.department_id and d.company_id = new.company_id
  ) then
    raise exception 'القسم لا يتبع شركة المشروع' using errcode = '42501';
  end if;

  if v_role = 'manager' and new.department_id is distinct from v_dept then
    raise exception 'يمكنك إدارة مشاريع قسمك فقط' using errcode = '42501';
  end if;
  return new;
end $$;

create or replace function public.tasks_before_write() returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_role public.app_role;
  v_dept uuid;
  v_company uuid := public.my_company();
  v_proj_dept uuid;
  v_proj_company uuid;
  v_manage boolean;
  v_self_owned boolean;
begin
  if v_uid is not null then
    select role, department_id into v_role, v_dept
    from public.profiles where id = v_uid and status = 'active';
  end if;

  if tg_op = 'INSERT' then
    if v_uid is not null then
      new.created_by := v_uid;
      new.company_id := coalesce(new.company_id, v_company);
      if new.company_id is null then
        raise exception 'لا يمكن إنشاء مهمة بدون شركة' using errcode = '42501';
      end if;
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
      if new.department_id is null then
        new.department_id := v_dept;
      end if;
      if new.department_id is not null and not exists (
        select 1 from public.departments d where d.id = new.department_id and d.company_id = new.company_id
      ) then
        raise exception 'القسم لا يتبع شركتك' using errcode = '42501';
      end if;
      if v_role is distinct from 'admin' and new.department_id is distinct from v_dept then
        raise exception 'لا يمكنك إنشاء مهام خارج قسمك' using errcode = '42501';
      end if;
      if v_role = 'employee' then
        new.status := case when new.status = 'done' and new.reviewer_id is not null then 'todo' else new.status end;
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

  if v_uid is not null and v_role is distinct from 'admin' then
    v_manage := public.can_manage_task(old.id);
    v_self_owned := old.created_by = v_uid and old.reviewer_id is null;

    if v_manage and v_role in ('manager', 'supervisor')
       and new.department_id is distinct from old.department_id
       and new.department_id is distinct from v_dept then
      raise exception 'لا يمكنك نقل المهمة إلى قسم آخر' using errcode = '42501';
    end if;

    if not v_manage then
      if old.created_by is distinct from v_uid then
        if row(new.title, new.description, new.project_id, new.department_id, new.priority,
               new.start_date, new.due_date, new.estimate_minutes, new.reviewer_id)
           is distinct from
           row(old.title, old.description, old.project_id, old.department_id, old.priority,
               old.start_date, old.due_date, old.estimate_minutes, old.reviewer_id) then
          raise exception 'يمكنك تغيير حالة المهمة فقط' using errcode = '42501';
        end if;
      elsif new.department_id is distinct from old.department_id then
        raise exception 'لا يمكنك نقل المهمة إلى قسم آخر' using errcode = '42501';
      end if;

      if new.status is distinct from old.status then
        if new.status = 'done' and not v_self_owned then
          raise exception 'المهمة تحتاج اعتماد المراجع قبل إغلاقها — أرسلها للمراجعة' using errcode = '42501';
        end if;
        if old.status = 'done' and not v_self_owned then
          raise exception 'لا يمكن إعادة فتح مهمة معتمدة' using errcode = '42501';
        end if;
      end if;
      new.review_note := old.review_note;
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

create or replace function public.assignees_before_insert() returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  if auth.uid() is not null then
    new.assigned_by := auth.uid();
  end if;
  new.assigned_at := now();
  if not exists (
    select 1 from public.profiles p
    where p.id = new.user_id and p.status = 'active'
      and p.company_id = (select t.company_id from public.tasks t where t.id = new.task_id)
  ) then
    raise exception 'لا يمكن إسناد مهمة لحساب غير مفعّل أو من شركة أخرى' using errcode = '23514';
  end if;
  return new;
end $$;

-- ---------------------------------------------------------------- row level security
create trigger companies_touch before update on public.companies
  for each row execute function public.touch_updated_at();

alter table public.companies enable row level security;

create policy companies_select on public.companies for select to authenticated
  using (public.is_developer() or id = public.my_company());
create policy companies_insert on public.companies for insert to authenticated
  with check (public.is_developer());
create policy companies_update on public.companies for update to authenticated
  using (public.is_developer() or (public.is_admin() and id = public.my_company()))
  with check (public.is_developer() or (public.is_admin() and id = public.my_company()));
create policy companies_delete on public.companies for delete to authenticated
  using (public.is_developer());

drop policy if exists departments_select on public.departments;
drop policy if exists departments_insert on public.departments;
drop policy if exists departments_update on public.departments;
drop policy if exists departments_delete on public.departments;
create policy departments_select on public.departments for select to authenticated
  using (public.is_active_member() and company_id = public.my_company());
create policy departments_insert on public.departments for insert to authenticated
  with check (public.is_admin() and company_id = public.my_company());
create policy departments_update on public.departments for update to authenticated
  using (public.is_admin() and company_id = public.my_company())
  with check (public.is_admin() and company_id = public.my_company());
create policy departments_delete on public.departments for delete to authenticated
  using (public.is_admin() and company_id = public.my_company());

drop policy if exists profiles_select on public.profiles;
drop policy if exists profiles_update on public.profiles;
drop policy if exists profiles_delete on public.profiles;
create policy profiles_select on public.profiles for select to authenticated
  using (
    id = (select auth.uid())
    or public.is_developer()
    or (public.is_active_member() and company_id = public.my_company())
  );
create policy profiles_update on public.profiles for update to authenticated
  using (
    id = (select auth.uid())
    or public.is_developer()
    or (public.is_admin() and company_id = public.my_company())
    or (
      public.my_role() = 'manager'
      and company_id = public.my_company()
      and department_id is not null
      and department_id = public.my_department()
    )
  )
  with check (true);
create policy profiles_delete on public.profiles for delete to authenticated
  using (
    id <> (select auth.uid())
    and (public.is_developer() or (public.is_admin() and company_id = public.my_company()))
  );

drop policy if exists invitations_select on public.invitations;
drop policy if exists invitations_insert on public.invitations;
drop policy if exists invitations_update on public.invitations;
drop policy if exists invitations_delete on public.invitations;
create policy invitations_select on public.invitations for select to authenticated
  using (
    company_id = public.my_company()
    and (
      public.is_admin()
      or (public.my_role() = 'manager' and department_id is not null and department_id = public.my_department())
    )
  );
create policy invitations_insert on public.invitations for insert to authenticated
  with check (
    company_id = public.my_company()
    and (
      public.is_admin()
      or (public.my_role() = 'manager' and department_id = public.my_department()
          and role in ('supervisor', 'employee', 'viewer'))
    )
  );
create policy invitations_update on public.invitations for update to authenticated
  using (
    company_id = public.my_company()
    and (
      public.is_admin()
      or (public.my_role() = 'manager' and department_id = public.my_department())
    )
  )
  with check (
    company_id = public.my_company()
    and (
      public.is_admin()
      or (public.my_role() = 'manager' and department_id = public.my_department()
          and role in ('supervisor', 'employee', 'viewer'))
    )
  );
create policy invitations_delete on public.invitations for delete to authenticated
  using (
    company_id = public.my_company()
    and (
      public.is_admin()
      or (public.my_role() = 'manager' and department_id = public.my_department())
    )
  );

drop policy if exists projects_select on public.projects;
drop policy if exists projects_insert on public.projects;
drop policy if exists projects_update on public.projects;
drop policy if exists projects_delete on public.projects;
create policy projects_select on public.projects for select to authenticated
  using (public.is_active_member() and company_id = public.my_company());
create policy projects_insert on public.projects for insert to authenticated
  with check (
    public.my_role() in ('admin', 'manager') and company_id = public.my_company()
  );
create policy projects_update on public.projects for update to authenticated
  using (
    company_id = public.my_company()
    and (
      public.is_admin()
      or (public.my_role() = 'manager' and department_id is not distinct from public.my_department())
      or (owner_id = (select auth.uid()) and public.my_role() <> 'viewer')
    )
  )
  with check (
    public.my_role() in ('admin', 'manager', 'supervisor', 'employee')
    and company_id = public.my_company()
  );
create policy projects_delete on public.projects for delete to authenticated
  using (
    company_id = public.my_company()
    and (
      public.is_admin()
      or (public.my_role() = 'manager' and department_id is not distinct from public.my_department())
    )
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
      public.my_role() in ('admin', 'viewer')
      or created_by = (select auth.uid())
      or reviewer_id = (select auth.uid())
      or public.is_task_assignee(id)
      or (public.my_role() in ('manager', 'supervisor') and department_id is not null
          and department_id = public.my_department())
    )
  );
create policy tasks_insert on public.tasks for insert to authenticated
  with check (
    public.my_role() in ('admin', 'manager', 'supervisor', 'employee')
    and company_id = public.my_company()
  );
create policy tasks_update on public.tasks for update to authenticated
  using (public.can_work_on_task(id))
  with check (
    public.my_role() in ('admin', 'manager', 'supervisor', 'employee')
    and company_id = public.my_company()
  );
create policy tasks_delete on public.tasks for delete to authenticated
  using (
    company_id = public.my_company()
    and (
      public.is_admin()
      or (public.my_role() in ('manager', 'supervisor') and department_id is not null
          and department_id = public.my_department())
      or (created_by = (select auth.uid()) and public.my_role() <> 'viewer')
    )
  );

-- Child records are scoped through their task; the helper functions verify the company.
-- (policies for task_assignees, subtasks, comments, attachments, time_sessions,
--  notifications and activities only needed the company-aware helpers.)

drop policy if exists assignees_insert on public.task_assignees;
create policy assignees_insert on public.task_assignees for insert to authenticated
  with check (
    (
      public.can_manage_task(task_id)
      or exists (select 1 from public.tasks t where t.id = task_id and t.created_by = (select auth.uid()))
    )
    and exists (
      select 1 from public.profiles p
      where p.id = user_id and p.company_id = public.my_company()
    )
  );

-- ---------------------------------------------------------------- grants
grant execute on function public.my_company() to authenticated;
grant execute on function public.is_developer() to authenticated;
grant execute on function public.workspace_status() to anon, authenticated;
revoke execute on function public.departments_before_write() from public, anon, authenticated;
revoke execute on function public.invitations_before_write() from public, anon, authenticated;
