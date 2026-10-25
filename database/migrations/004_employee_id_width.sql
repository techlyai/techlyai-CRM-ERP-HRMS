begin;

-- lpad truncates values longer than its requested width. Treat configured
-- digits as the minimum width so the sequence stays unique after 999, etc.
create or replace function private.format_employee_id(cfg jsonb,dept text,n bigint)
returns text language plpgsql stable set search_path='' as $$
declare
 parts text[]:=array[]::text[];
 sep text:=coalesce(cfg->>'separator','-');
 digits integer:=greatest(1,least(8,coalesce((cfg->>'digits')::integer,3)));
begin
 if coalesce(cfg->>'prefix','')<>'' then parts:=parts||(cfg->>'prefix'); end if;
 if coalesce((cfg->>'include_department')::boolean,false) and private.department_code(dept)<>'' then parts:=parts||private.department_code(dept); end if;
 if coalesce(cfg->>'branch_code','')<>'' then parts:=parts||(cfg->>'branch_code'); end if;
 if coalesce((cfg->>'include_year')::boolean,false) then parts:=parts||to_char(now(),'YYYY'); end if;
 parts:=parts||lpad(n::text,greatest(digits,length(n::text)),'0');
 return array_to_string(parts,sep);
end $$;

commit;
