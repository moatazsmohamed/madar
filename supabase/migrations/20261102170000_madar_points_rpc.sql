-- Madar: نظام النقاط والمكافآت — المرحلة 2 (دوال الكتابة بصلاحيات المالك)
-- جداول النقاط مافيهاش أي سياسة كتابة: كل تعديل يمر من الدوال دي وحدها، والصلاحية بتتحقق على الخادم.
-- السجل append-only: التصحيح حركة 'reverse' جديدة، ومفيش UPDATE أو DELETE على حركة معتمدة.

-- ---------------------------------------------------------------- رصيد وفترات

create or replace function public.point_balance(p_member uuid) returns integer
language sql stable security definer set search_path = ''
as $$
  select coalesce(sum(e.points), 0)
  from public.point_entries e
  where e.member_id = p_member and e.status = 'approved'
$$;

create or replace function public.point_pending(p_member uuid) returns integer
language sql stable security definer set search_path = ''
as $$
  select coalesce(sum(e.points), 0)
  from public.point_entries e
  where e.member_id = p_member and e.status = 'pending'
$$;

-- بداية فترة العدّ للشركة (يوم/شهر بالتوقيت المحلي لها)، وnull يعني بلا حد
create or replace function public.point_period_start(p_company uuid) returns timestamptz
language sql stable security definer set search_path = ''
as $$
  select case s.period_kind
           when 'day'   then date_trunc('day',   now() at time zone coalesce(c.timezone, 'Africa/Cairo'))
                            at time zone coalesce(c.timezone, 'Africa/Cairo')
           when 'month' then date_trunc('month', now() at time zone coalesce(c.timezone, 'Africa/Cairo'))
                            at time zone coalesce(c.timezone, 'Africa/Cairo')
           else null
         end
  from public.point_settings s
  join public.companies c on c.id = s.company_id
  where s.company_id = p_company
$$;

-- نقاط مكتسبة خلال الفترة الجارية (للحد الدوري) — المعتمدة والمعلّقة معًا، وإلا جاوز الحد بالانتظار
create or replace function public.point_period_earned(p_member uuid, p_since timestamptz) returns integer
language sql stable security definer set search_path = ''
as $$
  select coalesce(sum(e.points), 0)
  from public.point_entries e
  where e.member_id = p_member and e.status in ('approved', 'pending') and e.points > 0
    and (p_since is null or e.created_at >= p_since)
$$;

create or replace function public.point_rule_earned(p_member uuid, p_rule uuid) returns integer
language sql stable security definer set search_path = ''
as $$
  select coalesce(sum(e.points), 0)
  from public.point_entries e
  where e.member_id = p_member and e.rule_id = p_rule and e.status in ('approved', 'pending') and e.points > 0
$$;

-- من يدير نقاط هذا الزميل؟ مدير الشركة لكل العاملين بها، ومدير/مشرف القسم لقسمه
-- (نفس منطق can_manage_task الموجود، لا أدوار جديدة ولا استثناءات)
create or replace function public.can_manage_points(p_member uuid) returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1
    from public.profiles me
    join public.profiles t on t.id = p_member and t.company_id = me.company_id and t.status = 'active'
    where me.id = auth.uid() and me.status = 'active' and me.role <> 'viewer' and me.company_id is not null
      and (
        me.role = 'admin'
        or (me.role in ('manager', 'supervisor') and (
          (me.department_id is not null and t.department_id = me.department_id)
          or public.department_supervises_all(me.department_id)
        ))
      )
  )
$$;

revoke execute on function public.can_manage_points(uuid) from public, anon;
grant execute on function public.can_manage_points(uuid) to authenticated;

-- ---------------------------------------------------------------- حركة واحدة

-- الوحدة المركزية لكتابة السجل: كل الدوال العامة تستدعيها، فهي وحدها التي تقرر الحالة والتاريخ
create or replace function public.point_write(
  p_member uuid,
  p_points integer,
  p_kind text,
  p_status text,
  p_reason text,
  p_source text,
  p_rule uuid default null,
  p_task uuid default null,
  p_reward uuid default null,
  p_redemption uuid default null,
  p_reverses uuid default null,
  p_dedupe text default null,
  p_expires_at timestamptz default null
) returns public.point_entries
language plpgsql security definer set search_path = ''
as $$
declare
  v_row public.point_entries;
begin
  if p_member is null or p_points is null or p_points = 0 then
    raise exception 'حركة نقاط غير صالحة' using errcode = '22023';
  end if;
  if p_reason is null or trim(p_reason) = '' then
    raise exception 'السبب مطلوب' using errcode = '22023';
  end if;

  insert into public.point_entries (
    company_id, member_id, points, kind, status, reason, source,
    rule_id, task_id, reward_id, redemption_id, reverses_entry_id,
    actor_id, decided_at, expires_at, dedupe_key
  )
  values (
    (select t.company_id from public.profiles t where t.id = p_member),
    p_member, p_points, p_kind, p_status, trim(p_reason), p_source,
    p_rule, p_task, p_reward, p_redemption, p_reverses,
    auth.uid(),
    case when p_status = 'pending' then null else now() end,
    p_expires_at, p_dedupe
  )
  returning * into v_row;

  if v_row.task_id is not null then
    insert into public.activities (actor_id, task_id, action, details)
    values (auth.uid(), v_row.task_id, 'points_' || v_row.kind,
            jsonb_build_object('points', v_row.points, 'reason', v_row.reason, 'entry', v_row.id));
  end if;

  return v_row;
end $$;

-- إشعار بنمط مدار الموجود (user_id, kind, title, body, actor_id)
create or replace function public.point_notify(p_user uuid, p_kind text, p_title text, p_body text) returns void
language sql security definer set search_path = ''
as $$
  insert into public.notifications (user_id, kind, title, body, actor_id)
  values (p_user, p_kind, p_title, p_body, auth.uid())
$$;

-- الإعدادات النشطة للشركة الحالية، وإلا الرفض: النظام ميت قبل ما المدير يفعّله
create or replace function public.point_live_settings() returns public.point_settings
language plpgsql stable security definer set search_path = ''
as $$
declare
  v_row public.point_settings;
begin
  select * into v_row from public.point_settings
  where company_id = public.my_company() and enabled;
  if v_row.id is null then
    raise exception 'نظام النقاط غير مفعّل لهذه الشركة' using errcode = '42501';
  end if;
  return v_row;
end $$;

-- ---------------------------------------------------------------- عارض الرصيد

-- رصيد المتصل: الرصيد المعتمد، المعلّق، المتاح للاستبدال، وأقرب حركة تنتهي
create or replace function public.my_points()
returns table (balance integer, pending integer, available integer, expires_on timestamptz)
language plpgsql stable security definer set search_path = ''
as $$
declare
  v_me uuid := auth.uid();
  v_balance integer;
  v_pending integer;
begin
  if v_me is null then
    raise exception 'يلزم تسجيل الدخول' using errcode = '42501';
  end if;
  select coalesce(sum(e.points) filter (where e.status = 'approved'), 0),
         coalesce(sum(e.points) filter (where e.status = 'pending'), 0)
    into v_balance, v_pending
  from public.point_entries e
  where e.member_id = v_me;

  return query select
    coalesce(v_balance, 0),
    coalesce(v_pending, 0),
    greatest(coalesce(v_balance, 0), 0),
    (select min(x.expires_at) from public.point_entries x
      where x.member_id = v_me and x.status = 'approved' and x.points > 0 and x.expires_at is not null);
end $$;

-- كشف أرصدة الشركة بالمرافعة نفسها اللي على point_entries: أنا أو مدير الشركة أو منأراه
create or replace function public.point_balances()
returns table (member_id uuid, full_name text, department_id uuid, role public.app_role,
              balance integer, pending integer, entries integer)
language sql stable security definer set search_path = ''
as $$
  select p.id, p.full_name, p.department_id, p.role,
         coalesce(sum(e.points) filter (where e.status = 'approved'), 0),
         coalesce(sum(e.points) filter (where e.status = 'pending'), 0),
         count(e.id)
  from public.profiles p
  join public.point_entries e on e.member_id = p.id
  where p.company_id = public.my_company() and p.status = 'active'
    and (p.id = auth.uid() or public.is_admin() or public.can_view_profile(p.id))
  group by p.id, p.full_name, p.department_id, p.role
$$;

revoke execute on function public.my_points() from public, anon;
revoke execute on function public.point_balances() from public, anon;
grant execute on function public.my_points() to authenticated;
grant execute on function public.point_balances() to authenticated;

-- ---------------------------------------------------------------- إعدادات الأدمن

create or replace function public.save_point_settings(
  p_enabled boolean,
  p_unit_label text,
  p_unit_symbol text,
  p_require_approval boolean,
  p_period_kind text,
  p_cap integer,
  p_expiry_days integer,
  p_min_redeem integer
) returns public.point_settings
language plpgsql security definer set search_path = ''
as $$
declare
  v_company uuid := public.my_company();
  v_row public.point_settings;
begin
  if v_company is null or not public.is_admin() then
    raise exception 'إعدادات النقاط من صلاحيات مدير الشركة' using errcode = '42501';
  end if;
  if p_period_kind is null or p_period_kind not in ('day', 'month', 'none') then
    raise exception 'نوع فترة غير معروف' using errcode = '22023';
  end if;
  if p_cap is not null and p_cap <= 0 then
    raise exception 'حد الفترة لازم يكون أكبر من صفر' using errcode = '22023';
  end if;
  if p_expiry_days is not null and p_expiry_days <= 0 then
    raise exception 'مدة الصلاحية لازم تكون أكبر من صفر' using errcode = '22023';
  end if;
  if p_min_redeem is not null and p_min_redeem < 0 then
    raise exception 'الحد الأدنى للاستبدال لا يمكن أن يكون سالبًا' using errcode = '22023';
  end if;

  insert into public.point_settings (
    company_id, enabled, unit_label, unit_symbol, require_approval,
    period_kind, per_member_period_cap, expiry_days, min_redeem_points, updated_by
  )
  values (
    v_company, p_enabled, coalesce(nullif(trim(p_unit_label), ''), 'نقطة'),
    coalesce(nullif(trim(p_unit_symbol), ''), 'ن'), p_require_approval,
    p_period_kind, p_cap, p_expiry_days, p_min_redeem, auth.uid()
  )
  on conflict (company_id) do update
    set enabled = excluded.enabled,
        unit_label = excluded.unit_label,
        unit_symbol = excluded.unit_symbol,
        require_approval = excluded.require_approval,
        period_kind = excluded.period_kind,
        per_member_period_cap = excluded.per_member_period_cap,
        expiry_days = excluded.expiry_days,
        min_redeem_points = excluded.min_redeem_points,
        updated_by = excluded.updated_by,
        updated_at = now()
  returning * into v_row;
  return v_row;
end $$;

create or replace function public.save_point_rule(
  p_id uuid,
  p_event_key text,
  p_name text,
  p_description text,
  p_points integer,
  p_enabled boolean,
  p_require_approval boolean,
  p_max_per_member integer,
  p_starts_on date,
  p_ends_on date
) returns public.point_rules
language plpgsql security definer set search_path = ''
as $$
declare
  v_company uuid := public.my_company();
  v_row public.point_rules;
begin
  if v_company is null or not public.is_admin() then
    raise exception 'قواعد النقاط من صلاحيات مدير الشركة' using errcode = '42501';
  end if;
  if p_event_key is null or p_event_key not in ('manual', 'task_approved', 'month_closed') then
    raise exception 'حدث غير مدعوم في مدار' using errcode = '22023';
  end if;
  if p_name is null or trim(p_name) = '' then
    raise exception 'اسم القاعدة مطلوب' using errcode = '22023';
  end if;
  if p_points is null or p_points <= 0 then
    raise exception 'قيمة القاعدة لازم تكون أكبر من صفر' using errcode = '22023';
  end if;
  if p_max_per_member is not null and p_max_per_member <= 0 then
    raise exception 'حد العضو لازم يكون أكبر من صفر' using errcode = '22023';
  end if;
  if p_ends_on is not null and p_starts_on is not null and p_ends_on < p_starts_on then
    raise exception 'تاريخ النهاية قبل البداية' using errcode = '22023';
  end if;

  if p_id is null then
    insert into public.point_rules (
      company_id, event_key, name, description, points, enabled, require_approval,
      max_per_member, starts_on, ends_on, created_by, updated_by
    )
    values (
      v_company, p_event_key, trim(p_name), nullif(trim(coalesce(p_description, '')), ''),
      p_points, p_enabled, p_require_approval, p_max_per_member, p_starts_on, p_ends_on,
      auth.uid(), auth.uid()
    )
    returning * into v_row;
  else
    update public.point_rules
       set event_key = p_event_key,
           name = trim(p_name),
           description = nullif(trim(coalesce(p_description, '')), ''),
           points = p_points,
           enabled = p_enabled,
           require_approval = p_require_approval,
           max_per_member = p_max_per_member,
           starts_on = p_starts_on,
           ends_on = p_ends_on,
           updated_by = auth.uid(),
           updated_at = now()
     where id = p_id and company_id = v_company
     returning * into v_row;
    if v_row.id is null then
      raise exception 'القاعدة غير موجودة في شركتك' using errcode = '23503';
    end if;
  end if;
  return v_row;
end $$;

create or replace function public.save_reward(
  p_id uuid,
  p_name text,
  p_description text,
  p_cost integer,
  p_stock integer,
  p_per_member_max integer,
  p_enabled boolean
) returns public.rewards
language plpgsql security definer set search_path = ''
as $$
declare
  v_company uuid := public.my_company();
  v_row public.rewards;
begin
  if v_company is null or not public.is_admin() then
    raise exception 'المكافآت من صلاحيات مدير الشركة' using errcode = '42501';
  end if;
  if p_name is null or trim(p_name) = '' then
    raise exception 'اسم المكافأة مطلوب' using errcode = '22023';
  end if;
  if p_cost is null or p_cost <= 0 then
    raise exception 'سعر المكافأة لازم يكون أكبر من صفر' using errcode = '22023';
  end if;
  if p_stock is not null and p_stock < 0 then
    raise exception 'المخزون لا يمكن أن يكون سالبًا' using errcode = '22023';
  end if;
  if p_per_member_max is not null and p_per_member_max <= 0 then
    raise exception 'حد الفرد لازم يكون أكبر من صفر' using errcode = '22023';
  end if;

  if p_id is null then
    insert into public.rewards (company_id, name, description, cost_points, stock, per_member_max, enabled, created_by, updated_by)
    values (v_company, trim(p_name), nullif(trim(coalesce(p_description, '')), ''),
            p_cost, p_stock, p_per_member_max, p_enabled, auth.uid(), auth.uid())
    returning * into v_row;
  else
    update public.rewards
       set name = trim(p_name),
           description = nullif(trim(coalesce(p_description, '')), ''),
           cost_points = p_cost,
           stock = p_stock,
           per_member_max = p_per_member_max,
           enabled = p_enabled,
           updated_by = auth.uid(),
           updated_at = now()
     where id = p_id and company_id = v_company
     returning * into v_row;
    if v_row.id is null then
      raise exception 'المكافأة غير موجودة في شركتك' using errcode = '23503';
    end if;
  end if;
  return v_row;
end $$;

-- ---------------------------------------------------------------- منح وطلبات

-- منح/خصم مباشر من مسؤول، وطلب من الموظف لنفسه
-- القيمة تُقرأ من قاعدة 'manual' لو لم تُذكر، وقاعدة الحدث تطبّق حدّها وموافقتها
create or replace function public.grant_points(
  p_member uuid,
  p_points integer,
  p_reason text,
  p_request_id uuid default null
) returns public.point_entries
language plpgsql security definer set search_path = ''
as $$
declare
  v_set public.point_settings := public.point_live_settings();
  v_rule public.point_rules;
  v_target public.profiles;
  v_admin public.profiles;
  v_earned integer;
  v_points integer := p_points;
  v_status text;
  v_row public.point_entries;
begin
  select * into v_rule from public.point_rules
  where company_id = v_set.company_id and event_key = 'manual' and enabled;

  if v_points is null then
    if v_rule.id is null then
      raise exception 'حدّد قيمة النقاط أو فعّل قاعدة المنح المباشر' using errcode = '22023';
    end if;
    v_points := v_rule.points;
  end if;
  if v_points = 0 then
    raise exception 'قيمة النقاط لازم تكون أكبر من صفر' using errcode = '22023';
  end if;
  if p_member is null or not public.can_manage_points(p_member) then
    raise exception 'ليست لديك صلاحية منح نقاط لهذا الحساب' using errcode = '42501';
  end if;
  select * into v_target from public.profiles where id = p_member and status = 'active';
  if v_target.id is null then
    raise exception 'الحساب غير موجود أو غير نشط' using errcode = '23503';
  end if;

  if p_request_id is not null then
    select * into v_row from public.point_entries
    where company_id = v_target.company_id and dedupe_key = 'grant:' || p_request_id::text;
    if v_row.id is not null then
      return v_row;                                 -- نقرة مكررة = نفس الحركة، لا حركة ثانية
    end if;
  end if;

  if v_points > 0 then
    v_earned := public.point_period_earned(p_member, public.point_period_start(v_set.company_id));
    if v_set.per_member_period_cap is not null
       and v_earned + v_points > v_set.per_member_period_cap then
      raise exception 'تجاوزت حد النقاط لكل عضو خلال %',
        case v_set.period_kind when 'day' then 'اليوم' else 'الشهر' end using errcode = '23514';
    end if;
    if v_rule.max_per_member is not null
       and public.point_rule_earned(p_member, v_rule.id) + v_points > v_rule.max_per_member then
      raise exception 'تجاوزت الحد الأقصى لقاعدة المنح المباشر لهذه العضو' using errcode = '23514';
    end if;
  end if;

  v_status := case
    when v_points < 0 then 'approved'                         -- الخصم تسوية مباشرة من مسؤول
    when coalesce(v_rule.require_approval, v_set.require_approval) then 'pending'
    else 'approved'
  end if;

  v_row := public.point_write(
    p_member, v_points,
    case when v_points > 0 then 'earn' else 'adjust' end,
    v_status, p_reason, 'manual',
    v_rule.id, null, null, null, null,
    case when p_request_id is null then null else 'grant:' || p_request_id::text end,
    case when v_status = 'approved' and v_points > 0 and v_set.expiry_days is not null
         then now() + make_interval(days => v_set.expiry_days) else null end
  );

  if v_row.status = 'pending' then
    for v_admin in select * from public.profiles
                   where role = 'admin' and status = 'active' and company_id = v_set.company_id loop
      perform public.point_notify(v_admin.id, 'points_pending_request', 'طلب نقطة جديد',
        v_target.full_name || ' طلب ' || v_points || ' ' || v_set.unit_label);
    end loop;
  else
    perform public.point_notify(p_member, 'points_granted', 'نقاط جديدة',
      case when v_points > 0 then 'تم منحك ' || v_points else 'تم خصم ' || abs(v_points) end
      || ' ' || v_set.unit_label || ': ' || v_row.reason);
  end if;

  return v_row;
end $$;

-- موظف يطلب نقاطًا لنفسه: يمر بنفس الموافقة، والمفتاح المكرّر يمنع ازدواج الطلب
create or replace function public.request_points(
  p_points integer,
  p_reason text,
  p_request_id uuid
) returns public.point_entries
language plpgsql security definer set search_path = ''
as $$
declare
  v_set public.point_settings := public.point_live_settings();
  v_me uuid := auth.uid();
  v_name text;
  v_admin public.profiles;
  v_row public.point_entries;
begin
  if v_me is null then
    raise exception 'يلزم تسجيل الدخول' using errcode = '42501';
  end if;
  if public.my_role() = 'viewer' then
    raise exception 'حساب المشاهد للعرض فقط' using errcode = '42501';
  end if;
  if p_request_id is null then
    raise exception 'معرّف الطلب مطلوب لمنع التكرار' using errcode = '22023';
  end if;
  if p_points is null or p_points <= 0 or p_points > 100000 then
    raise exception 'قيمة الطلب غير معقولة' using errcode = '22023';
  end if;

  select * into v_row from public.point_entries
  where company_id = v_set.company_id and dedupe_key = 'request:' || p_request_id::text;
  if v_row.id is not null then
    return v_row;                                    -- إعادة نفس الطلب = نفس الحركة، لا حركة ثانية
  end if;

  v_row := public.point_write(
    v_me, p_points, 'earn',
    case when v_set.require_approval then 'pending' else 'approved' end,
    p_reason, 'manual', null, null, null, null, null,
    'request:' || p_request_id::text,
    case when not v_set.require_approval and v_set.expiry_days is not null
         then now() + make_interval(days => v_set.expiry_days) else null end
  );

  if v_row.status = 'pending' then
    select full_name into v_name from public.profiles where id = v_me;
    for v_admin in select * from public.profiles
                   where role = 'admin' and status = 'active' and company_id = v_set.company_id loop
      perform public.point_notify(v_admin.id, 'points_pending_request', 'طلب نقطة جديد',
        coalesce(v_name, '') || ' طلب ' || p_points || ' ' || v_set.unit_label);
    end loop;
  end if;
  return v_row;
end $$;

-- موافقة/رفض حركة معلّقة — نفس مرافعة can_manage_points
create or replace function public.decide_point_entry(
  p_entry uuid,
  p_approve boolean,
  p_note text default null
) returns public.point_entries
language plpgsql security definer set search_path = ''
as $$
declare
  v_set public.point_settings := public.point_live_settings();
  v_row public.point_entries;
  v_expires timestamptz;
begin
  select * into v_row from public.point_entries where id = p_entry and company_id = v_set.company_id;
  if v_row.id is null then
    raise exception 'الحركة غير موجودة في شركتك' using errcode = '23503';
  end if;
  if v_row.status <> 'pending' then
    raise exception 'هذه الحركة تمّت مراجعتها بالفعل' using errcode = '23514';
  end if;
  if not public.can_manage_points(v_row.member_id) then
    raise exception 'ليست لديك صلاحية مراجعة هذه الحركة' using errcode = '42501';
  end if;

  if p_approve then
    v_expires := case when v_row.points > 0 and v_set.expiry_days is not null
                      then now() + make_interval(days => v_set.expiry_days) else null end;
    update public.point_entries
       set status = 'approved', decided_at = now(), expires_at = v_expires
     where id = p_entry
     returning * into v_row;
    perform public.point_notify(v_row.member_id, 'points_approved', 'تمت الموافقة على نقاطك',
      v_row.points || ' ' || v_set.unit_label || ': ' || v_row.reason);
  else
    update public.point_entries
       set status = 'rejected', decided_at = now(), reject_note = nullif(trim(coalesce(p_note, '')), '')
     where id = p_entry
     returning * into v_row;
    perform public.point_notify(v_row.member_id, 'points_rejected', 'طلب نقاط مرفوض',
      coalesce(nullif(trim(coalesce(p_note, '')), ''), 'لم تتم الموافقة'));
  end if;
  return v_row;
end $$;

-- تصحيح حركة معتمدة: حركة معاكسة جديدة، والسجل الأصلي مايتلمسش
create or replace function public.correct_point_entry(p_entry uuid, p_note text)
returns public.point_entries
language plpgsql security definer set search_path = ''
as $$
declare
  v_set public.point_settings := public.point_live_settings();
  v_old public.point_entries;
  v_new public.point_entries;
begin
  select * into v_old from public.point_entries where id = p_entry and company_id = v_set.company_id;
  if v_old.id is null then
    raise exception 'الحركة غير موجودة في شركتك' using errcode = '23503';
  end if;
  if v_old.status <> 'approved' then
    raise exception 'التصحيح للحركات المعتمدة فقط' using errcode = '23514';
  end if;
  if v_old.kind = 'reverse' then
    raise exception 'لا يمكن عكس حركة تصحيح' using errcode = '23514';
  end if;
  if not public.can_manage_points(v_old.member_id) then
    raise exception 'ليست لديك صلاحية تصحيح هذه الحركة' using errcode = '42501';
  end if;
  if p_note is null or trim(p_note) = '' then
    raise exception 'سبب التصحيح مطلوب' using errcode = '22023';
  end if;

  if exists (select 1 from public.point_entries x where x.reverses_entry_id = p_entry) then
    raise exception 'تم تصحيح هذه الحركة من قبل' using errcode = '23514';
  end if;

  v_new := public.point_write(
    v_old.member_id, -v_old.points, 'reverse', 'approved', p_note, 'correction',
    null, v_old.task_id, null, null, p_entry, 'reverse:' || p_entry::text
  );
  perform public.point_notify(v_old.member_id, 'points_corrected', 'تصحيح في رصيد نقاطك',
    (-v_old.points) || ' ' || v_set.unit_label || ': ' || v_new.reason);
  return v_new;
end $$;

-- ---------------------------------------------------------------- استبدال

-- مسح انتهاء الصلاحية لعضل: حركة 'expire' سالبة لكل رصة منتهية بلا حركة سابقة
create or replace function public.point_expire_member(p_member uuid) returns integer
language plpgsql security definer set search_path = ''
as $$
declare
  v_set public.point_settings;
  v_lot public.point_entries;
  v_count integer := 0;
begin
  select * into v_set from public.point_settings
  where company_id = (select company_id from public.profiles where id = p_member) and enabled;
  if v_set.id is null then
    return 0;
  end if;

  for v_lot in select * from public.point_entries
               where member_id = p_member and status = 'approved' and points > 0
                 and expires_at is not null and expires_at <= now()
                 and not exists (select 1 from public.point_entries x
                                  where x.kind = 'expire' and x.reverses_entry_id = point_entries.id)
               order by expires_at loop
    perform public.point_write(p_member, -v_lot.points, 'expire', 'approved',
                               'انتهت صلاحية النقاط', 'system',
                               null, null, null, null, v_lot.id, 'expire:' || v_lot.id::text);
    v_count := v_count + 1;
  end loop;

  if v_count > 0 then
    perform public.point_notify(p_member, 'points_expired', 'انتهت صلاحية نقاط',
      'تم خصم ' || (select coalesce(sum(-x.points), 0) from public.point_entries x
                     where x.member_id = p_member and x.kind = 'expire' and x.status = 'approved')
      || ' ' || v_set.unit_label || ' لانتهاء الصلاحية');
  end if;
  return v_count;
end $$;

create or replace function public.expire_points() returns integer
language plpgsql security definer set search_path = ''
as $$
declare
  v_set public.point_settings;
  v_company uuid := public.my_company();
  v_member uuid;
  v_total integer := 0;
begin
  if v_company is null or not public.is_admin() then
    raise exception 'مسح انتهاء الصلاحية من صلاحيات مدير الشركة' using errcode = '42501';
  end if;
  select * into v_set from public.point_settings where company_id = v_company and enabled;
  if v_set.id is null or v_set.expiry_days is null then
    return 0;                                   -- بلا صلاحية محددة: لا شيء ينتهي
  end if;
  perform pg_advisory_xact_lock(hashtext('madar_points_' || v_company::text));
  for v_member in select id from public.profiles
                  where company_id = v_company and status = 'active' loop
    v_total := v_total + public.point_expire_member(v_member);
  end loop;
  return v_total;
end $$;

create or replace function public.redeem_reward(p_reward uuid, p_request_id uuid)
returns public.redemptions
language plpgsql security definer set search_path = ''
as $$
declare
  v_set public.point_settings := public.point_live_settings();
  v_reward public.rewards;
  v_admin public.profiles;
  v_me uuid := auth.uid();
  v_name text;
  v_row public.redemptions;
  v_balance integer;
begin
  if v_me is null then
    raise exception 'يلزم تسجيل الدخول' using errcode = '42501';
  end if;
  if p_request_id is null then
    raise exception 'معرّف الطلب مطلوب لمنع التكرار' using errcode = '22023';
  end if;
  if public.my_role() = 'viewer' then
    raise exception 'حساب المشاهد للعرض فقط' using errcode = '42501';
  end if;

  select * into v_row from public.redemptions
  where company_id = v_set.company_id and request_id = p_request_id;
  if v_row.id is not null then
    return v_row;                                   -- نقرة مكررة = نفس الطلب
  end if;

  perform pg_advisory_xact_lock(hashtext('madar_points_' || v_set.company_id::text));
  perform public.point_expire_member(v_me);

  select * into v_reward from public.rewards
  where id = p_reward and company_id = v_set.company_id and enabled;
  if v_reward.id is null then
    raise exception 'المكافأة غير متاحة' using errcode = '23503';
  end if;
  if v_reward.stock is not null and v_reward.stock <= 0 then
    raise exception 'المكافأة نفدت' using errcode = '23514';
  end if;
  if v_reward.per_member_max is not null and (
    select count(*) from public.redemptions
    where company_id = v_set.company_id and reward_id = p_reward and member_id = v_me
      and status in ('requested', 'approved', 'fulfilled')
  ) >= v_reward.per_member_max then
    raise exception 'وصلت للحد الأقصى من هذه المكافأة' using errcode = '23514';
  end if;

  v_balance := public.point_balance(v_me);
  if v_balance < v_reward.cost_points then
    raise exception 'رصيدك لا يكفي؛ تحتاج % ولديك %', v_reward.cost_points, v_balance
      using errcode = '23514';
  end if;
  if v_set.min_redeem_points is not null and v_balance < v_set.min_redeem_points then
    raise exception 'الاستبدال يبدأ من % %', v_set.min_redeem_points, v_set.unit_label
      using errcode = '23514';
  end if;

  -- الاستبدال الفوري (بلا موافقة) لازم يسجّل قراره: قيد redemptions_decision_check يفرض ذلك
  insert into public.redemptions (
    company_id, member_id, reward_id, points_spent, status, request_id, decided_by, decided_at
  )
  values (
    v_set.company_id, v_me, p_reward, v_reward.cost_points,
    case when v_set.require_approval then 'requested' else 'approved' end, p_request_id,
    case when v_set.require_approval then null else auth.uid() end,
    case when v_set.require_approval then null else now() end
  )
  returning * into v_row;

  if v_row.status = 'approved' then
    perform public.point_deduct(v_row, v_reward);
    perform public.point_notify(v_me, 'points_redeemed', 'تم الاستبدال',
      v_reward.name || ' — ' || v_row.points_spent || ' ' || v_set.unit_label);
  else
    select full_name into v_name from public.profiles where id = v_me;
    for v_admin in select * from public.profiles
                   where role = 'admin' and status = 'active' and company_id = v_set.company_id loop
      perform public.point_notify(v_admin.id, 'points_redemption_request', 'طلب استبدال جديد',
        coalesce(v_name, '') || ' يطلب ' || v_reward.name);
    end loop;
  end if;
  return v_row;
end $$;

-- خصم الرصيد وربط حركة الاستبدال وخصم المخزون — تُستدعى بعد اكتمال حالة الطلب
create or replace function public.point_deduct(p_redemption public.redemptions, p_reward public.rewards)
returns void
language plpgsql security definer set search_path = ''
as $$
begin
  if exists (select 1 from public.point_entries e where e.redemption_id = p_redemption.id and e.kind = 'redeem') then
    return;
  end if;
  perform public.point_write(p_redemption.member_id, -p_redemption.points_spent, 'redeem', 'approved',
                             p_reward.name, 'redemption', null, null, p_reward.id, p_redemption.id,
                             null, 'redeem:' || p_redemption.request_id::text);
  if p_reward.stock is not null then
    update public.rewards set stock = greatest(stock - 1, 0) where id = p_reward.id;
  end if;
end $$;

create or replace function public.decide_redemption(p_redemption uuid, p_approve boolean, p_note text default null)
returns public.redemptions
language plpgsql security definer set search_path = ''
as $$
declare
  v_set public.point_settings;
  v_row public.redemptions;
  v_reward public.rewards;
begin
  select * into v_row from public.redemptions where id = p_redemption;
  if v_row.id is null then
    raise exception 'الطلب غير موجود' using errcode = '23503';
  end if;
  select * into v_set from public.point_settings where company_id = v_row.company_id and enabled;
  if v_set.id is null then
    raise exception 'نظام النقاط غير مفعّل لهذه الشركة' using errcode = '42501';
  end if;
  if v_row.company_id is distinct from public.my_company()
     or not public.can_manage_points(v_row.member_id) then
    raise exception 'ليست لديك صلاحية مراجعة هذا الطلب' using errcode = '42501';
  end if;
  if v_row.status <> 'requested' then
    raise exception 'هذا الطلب تمّت مراجعته بالفعل' using errcode = '23514';
  end if;

  select * into v_reward from public.rewards where id = v_row.reward_id and company_id = v_row.company_id;
  if p_approve then
    perform pg_advisory_xact_lock(hashtext('madar_points_' || v_row.company_id::text));
    perform public.point_expire_member(v_row.member_id);
    if public.point_balance(v_row.member_id) < v_row.points_spent then
      raise exception 'رصيد العضو لم يعد يكفي بعد انتهاء الصلاحية' using errcode = '23514';
    end if;
    if v_reward.stock is not null and v_reward.stock <= 0 then
      raise exception 'المكافأة نفدت' using errcode = '23514';
    end if;
    update public.redemptions
       set status = 'approved', note = nullif(trim(coalesce(p_note, '')), ''),
           decided_by = auth.uid(), decided_at = now()
     where id = p_redemption
     returning * into v_row;
  else
    update public.redemptions
       set status = 'rejected', note = nullif(trim(coalesce(p_note, '')), ''),
           decided_by = auth.uid(), decided_at = now()
     where id = p_redemption
     returning * into v_row;
  end if;

  if p_approve then
    perform public.point_deduct(v_row, v_reward);
    perform public.point_notify(v_row.member_id, 'points_redeemed', 'تمت الموافقة على استبدال',
      v_reward.name || ' — ' || v_row.points_spent || ' ' || v_set.unit_label);
  else
    perform public.point_notify(v_row.member_id, 'points_redemption_rejected', 'طلب استبدال مرفوض',
      coalesce(nullif(trim(coalesce(p_note, '')), ''), 'لم تتم الموافقة على استبدال ' || v_reward.name));
  end if;
  return v_row;
end $$;

-- تسليم المكافأة فعليًا: حالة الطلب وحدها تتغير، ولا حركة نقاط جديدة
create or replace function public.fulfil_redemption(p_redemption uuid, p_note text default null)
returns public.redemptions
language plpgsql security definer set search_path = ''
as $$
declare
  v_row public.redemptions;
begin
  select * into v_row from public.redemptions where id = p_redemption;
  if v_row.id is null then
    raise exception 'الطلب غير موجود' using errcode = '23503';
  end if;
  if v_row.company_id is distinct from public.my_company()
     or not public.can_manage_points(v_row.member_id) then
    raise exception 'ليست لديك صلاحية تحديث هذا الطلب' using errcode = '42501';
  end if;
  if v_row.status <> 'approved' then
    raise exception 'التسليم بعد الموافقة على الطلب فقط' using errcode = '23514';
  end if;

  update public.redemptions
     set status = 'fulfilled', note = coalesce(nullif(trim(coalesce(p_note, '')), ''), note)
   where id = p_redemption
   returning * into v_row;
  perform public.point_notify(v_row.member_id, 'points_redemption_fulfilled', 'مكافأتك جاهزة',
    coalesce((select name from public.rewards where id = v_row.reward_id), '') || ' — تم التسليم');
  return v_row;
end $$;

-- استرجاع نقاط استبدال مُلغى: حركة reverse تعيد الرصيد وترجّع المخزون، الطلب يُلغى
create or replace function public.refund_redemption(p_redemption uuid, p_note text)
returns public.redemptions
language plpgsql security definer set search_path = ''
as $$
declare
  v_set public.point_settings;
  v_row public.redemptions;
  v_reward public.rewards;
  v_spend public.point_entries;
begin
  select * into v_row from public.redemptions where id = p_redemption;
  if v_row.id is null then
    raise exception 'الطلب غير موجود' using errcode = '23503';
  end if;
  select * into v_set from public.point_settings where company_id = v_row.company_id;
  if v_row.company_id is distinct from public.my_company() or not public.is_admin() then
    raise exception 'إلغاء الاستبدال من صلاحيات مدير الشركة' using errcode = '42501';
  end if;
  if v_row.status not in ('approved', 'fulfilled') then
    raise exception 'يمكن إلغاء الاستبدال المعتمد فقط' using errcode = '23514';
  end if;
  if p_note is null or trim(p_note) = '' then
    raise exception 'سبب الإلغاء مطلوب' using errcode = '22023';
  end if;

  select * into v_spend from public.point_entries
  where redemption_id = p_redemption and kind = 'redeem' and status = 'approved';
  if v_spend.id is null then
    raise exception 'لا توجد حركة خصم لهذا الطلب' using errcode = '23503';
  end if;
  if exists (select 1 from public.point_entries x where x.reverses_entry_id = v_spend.id) then
    raise exception 'هذا الطلب مُلغى من قبل' using errcode = '23514';
  end if;

  perform pg_advisory_xact_lock(hashtext('madar_points_' || v_row.company_id::text));
  select * into v_reward from public.rewards where id = v_row.reward_id;
  perform public.point_write(v_row.member_id, -v_spend.points, 'reverse', 'approved', p_note, 'correction',
                             null, null, v_row.reward_id, v_row.id, v_spend.id,
                             'refund:' || v_row.id::text);
  if v_reward.stock is not null then
    update public.rewards set stock = stock + 1 where id = v_reward.id and stock is not null;
  end if;

  update public.redemptions
     set status = 'cancelled', note = trim(p_note), decided_by = auth.uid(), decided_at = now()
   where id = p_redemption
   returning * into v_row;
  perform public.point_notify(v_row.member_id, 'points_redemption_refunded', 'تم إلغاء استبدال',
    v_reward.name || ' — رجع لك ' || v_spend.points || ' ' || coalesce(v_set.unit_label, 'نقطة'));
  return v_row;
end $$;

-- ---------------------------------------------------------------- الصلاحيات

revoke execute on function public.save_point_settings(boolean, text, text, boolean, text, integer, integer, integer) from public, anon;
revoke execute on function public.save_point_rule(uuid, text, text, text, integer, boolean, boolean, integer, date, date) from public, anon;
revoke execute on function public.save_reward(uuid, text, text, integer, integer, integer, boolean) from public, anon;
revoke execute on function public.grant_points(uuid, integer, text, uuid) from public, anon;
revoke execute on function public.request_points(integer, text, uuid) from public, anon;
revoke execute on function public.decide_point_entry(uuid, boolean, text) from public, anon;
revoke execute on function public.correct_point_entry(uuid, text) from public, anon;
revoke execute on function public.redeem_reward(uuid, uuid) from public, anon;
revoke execute on function public.decide_redemption(uuid, boolean, text) from public, anon;
revoke execute on function public.fulfil_redemption(uuid, text) from public, anon;
revoke execute on function public.refund_redemption(uuid, text) from public, anon;
revoke execute on function public.expire_points() from public, anon;

grant execute on function public.save_point_settings(boolean, text, text, boolean, text, integer, integer, integer) to authenticated;
grant execute on function public.save_point_rule(uuid, text, text, text, integer, boolean, boolean, integer, date, date) to authenticated;
grant execute on function public.save_reward(uuid, text, text, integer, integer, integer, boolean) to authenticated;
grant execute on function public.grant_points(uuid, integer, text, uuid) to authenticated;
grant execute on function public.request_points(integer, text, uuid) to authenticated;
grant execute on function public.decide_point_entry(uuid, boolean, text) to authenticated;
grant execute on function public.correct_point_entry(uuid, text) to authenticated;
grant execute on function public.redeem_reward(uuid, uuid) to authenticated;
grant execute on function public.decide_redemption(uuid, boolean, text) to authenticated;
grant execute on function public.fulfil_redemption(uuid, text) to authenticated;
grant execute on function public.refund_redemption(uuid, text) to authenticated;
grant execute on function public.expire_points() to authenticated;

-- دوال داخلية: لا تُنفَّذ من العميل مباشرة
revoke execute on function public.point_write(uuid, integer, text, text, text, text, uuid, uuid, uuid, uuid, uuid, text, timestamptz) from public, anon, authenticated;
revoke execute on function public.point_notify(uuid, text, text, text) from public, anon, authenticated;
revoke execute on function public.point_live_settings() from public, anon, authenticated;
revoke execute on function public.point_expire_member(uuid) from public, anon, authenticated;
revoke execute on function public.point_deduct(public.redemptions, public.rewards) from public, anon, authenticated;
revoke execute on function public.point_balance(uuid) from public, anon, authenticated;
revoke execute on function public.point_pending(uuid) from public, anon, authenticated;
revoke execute on function public.point_period_start(uuid) from public, anon, authenticated;
revoke execute on function public.point_period_earned(uuid, timestamptz) from public, anon, authenticated;
revoke execute on function public.point_rule_earned(uuid, uuid) from public, anon, authenticated;
