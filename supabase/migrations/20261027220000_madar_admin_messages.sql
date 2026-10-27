-- Company admins can message or warn any account inside their own company.
-- Messages reuse the notifications feed so the recipient sees them immediately.

create or replace function public.send_member_message(p_user uuid, p_kind text, p_body text)
returns uuid
language plpgsql security definer set search_path = ''
as $$
declare
  me uuid := auth.uid();
  target_company uuid;
  message_id uuid;
begin
  if not exists (
    select 1 from public.profiles p
    where p.id = me and p.status = 'active' and p.role = 'admin'
  ) then
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

revoke execute on function public.send_member_message(uuid, text, text) from public, anon;
grant execute on function public.send_member_message(uuid, text, text) to authenticated;

-- Admins can read the messages and warnings their company received so the
-- member page can show an audit trail; ordinary notifications stay private.
create policy notifications_admin_messages on public.notifications for select to authenticated
  using (
    kind in ('message', 'warning')
    and public.my_role() = 'admin'
    and exists (
      select 1 from public.profiles t
      where t.id = notifications.user_id
        and t.company_id = public.my_company()
    )
  );
