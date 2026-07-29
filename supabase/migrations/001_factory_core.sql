-- Migration 001: OMNEX Factory core
--
-- The shared spine every module runs on: one user profile, ONE credit balance,
-- an auditable ledger, and per-module usage events.
--
-- The `module_id` dimension is the thing OMNEX never had: the old platform
-- scoped everything by user_id only, so it could never answer "which product
-- makes money". Every credit spend and every usage event carries a module_id.
--
-- Patterns deliberately reused from the proven live OMNEX schema:
--   * consume_credits()  ← migration 013 consume_run(): SELECT ... FOR UPDATE row
--     lock so two concurrent requests can never double-spend the same credits.
--   * webhook_events     ← migration 014: Stripe idempotency via primary-key
--     conflict, so a redelivered event can never grant credits twice.
--   * RLS `auth.uid() = user_id` on every user-scoped table (service role bypasses).

create extension if not exists pgcrypto;

-- ── Profiles ────────────────────────────────────────────────────────────────
create table if not exists public.profiles (
  id                 uuid primary key references auth.users(id) on delete cascade,
  email              text,
  full_name          text,
  stripe_customer_id text,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

alter table public.profiles enable row level security;
drop policy if exists "profiles_owner_select" on public.profiles;
create policy "profiles_owner_select" on public.profiles
  for select to authenticated using (auth.uid() = id);
drop policy if exists "profiles_owner_update" on public.profiles;
create policy "profiles_owner_update" on public.profiles
  for update to authenticated using (auth.uid() = id);

-- ── Credit balance (one balance, spendable across every module) ─────────────
create table if not exists public.credit_balance (
  user_id    uuid primary key references auth.users(id) on delete cascade,
  credits    integer not null default 0 check (credits >= 0),
  updated_at timestamptz not null default now()
);

alter table public.credit_balance enable row level security;
drop policy if exists "credit_balance_owner" on public.credit_balance;
create policy "credit_balance_owner" on public.credit_balance
  for select to authenticated using (auth.uid() = user_id);
-- writes are service-role only (via consume_credits / grant_credits)

-- ── Ledger: every grant and every spend, auditable ──────────────────────────
create table if not exists public.credit_ledger (
  id         bigserial primary key,
  user_id    uuid not null references auth.users(id) on delete cascade,
  delta      integer not null,          -- +granted / -spent
  reason     text not null,             -- 'purchase' | 'signup_bonus' | 'spend' | 'refund'
  module_id  text,                      -- which module spent it (null for grants)
  stripe_ref text,                      -- checkout session / invoice id for grants
  created_at timestamptz not null default now()
);

create index if not exists idx_credit_ledger_user on public.credit_ledger (user_id, created_at desc);
create index if not exists idx_credit_ledger_module on public.credit_ledger (module_id, created_at desc);

alter table public.credit_ledger enable row level security;
drop policy if exists "credit_ledger_owner" on public.credit_ledger;
create policy "credit_ledger_owner" on public.credit_ledger
  for select to authenticated using (auth.uid() = user_id);

-- ── Usage events: per-module analytics + revenue attribution ────────────────
create table if not exists public.usage_events (
  id         bigserial primary key,
  user_id    uuid references auth.users(id) on delete set null,
  module_id  text not null,
  action     text not null,             -- e.g. 'generate'
  credits    integer not null default 0,
  ok         boolean not null default true,
  meta       jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists idx_usage_events_module on public.usage_events (module_id, created_at desc);
create index if not exists idx_usage_events_user on public.usage_events (user_id, created_at desc);

alter table public.usage_events enable row level security;
drop policy if exists "usage_events_owner" on public.usage_events;
create policy "usage_events_owner" on public.usage_events
  for select to authenticated using (auth.uid() = user_id);

-- ── Stripe webhook idempotency (migration 014 pattern) ─────────────────────
create table if not exists public.webhook_events (
  id          text primary key,          -- Stripe event.id
  type        text,
  received_at timestamptz not null default now()
);

alter table public.webhook_events enable row level security;
-- service-role only; no client policy = default deny.

-- ── Atomic spend (migration 013 consume_run pattern) ───────────────────────
-- Locks the balance row, verifies sufficient credits, decrements, and writes the
-- ledger line in ONE transaction. Returns false when the balance is insufficient
-- so the caller can 402 without having charged anything.
create or replace function consume_credits(
  p_user_id uuid,
  p_amount  integer,
  p_module  text
) returns boolean
language plpgsql
security definer
as $$
declare
  v_credits integer;
begin
  if p_amount <= 0 then
    return true;                       -- nothing to charge
  end if;

  select credits into v_credits
  from public.credit_balance
  where user_id = p_user_id
  for update;                          -- row lock closes the double-spend race

  if v_credits is null or v_credits < p_amount then
    return false;
  end if;

  update public.credit_balance
  set credits = credits - p_amount, updated_at = now()
  where user_id = p_user_id;

  insert into public.credit_ledger (user_id, delta, reason, module_id)
  values (p_user_id, -p_amount, 'spend', p_module);

  return true;
end;
$$;

-- ── Grant credits (purchase / bonus / refund) ──────────────────────────────
create or replace function grant_credits(
  p_user_id uuid,
  p_amount  integer,
  p_reason  text default 'purchase',
  p_ref     text default null
) returns integer
language plpgsql
security definer
as $$
declare
  v_new integer;
begin
  insert into public.credit_balance (user_id, credits)
  values (p_user_id, greatest(p_amount, 0))
  on conflict (user_id) do update
    set credits = public.credit_balance.credits + greatest(p_amount, 0),
        updated_at = now()
  returning credits into v_new;

  insert into public.credit_ledger (user_id, delta, reason, stripe_ref)
  values (p_user_id, p_amount, p_reason, p_ref);

  return v_new;
end;
$$;

-- ── New user: profile + starter credits so the product can be TRIED ────────
create or replace function handle_new_factory_user()
returns trigger
language plpgsql
security definer
as $$
begin
  insert into public.profiles (id, email, full_name)
  values (new.id, new.email, new.raw_user_meta_data->>'full_name')
  on conflict (id) do nothing;

  insert into public.credit_balance (user_id, credits)
  values (new.id, 20)                  -- enough for 2 Ad Studio generations
  on conflict (user_id) do nothing;

  insert into public.credit_ledger (user_id, delta, reason)
  values (new.id, 20, 'signup_bonus');

  return new;
end;
$$;

drop trigger if exists on_auth_user_created_factory on auth.users;
create trigger on_auth_user_created_factory
  after insert on auth.users
  for each row execute function handle_new_factory_user();
