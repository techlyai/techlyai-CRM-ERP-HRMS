-- Migration 006: role-based access control.
--
-- Three access levels: Super Admin (role super_admin, full access, enforced in
-- private.scope_for), Admin (role manager) and Employee (role employee). Admins
-- and Employees receive only what their role defaults and individual overrides
-- grant. Every permission is a row in public.permission_definitions and is
-- checked by the database; the UI only reflects these rules.
begin;

-- ---------------------------------------------------------------------------
-- Permission catalogue: the single source of truth for what can be granted.
-- ---------------------------------------------------------------------------
create table public.permission_definitions(
 module text not null,
 action text not null,
 module_label text not null,
 module_group text not null,
 label text not null,
 description text not null default '',
 scoped boolean not null default true,   -- false: granted or not (no Own/Team/Department/All)
 hidden boolean not null default false,  -- reserved combinations not shown in the checklist
 sensitive boolean not null default false,
 sort integer not null default 0,
 primary key(module,action)
);
alter table public.permission_definitions enable row level security;
create policy permission_definitions_read on public.permission_definitions for select to techly_user using(true);
grant select on public.permission_definitions to techly_user;
grant all on public.permission_definitions to techly_service;

-- Business record modules: every module supports the same seven actions.
with mods(module,module_label,module_group,msort) as (values
 ('clients','Clients','Business',10),('leads','CRM & leads','Business',11),('renewals','Renewals','Business',12),
 ('projects','Projects','Work',20),('tasks','Tasks','Work',21),('eod','Daily reports','Work',22),
 ('employees','People & HRIS','People',30),('payroll','Salary & payroll','People',31),('onboarding','Onboarding','People',32),
 ('attendance','Attendance','People',33),('corrections','Attendance corrections','People',34),('leave','Leave management','People',35),
 ('software','Software & licences','Operations',40),('inventory','Inventory','Operations',41),('assets','Assets & maintenance','Operations',42),('maintenance','Maintenance history','Operations',43),
 ('vendors','Vendors','Finance',50),('purchases','Purchases','Finance',51),('expenses','Expenses & claims','Finance',52),('credit','Credit & dues','Finance',53)
), acts(action,label,asort) as (values
 ('view','View records',1),('create','Create records',2),('edit','Edit records',3),('upload','Upload and download attachments',4),
 ('approve','Approve, review and verify',5),('export','Export reports',6),('delete','Delete (archive) records',7)
)
insert into public.permission_definitions(module,action,module_label,module_group,label,sort,sensitive)
select m.module,a.action,m.module_label,m.module_group,a.label,m.msort*10+a.asort,
 m.module in ('payroll','employees','credit','expenses','purchases') and a.action in ('view','approve','export')
from mods m cross join acts a;

-- Module-specific wording, so each checkbox says exactly what it allows.
update public.permission_definitions d set label=v.label from (values
 ('leads','create','Create and import leads'),
 ('renewals','edit','Edit, renew, snooze and change renewal status'),
 ('software','edit','Edit, renew, snooze and change licence status'),
 ('tasks','edit','Update tasks (including marking complete)'),
 ('eod','view','View daily reports'),('eod','create','Submit daily reports'),('eod','edit','Edit drafts and reply to questions'),
 ('eod','approve','Review, question, approve or reject reports'),('eod','export','Export daily reports'),
 ('employees','view','View employee profiles'),('employees','create','Create employee records'),('employees','edit','Edit employee profiles'),
 ('employees','upload','Upload and view employee and joining documents'),('employees','approve','Verify employee documents'),
 ('payroll','approve','Approve payroll and record payments'),
 ('attendance','view','View attendance'),('attendance','create','Clock in'),('attendance','edit','Clock out'),('attendance','export','Export attendance reports'),
 ('corrections','create','Request attendance corrections'),('corrections','approve','Approve or reject attendance corrections'),
 ('leave','view','View leave applications and balances'),('leave','create','Apply for leave'),('leave','approve','Approve or reject leave and grant leave days'),
 ('inventory','edit','Edit items and record stock movements'),
 ('maintenance','approve','Approve maintenance and update assets'),
 ('purchases','approve','Approve purchases, receive stock and record payments'),
 ('expenses','create','Submit expense claims'),('expenses','approve','Approve or reject claims and record payments'),
 ('credit','approve','Record payments against dues')
) v(module,action,label) where d.module=v.module and d.action=v.action;
-- Combinations the application never uses are kept for referential integrity but not shown.
update public.permission_definitions set hidden=true where (module,action) in (
 ('attendance','approve'),('attendance','delete'),('attendance','upload'),('inventory','delete'),('credit','delete'));

-- Platform features beyond business records.
insert into public.permission_definitions(module,action,module_label,module_group,label,description,scoped,sensitive,sort) values
 ('credentials','view','Client credentials','Business','See saved logins and usernames','Scope follows the client record owner.',true,true,1301),
 ('credentials','reveal','Client credentials','Business','Reveal and copy current passwords','Every reveal and copy is audited.',true,true,1302),
 ('credentials','edit','Client credentials','Business','Add, edit, archive and change passwords','',true,true,1303),
 ('credentials','history','Client credentials','Business','Open previous passwords','Also requires password re-confirmation.',true,true,1304),
 ('chat','view','Internal chat','Workspace','Use internal chat','Send and receive messages and attachments.',false,false,6001),
 ('chat','create_group','Internal chat','Workspace','Create group chats','In addition to the chat policy in Settings.',false,false,6002),
 ('users','view','Users & access','Administration','View the user directory','Own: yourself. Team: direct reports. Department: your department. All: everyone.',true,false,7001),
 ('users','create','Users & access','Administration','Create employee accounts','Team: new users report to you. Department: new users join your department.',true,false,7002),
 ('users','edit','Users & access','Administration','Edit profiles and activate or deactivate accounts','Roles can only be changed by a Super Admin.',true,false,7003),
 ('users','permissions','Users & access','Administration','Manage employee permissions','You can only grant permissions you hold yourself.',true,true,7004),
 ('settings','company','Settings','Administration','Company hours, holidays and attendance policy','',false,false,7101),
 ('settings','reminders','Settings','Administration','Reminder, notification and sound defaults','',false,false,7102),
 ('settings','chat','Settings','Administration','Chat policy','',false,false,7103),
 ('settings','email','Settings','Administration','Email settings and delivery log','',false,true,7104),
 ('settings','employee_ids','Settings','Administration','Employee ID format','',false,false,7105),
 ('settings','leave_policy','Settings','Administration','Leave policies','',false,false,7106),
 ('audit','view','Activity & audit','Administration','View activity and audit logs','',false,true,7201);

-- ---------------------------------------------------------------------------
-- Grants: catalogue-backed actions, department scope, valid roles only.
-- ---------------------------------------------------------------------------
delete from public.permission_grants g where not exists(select 1 from public.permission_definitions d where d.module=g.module and d.action=g.action);
delete from public.permission_grants where role is not null and role not in ('employee','manager');
alter table public.permission_grants drop constraint if exists permission_grants_action_check;
alter table public.permission_grants drop constraint if exists permission_grants_scope_check;
alter table public.permission_grants add constraint permission_grants_scope_check check(scope in ('self','team','department','all','none'));
alter table public.permission_grants add constraint permission_grants_role_check check(role is null or role in ('employee','manager'));
alter table public.permission_grants add constraint permission_grants_definition_fk foreign key(module,action) references public.permission_definitions(module,action) on update cascade;
alter table public.permission_grants add column if not exists updated_at timestamptz not null default now();
alter table public.permission_grants add column if not exists updated_by uuid references public.profiles(id);
create index if not exists permission_grants_user_idx on public.permission_grants(user_id) where user_id is not null;

-- Preserve today's behaviour for the new feature permissions.
insert into public.permission_grants(role,module,action,scope) values('employee','chat','view','all'),('manager','chat','view','all') on conflict do nothing;
insert into public.permission_grants(user_id,role,module,action,scope)
 select user_id,role,'credentials',x.action,scope from public.permission_grants g cross join (values('view'),('reveal'),('edit')) x(action)
 where g.module='clients' and g.action='edit' and g.scope<>'none' on conflict do nothing;
insert into public.permission_grants(user_id,role,module,action,scope)
 select user_id,role,'credentials','history',scope from public.permission_grants g where g.module='clients' and g.action='approve' and g.scope<>'none' on conflict do nothing;

-- ---------------------------------------------------------------------------
-- Central authorization.
-- ---------------------------------------------------------------------------
-- Effective scope of one permission for one user. Super Admins always have 'all'.
create function private.scope_for(uid uuid,m text,a text) returns text language plpgsql stable security definer set search_path='' as $$
declare p public.profiles; s text;
begin
 select * into p from public.profiles where id=uid;
 if p.id is null or not p.active or p.must_change_password then return 'none'; end if;
 if p.role='super_admin' then return 'all'; end if;
 select scope into s from public.permission_grants where user_id=p.id and role is null and module=m and action=a;
 if s is null then select scope into s from public.permission_grants where user_id is null and role=p.role and module=m and action=a; end if;
 return coalesce(s,'none');
end $$;
-- True when scope `holder` includes everything scope `x` reaches.
create function private.scope_covers(holder text,x text) returns boolean language sql immutable set search_path='' as $$
 select x='none' or holder='all' or holder=x or (x='self' and holder in ('team','department','all'));
$$;
create or replace function private.permitted_for(uid uuid,m text,a text,owner uuid) returns boolean language plpgsql stable security definer set search_path='' as $$
declare p public.profiles; s text;
begin
 select * into p from public.profiles where id=uid;
 if p.id is null or not p.active or p.must_change_password then return false; end if;
 if p.role='super_admin' then return true; end if;
 -- Employees never see other people's private HR records, whatever they are granted.
 if p.role='employee' and (m='onboarding' or (m in ('employees','payroll','attendance','leave','corrections') and owner is distinct from p.id)) then return false;end if;
 s:=private.scope_for(uid,m,a);
 return coalesce(s='all'
  or (s='self' and owner=p.id)
  or (s='team' and (owner=p.id or exists(select 1 from public.profiles where id=owner and manager_id=p.id and active)))
  or (s='department' and (owner=p.id or (p.department is not null and exists(select 1 from public.profiles where id=owner and active and department=p.department)))),false);
end $$;
-- Feature permissions that are simply granted or not.
create function private.has_feature(m text,a text) returns boolean language sql stable security definer set search_path='' as $$
 select private.scope_for(private.current_user_id(),m,a)<>'none';
$$;

-- ---------------------------------------------------------------------------
-- Replace Super-Admin-only checks with specific permissions.
-- ---------------------------------------------------------------------------
create or replace function public.update_settings(p_data jsonb) returns void language plpgsql security definer set search_path='' as $$
declare cur jsonb; k text; grp text;
begin
 select data into cur from public.settings where id=1;
 if jsonb_typeof(p_data)<>'object' then raise exception 'Invalid settings';end if;
 -- Each changed setting needs the permission for its group.
 for k in select key from jsonb_each(p_data) union select key from jsonb_each(cur) loop
  if (p_data->k) is distinct from (cur->k) then
   grp:=case when k like 'reminder\_%' or k in ('notification_channels','sounds') then 'reminders' when k='chat' then 'chat' else 'company' end;
   if not private.has_feature('settings',grp) then raise exception 'You do not have permission to change % settings',grp;end if;
  end if;
 end loop;
 if not exists(select 1 from pg_timezone_names where name=p_data->>'timezone') then raise exception 'Invalid company timezone';end if;
 perform (p_data->>'office_start')::time;perform (p_data->>'office_end')::time;perform (p_data->>'attendance_reminder')::time;perform (p_data->>'eod_reminder')::time;perform (p_data->>'eod_deadline')::time;
 if (p_data->>'grace_minutes')::numeric not between 0 and 180 or (p_data->>'geofence_radius')::numeric not between 10 and 50000 or (p_data->>'renewal_days')::integer not between 1 and 365 then raise exception 'Invalid company policy';end if;
 update public.settings set data=p_data where id=1;
 insert into public.history(actor_id,action,snapshot) values(private.current_user_id(),'Company policy updated',p_data);
end $$;
create or replace function public.update_email_settings(p_data jsonb) returns void language plpgsql security definer set search_path='' as $$
begin if not private.has_feature('settings','email') then raise exception 'Permission denied';end if;
 if jsonb_typeof(p_data)<>'object' or jsonb_typeof(p_data->'events')<>'object' or jsonb_typeof(p_data->'templates')<>'object' then raise exception 'Invalid email settings';end if;
 if coalesce(p_data->>'sender_email','')<>'' and p_data->>'sender_email' !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then raise exception 'Enter a valid sender email';end if;
 update public.email_settings set data=p_data where id=1;
 insert into public.history(actor_id,action,snapshot) values(private.current_user_id(),'Email settings updated',p_data-'templates');
end $$;
create or replace function public.retry_email(p_id uuid) returns void language plpgsql security definer set search_path='' as $$
begin if not private.has_feature('settings','email') then raise exception 'Permission denied';end if;
 update public.email_log set status='queued',next_attempt_at=now(),attempts=0,error=null where id=p_id and status='failed';
 insert into public.history(actor_id,action,snapshot) values(private.current_user_id(),'Email retry requested',jsonb_build_object('email_id',p_id));
end $$;
create or replace function public.set_profile_email(p_id uuid,p_email text) returns void language plpgsql security definer set search_path='' as $$
begin if p_id<>private.current_user_id() and not private.permitted('users','edit',p_id) then raise exception 'Permission denied';end if;
 if exists(select 1 from public.profiles where id=p_id and role='super_admin') and p_id<>private.current_user_id() and not private.is_admin() then raise exception 'Only a Super Admin can change a Super Admin account';end if;
 if p_email is not null and p_email<>'' and p_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then raise exception 'Enter a valid email address';end if;
 update public.profiles set email=nullif(lower(trim(p_email)),'') where id=p_id;
 insert into public.history(actor_id,action,snapshot) values(private.current_user_id(),'Email address updated',jsonb_build_object('user_id',p_id));
end $$;
create or replace function public.employee_id_preview(p_department text default null) returns text language plpgsql stable security definer set search_path='' as $$
declare cfg jsonb; n bigint;
begin
 if not private.permitted('employees','create',private.current_user_id()) and not private.has_feature('settings','employee_ids') then raise exception 'Permission denied';end if;
 select data into cfg from public.employee_id_settings where id=1;
 select next_value into n from public.employee_id_sequences where key=private.employee_sequence_key(cfg,p_department);
 return private.format_employee_id(cfg,p_department,coalesce(n,greatest(1,coalesce((cfg->>'start')::bigint,1))));
end $$;
create or replace function public.update_employee_id_settings(p_data jsonb) returns void language plpgsql security definer set search_path='' as $$
begin if not private.has_feature('settings','employee_ids') then raise exception 'Permission denied';end if;
 if jsonb_typeof(p_data)<>'object' or coalesce((p_data->>'digits')::integer,0) not between 1 and 8 or coalesce((p_data->>'start')::bigint,0)<1 or p_data->>'scope' not in ('global','department') or p_data->>'reset' not in ('never','yearly') or length(coalesce(p_data->>'separator',''))>3 or length(coalesce(p_data->>'prefix',''))>20 or length(coalesce(p_data->>'branch_code',''))>10 then raise exception 'Invalid employee ID format';end if;
 if coalesce(p_data->>'prefix','')||coalesce(p_data->>'branch_code','') !~ '^[A-Za-z0-9/_-]*$' then raise exception 'Use letters, numbers, / _ or - in codes';end if;
 update public.employee_id_settings set data=p_data where id=1;
 insert into public.history(actor_id,action,snapshot) values(private.current_user_id(),'Employee ID format updated',p_data);
end $$;
drop policy if exists email_settings_read on public.email_settings;
create policy email_settings_read on public.email_settings for select to techly_user using(private.has_feature('settings','email'));
drop policy if exists email_log_read on public.email_log;
create policy email_log_read on public.email_log for select to techly_user using(private.has_feature('settings','email') or user_id=private.current_user_id());
drop policy if exists employee_id_settings_read on public.employee_id_settings;
create policy employee_id_settings_read on public.employee_id_settings for select to techly_user using(private.has_feature('settings','employee_ids') or private.permitted('employees','create',private.current_user_id()));
create or replace function public.set_leave_policy(p_type text,p_allocation numeric,p_accrual text,p_carry numeric,p_eligibility integer,p_paid boolean) returns void language plpgsql security definer set search_path='' as $$
begin if not private.has_feature('settings','leave_policy') or p_allocation<0 or p_carry<0 or p_eligibility<0 then raise exception 'Permission denied or invalid policy';end if;
 insert into public.leave_policies(type,allocation,accrual,carry_forward,eligibility_days,paid) values(p_type,p_allocation,p_accrual,p_carry,p_eligibility,p_paid) on conflict(type) do update set allocation=excluded.allocation,accrual=excluded.accrual,carry_forward=excluded.carry_forward,eligibility_days=excluded.eligibility_days,paid=excluded.paid;
 insert into public.history(actor_id,action,snapshot) values(private.current_user_id(),'Leave policy updated',jsonb_build_object('type',p_type,'allocation',p_allocation,'accrual',p_accrual,'carry_forward',p_carry,'eligibility_days',p_eligibility,'paid',p_paid));
end $$;
create or replace function public.grant_leave(p_user uuid,p_type text,p_amount numeric,p_reason text,p_key text) returns void language plpgsql security definer set search_path='' as $$
begin if not private.permitted('leave','approve',p_user) or p_user=private.current_user_id() and not private.is_admin() or p_amount<=0 or p_amount>365 or length(trim(p_reason))=0 then raise exception 'Permission denied or invalid grant';end if;
 insert into public.leave_ledger(user_id,type,amount,event_key) values(p_user,p_type,p_amount,'manual:'||p_key) on conflict(event_key) do nothing;
 if not found then return;end if;
 insert into public.history(actor_id,action,snapshot) values(private.current_user_id(),'Manual leave grant',jsonb_build_object('user_id',p_user,'type',p_type,'amount',p_amount,'reason',p_reason));end $$;

-- User administration: delegated, never above the actor's own reach.
create or replace function public.set_profile(p_id uuid,p_name text,p_department text,p_manager uuid,p_role text,p_active boolean) returns void language plpgsql security definer set search_path='' as $$
declare t public.profiles; actor uuid:=private.current_user_id();
begin
 select * into t from public.profiles where id=p_id;
 if t.id is null then raise exception 'User not found';end if;
 if not private.is_admin() then
  if not private.permitted('users','edit',p_id) then raise exception 'Permission denied';end if;
  if t.role='super_admin' then raise exception 'Only a Super Admin can change a Super Admin account';end if;
  if p_role is distinct from t.role then raise exception 'Only a Super Admin can change roles';end if;
  if p_id=actor and not p_active then raise exception 'You cannot deactivate your own account';end if;
 end if;
 if p_role not in ('super_admin','manager','employee') then raise exception 'Invalid role';end if;
 perform pg_advisory_xact_lock(9282731);
 if t.role='super_admin' and t.active and (p_role<>'super_admin' or not p_active) and (select count(*) from public.profiles where role='super_admin' and active)<2 then raise exception 'Keep at least one active Super Admin';end if;
 if p_id=p_manager then raise exception 'Manager cannot report to themselves';end if;
 if p_manager is not null and not exists(select 1 from public.profiles where id=p_manager and active and role in ('manager','super_admin')) then raise exception 'Select an active manager';end if;
 if exists(with recursive chain as (select id,manager_id,array[id] path from public.profiles where id=p_manager union all select p.id,p.manager_id,c.path||p.id from public.profiles p join chain c on c.manager_id=p.id where not p.id=any(c.path)) select 1 from chain where id=p_id) then raise exception 'Reporting relationships cannot form a cycle';end if;
 update public.profiles set full_name=p_name,department=p_department,manager_id=p_manager,role=p_role,active=p_active where id=p_id;
 insert into public.history(actor_id,action,snapshot) values(actor,'User account updated',jsonb_build_object('user_id',p_id,
  'before',jsonb_build_object('full_name',t.full_name,'department',t.department,'manager_id',t.manager_id,'role',t.role,'active',t.active),
  'after',jsonb_build_object('full_name',p_name,'department',p_department,'manager_id',p_manager,'role',p_role,'active',p_active)));
end $$;
-- Called by the server (service role) before creating an account; returns the enforced placement.
create function public.authorize_user_creation(p_actor uuid,p_role text,p_department text,p_manager uuid) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare a public.profiles; s text;
begin
 select * into a from public.profiles where id=p_actor and active and not must_change_password;
 if a.id is null then raise exception 'Please sign in again';end if;
 if p_role not in ('super_admin','manager','employee') then raise exception 'Invalid role';end if;
 if a.role='super_admin' then return jsonb_build_object('department',p_department,'manager',p_manager); end if;
 s:=private.scope_for(p_actor,'users','create');
 if s not in ('team','department','all') then raise exception 'You do not have permission to create users';end if;
 if p_role<>'employee' then raise exception 'Only a Super Admin can create Admin or Super Admin accounts';end if;
 return jsonb_build_object(
  'department',case when s='department' then a.department else p_department end,
  'manager',case when s='team' then a.id else p_manager end);
end $$;

-- Legacy single-grant function: Super Admin only, now validated against the catalogue.
create or replace function public.set_permission(p_user uuid,p_role text,p_module text,p_action text,p_scope text) returns void language plpgsql security definer set search_path='' as $$
begin if not private.is_admin() then raise exception 'Permission denied';end if;
 if not exists(select 1 from public.permission_definitions where module=p_module and action=p_action) then raise exception 'Unknown permission';end if;
 if p_role is not null and p_role not in ('employee','manager') then raise exception 'Role defaults exist only for Admin and Employee';end if;
 insert into public.permission_grants(user_id,role,module,action,scope,updated_at,updated_by) values(p_user,p_role,p_module,p_action,p_scope,now(),private.current_user_id())
 on conflict(user_id,role,module,action) do update set scope=excluded.scope,updated_at=now(),updated_by=private.current_user_id();
 insert into public.history(actor_id,action,snapshot) values(private.current_user_id(),'Permission updated',jsonb_build_object('user_id',p_user,'role',p_role,'module',p_module,'action',p_action,'scope',p_scope));
end $$;

-- Read access follows the new permissions.
drop policy if exists profiles_read on public.profiles;
create policy profiles_read on public.profiles for select to techly_user using(id=private.current_user_id() or private.is_admin() or manager_id=private.current_user_id() or private.permitted('users','view',id) or private.permitted('users','permissions',id));
drop policy if exists grants_read on public.permission_grants;
create policy grants_read on public.permission_grants for select to techly_user using(
 user_id=private.current_user_id() or private.is_admin()
 or role=(select p.role from public.profiles p where p.id=private.current_user_id())
 or (user_id is not null and private.permitted('users','permissions',user_id))
 or (role is not null and private.has_feature('users','permissions')));
drop policy if exists history_read on public.history;
create policy history_read on public.history for select to techly_user using(private.is_admin() or private.visible(record_id) or (private.has_feature('audit','view') and record_id is null));

-- Credentials: separate permissions for listing, revealing, editing and history.
create function private.credential_allowed(p_client uuid,p_action text) returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.records r where r.id=p_client and r.module='clients' and private.visible(r.id) and private.permitted('credentials',p_action,r.owner_id));
$$;
create or replace function private.can_manage_credentials(p_client uuid) returns boolean language sql stable security definer set search_path='' as $$
 select private.credential_allowed(p_client,'edit');
$$;
create or replace function private.can_view_credential_history(p_client uuid) returns boolean language sql stable security definer set search_path='' as $$
 select private.credential_allowed(p_client,'history');
$$;
drop policy if exists client_credentials_read on public.client_credentials;
create policy client_credentials_read on public.client_credentials for select to techly_user using(private.credential_allowed(client_id,'view'));
create or replace function public.credential_secret(p_id uuid,p_version integer,p_purpose text) returns jsonb language plpgsql security definer set search_path='' as $$
declare actor uuid:=private.current_user_id(); c public.client_credentials; s private.credential_secrets; historical boolean; recent integer;
begin
 if p_purpose not in ('reveal','copy') then raise exception 'Invalid request';end if;
 select * into c from public.client_credentials where id=p_id;
 if c.id is null or not private.credential_allowed(c.client_id,'view') then raise exception 'Credential not found';end if;
 historical:=p_version is not null and p_version<>c.current_version;
 if historical then
  if not private.can_view_credential_history(c.client_id) then raise exception 'Only authorized reviewers can open previous passwords';end if;
  if not exists(select 1 from private.vault_unlocks where user_id=actor and expires_at>now()) then raise exception 'Confirm your password to open previous passwords';end if;
 elsif not private.credential_allowed(c.client_id,'reveal') then raise exception 'You do not have permission to reveal or copy passwords';
 end if;
 select count(*) into recent from public.credential_audit where actor_id=actor and action in ('revealed','copied','history_revealed','history_copied') and created_at>now()-interval '1 minute';
 if recent>=30 then raise exception 'Too many password requests. Wait a minute and try again.';end if;
 select * into s from private.credential_secrets where credential_id=p_id and version=coalesce(p_version,c.current_version);
 if s.credential_id is null then raise exception 'Password version not found';end if;
 perform private.credential_audit_write(p_id,c.client_id,case when historical then 'history_' else '' end||case when p_purpose='reveal' then 'revealed' else 'copied' end,s.version);
 return jsonb_build_object('credential_id',p_id,'version',s.version,'key_id',s.key_id,'ciphertext',encode(s.ciphertext,'base64'),'iv',encode(s.iv,'base64'),'tag',encode(s.tag,'base64'));
end $$;
create or replace function public.credential_versions(p_id uuid) returns table(version integer,created_at timestamptz,created_by text,replaced_at timestamptz,replaced_by text,reason text,is_current boolean) language plpgsql security definer set search_path='' as $$
declare c public.client_credentials;
begin
 select * into c from public.client_credentials where id=p_id;
 if c.id is null or not private.credential_allowed(c.client_id,'view') then raise exception 'Credential not found';end if;
 perform private.credential_audit_write(p_id,c.client_id,'history_viewed',c.current_version);
 return query select s.version,s.created_at,coalesce(a.full_name,'Unknown'),s.replaced_at,b.full_name,s.reason,s.version=c.current_version
  from private.credential_secrets s left join public.profiles a on a.id=s.created_by left join public.profiles b on b.id=s.replaced_by
  where s.credential_id=p_id order by s.version desc;
end $$;

-- Chat: access and group creation are permissions too.
create or replace function public.start_direct_conversation(p_user uuid) returns uuid language plpgsql security definer set search_path='' as $$
declare me uuid:=private.current_user_id(); k text; cid uuid;
begin
 if not private.has_feature('chat','view') then raise exception 'You do not have access to chat';end if;
 if not private.can_chat_with(p_user) then raise exception 'Direct messages with this person are not permitted by company policy';end if;
 k:=least(me::text,p_user::text)||':'||greatest(me::text,p_user::text);
 select id into cid from public.conversations where direct_key=k;
 if cid is null then
  insert into public.conversations(kind,created_by,direct_key) values('direct',me,k) returning id into cid;
  insert into public.conversation_members(conversation_id,user_id) values(cid,me),(cid,p_user);
 end if;
 return cid;
end $$;
create or replace function public.create_group(p_name text,p_members uuid[],p_department text default null,p_project uuid default null,p_official boolean default false) returns uuid language plpgsql security definer set search_path='' as $$
declare me public.profiles; cid uuid; pol text; m uuid;
begin
 select * into me from public.profiles where id=private.current_user_id();
 if not private.has_feature('chat','view') then raise exception 'You do not have access to chat';end if;
 pol:=coalesce(private.chat_policy()->>'group_creation','managers');
 if not (me.role='super_admin' or (pol='managers' and me.role='manager') or pol='everyone' or private.has_feature('chat','create_group')) then raise exception 'You do not have permission to create groups';end if;
 if p_official and me.role<>'super_admin' then raise exception 'Only Super Admins create official groups';end if;
 if p_project is not null and not private.visible(p_project) then raise exception 'Project not accessible';end if;
 insert into public.conversations(kind,name,department,project_id,official,created_by) values('group',trim(p_name),nullif(p_department,''),p_project,p_official,me.id) returning id into cid;
 insert into public.conversation_members(conversation_id,user_id,role) values(cid,me.id,'admin');
 foreach m in array coalesce(p_members,'{}') loop
  if m<>me.id and exists(select 1 from public.profiles where id=m and active) then insert into public.conversation_members(conversation_id,user_id) values(cid,m) on conflict do nothing; end if;
 end loop;
 if p_department is not null and p_department<>'' then insert into public.conversation_members(conversation_id,user_id) select cid,id from public.profiles where active and department=p_department on conflict do nothing; end if;
 if p_project is not null then insert into public.conversation_members(conversation_id,user_id) select cid,x::uuid from public.records r, jsonb_array_elements_text(coalesce(r.data->'team','[]')) x where r.id=p_project and exists(select 1 from public.profiles where id=x::uuid and active) on conflict do nothing;
  insert into public.conversation_members(conversation_id,user_id) select cid,owner_id from public.records where id=p_project on conflict do nothing; end if;
 insert into public.history(actor_id,action,snapshot) values(me.id,'Chat group created',jsonb_build_object('conversation_id',cid,'name',p_name,'official',p_official));
 return cid;
end $$;
-- Revoking chat access stops sending immediately (reading stays limited to own conversations by RLS).
create or replace function private.is_member(cid uuid) returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.conversation_members where conversation_id=cid and user_id=private.current_user_id()) and private.has_feature('chat','view');
$$;

-- ---------------------------------------------------------------------------
-- Permission history, templates and management functions.
-- ---------------------------------------------------------------------------
create table public.permission_audit(
 id bigint generated always as identity primary key,
 target_user uuid references public.profiles(id),
 target_role text check(target_role is null or target_role in ('employee','manager')),
 actor_id uuid not null references public.profiles(id),
 source text not null check(source in ('user','role','template','reset','copy')),
 changes jsonb not null,  -- [{module,action,before,after}]
 reason text not null default '' check(length(reason)<=1000),
 created_at timestamptz not null default now(),
 check((target_user is null)<>(target_role is null))
);
create index permission_audit_user_idx on public.permission_audit(target_user,created_at desc);
create index permission_audit_role_idx on public.permission_audit(target_role,created_at desc);
alter table public.permission_audit enable row level security;
create policy permission_audit_read on public.permission_audit for select to techly_user using(
 private.is_admin() or target_user=private.current_user_id() or (target_user is not null and private.permitted('users','permissions',target_user)) or private.has_feature('audit','view'));
grant select on public.permission_audit to techly_user;
grant all on public.permission_audit to techly_service;

create table public.permission_templates(
 id uuid primary key default gen_random_uuid(),
 name text not null check(length(trim(name)) between 1 and 80),
 description text not null default '' check(length(description)<=500),
 items jsonb not null check(jsonb_typeof(items)='array'),
 created_by uuid not null references public.profiles(id),
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now()
);
create unique index permission_templates_name_idx on public.permission_templates(lower(name));
alter table public.permission_templates enable row level security;
create policy permission_templates_read on public.permission_templates for select to techly_user using(private.is_admin() or private.has_feature('users','permissions'));
grant select on public.permission_templates to techly_user;
grant all on public.permission_templates to techly_service;

-- Effective permissions of a user, with where each value comes from.
create function public.effective_permissions(p_user uuid) returns table(module text,action text,scope text,role_scope text,override_scope text) language plpgsql stable security definer set search_path='' as $$
declare t public.profiles;
begin
 select * into t from public.profiles where id=p_user;
 if t.id is null then raise exception 'User not found';end if;
 if p_user<>private.current_user_id() and not private.is_admin() and not private.permitted('users','permissions',p_user) and not private.permitted('users','view',p_user) then raise exception 'Permission denied';end if;
 return query select d.module,d.action,
  case when t.role='super_admin' then 'all' else coalesce(u.scope,r.scope,'none') end,
  case when t.role='super_admin' then 'all' else coalesce(r.scope,'none') end,
  u.scope
 from public.permission_definitions d
 left join public.permission_grants r on r.user_id is null and r.role=t.role and r.module=d.module and r.action=d.action
 left join public.permission_grants u on u.user_id=t.id and u.role is null and u.module=d.module and u.action=d.action
 where not d.hidden order by d.sort;
end $$;
-- What the current user may hand out, and how widely.
create function public.delegable_permissions() returns table(module text,action text,max_scope text) language sql stable security definer set search_path='' as $$
 select d.module,d.action,private.scope_for(private.current_user_id(),d.module,d.action)
 from public.permission_definitions d
 where not d.hidden and (private.is_admin() or private.has_feature('users','permissions'))
   and private.scope_for(private.current_user_id(),d.module,d.action)<>'none'
 order by d.sort;
$$;
-- Core writer. p_items: [{module,action,scope}] = desired effective scope per permission.
-- Items not listed are left unchanged. Overrides equal to the role default are removed,
-- so the user keeps inheriting future role-default changes for them.
create function private.apply_user_permissions(p_user uuid,p_items jsonb,p_reason text,p_source text,p_strict boolean) returns integer language plpgsql security definer set search_path='' as $$
declare actor uuid:=private.current_user_id(); admin boolean:=private.is_admin(); t public.profiles; i jsonb; d public.permission_definitions;
 want text; role_s text; ov text; old text; mine text; changes jsonb:='[]'::jsonb;
begin
 select * into t from public.profiles where id=p_user;
 if t.id is null then raise exception 'User not found';end if;
 if t.role='super_admin' then raise exception 'Super Admins always have full access; their permissions cannot be changed';end if;
 if not admin then
  if not private.permitted('users','permissions',p_user) then raise exception 'You do not have permission to manage this user''s access';end if;
  if p_user=actor then raise exception 'You cannot change your own permissions';end if;
 end if;
 if jsonb_typeof(p_items)<>'array' then raise exception 'Invalid permission list';end if;
 perform pg_advisory_xact_lock(hashtextextended('perm:'||p_user::text,0));
 for i in select * from jsonb_array_elements(p_items) loop
  select * into d from public.permission_definitions where module=i->>'module' and action=i->>'action' and not hidden;
  if d.module is null then raise exception 'Unknown permission %.%',i->>'module',i->>'action';end if;
  want:=coalesce(i->>'scope','none');
  if want not in ('none','self','team','department','all') then raise exception 'Invalid scope %',want;end if;
  if not d.scoped and want<>'none' then want:='all'; end if;
  select scope into role_s from public.permission_grants where user_id is null and role=t.role and module=d.module and action=d.action;
  role_s:=coalesce(role_s,'none');
  select scope into ov from public.permission_grants where user_id=t.id and role is null and module=d.module and action=d.action;
  old:=coalesce(ov,role_s);
  if old=want and (ov is null or ov<>role_s) then continue; end if;
  if not admin then
   mine:=private.scope_for(actor,d.module,d.action);
   if not (private.scope_covers(mine,want) and private.scope_covers(mine,old)) then
    if p_strict then raise exception 'You can only assign permissions you hold yourself (%: %)',d.module_label,d.label; end if;
    continue;
   end if;
  end if;
  if want=role_s then delete from public.permission_grants where user_id=t.id and role is null and module=d.module and action=d.action;
  else insert into public.permission_grants(user_id,module,action,scope,updated_at,updated_by) values(t.id,d.module,d.action,want,now(),actor)
   on conflict(user_id,role,module,action) do update set scope=excluded.scope,updated_at=now(),updated_by=actor;
  end if;
  if old<>want then changes:=changes||jsonb_build_object('module',d.module,'action',d.action,'before',old,'after',want); end if;
 end loop;
 if jsonb_array_length(changes)>0 then
  insert into public.permission_audit(target_user,actor_id,source,changes,reason) values(t.id,actor,p_source,changes,left(coalesce(p_reason,''),1000));
 end if;
 return jsonb_array_length(changes);
end $$;
create function public.save_user_permissions(p_user uuid,p_items jsonb,p_reason text default '') returns integer language sql security definer set search_path='' as $$
 select private.apply_user_permissions(p_user,p_items,p_reason,'user',true);
$$;
-- Copy another user's effective permissions (only what the actor may delegate).
create function public.copy_user_permissions(p_from uuid,p_to uuid,p_reason text default '') returns integer language plpgsql security definer set search_path='' as $$
declare items jsonb;
begin
 select coalesce(jsonb_agg(jsonb_build_object('module',e.module,'action',e.action,'scope',e.scope)),'[]') into items from public.effective_permissions(p_from) e;
 return private.apply_user_permissions(p_to,items,coalesce(nullif(p_reason,''),'Copied from another user'),'copy',false);
end $$;
-- Remove individual overrides so the user inherits the role defaults again.
create function public.reset_user_permissions(p_user uuid,p_reason text default '') returns integer language plpgsql security definer set search_path='' as $$
declare t public.profiles; items jsonb;
begin
 select * into t from public.profiles where id=p_user;
 if t.id is null then raise exception 'User not found';end if;
 select coalesce(jsonb_agg(jsonb_build_object('module',u.module,'action',u.action,'scope',coalesce(r.scope,'none'))),'[]') into items
 from public.permission_grants u left join public.permission_grants r on r.user_id is null and r.role=t.role and r.module=u.module and r.action=u.action
 join public.permission_definitions d on d.module=u.module and d.action=u.action and not d.hidden
 where u.user_id=t.id and u.role is null;
 return private.apply_user_permissions(p_user,items,coalesce(nullif(p_reason,''),'Reset to role defaults'),'reset',false);
end $$;
-- Role defaults (Super Admin only). p_apply: 'all' updates everyone who inherits the default;
-- 'new_only' keeps existing users on their current access by recording it as overrides.
create function public.save_role_permissions(p_role text,p_items jsonb,p_apply text default 'all',p_reason text default '') returns integer language plpgsql security definer set search_path='' as $$
declare actor uuid:=private.current_user_id(); i jsonb; d public.permission_definitions; want text; old text; changes jsonb:='[]'::jsonb;
begin
 if not private.is_admin() then raise exception 'Only a Super Admin can change role defaults';end if;
 if p_role not in ('employee','manager') then raise exception 'Role defaults exist only for Admin and Employee';end if;
 if p_apply not in ('all','new_only') then raise exception 'Choose who the change applies to';end if;
 perform pg_advisory_xact_lock(hashtextextended('role:'||p_role,0));
 for i in select * from jsonb_array_elements(p_items) loop
  select * into d from public.permission_definitions where module=i->>'module' and action=i->>'action' and not hidden;
  if d.module is null then raise exception 'Unknown permission %.%',i->>'module',i->>'action';end if;
  want:=coalesce(i->>'scope','none');
  if want not in ('none','self','team','department','all') then raise exception 'Invalid scope %',want;end if;
  if not d.scoped and want<>'none' then want:='all'; end if;
  select scope into old from public.permission_grants where user_id is null and role=p_role and module=d.module and action=d.action;
  old:=coalesce(old,'none');
  if old=want then continue; end if;
  if p_apply='new_only' then
   insert into public.permission_grants(user_id,module,action,scope,updated_at,updated_by)
   select p.id,d.module,d.action,old,now(),actor from public.profiles p
   where p.role=p_role and not exists(select 1 from public.permission_grants g where g.user_id=p.id and g.module=d.module and g.action=d.action);
  end if;
  if want='none' then delete from public.permission_grants where user_id is null and role=p_role and module=d.module and action=d.action;
  else insert into public.permission_grants(role,module,action,scope,updated_at,updated_by) values(p_role,d.module,d.action,want,now(),actor)
   on conflict(user_id,role,module,action) do update set scope=excluded.scope,updated_at=now(),updated_by=actor;
  end if;
  changes:=changes||jsonb_build_object('module',d.module,'action',d.action,'before',old,'after',want);
 end loop;
 if jsonb_array_length(changes)>0 then
  insert into public.permission_audit(target_role,actor_id,source,changes,reason) values(p_role,actor,'role',changes,left(coalesce(p_reason,''),1000)||case when p_apply='new_only' then ' [new users only]' else '' end);
 end if;
 return jsonb_array_length(changes);
end $$;
create function public.save_permission_template(p_id uuid,p_name text,p_description text,p_items jsonb) returns uuid language plpgsql security definer set search_path='' as $$
declare tid uuid; i jsonb;
begin
 if not private.is_admin() and not private.has_feature('users','permissions') then raise exception 'Permission denied';end if;
 if jsonb_typeof(p_items)<>'array' then raise exception 'Invalid template';end if;
 for i in select * from jsonb_array_elements(p_items) loop
  if not exists(select 1 from public.permission_definitions where module=i->>'module' and action=i->>'action' and not hidden) or coalesce(i->>'scope','') not in ('none','self','team','department','all') then raise exception 'Invalid template item';end if;
 end loop;
 if p_id is null then
  insert into public.permission_templates(name,description,items,created_by) values(trim(p_name),coalesce(p_description,''),p_items,private.current_user_id()) returning id into tid;
 else
  update public.permission_templates set name=trim(p_name),description=coalesce(p_description,''),items=p_items,updated_at=now()
   where id=p_id and (created_by=private.current_user_id() or private.is_admin()) returning id into tid;
  if tid is null then raise exception 'Template not found';end if;
 end if;
 insert into public.history(actor_id,action,snapshot) values(private.current_user_id(),'Permission template saved',jsonb_build_object('template_id',tid,'name',trim(p_name)));
 return tid;
exception when unique_violation then raise exception 'A template with this name already exists';
end $$;
create function public.delete_permission_template(p_id uuid) returns void language plpgsql security definer set search_path='' as $$
begin
 delete from public.permission_templates where id=p_id and (created_by=private.current_user_id() or private.is_admin());
 if not found then raise exception 'Template not found';end if;
 insert into public.history(actor_id,action,snapshot) values(private.current_user_id(),'Permission template deleted',jsonb_build_object('template_id',p_id));
end $$;
-- Apply a template as the user's complete access: permissions not in the template are removed.
create function public.apply_permission_template(p_template uuid,p_users uuid[],p_reason text default '') returns integer language plpgsql security definer set search_path='' as $$
declare tpl public.permission_templates; u uuid; items jsonb; total integer:=0;
begin
 select * into tpl from public.permission_templates where id=p_template;
 if tpl.id is null then raise exception 'Template not found';end if;
 if coalesce(array_length(p_users,1),0) not between 1 and 200 then raise exception 'Select between 1 and 200 users';end if;
 select jsonb_agg(jsonb_build_object('module',d.module,'action',d.action,'scope',coalesce((select x->>'scope' from jsonb_array_elements(tpl.items) x where x->>'module'=d.module and x->>'action'=d.action limit 1),'none')))
  into items from public.permission_definitions d where not d.hidden;
 foreach u in array p_users loop
  total:=total+private.apply_user_permissions(u,items,coalesce(nullif(p_reason,''),'Template: '||tpl.name),'template',false);
 end loop;
 return total;
end $$;

-- ---------------------------------------------------------------------------
-- Grants
-- ---------------------------------------------------------------------------
revoke all on function private.scope_for(uuid,text,text),private.scope_covers(text,text),private.has_feature(text,text),private.credential_allowed(uuid,text),private.apply_user_permissions(uuid,jsonb,text,text,boolean) from public,techly_anon,techly_user;
grant execute on function private.has_feature(text,text),private.scope_covers(text,text),private.credential_allowed(uuid,text) to techly_user;
grant execute on function private.scope_for(uuid,text,text),private.permitted_for(uuid,text,text,uuid) to techly_service;
revoke all on function public.effective_permissions(uuid),public.delegable_permissions(),public.save_user_permissions(uuid,jsonb,text),public.copy_user_permissions(uuid,uuid,text),public.reset_user_permissions(uuid,text),public.save_role_permissions(text,jsonb,text,text),public.save_permission_template(uuid,text,text,jsonb),public.delete_permission_template(uuid),public.apply_permission_template(uuid,uuid[],text),public.authorize_user_creation(uuid,text,text,uuid) from public,techly_anon,techly_user,techly_service;
grant execute on function public.effective_permissions(uuid),public.delegable_permissions(),public.save_user_permissions(uuid,jsonb,text),public.copy_user_permissions(uuid,uuid,text),public.reset_user_permissions(uuid,text),public.save_role_permissions(text,jsonb,text,text),public.save_permission_template(uuid,text,text,jsonb),public.delete_permission_template(uuid),public.apply_permission_template(uuid,uuid[],text) to techly_user;
grant execute on function public.authorize_user_creation(uuid,text,text,uuid) to techly_service;
grant execute on function public.set_leave_policy(text,numeric,text,numeric,integer,boolean),public.grant_leave(uuid,text,numeric,text,text) to techly_user;
commit;
