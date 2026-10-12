import { writeFileSync } from "node:fs";
import { modules } from "../src/lib/modules";
const contract = Object.fromEntries(
  modules.map((m) => [
    m.key,
    {
      statuses: m.statuses,
      fields: m.fields.map((f) => ({
        ...f,
        required: f.required || f.label.includes("*"),
      })),
    },
  ]),
);
writeFileSync(
  "database/contracts.sql",
  `-- Generated from src/lib/modules.ts by npm exec tsx scripts/generate-contracts.ts\nbegin;\ncreate table private.module_contracts(module text primary key,definition jsonb not null);\ninsert into private.module_contracts(module,definition) select key,value from jsonb_each('${JSON.stringify(contract).replaceAll("'", "''")}'::jsonb);\nalter table private.module_contracts enable row level security;\n\ncreate function private.validate_record_data(m text,d jsonb) returns void language plpgsql set search_path='' as $$
declare c jsonb; f jsonb; k text; v jsonb; s text; numeric_value numeric;
begin
 select definition into c from private.module_contracts where module=m;
 if c is null or jsonb_typeof(d)<>'object' then raise exception 'Invalid module data';end if;
 for k in select jsonb_object_keys(d) loop
  if not exists(select 1 from jsonb_array_elements(c->'fields') field where field->>'key'=k) then raise exception 'Unknown or protected field: %',k;end if;
 end loop;
 for f in select * from jsonb_array_elements(c->'fields') loop
  k:=f->>'key';v:=d->k;s:=d->>k;
  if coalesce((f->>'required')::boolean,false) and (v is null or v='null' or trim(coalesce(s,''))='') then raise exception 'Required field: %',k;end if;
  if v is null or v='null' or s='' then continue;end if;
  if f->>'type'='number' then
   if jsonb_typeof(v)<>'number' then raise exception 'Invalid number: %',k;end if;
   numeric_value:=s::numeric;if numeric_value<0 or numeric_value>1000000000000 then raise exception 'Number out of bounds: %',k;end if;
   if k in ('amount','salary','allowances','deductions','unit_cost','gst','budget','purchase_value') and round(numeric_value,2)<>numeric_value then raise exception 'Use at most two decimal places: %',k;end if;
  elsif f->>'type'='json' then
   if jsonb_typeof(v) not in ('array','object') then raise exception 'Invalid structured field: %',k;end if;
  else
   if jsonb_typeof(v)<>'string' or length(s)>20000 then raise exception 'Invalid text field: %',k;end if;
   if f->>'type'='date' and (s!~'^\\d{4}-\\d{2}-\\d{2}$' or (s::date)::text<>s) then raise exception 'Invalid date: %',k;end if;
   if f->>'type'='select' and not (f->'options') @> to_jsonb(s) then raise exception 'Invalid option: %',k;end if;
   if f->>'type'='user' then perform s::uuid;end if;
   if f->>'type'='datetime' then perform s::timestamptz;end if;
   if k='phone' and s!~'^\\+[1-9][0-9]{7,14}$' then raise exception 'Use a phone number with country code';end if;
   if f->>'type'='url' and s!~'^https://' then raise exception 'HTTPS link required';end if;
  end if;
 end loop;
 if m='leave' and (d->>'end_date')::date<(d->>'start_date')::date then raise exception 'Leave end precedes start';end if;
 if m='leave' and (d->>'end_date')::date-(d->>'start_date')::date>366 then raise exception 'Leave duration limit is 366 days';end if;
 if m='payroll' and coalesce((d->>'deductions')::numeric,0)>(d->>'salary')::numeric+coalesce((d->>'allowances')::numeric,0) then raise exception 'Deductions exceed salary plus allowances';end if;
 if d->>'frequency'='Custom' and (coalesce((d->>'custom_days')::numeric,0) not between 1 and 3660 or (d->>'custom_days')::numeric<>trunc((d->>'custom_days')::numeric)) then raise exception 'Enter custom cycle days';end if;
 if d->>'minimum_stock' is not null and (d->>'minimum_stock')::numeric<>trunc((d->>'minimum_stock')::numeric) then raise exception 'Minimum stock must be a whole number';end if;
 if d->>'tax_percent' is not null and (d->>'tax_percent')::numeric>100 then raise exception 'Invalid tax percentage';end if;
 if d->>'project_id' is not null and not exists(select 1 from public.records where id=(d->>'project_id')::uuid and module='projects' and private.visible(id)) then raise exception 'Select an accessible project';end if;
 if m='purchases' then
  if jsonb_typeof(d->'lines')<>'array' or jsonb_array_length(d->'lines') not between 1 and 100 then raise exception 'Add 1 to 100 purchase lines';end if;
  if (select count(*) from jsonb_array_elements(d->'lines'))<>(select count(distinct x->>'item_id') from jsonb_array_elements(d->'lines') x) then raise exception 'Duplicate purchase item';end if;
  for f in select * from jsonb_array_elements(d->'lines') loop
   if not (f ?& array['item_id','quantity','unit_cost']) or jsonb_typeof(f->'quantity')<>'number' or jsonb_typeof(f->'unit_cost')<>'number' then raise exception 'Complete each purchase item, quantity, and unit cost';end if;
   if round((f->>'unit_cost')::numeric,2)<>(f->>'unit_cost')::numeric then raise exception 'Unit cost supports two decimal places';end if;
   perform (f->>'item_id')::uuid;
   if not exists(select 1 from public.records where id=(f->>'item_id')::uuid and module='inventory' and status='Active') then raise exception 'Stock item not found';end if;
   if (f->>'quantity')::numeric<>trunc((f->>'quantity')::numeric) or (f->>'quantity')::numeric not between 1 and 1000000 or (f->>'unit_cost')::numeric not between 0 and 1000000000000 then raise exception 'Invalid purchase line';end if;
  end loop;
  if round((select sum((x->>'quantity')::numeric*(x->>'unit_cost')::numeric) from jsonb_array_elements(d->'lines') x)+coalesce((d->>'gst')::numeric,0),2)<>(d->>'amount')::numeric then raise exception 'Purchase total must equal line totals plus GST';end if;
 end if;
end $$;
revoke all on function private.validate_record_data(text,jsonb) from public,techly_anon,techly_user;
commit;\n`,
);
console.log("Generated module contracts.");
