-- 여러 회사가 함께 쓰도록 회사(companies)를 두고, 직원·근무지·휴가를 회사별로 가른다.
-- 0001_init.sql 을 적용한 DB 에 이어서 실행한다. 이미 있던 데이터는 '데모회사' 로 옮겨진다.

create table public.companies (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  -- 같은 회사를 가리는 기준. 앞뒤 공백을 떼고 소문자로 바꾼 이름 (서버가 채운다)
  name_key text not null unique,
  created_at timestamptz not null default now()
);

alter table public.companies enable row level security;

insert into public.companies (name, name_key) values ('데모회사', '데모회사');

-- 직원: 사번은 회사 안에서만 겹치지 않으면 된다.
alter table public.employees add column company_id uuid references public.companies (id) on delete cascade;
update public.employees set company_id = (select id from public.companies where name_key = '데모회사');
alter table public.employees alter column company_id set not null;
alter table public.employees drop constraint employees_employee_no_key;
alter table public.employees add constraint employees_company_employee_no_key unique (company_id, employee_no);

-- 근무지: 회사마다 하나.
alter table public.worksites add column company_id uuid references public.companies (id) on delete cascade;
update public.worksites set company_id = (select id from public.companies where name_key = '데모회사');
alter table public.worksites alter column company_id set not null;
alter table public.worksites add constraint worksites_company_id_key unique (company_id);
alter table public.worksites alter column id set default gen_random_uuid()::text;

-- 휴가: 결재함을 회사 + 부서로 찾는다.
alter table public.leave_requests add column company_id uuid references public.companies (id) on delete cascade;
update public.leave_requests l set company_id = e.company_id from public.employees e where e.id = l.employee_id;
alter table public.leave_requests alter column company_id set not null;
drop index public.leave_requests_inbox_idx;
create index leave_requests_inbox_idx on public.leave_requests (company_id, department, start_date)
  where status = 'pending';

-- 회사 등록: 회사 · 기본 근무지 · 첫 직원(관리자)을 한 번에 만든다.
-- 중간에 실패해 관리자 없는 회사가 남지 않도록 한 트랜잭션으로 묶는다.
-- 같은 이름의 회사가 이미 있으면 unique_violation(23505)이 난다.
create function public.create_company_with_owner(
  p_company_name text,
  p_company_key text,
  p_employee_no text,
  p_name text,
  p_department text,
  p_position text,
  p_password_hash text
) returns uuid
language plpgsql
set search_path = public
as $$
declare
  v_company_id uuid;
  v_employee_id uuid;
begin
  insert into companies (name, name_key) values (p_company_name, p_company_key)
    returning id into v_company_id;

  -- 기본 근무지 (서울시청). 관리자가 앱 설정 화면에서 옮긴다.
  insert into worksites
    (company_id, name, latitude, longitude, radius_meters, start_hour, start_minute, end_hour, end_minute)
  values
    (v_company_id, '본사', 37.5666805, 126.9784147, 200, 9, 0, 18, 0);

  insert into employees (company_id, employee_no, name, department, position, role, password_hash)
  values (v_company_id, p_employee_no, p_name, p_department, p_position, 'manager', p_password_hash)
    returning id into v_employee_id;

  return v_employee_id;
end;
$$;

revoke execute on function public.create_company_with_owner(text, text, text, text, text, text, text)
  from public, anon, authenticated;
grant execute on function public.create_company_with_owner(text, text, text, text, text, text, text)
  to service_role;
