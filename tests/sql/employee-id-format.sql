-- Read-only regression assertions. Run against an isolated database with 004
-- applied. No employee records, profiles, or sequence counters are changed.
do $$
declare
 cfg jsonb:='{"prefix":"TEST","digits":3,"separator":"-"}';
begin
 if private.format_employee_id(cfg,null,1)<>'TEST-001' then raise exception 'Minimum width padding changed'; end if;
 if private.format_employee_id(cfg,null,999)<>'TEST-999' then raise exception 'Width boundary changed'; end if;
 if private.format_employee_id(cfg,null,1000)<>'TEST-1000' then raise exception 'Sequence was truncated at the width boundary'; end if;
 if private.format_employee_id(cfg,null,1001)=private.format_employee_id(cfg,null,1000) then raise exception 'Consecutive IDs collided'; end if;
 if private.format_employee_id(cfg||'{"digits":8}',null,100000000)<>'TEST-100000000' then raise exception 'Large sequence was truncated'; end if;
 if private.format_employee_id(cfg||'{"include_department":true,"branch_code":"BLR"}','Sales',1000)<>'TEST-SAL-BLR-1000' then raise exception 'Configured ID parts changed'; end if;
 if private.format_employee_id(cfg||'{"include_year":true}',null,1000)<>'TEST-'||to_char(now(),'YYYY')||'-1000' then raise exception 'Calendar year part changed'; end if;
 if private.format_employee_id('{"prefix":"","digits":1,"separator":""}',null,10)<>'10' then raise exception 'Unprefixed sequence was truncated'; end if;
end $$;
