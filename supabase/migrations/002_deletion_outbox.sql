-- File deletion is not transactional with SQL. Persist paths for retry.
create table if not exists poc.deletion_files (
  id uuid primary key,owner_id uuid not null,path text not null,
  created_at timestamptz not null default now(),unique(owner_id,path)
);
alter table poc.deletion_files enable row level security;
alter table poc.deletion_files force row level security;
do $$ begin
  if not exists(select from pg_policies where schemaname='poc' and tablename='deletion_files' and policyname='deletion_owner') then
    create policy deletion_owner on poc.deletion_files to poc_server using(owner_id=poc.owner_id()) with check(owner_id=poc.owner_id());
  end if;
end $$;
grant select,insert,update,delete on poc.deletion_files to poc_server;
