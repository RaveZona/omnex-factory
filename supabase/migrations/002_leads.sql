-- Leads from the public portfolio brief form.
--
-- RLS is on with NO public select policy: an anonymous visitor may insert their own
-- enquiry and read nothing back. Without that, the brief form would double as a
-- customer-list endpoint for anyone who found the anon key.

create table if not exists public.leads (
  id            uuid primary key default gen_random_uuid(),
  created_at    timestamptz not null default now(),
  source        text not null default 'portfolio',
  name          text,
  email         text not null,
  company       text,
  brand_site    text,
  -- Kept as free text rather than an enum: the options on the form will change
  -- faster than a migration should.
  budget        text,
  timeline      text,
  brief         text,
  -- Scored later by the qualification step; null means "not yet scored".
  score         int,
  stage         text not null default 'new',
  meta          jsonb not null default '{}'::jsonb
);

create index if not exists leads_created_at_idx on public.leads (created_at desc);
create index if not exists leads_stage_idx on public.leads (stage);

alter table public.leads enable row level security;

-- Insert-only for anonymous visitors. Service-role bypasses RLS for the owner view.
drop policy if exists leads_public_insert on public.leads;
create policy leads_public_insert
  on public.leads for insert
  to anon, authenticated
  with check (true);
