-- =============================================================
-- Budget Management: budgets, categories, expenses, recurring,
-- refunds and rules (super_admin managed).
--
-- All tables additive with UUID keys, timestamptz stamps, created_by,
-- NUMERIC(14,2) money (never float), status + archive-by-status.
-- RLS: super_admin full manage via auth_user_is_super_admin();
-- authenticated users get NO access (no weakening of anything else).
-- Existing finance/invoice/profile/notification tables untouched.
-- =============================================================

-- ---------------------------------------------------------------
-- 1. Budgets (global when parent_budget_id is null, sub otherwise)
-- ---------------------------------------------------------------
create table if not exists public.budgets (
  id                uuid not null default gen_random_uuid(),
  parent_budget_id  uuid null references public.budgets(id) on delete restrict,
  name              text not null,
  description       text null,
  total_amount      numeric(14,2) not null check (total_amount >= 0),
  currency          text not null default 'TND',
  start_date        date null,
  end_date          date null,
  status            text not null default 'draft'
                    check (status in ('draft','active','paused','closed','archived')),
  project_id        uuid null references public.projects(id) on delete set null,
  alert_threshold   numeric(5,2) null check (alert_threshold is null or (alert_threshold >= 0 and alert_threshold <= 100)),
  notes             text null,
  created_by        uuid null references auth.users(id) on delete set null,
  updated_by        uuid null references auth.users(id) on delete set null,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  constraint budgets_pkey primary key (id),
  constraint budgets_no_self_parent check (parent_budget_id is null or parent_budget_id <> id)
);

create index if not exists budgets_parent_idx on public.budgets(parent_budget_id);
create index if not exists budgets_project_idx on public.budgets(project_id);
create index if not exists budgets_status_idx on public.budgets(status);

-- ---------------------------------------------------------------
-- 2. Categories (self-nesting sub-categories, archive by active flag)
-- ---------------------------------------------------------------
create table if not exists public.budget_categories (
  id                uuid not null default gen_random_uuid(),
  parent_category_id uuid null references public.budget_categories(id) on delete restrict,
  name              text not null,
  description       text null,
  icon              text null,
  active            boolean not null default true,
  sort_order        integer not null default 0,
  created_by        uuid null references auth.users(id) on delete set null,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  constraint budget_categories_pkey primary key (id),
  constraint budget_categories_no_self_parent check (parent_category_id is null or parent_category_id <> id)
);

create index if not exists budget_categories_parent_idx on public.budget_categories(parent_category_id);

-- Seed a neutral default set (idempotent, English canonical names; the UI
-- translates chrome, user data stays as entered).
insert into public.budget_categories (name, description, icon, sort_order)
select v.name, v.description, v.icon, v.sort_order
from (values
  ('Operations', 'Day-to-day running costs', 'Briefcase', 10),
  ('Payroll', 'Salaries and compensation', 'Users', 20),
  ('Equipment', 'Machinery and tools', 'Wrench', 30),
  ('Vehicles', 'Fuel, maintenance and insurance', 'Car', 40),
  ('Office', 'Supplies, internet and utilities', 'Building', 50),
  ('Marketing', 'Promotion and communication', 'Megaphone', 60),
  ('Travel', 'Transport and accommodation', 'Plane', 70),
  ('Taxes', 'Duties and fiscal charges', 'Receipt', 80),
  ('Professional Services', 'Consultants and experts', 'Handshake', 90),
  ('Projects', 'Project-linked spending', 'FolderKanban', 100),
  ('Miscellaneous', 'Unclassified spending', 'Shapes', 110)
) as v(name, description, icon, sort_order)
where not exists (select 1 from public.budget_categories c where c.name = v.name);

-- ---------------------------------------------------------------
-- 3. Expenses
-- ---------------------------------------------------------------
create table if not exists public.budget_expenses (
  id                uuid not null default gen_random_uuid(),
  title             text not null,
  description       text null,
  amount            numeric(14,2) not null check (amount >= 0),
  expected_amount   numeric(14,2) null check (expected_amount is null or expected_amount >= 0),
  currency          text not null default 'TND',
  expense_date      date not null default current_date,
  category_id       uuid null references public.budget_categories(id) on delete set null,
  subcategory_id    uuid null references public.budget_categories(id) on delete set null,
  budget_id         uuid null references public.budgets(id) on delete set null,
  project_id        uuid null references public.projects(id) on delete set null,
  vendor            text null,
  reference         text null,
  payment_status    text not null default 'pending'
                    check (payment_status in ('planned','pending','approved','paid','partially_paid','overdue','cancelled','refunded','partially_refunded')),
  expense_type      text not null default 'flexible'
                    check (expense_type in ('fixed','flexible')),
  expense_kind      text not null default 'one_time'
                    check (expense_kind in ('one_time','recurring')),
  recurring_id      uuid null,
  recurrence_key    text null,
  document_id       uuid null references public.documents(id) on delete set null,
  notes             text null,
  archived          boolean not null default false,
  created_by        uuid null references auth.users(id) on delete set null,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  constraint budget_expenses_pkey primary key (id)
);

create unique index if not exists budget_expenses_recurrence_uidx
  on public.budget_expenses (recurrence_key) where recurrence_key is not null;
create index if not exists budget_expenses_budget_idx on public.budget_expenses(budget_id);
create index if not exists budget_expenses_project_idx on public.budget_expenses(project_id);
create index if not exists budget_expenses_category_idx on public.budget_expenses(category_id);
create index if not exists budget_expenses_date_idx on public.budget_expenses(expense_date);
create index if not exists budget_expenses_status_idx on public.budget_expenses(payment_status);
create index if not exists budget_expenses_created_by_idx on public.budget_expenses(created_by);

-- ---------------------------------------------------------------
-- 4. Recurring definitions (generation is idempotent via recurrence_key)
-- ---------------------------------------------------------------
create table if not exists public.budget_recurring (
  id                uuid not null default gen_random_uuid(),
  title             text not null,
  amount            numeric(14,2) not null check (amount >= 0),
  currency          text not null default 'TND',
  category_id       uuid null references public.budget_categories(id) on delete set null,
  budget_id         uuid null references public.budgets(id) on delete set null,
  project_id        uuid null references public.projects(id) on delete set null,
  vendor            text null,
  frequency         text not null default 'monthly'
                    check (frequency in ('daily','weekly','monthly','quarterly','yearly')),
  start_date        date not null default current_date,
  end_date          date null,
  next_run_date     date not null default current_date,
  last_generated_at timestamptz null,
  active            boolean not null default true,
  notes             text null,
  created_by        uuid null references auth.users(id) on delete set null,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  constraint budget_recurring_pkey primary key (id)
);

create index if not exists budget_recurring_next_run_idx
  on public.budget_recurring(next_run_date) where active = true;

-- ---------------------------------------------------------------
-- 5. Refunds (never mutate the original expense)
-- ---------------------------------------------------------------
create table if not exists public.budget_refunds (
  id                uuid not null default gen_random_uuid(),
  expense_id        uuid not null references public.budget_expenses(id) on delete restrict,
  amount            numeric(14,2) not null check (amount > 0),
  refund_date       date not null default current_date,
  reason            text null,
  source            text null,
  project_id        uuid null references public.projects(id) on delete set null,
  category_id       uuid null references public.budget_categories(id) on delete set null,
  document_id       uuid null references public.documents(id) on delete set null,
  notes             text null,
  status            text not null default 'paid'
                    check (status in ('pending','paid','cancelled')),
  created_by        uuid null references auth.users(id) on delete set null,
  created_at        timestamptz not null default now(),
  constraint budget_refunds_pkey primary key (id)
);

create index if not exists budget_refunds_expense_idx on public.budget_refunds(expense_id);
create index if not exists budget_refunds_project_idx on public.budget_refunds(project_id);

-- ---------------------------------------------------------------
-- 6. Structured budget rules (no executable code from users)
-- ---------------------------------------------------------------
create table if not exists public.budget_rules (
  id                uuid not null default gen_random_uuid(),
  name              text not null,
  scope_type        text not null default 'global'
                    check (scope_type in ('global','sub_budget','category','project')),
  scope_id          uuid null,
  metric            text not null default 'utilization'
                    check (metric in ('utilization','spent','remaining')),
  operator          text not null default 'gte'
                    check (operator in ('gte','lte')),
  threshold         numeric(14,2) not null,
  period            text not null default 'once'
                    check (period in ('once','monthly','quarterly','yearly')),
  action            text not null default 'notify'
                    check (action in ('notify', 'require_approval')),
  enabled           boolean not null default true,
  effective_from    date null,
  effective_to      date null,
  last_triggered_at timestamptz null,
  last_value        numeric(14,2) null,
  notes             text null,
  created_by        uuid null references auth.users(id) on delete set null,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  constraint budget_rules_pkey primary key (id)
);

create index if not exists budget_rules_scope_idx on public.budget_rules(scope_type, scope_id);

-- ---------------------------------------------------------------
-- 7. RLS: super_admin full manage, nobody else touches finance data
-- ---------------------------------------------------------------
do $$
declare
  t text;
begin
  foreach t in array array[
    'public.budgets', 'public.budget_categories', 'public.budget_expenses',
    'public.budget_recurring', 'public.budget_refunds', 'public.budget_rules'
  ]
  loop
    execute format('alter table %s enable row level security', t);
    execute format('drop policy if exists "Budget super admin manage" on %s', t);
    execute format(
      'create policy "Budget super admin manage" on %s for all to authenticated using (public.auth_user_is_super_admin()) with check (public.auth_user_is_super_admin())',
      t
    );
    execute format('revoke all on %s from anon', t);
  end loop;
end $$;

-- updated_at maintenance (touch only these tables' own triggers)
do $$
declare
  t text;
begin
  foreach t in array array[
    'public.budgets', 'public.budget_categories', 'public.budget_expenses',
    'public.budget_recurring', 'public.budget_rules'
  ]
  loop
    execute format('drop trigger if exists set_updated_at on %s', t);
    execute format('create trigger set_updated_at before update on %s for each row execute function public.update_updated_at_column()', t);
  end loop;
end $$;

notify pgrst, 'reload schema';
