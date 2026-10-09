-- Phase A only. Apply as database owner. No auth/closet/payment MVP tables.
create schema if not exists poc;
create or replace function poc.owner_id() returns uuid language sql stable as $$
  select coalesce(nullif(current_setting('request.jwt.claim.sub', true), ''),
    nullif(current_setting('request.jwt.claims', true), '')::jsonb->>'sub')::uuid
$$;
create table poc.image_assets (
  id uuid primary key, owner_id uuid not null, kind text not null check(kind in ('person','garment','result')),
  path text not null unique, width integer not null, height integer not null, bytes integer not null,
  created_at timestamptz not null default now(), expires_at timestamptz not null default now()+interval '90 days'
);
create table poc.tryon_jobs (
  id uuid primary key, owner_id uuid not null,
  idempotency_key uuid not null, input_hash text not null,
  provider text not null check(provider in ('mock','fal-fashn','fal-nano')),
  model text not null, prompt_version text not null, prompt text not null, resolution text not null,
  inputs jsonb not null, approval_id text, consent_version text,
  state text not null default 'queued' check(state in ('queued','running','succeeded','failed','cancelled','reconciling')),
  external_id text, submit_started_at timestamptz, lease_until timestamptz,
  error_code text, created_at timestamptz not null default now(), started_at timestamptz, finished_at timestamptz,
  deleted_at timestamptz, unique(owner_id,idempotency_key)
);
create table poc.cost_reservations (
  id uuid primary key, job_id uuid not null unique references poc.tryon_jobs(id) on delete restrict,
  owner_id uuid not null, period text not null, currency text not null default 'JPY' check(currency='JPY'),
  max_jpy integer not null check(max_jpy>=0), actual_jpy integer check(actual_jpy>=0),
  status text not null check(status in ('reserved','unknown','settled','released')),
  usd_jpy numeric, unit_usd numeric, price_checked_at text, evidence text,
  created_at timestamptz not null default now()
);
create table poc.generation_attempts (
  id uuid primary key, job_id uuid not null unique references poc.tryon_jobs(id) on delete restrict,
  owner_id uuid not null, external_id text, billing text not null default 'not_started' check(billing in ('not_started','unknown','mock_free','confirmed')),
  started_at timestamptz, finished_at timestamptz
);
create table poc.tryon_results (
  id uuid primary key, owner_id uuid not null, job_id uuid not null unique references poc.tryon_jobs(id) on delete cascade,
  image_id uuid not null references poc.image_assets(id) on delete cascade
);
create table poc.feedback (
  id uuid primary key, owner_id uuid not null, job_id uuid not null unique references poc.tryon_jobs(id) on delete cascade,
  identity_score integer not null check(identity_score between 1 and 5),
  garment_score integer not null check(garment_score between 1 and 5),
  natural_score integer not null check(natural_score between 1 and 5),
  helpful text not null check(helpful in ('yes','partly','no')),
  major_missing boolean not null, tags text[] not null, comment text not null,
  case_id text not null, split text not null check(split in ('tuning','holdout')),
  evaluator text not null check(evaluator in ('operator','self')), created_at timestamptz not null default now()
);
do $$ declare t text; begin
  foreach t in array array['image_assets','tryon_jobs','cost_reservations','generation_attempts','tryon_results','feedback'] loop
    execute format('alter table poc.%I enable row level security',t);
    execute format('alter table poc.%I force row level security',t);
    execute format('create policy owner_read on poc.%I for select using(owner_id=poc.owner_id())',t);
  end loop;
end $$;
-- Server-only role. It is not exposed in Supabase's public REST schemas.
do $$ begin
  if not exists(select from pg_roles where rolname='poc_server') then create role poc_server nologin nosuperuser nobypassrls; end if;
end $$;
grant usage on schema poc to poc_server;
grant execute on function poc.owner_id() to poc_server;
grant select,insert,update,delete on all tables in schema poc to poc_server;
do $$ declare t text; begin
  foreach t in array array['image_assets','tryon_jobs','cost_reservations','generation_attempts','tryon_results','feedback'] loop
    execute format('create policy server_write on poc.%I to poc_server using(owner_id=poc.owner_id()) with check(owner_id=poc.owner_id())',t);
  end loop;
end $$;
-- Future authenticated clients may read their own data, never change costs/jobs.
do $$ begin
  if exists(select from pg_roles where rolname='authenticated') then
    grant usage on schema poc to authenticated;
    grant execute on function poc.owner_id() to authenticated;
    grant select on all tables in schema poc to authenticated;
  end if;
end $$;
-- Supabase Storage is deliberately NOT used in local Phase A. When present,
-- prepare private bucket with UUID owner prefix, allowing only owner read.
do $$ begin
  if to_regclass('storage.buckets') is not null then
    insert into storage.buckets(id,name,public) values('tryon-private','tryon-private',false) on conflict(id) do update set public=false;
    execute $p$create policy poc_storage_owner_read on storage.objects for select to authenticated
      using(bucket_id='tryon-private' and split_part(name,'/',1)=poc.owner_id()::text)$p$;
  end if;
end $$;
