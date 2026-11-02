-- Madar: شيكات ودفعيات الموظفين — additive فقط (مفيش تعديل على جدول أو صف قائم)

create type public.payment_kind as enum ('cash', 'check', 'transfer');
create type public.payment_status as enum ('draft', 'issued', 'cleared', 'returned', 'cancelled');

create table public.payments (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  employee_id uuid not null references public.profiles(id) on delete restrict,
  month_id uuid references public.company_months(id) on delete set null,
  kind public.payment_kind not null default 'check',
  status public.payment_status not null default 'draft',
  amount numeric(12,2) not null check (amount > 0),
  currency text not null default 'EGP',
  reference_no text,
  bank_name text,
  issue_date date,
  due_date date not null,
  cleared_at timestamptz,
  note text,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (kind <> 'check' or reference_no is not null),
  check (status <> 'cleared' or cleared_at is not null)
);

create index payments_company_due_idx on public.payments (company_id, due_date);
create index payments_employee_idx on public.payments (employee_id, status);

alter table public.payments enable row level security;

-- كل سياسة تُقفل على شركة المستخدم أولًا، مثل بقية سياسات مدار
create policy payments_select on public.payments for select to authenticated
  using (
    company_id = public.my_company()
    and (employee_id = (select auth.uid()) or public.is_admin())
  );
create policy payments_insert on public.payments for insert to authenticated
  with check (company_id = public.my_company() and public.is_admin());
create policy payments_update on public.payments for update to authenticated
  using (company_id = public.my_company() and public.is_admin())
  with check (company_id = public.my_company() and public.is_admin());
create policy payments_delete on public.payments for delete to authenticated
  using (company_id = public.my_company() and public.is_admin());
