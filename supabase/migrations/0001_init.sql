-- 출근체크 서버 스키마.
-- Supabase SQL Editor 에 붙여 넣거나 `supabase db push` 로 적용한다.

create table public.employees (
  id uuid primary key default gen_random_uuid(),
  employee_no text not null unique,
  name text not null,
  department text not null,
  position text not null,
  -- manager 는 같은 부서의 휴가 신청을 결재하고 근무지 설정을 바꾼다.
  role text not null default 'member' check (role in ('member', 'manager')),
  -- bcrypt 해시
  password_hash text not null,
  -- 연차 부여 일수의 기준
  hired_at date not null default current_date,
  -- 따로 정한 연간 연차. null 이면 근속연수로 계산한다.
  annual_leave_days numeric(5, 2),
  -- false 면 로그인과 기존 토큰이 모두 막힌다.
  active boolean not null default true,
  created_at timestamptz not null default now()
);

-- 근무지(사업장). 앱은 단일 사업장만 쓰므로 가장 먼저 만든 한 줄을 읽는다.
create table public.worksites (
  id text primary key,
  name text not null,
  latitude double precision not null check (latitude between -90 and 90),
  longitude double precision not null check (longitude between -180 and 180),
  radius_meters integer not null check (radius_meters > 0),
  start_hour smallint not null check (start_hour between 0 and 23),
  start_minute smallint not null default 0 check (start_minute between 0 and 59),
  end_hour smallint not null check (end_hour between 0 and 23),
  end_minute smallint not null default 0 check (end_minute between 0 and 59),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.attendance_records (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references public.employees (id) on delete cascade,
  -- 근무일 (APP_TIMEZONE 기준)
  work_date date not null,
  check_in_at timestamptz not null,
  -- { latitude, longitude, accuracy }
  check_in_location jsonb,
  check_out_at timestamptz,
  check_out_location jsonb,
  worked_minutes integer,
  -- 퇴근 전에는 'working' 으로 두고, 읽을 때 날짜가 지났으면 'missingCheckOut' 으로 내려준다.
  status text not null check (
    status in ('working', 'normal', 'late', 'earlyLeave', 'lateAndEarlyLeave', 'missingCheckOut')
  ),
  note text,
  created_at timestamptz not null default now(),
  -- 하루에 한 번만 출근할 수 있다. 동시에 들어온 출근 요청도 여기서 걸러진다.
  unique (employee_id, work_date)
);

create table public.leave_requests (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references public.employees (id) on delete cascade,
  -- 신청 시점의 이름·부서. 결재 권한도 이 부서로 따진다.
  employee_name text not null,
  department text not null,
  type text not null check (type in ('annual', 'halfAm', 'halfPm', 'hourly')),
  start_date date not null,
  end_date date not null,
  -- 시차만. HH:mm
  start_time text,
  end_time text,
  days numeric(6, 3) not null check (days > 0),
  reason text,
  status text not null default 'pending' check (
    status in ('pending', 'approved', 'rejected', 'cancelled')
  ),
  requested_at timestamptz not null default now(),
  decided_at timestamptz,
  decided_by text,
  check (end_date >= start_date)
);

create index leave_requests_employee_idx on public.leave_requests (employee_id, start_date);
create index leave_requests_inbox_idx on public.leave_requests (department, start_date)
  where status = 'pending';

-- 공휴일. 휴가 차감 일수에서 빠진다. 해마다 관리자가 채워 넣는다.
create table public.holidays (
  date date primary key,
  name text not null
);

-- 서버(service_role)만 접근한다. 정책을 두지 않아 anon·authenticated 키로는 아무것도 읽지 못한다.
alter table public.employees enable row level security;
alter table public.worksites enable row level security;
alter table public.attendance_records enable row level security;
alter table public.leave_requests enable row level security;
alter table public.holidays enable row level security;

-- 기본 근무지 (서울시청). 앱 설정 화면이나 PATCH /worksite 로 옮긴다.
insert into public.worksites
  (id, name, latitude, longitude, radius_meters, start_hour, start_minute, end_hour, end_minute)
values
  ('hq', '본사', 37.5666805, 126.9784147, 200, 9, 0, 18, 0);
