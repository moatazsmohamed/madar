-- Madar: نظام النقاط والمكافآت — المرحلة 1 (الجداول فقط)
-- إضافة معزولة: ولا جدول/عمود/صف قائم اتلمس. النظام ميت افتراضيًا (enabled = false) لحد ما الأدمن يفعّله.

create table public.point_settings (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id) on delete cascade,
  enabled boolean not null default false,
  unit_label text not null default 'نقطة',
  unit_symbol text not null default 'ن',
  require_approval boolean not null default true,
  period_kind text not null default 'month' check (period_kind in ('day', 'month', 'none')),
  per_member_period_cap int,
  expiry_days int,
  min_redeem_points int,
  updated_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint point_settings_company_key unique (company_id),
  constraint point_settings_cap_check check (per_member_period_cap is null or per_member_period_cap > 0),
  constraint point_settings_expiry_check check (expiry_days is null or expiry_days > 0),
  constraint point_settings_min_redeem_check check (min_redeem_points is null or min_redeem_points >= 0)
);

-- قواعد الاكتساب: حدث واحد لكل قاعدة، والحدث لازم يكون موجودًا فعلًا في مدار
create table public.point_rules (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id) on delete cascade,
  event_key text not null check (event_key in ('manual', 'task_approved', 'month_closed')),
  name text not null,
  description text,
  points int not null check (points > 0),
  enabled boolean not null default true,
  require_approval boolean,
  max_per_member int,
  starts_on date,
  ends_on date,
  created_by uuid references public.profiles (id) on delete set null,
  updated_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint point_rules_company_event_key unique (company_id, event_key),
  constraint point_rules_company_name_key unique (company_id, name),
  constraint point_rules_window_check check (ends_on is null or starts_on is null or ends_on >= starts_on),
  constraint point_rules_max_check check (max_per_member is null or max_per_member > 0)
);

create table public.rewards (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id) on delete cascade,
  name text not null,
  description text,
  cost_points int not null check (cost_points > 0),
  stock int,
  per_member_max int,
  enabled boolean not null default true,
  created_by uuid references public.profiles (id) on delete set null,
  updated_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint rewards_company_name_key unique (company_id, name),
  constraint rewards_stock_check check (stock is null or stock >= 0),
  constraint rewards_per_member_check check (per_member_max is null or per_member_max > 0)
);

-- request_id توكن يرسله العميل مرة واحدة: النقر المكرر لا يولّد حركة ثانية
create table public.redemptions (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id) on delete cascade,
  member_id uuid not null references public.profiles (id) on delete restrict,
  reward_id uuid not null references public.rewards (id) on delete restrict,
  points_spent int not null check (points_spent > 0),
  status text not null default 'requested' check (status in ('requested', 'approved', 'rejected', 'fulfilled', 'cancelled')),
  request_id uuid not null default gen_random_uuid(),
  note text,
  decided_by uuid references public.profiles (id) on delete set null,
  decided_at timestamptz,
  created_at timestamptz not null default now(),
  constraint redemptions_company_request_key unique (company_id, request_id),
  constraint redemptions_decision_check check (status = 'requested' or decided_at is not null)
);

-- سجل الحركات = المصدر المعتمد للرصيد. حركة تصحيح بدل أي تعديل تاريخي
create table public.point_entries (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id) on delete cascade,
  member_id uuid not null references public.profiles (id) on delete restrict,
  points int not null check (points <> 0),
  kind text not null check (kind in ('earn', 'adjust', 'redeem', 'expire', 'reverse')),
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected', 'cancelled')),
  reason text not null,
  source text not null default 'manual' check (source in ('manual', 'rule', 'redemption', 'system', 'correction')),
  rule_id uuid references public.point_rules (id) on delete set null,
  task_id uuid references public.tasks (id) on delete set null,
  reward_id uuid references public.rewards (id) on delete set null,
  redemption_id uuid references public.redemptions (id) on delete set null,
  reverses_entry_id uuid references public.point_entries (id) on delete set null,
  actor_id uuid references public.profiles (id) on delete set null,
  decided_at timestamptz,
  reject_note text,
  expires_at timestamptz,
  dedupe_key text,
  created_at timestamptz not null default now(),
  constraint point_entries_company_dedupe_key unique (company_id, dedupe_key),
  constraint point_entries_sign_check check (
    (kind = 'earn' and points > 0)
    or (kind in ('redeem', 'expire') and points < 0)
    or (kind in ('adjust', 'reverse'))
  ),
  constraint point_entries_decision_check check (status = 'pending' or decided_at is not null),
  constraint point_entries_reverse_check check (kind <> 'reverse' or reverses_entry_id is not null),
  constraint point_entries_redeem_link_check check (kind <> 'redeem' or redemption_id is not null)
);

create index point_entries_company_member_idx on public.point_entries (company_id, member_id, created_at desc);
create index point_entries_company_status_idx on public.point_entries (company_id, status);
create index point_entries_expiry_idx on public.point_entries (expires_at) where status = 'approved' and points > 0;
create index rewards_company_enabled_idx on public.rewards (company_id, enabled);
create index redemptions_company_status_idx on public.redemptions (company_id, status, created_at desc);

alter table public.point_settings enable row level security;
alter table public.point_rules enable row level security;
alter table public.rewards enable row level security;
alter table public.redemptions enable row level security;
alter table public.point_entries enable row level security;

-- القراءة: عضو الشركة فقط، ومراجعة الملفات عن طريق can_view_profile الموجودة أصلًا.
-- الكتابة: مفيش أي policy كتابة — كل تعديل بيتم من RPC security definer (المرحلة 2) يتحقق على الخادم.
create policy point_settings_select on public.point_settings for select to authenticated
  using (company_id = public.my_company());
-- الأدمن لازم يشوف القاعدة/المكافأة الموقوفة عشان يفعّلها تاني؛ غيرُه يشوف النشط فقط
create policy point_rules_select on public.point_rules for select to authenticated
  using (company_id = public.my_company() and (enabled or public.is_admin()));
create policy rewards_select on public.rewards for select to authenticated
  using (company_id = public.my_company() and (enabled or public.is_admin()));
create policy redemptions_select on public.redemptions for select to authenticated
  using (
    company_id = public.my_company()
    and (member_id = (select auth.uid()) or public.is_admin() or public.can_view_profile(member_id))
  );
create policy point_entries_select on public.point_entries for select to authenticated
  using (
    company_id = public.my_company()
    and (member_id = (select auth.uid()) or public.is_admin() or public.can_view_profile(member_id))
  );
