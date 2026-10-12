-- Run ONLY in an isolated test project after all five SQL files. Entire suite rolls back.
begin;
create function pg_temp.assert_true(condition boolean,message text) returns void language plpgsql as $$begin if condition is distinct from true then raise exception 'TEST FAILED: %',message;end if;end $$;
insert into private.accounts(id,password_hash) values
 ('10000000-0000-4000-8000-000000000001','test-admin@techly.invalid'),
 ('10000000-0000-4000-8000-000000000002','test-manager@techly.invalid'),
 ('10000000-0000-4000-8000-000000000003','test-employee-a@techly.invalid'),
 ('10000000-0000-4000-8000-000000000004','test-employee-b@techly.invalid');
insert into public.profiles(id,full_name,phone,role,must_change_password,manager_id) values
 ('10000000-0000-4000-8000-000000000001','Test Admin','+910000000001','super_admin',false,null),
 ('10000000-0000-4000-8000-000000000002','Test Manager','+910000000002','manager',false,null),
 ('10000000-0000-4000-8000-000000000003','Employee A','+910000000003','employee',false,'10000000-0000-4000-8000-000000000002'),
 ('10000000-0000-4000-8000-000000000004','Employee B','+910000000004','employee',false,null);
insert into public.records(id,module,title,status,owner_id,created_by,data) values
 ('20000000-0000-4000-8000-000000000001','leads','A private lead','New Lead','10000000-0000-4000-8000-000000000003','10000000-0000-4000-8000-000000000003','{"contact":"A","phone":"1111111111"}'),
 ('20000000-0000-4000-8000-000000000002','leads','B private lead','New Lead','10000000-0000-4000-8000-000000000004','10000000-0000-4000-8000-000000000004','{"contact":"B","phone":"2222222222"}'),
 ('20000000-0000-4000-8000-000000000003','leave','Test leave','Draft','10000000-0000-4000-8000-000000000003','10000000-0000-4000-8000-000000000003','{"leave_type":"Casual Leave","start_date":"2026-10-12","end_date":"2026-10-12","duration":"Full Day","reason":"Personal"}'),
 ('20000000-0000-4000-8000-000000000004','inventory','Test stock','Active','10000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001','{"sku":"TEST-SKU","category":"Computers","available":0,"allocated":0,"damaged":0,"minimum_stock":1}'),
 ('20000000-0000-4000-8000-000000000005','expenses','Test claim','Pending Payment','10000000-0000-4000-8000-000000000003','10000000-0000-4000-8000-000000000003','{"expense_date":"2026-10-12","amount":100,"category":"Travel","purpose":"Visit"}');
insert into public.leave_ledger(user_id,type,amount,event_key) values('10000000-0000-4000-8000-000000000003','Casual Leave',12,'test-allocation');
update public.settings set data=data||'{"holidays":[],"special_days":[]}'::jsonb;

set local role techly_user;
select set_config('app.user_id','10000000-0000-4000-8000-000000000003',true);
do $$declare blocked boolean:=false;begin begin perform password_hash from private.accounts limit 1;exception when insufficient_privilege then blocked:=true;end;perform pg_temp.assert_true(blocked,'application user role cannot read password hashes');end $$;
do $$declare blocked boolean:=false;begin begin perform token_hash from private.sessions limit 1;exception when insufficient_privilege then blocked:=true;end;perform pg_temp.assert_true(blocked,'application user role cannot read session hashes');end $$;
do $$declare blocked boolean:=false;begin begin perform content from private.stored_files limit 1;exception when insufficient_privilege then blocked:=true;end;perform pg_temp.assert_true(blocked,'application user role cannot bypass authorized file downloads');end $$;
select pg_temp.assert_true((select count(*)=1 from public.records where module='leads'),'employee must see only own lead');
select pg_temp.assert_true(jsonb_array_length(public.export_records('leads'))=1,'exports must respect employee ownership');
do $$declare blocked boolean:=false;begin begin perform public.save_record('leads','Stolen lead','{"contact":"X","phone":"3333333333"}','10000000-0000-4000-8000-000000000004');exception when insufficient_privilege or raise_exception then blocked:=true;end;perform pg_temp.assert_true(blocked,'cross-employee ownership must be blocked');end $$;
do $$declare blocked boolean:=false;begin begin update public.records set status='Approved' where module='leave';exception when insufficient_privilege then blocked:=true;end;perform pg_temp.assert_true(blocked,'direct table workflow bypass must be blocked');end $$;
select public.workflow('20000000-0000-4000-8000-000000000003','submit',1,'');
do $$declare blocked boolean:=false;begin begin perform public.workflow('20000000-0000-4000-8000-000000000003','approve',2,'');exception when raise_exception then blocked:=true;end;perform pg_temp.assert_true(blocked,'self approval must be blocked');end $$;
select set_config('app.user_id','10000000-0000-4000-8000-000000000002',true);
select pg_temp.assert_true((select count(*)=0 from public.records),'manager must start with no module access');
reset role;
insert into public.permission_grants(role,module,action,scope) values('manager','leads','view','team'),('manager','leave','view','team'),('manager','leave','approve','team');
set local role techly_user;
select pg_temp.assert_true((select count(*)=1 from public.records where module='leads'),'manager must see only reporting-team lead');
select public.workflow('20000000-0000-4000-8000-000000000003','approve',2,'');
select pg_temp.assert_true((select sum(amount)=11 from public.leave_ledger where type='Casual Leave'),'approval deducts exactly one day');
do $$declare blocked boolean:=false;begin begin perform public.workflow('20000000-0000-4000-8000-000000000003','approve',3,'');exception when raise_exception then blocked:=true;end;perform pg_temp.assert_true(blocked,'repeat approval must be blocked');end $$;
select set_config('app.user_id','10000000-0000-4000-8000-000000000003',true);
select public.workflow('20000000-0000-4000-8000-000000000003','cancel_request',3,'');
select set_config('app.user_id','10000000-0000-4000-8000-000000000002',true);
select public.workflow('20000000-0000-4000-8000-000000000003','cancel_approve',4,'');
select pg_temp.assert_true((select sum(amount)=12 from public.leave_ledger where type='Casual Leave'),'approved cancellation restores one day');

select set_config('app.user_id','10000000-0000-4000-8000-000000000001',true);
select public.stock_transaction('20000000-0000-4000-8000-000000000004','Purchase',2,null,null,'Test receipt','test-receipt');
select public.stock_transaction('20000000-0000-4000-8000-000000000004','Purchase',2,null,null,'Repeated request','test-receipt');
select pg_temp.assert_true((select (data->>'available')::integer=2 from public.records where id='20000000-0000-4000-8000-000000000004'),'same stock request cannot add twice');
select public.stock_transaction('20000000-0000-4000-8000-000000000004','Allocation',1,'10000000-0000-4000-8000-000000000003',null,'Test allocation','test-allocate');
do $$declare blocked boolean:=false;begin begin perform public.stock_transaction('20000000-0000-4000-8000-000000000004','Allocation',3,'10000000-0000-4000-8000-000000000003',null,'Excess','test-excess');exception when raise_exception then blocked:=true;end;perform pg_temp.assert_true(blocked,'stock cannot become negative');end $$;
select public.record_payment('20000000-0000-4000-8000-000000000005',60,'UPI','TEST-1','test-payment-1');
select public.record_payment('20000000-0000-4000-8000-000000000005',60,'UPI','TEST-1','test-payment-1');
select pg_temp.assert_true((select sum(amount)=60 from public.payments where record_id='20000000-0000-4000-8000-000000000005'),'same payment cannot reimburse twice');
do $$declare blocked boolean:=false;begin begin perform public.record_payment('20000000-0000-4000-8000-000000000005',50,'UPI','OVER','test-overpay');exception when raise_exception then blocked:=true;end;perform pg_temp.assert_true(blocked,'payment cannot exceed outstanding amount');end $$;
select public.record_payment('20000000-0000-4000-8000-000000000005',40,'UPI','TEST-2','test-payment-2');
select pg_temp.assert_true((select status='Paid' from public.records where id='20000000-0000-4000-8000-000000000005'),'full settlement marks claim paid');
reset role;
update public.settings set data=data||'{"office_lat":12.9716,"office_lng":77.5946,"geofence_radius":200,"enforce_geofence":true}'::jsonb;
set local role techly_user;
select public.clock_attendance('in',12.9716,77.5946,5,false);
select pg_temp.assert_true((select abs((data->>'distance_m')::numeric)<0.01 and not (data->>'flagged')::boolean from public.records where module='attendance' and owner_id='10000000-0000-4000-8000-000000000001'),'attendance at office computes zero distance');
select set_config('app.user_id','10000000-0000-4000-8000-000000000004',true);
do $$declare blocked boolean:=false;begin begin perform public.clock_attendance('in',13.0827,80.2707,5,false);exception when raise_exception then blocked:=true;end;perform pg_temp.assert_true(blocked,'office geofence rejects distant attendance');end $$;
select set_config('app.user_id','10000000-0000-4000-8000-000000000001',true);
select pg_temp.assert_true(jsonb_typeof(public.dashboard_stats())='object','admin dashboard aggregates execute under the restricted application role');
reset role;
insert into public.records(module,title,status,owner_id,created_by,data)
select 'leads','Export test '||n,'New Lead','10000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001','{}'::jsonb from generate_series(1,1001) n;
select pg_temp.assert_true(jsonb_array_length(public.export_records('leads'))>=1001,'scalar JSON exports must retain more than 1000 rows');
select 'Database integration assertions passed; all fixtures will roll back.' as result;
rollback;
