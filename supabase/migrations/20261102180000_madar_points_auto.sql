-- Madar: نظام النقاط والمكافآت — المرحلة 3 (الاكتساب التلقائي)
-- نقطتان بيتحسبوا من أحداث موجودة فعلًا في مدار: اعتماد مهمة (review/... → done) وإغلاق الشهر.
-- مفيش أي سلوك جديد على البيانات القائمة: لو الشركة مش مفعّلة النظام أو قاعدتها مطفّية، الـ trigger ما يعملش حاجة.
-- المنح التلقائي ما يُلغيش عملية المستخدم: أي فشل فيه بيتم تجاهله، والاعتماد/الإغلاق بيتم.

-- ---------------------------------------------------------------- قرار القاعدة

-- إعدادات الشركة النشطة لصف بيُكتب بصلاحية المالك (مختلفة عن point_live_settings اللي بتسأل المتصل)
create or replace function public.point_enabled_settings(p_company uuid) returns public.point_settings
language sql stable security definer set search_path = ''
as $$
  select s.* from public.point_settings s
  where s.company_id = p_company and s.enabled
$$;

-- القاعدة النشطة للحدث في نافذتها الزمنية، بتوقيت الشركة المحلي
create or replace function public.point_rule_for(p_company uuid, p_event text) returns public.point_rules
language sql stable security definer set search_path = ''
as $$
  select r.*
  from public.point_rules r
  join public.companies c on c.id = r.company_id
  where r.company_id = p_company
    and r.event_key = p_event
    and r.enabled
    and (r.starts_on is null
         or (now() at time zone coalesce(c.timezone, 'Africa/Cairo'))::date >= r.starts_on)
    and (r.ends_on is null
         or (now() at time zone coalesce(c.timezone, 'Africa/Cairo'))::date <= r.ends_on)
$$;

-- ---------------------------------------------------------------- منح القاعدة

-- تُرجع null بدل الرفض: تجاوز الحد أو وجود حركة سابقة يعني "مفيش منح"، مش خطأ
create or replace function public.point_award(
  p_member uuid,
  p_points integer,
  p_reason text,
  p_rule public.point_rules,
  p_settings public.point_settings,
  p_task uuid default null,
  p_dedupe text default null
) returns public.point_entries
language plpgsql security definer set search_path = ''
as $$
declare
  v_member public.profiles;
  v_existing public.point_entries;
  v_status text;
  v_row public.point_entries;
begin
  if p_rule.id is null or p_settings.id is null or p_member is null or p_points is null or p_points <= 0 then
    return null;
  end if;

  select * into v_member from public.profiles
  where id = p_member and status = 'active' and company_id = p_settings.company_id;
  if v_member.id is null then
    return null;
  end if;

  if p_dedupe is not null then
    select * into v_existing from public.point_entries
    where company_id = p_settings.company_id and dedupe_key = p_dedupe;
    if v_existing.id is not null then
      return v_existing;                          -- إعادة نفس الحدث = نفس الحركة، لا منح مزدوج
    end if;
  end if;

  perform pg_advisory_xact_lock(hashtext('madar_points_' || p_settings.company_id::text));

  if p_rule.max_per_member is not null
     and public.point_rule_earned(p_member, p_rule.id) + p_points > p_rule.max_per_member then
    return null;                                  -- حد القاعدة للعضو خلص — بدون منح وبدون تعطيل العملية
  end if;
  if p_settings.per_member_period_cap is not null
     and public.point_period_earned(p_member, public.point_period_start(p_settings.company_id)) + p_points
         > p_settings.per_member_period_cap then
    return null;
  end if;

  v_status := case when coalesce(p_rule.require_approval, p_settings.require_approval)
                   then 'pending' else 'approved' end;

  v_row := public.point_write(
    p_member, p_points, 'earn', v_status, p_reason, 'rule',
    p_rule.id, p_task, null, null, null, p_dedupe,
    case when v_status = 'approved' and p_settings.expiry_days is not null
         then now() + make_interval(days => p_settings.expiry_days) else null end
  );

  if v_row.status = 'approved' then
    perform public.point_notify(p_member, 'points_auto_earned', 'نقاط جديدة',
      'حصلت على ' || p_points || ' ' || p_settings.unit_label || ': ' || v_row.reason);
  end if;

  return v_row;
end $$;

-- ---------------------------------------------------------------- اعتماد المهمة

-- كل مُسند إليه نشط على المهمة ياخد نقطة القاعدة. لو مفيش مُسندون — ولا حركة (نفس منطق الإشعارات الموجودة)
create or replace function public.points_after_task_done() returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  v_set public.point_settings;
  v_rule public.point_rules;
  r record;
begin
  v_set := public.point_enabled_settings(new.company_id);
  if v_set.id is null then
    return null;
  end if;
  v_rule := public.point_rule_for(new.company_id, 'task_approved');
  if v_rule.id is null then
    return null;
  end if;

  for r in
    select a.user_id
    from public.task_assignees a
    join public.profiles p on p.id = a.user_id and p.status = 'active'
    where a.task_id = new.id
  loop
    begin
      perform public.point_award(r.user_id, v_rule.points,
        'اعتماد مهمة: ' || new.title, v_rule, v_set, new.id,
        'task_approved:' || new.id::text || ':' || r.user_id::text);
    exception when others then
      null;                                       -- الفشل في النقاط ما يرفضش اعتماد المهمة
    end;
  end loop;
  return null;
end $$;

create trigger points_on_task_done after update on public.tasks
  for each row when (new.status = 'done' and old.status <> 'done')
  execute function public.points_after_task_done();

-- ---------------------------------------------------------------- إغلاق الشهر

-- مكافأة الدورة تُمنح لمن أنجز مهمة فعلًا في الشهر. مفيش حركة on_task_created:
-- إنشاء المهمة مش إنجاز مُعتمد، ولازم ما يديش نقاط
create or replace function public.points_after_month_close() returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  v_set public.point_settings;
  v_rule public.point_rules;
  r record;
begin
  v_set := public.point_enabled_settings(new.company_id);
  if v_set.id is null then
    return null;
  end if;
  v_rule := public.point_rule_for(new.company_id, 'month_closed');
  if v_rule.id is null then
    return null;
  end if;

  for r in
    select distinct a.user_id
    from public.tasks t
    join public.task_assignees a on a.task_id = t.id
    join public.profiles p on p.id = a.user_id and p.status = 'active'
    where t.month_id = new.id and t.status = 'done'
  loop
    begin
      perform public.point_award(r.user_id, v_rule.points,
        'إغلاق شهر ' || to_char(new.period, 'YYYY-MM'), v_rule, v_set, null,
        'month_closed:' || new.id::text || ':' || r.user_id::text);
    exception when others then
      null;
    end;
  end loop;
  return null;
end $$;

create trigger points_on_month_close after update on public.company_months
  for each row when (new.status = 'closed' and old.status <> 'closed')
  execute function public.points_after_month_close();

-- ---------------------------------------------------------------- الصلاحيات

-- داخلية بالكامل: تستدعيها الـ triggers بس، والعميل ما يقدرش يمنح نقطة بالقاعدة دي مباشرة
revoke execute on function public.point_enabled_settings(uuid) from public, anon, authenticated;
revoke execute on function public.point_rule_for(uuid, text) from public, anon, authenticated;
revoke execute on function public.point_award(uuid, integer, text, public.point_rules, public.point_settings, uuid, text)
  from public, anon, authenticated;
revoke execute on function public.points_after_task_done() from public, anon, authenticated;
revoke execute on function public.points_after_month_close() from public, anon, authenticated;
