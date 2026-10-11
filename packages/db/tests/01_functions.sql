-- @file  packages/db/tests/01_functions.sql
-- @area  Tests
-- @what  SQL tests for the database functions and the app role restrictions.
\set ON_ERROR_STOP 1
-- Run after migrations + seed. Exercises the SQL functions as the least-privilege app role.
set role lens_app;
select public.create_report_with_credit('00000000-0000-0000-0000-000000000001','{"version":1}'::jsonb, array['a.csv'], array['h1'], 'India','INR', 10, -500, 30) as rid \gset
select balance as after_one from credits where user_id='00000000-0000-0000-0000-000000000001';
do $$ begin
  perform public.create_report_with_credit('00000000-0000-0000-0000-000000000001','{}'::jsonb, array['a'], array['h'],null,null,1,0,30) from generate_series(1,4);
  begin
    perform public.create_report_with_credit('00000000-0000-0000-0000-000000000001','{}'::jsonb, array['a'], array['h'],null,null,1,0,30);
    raise exception 'expected no_credits';
  exception when sqlstate 'P0001' then
    if sqlerrm <> 'no_credits' then raise; end if;
    raise notice 'PASS no_credits raised at zero balance';
  end;
end $$;
do $$ begin
  begin insert into reports(user_id,file_names,file_hashes,expires_at) values ('00000000-0000-0000-0000-000000000001', array['1','2','3','4'], array['a'], now());
  raise exception 'expected check violation';
  exception when check_violation then raise notice 'PASS max-3-files constraint'; end;
end $$;
select public.delete_report('00000000-0000-0000-0000-000000000001', :'rid') as deleted_first_time;
select public.delete_report('00000000-0000-0000-0000-000000000001', :'rid') as deleted_second_time;
do $$ begin
  begin delete from reports; raise exception 'expected permission denied';
  exception when insufficient_privilege then raise notice 'PASS app role cannot DELETE rows'; end;
  begin create table hack(x int); raise exception 'expected permission denied';
  exception when insufficient_privilege then raise notice 'PASS app role cannot run DDL'; end;
end $$;
reset role;
update reports set expires_at = now() - interval '1 day' where purged_at is null and id in (select id from reports where purged_at is null limit 2);
set role lens_app;
select public.purge_expired_reports() as purged;
reset role;
select count(*) filter (where purged_at is null) as live, count(*) filter (where report is null) as nulled from reports;
select action, count(*) from audit_log group by action order by action;
